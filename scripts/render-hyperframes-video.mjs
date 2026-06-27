#!/usr/bin/env node
// Render a presentation manifest as an MP4 using the HyperFrames CLI.
//
// Usage:
//   node scripts/render-hyperframes-video.mjs ct-head
//   node scripts/render-hyperframes-video.mjs mr-knee
//   npm run render:hyperframes:ct-head
//
// Manifest resolution (in priority order):
//   1. web/generated/hyperframes/<accession>/presentation.json
//      Written by scripts/export-hyperframes-evidence.mjs — includes real
//      image evidence (asset paths to captured CT screenshots).
//   2. Built from the demo report registry (no image evidence).
//      Used when presentation.json does not yet exist.
//
// Output:
//   web/generated/hyperframes/<accession>/index.html   — HyperFrames composition
//   web/generated/hyperframes/<accession>/meta.json    — project metadata
//   web/generated/hyperframes/<accession>/hyperframes.json
//   web/generated/hyperframes/<accession>/renders/<accession>.mp4
//   web/generated/hyperframes/<accession>/render.json  — render metadata
//
// Notes:
//   - web/generated/ is gitignored; do not commit generated files.
//   - Requires: ffmpeg, Chrome (auto-installed by hyperframes), Node 18+.
//   - Run npm run build:hyperframes:ct-head to export + render in one step.

import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Scene timing mirrors htmlPresentationExporter.mjs (title 3 + summary 4 +
// per-finding 9 [text 3 + image 6] + closing 5). The first finding's CT image
// beat starts at 3+4+3 = 10s and runs 6s, so its midpoint is 13s — used for the
// render-input screenshot and the post-render frame check.
const SLIDE1_MID = 13.0;

const { exportHtmlComposition } =
  await import(`${ROOT}/web/esm/lv/presentation/htmlPresentationExporter.mjs`);

// Heuristic: does an extracted MP4 frame contain a real CT image (vs the dark
// "No image captured" placeholder)? We crop the right ~62% of the frame (where
// the image panel lives), downscale to a tiny grayscale buffer, and measure the
// fraction of pixels brighter than the mid-gray cutoff (90). A real CT image —
// skull ring plus mid-gray brain tissue — measures ~0.12; the placeholder panel
// (all colours below ~70 luma) measures ~0.00, giving a wide separation.
async function frameContainsImage(framePath) {
  // The CT image is centered full-frame (object-fit:contain); sample the center
  // 60% where the skull/brain pixels live.
  const ff = spawnSync('ffmpeg', [
    '-i', framePath,
    '-vf', 'crop=in_w*0.6:in_h:in_w*0.2:0,scale=80:45,format=gray',
    '-f', 'rawvideo', '-',
  ], { maxBuffer: 1 << 20, timeout: 30_000 });
  if (ff.status !== 0 || !ff.stdout || ff.stdout.length === 0) return null;
  const px = ff.stdout;
  let bright = 0;
  for (let i = 0; i < px.length; i++) if (px[i] > 90) bright++;
  const fraction = bright / px.length;
  // Real CT frames measured ~0.12; placeholder ~0.00. Threshold 0.03 = ~4× margin.
  return fraction > 0.03;
}

const { resolveTarget } = await import(`${ROOT}/scripts/lib/resolveTarget.mjs`);
const { accession, label: targetName } = resolveTarget(process.argv.slice(2));

// --style v2 flag: selects the V2 presentation style and writes to style-suffixed
// output files so V1 and V2 artifacts coexist in the same project directory.
const styleArg = process.argv.find((a, i, arr) => (a === '--style') && arr[i + 1]) || null;
const presentationStyle = styleArg ? process.argv[process.argv.indexOf('--style') + 1] : 'v1';
const styleSuffix = presentationStyle !== 'v1' ? `-${presentationStyle}` : '';

console.log(`\n=== HyperFrames MP4 render: ${targetName} (${accession}) [style: ${presentationStyle}] ===\n`);

// projectDir always points at the V1 project (where presentation.json and
// evidence assets live). For V2 the composition and renders go to a separate
// sibling directory so both HyperFrames projects can coexist and each has
// exactly one index.html entry point.
const projectDir = resolve(ROOT, 'web', 'generated', 'hyperframes', accession);
const compositionDir = presentationStyle !== 'v1'
  ? resolve(ROOT, 'web', 'generated', 'hyperframes', `${accession}-${presentationStyle}`)
  : projectDir;
const rendersDir = resolve(compositionDir, 'renders');
mkdirSync(rendersDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });

const renderJsonPath = resolve(compositionDir, 'render.json');
// render.json carries a status field so the Preview Deck can show
// Create / Rendering… / Watch / Retry without any study-specific logic.
function writeRenderStatus(status, extra = {}) {
  try {
    writeFileSync(renderJsonPath, JSON.stringify({
      accession, status, updatedAt: new Date().toISOString(), ...extra
    }, null, 2));
  } catch { /* best-effort */ }
}

// ── 1. Resolve manifest ────────────────────────────────────────────────────────

const presentationPath = resolve(projectDir, 'presentation.json');
let manifest;
let evidenceSource;

if (existsSync(presentationPath)) {
  manifest = JSON.parse(readFileSync(presentationPath, 'utf8'));
  const capturedCount = manifest.sections?.filter(s =>
    s.imageEvidence?.some(e => e.status === 'captured')
  ).length ?? 0;
  evidenceSource = capturedCount > 0
    ? `presentation.json (${capturedCount}/${manifest.sections?.length} with evidence)`
    : 'presentation.json (no captured evidence — run export first)';
} else {
  // Fall back to building from the demo registry without image evidence.
  const { listFindings, listNegativeFindings, getReport } =
    await import(`${ROOT}/web/esm/lv/findings/reportRegistry.mjs`);
  const { buildPresentationManifest } =
    await import(`${ROOT}/web/esm/lv/presentation/presentationManifest.mjs`);

  const report = getReport(accession);
  if (!report) {
    console.error(`No demo report found for accession "${accession}". Run export first.`);
    process.exit(1);
  }
  const context = {
    source: 'demo', accession,
    positiveFindings: listFindings(accession),
    negativeFindings: listNegativeFindings(accession),
    document: null,
  };
  manifest = buildPresentationManifest(context, { evidenceMap: new Map() });
  evidenceSource = 'registry (no image evidence — run npm run export:hyperframes:' + targetName + ')';
}

// Backfill patientFriendlyExplanation from the registry when presentation.json
// predates the field (old exports). Non-destructive: only fills null/missing slots.
try {
  const { getReport, listFindings } = await import(`${ROOT}/web/esm/lv/findings/reportRegistry.mjs`);
  const report = getReport(accession);
  if (report) {
    const byId = new Map(listFindings(accession).map(f => [f.id, f]));
    manifest.sections.forEach((s) => {
      if (s.patientFriendlyExplanation == null) {
        const f = byId.get(s.id);
        if (f?.patientFriendlyExplanation) s.patientFriendlyExplanation = f.patientFriendlyExplanation;
      }
    });
  }
} catch { /* optional — non-demo studies simply omit the field */ }

const { sectionHasImage } = await import(`${ROOT}/web/esm/lv/presentation/htmlPresentationExporter.mjs`);

if ((manifest.sections?.length ?? 0) === 0) {
  console.log('\nNo positive findings — nothing to render.');
  process.exit(0);
}

// ── Storyboard plan ─────────────────────────────────────────────────────────
// Make it obvious which findings receive an image scene and which appear in the
// summary/impression only (no localization).
console.log('\nPresentation Storyboard');
console.log('  Opening title');
console.log('  Summary');
let imageSceneCount = 0;
manifest.sections.forEach((s, i) => {
  if (sectionHasImage(s)) {
    imageSceneCount++;
    console.log(`  Finding ${i + 1}: ${s.title}`);
    console.log(`    ✓ Image scene  (Series ${s.seriesNumber}, Image ${s.imageNumber})`);
  } else {
    console.log(`  Finding ${i + 1}: ${s.title}`);
    console.log(`    • Summary + closing impression only`);
    console.log(`    • No image localization available`);
  }
});
console.log('  Closing impression');
console.log(`\nEvidence source: ${evidenceSource}`);
console.log(`Image scenes: ${imageSceneCount} / ${manifest.sections.length} findings`);

// ── 2. Export HTML composition ─────────────────────────────────────────────────
// Embed exported PNG evidence as inline data: URLs (assetMode "data-url").
// This is the most reliable path for the HyperFrames CLI render: the image
// bytes travel inside the HTML, so there is no dependency on the renderer's
// file server root, cwd, or relative-path resolution.

let embeddedAssets = 0;
const readAsset = (assetPath) => {
  const abs = resolve(projectDir, assetPath);
  if (!existsSync(abs)) {
    console.warn(`  ! evidence asset missing on disk: ${abs}`);
    return null;
  }
  const bytes = readFileSync(abs);
  embeddedAssets++;
  return `data:image/png;base64,${bytes.toString('base64')}`;
};

const html = exportHtmlComposition(manifest, {
  projectDir,
  assetMode: 'data-url',
  readAsset,
  presentationStyle,
});
const indexPath = resolve(compositionDir, 'index.html');
writeFileSync(indexPath, html, 'utf8');
console.log(`\nComposition:  ${indexPath}`);
console.log(`Embedded evidence images (inline data URLs): ${embeddedAssets}`);

// ── Provenance proof: Preview Deck image hash == HTML-embedded image hash ──────
// The export step recorded each finding's Preview Deck SHA256 (evidence.sha256).
// Here we hash the image actually embedded in the generated HTML and confirm they
// are identical — proving no divergent evidence was generated for the MP4 path.
const embeddedDataUrls = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)].map(m => m[1]);
const capturedSections = (manifest.sections || []).filter(s =>
  (s.imageEvidence || []).some(e => e.status === 'captured' && (e.assetPath || e.dataUrl)));

const hashReport = [];
let hashMismatch = false;
console.log('\n=== Evidence provenance (Preview Deck → HTML) ===');
capturedSections.forEach((section, idx) => {
  const ev = section.imageEvidence.find(e => e.status === 'captured' && (e.assetPath || e.dataUrl));
  const previewSha = ev?.sha256 || null;          // recorded by the export step
  const b64 = embeddedDataUrls[idx];
  const htmlSha = b64 ? sha256(Buffer.from(b64, 'base64')) : null;
  const match = previewSha && htmlSha ? previewSha === htmlSha : null;
  if (match === false) hashMismatch = true;
  hashReport.push({ finding: section.id, previewSource: ev?.previewSource || 'preview-deck:imageEvidence.dataUrl',
    htmlSource: ev?.assetPath || 'inline-data-url', previewSha256: previewSha, htmlSha256: htmlSha, match });
  console.log(`Finding:        ${section.id}`);
  console.log(`  Preview source: ${ev?.previewSource || 'preview-deck:imageEvidence.dataUrl'}`);
  console.log(`  HTML source:    ${ev?.assetPath || 'inline-data-url'}`);
  console.log(`  Preview SHA256: ${previewSha || '(not recorded — run export step)'}`);
  console.log(`  HTML SHA256:    ${htmlSha || '(none embedded)'}`);
  console.log(`  Match:          ${match === null ? 'UNKNOWN' : (match ? 'YES' : 'NO')}`);
});
if (hashMismatch) {
  console.error('\nERROR: HTML-embedded image differs from the Preview Deck evidence. Aborting.');
  process.exit(2);
}

writeFileSync(resolve(compositionDir, 'meta.json'), JSON.stringify({
  id: accession, name: manifest.presentationTitle, targetName, accession,
  presentationStyle, evidenceSource, createdAt: new Date().toISOString(),
}, null, 2));

writeFileSync(resolve(compositionDir, 'hyperframes.json'), JSON.stringify({
  '$schema': 'https://hyperframes.heygen.com/schema/hyperframes.json',
  registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
}, null, 2));

// ── 3. Pre-render verification: screenshot the EXACT HTML to be rendered ────────
// We open the same index.html file HyperFrames will consume, seek the GSAP
// timeline to the middle of slide 1, screenshot it, and check that the CT image
// element actually loaded (naturalWidth > 0). If the image is missing here it
// will be missing in the MP4 too — fail fast rather than render a broken video.

const debugDir = resolve(compositionDir, 'debug');
const shotDir  = resolve(ROOT, 'test-artifacts', 'hyperframes');
mkdirSync(debugDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

const renderInputShot = resolve(debugDir, 'render-input-slide-1.png');
const compositionShot = resolve(shotDir, `composition-${accession}${styleSuffix}.png`);

let inputImageOk = false;
let frameSeekTime = SLIDE1_MID; // updated from the DOM below; used for the post-render frame too
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto(`file://${indexPath}`);
  await page.waitForTimeout(800);

  // Locate the first evidence image's clip and seek to the middle of its beat.
  // Robust to scene-timing changes and to which finding is first localized.
  frameSeekTime = await page.evaluate(() => {
    const img = document.querySelector('.evidence-img');
    const clipEl = img && img.closest('.clip');
    if (clipEl) {
      const s = parseFloat(clipEl.getAttribute('data-start'));
      const d = parseFloat(clipEl.getAttribute('data-duration'));
      if (Number.isFinite(s) && Number.isFinite(d)) return s + d / 2;
    }
    return 13.0;
  });

  await page.evaluate((t) => {
    const tl = Object.values(window.__timelines || {})[0];
    if (tl && typeof tl.seek === 'function') tl.seek(t);
  }, frameSeekTime);
  await page.waitForTimeout(300);

  // Verify the first evidence CT <img> actually decoded.
  inputImageOk = await page.evaluate(() => {
    const img = document.querySelector('.evidence-img');
    return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  });

  await page.screenshot({ path: renderInputShot, fullPage: false });
  await page.screenshot({ path: compositionShot, fullPage: false });
  await browser.close();
  console.log(`Render-input screenshot:  ${renderInputShot} (@${frameSeekTime.toFixed(1)}s)`);
  console.log(`First evidence image decoded: ${inputImageOk ? 'YES' : 'NO'}`);
} catch (e) {
  console.log(`(Render-input verification skipped: ${e.message})`);
}

if (!inputImageOk && embeddedAssets > 0) {
  writeRenderStatus('failed', { reason: 'evidence embedded but image did not decode' });
  console.error('\nABORT: evidence was embedded but the first image did not decode in the render input.');
  console.error('The MP4 would not contain the CT image. Inspect:', renderInputShot);
  process.exit(2);
}

// ── 4. Run HyperFrames render ──────────────────────────────────────────────────

const outputPath = resolve(rendersDir, `${accession}${styleSuffix}.mp4`);
const hfBin      = resolve(ROOT, 'node_modules', '.bin', 'hyperframes');

const totalDuration = 3 + 4 + imageSceneCount * 9 + 5; // title+summary+image-findings+closing
console.log(`\nRendering (~${totalDuration}s composition at 30fps)…\n`);
writeRenderStatus('rendering', { startedAt: new Date().toISOString() });

const result = spawnSync(
  hfBin,
  ['render', compositionDir, '--output', outputPath, '--quality', 'draft'],
  { stdio: 'inherit', cwd: ROOT, timeout: 10 * 60 * 1000 }
);

const exitCode = result.status ?? 1;
if (exitCode !== 0) {
  writeRenderStatus('failed', { reason: `hyperframes exited ${exitCode}` });
  console.error(`\nhyperframes render exited with code ${exitCode}`);
  if (result.error) console.error(result.error.message);
  process.exit(exitCode);
}

const mp4Exists = existsSync(outputPath);
const mp4Buffer = mp4Exists ? readFileSync(outputPath) : null;
const mp4Bytes  = mp4Buffer ? mp4Buffer.byteLength : 0;
// Content hash → cache-busting version token for the served URL (Cloudflare
// caches .mp4 by extension; a ?v=<hash> query forces a fresh fetch per render).
const mp4Sha256 = mp4Buffer ? sha256(mp4Buffer) : null;

// ── 5. Post-render verification: extract a frame from the MP4 ───────────────────
// Pull a frame from the middle of the first evidence image beat and run a simple
// content heuristic (center 60% brightness). Only meaningful when there is at
// least one localized finding (an image scene); skipped otherwise.

const renderedFrameShot = resolve(debugDir, 'rendered-frame-1.png');
let frameHasImage = null; // null = could not determine / no image scene
if (mp4Exists && inputImageOk) {
  try {
    const ff = spawnSync('ffmpeg',
      ['-y', '-ss', String(frameSeekTime), '-i', outputPath, '-frames:v', '1', renderedFrameShot],
      { encoding: 'utf8', timeout: 60_000 });
    if (ff.status === 0 && existsSync(renderedFrameShot)) {
      frameHasImage = await frameContainsImage(renderedFrameShot);
      console.log(`\nRendered frame:           ${renderedFrameShot}`);
      console.log(`Frame contains CT image:  ${frameHasImage ? 'YES' : 'NO (placeholder-like)'}`);
    } else {
      console.log(`(Frame extraction failed: ${ff.stderr?.split('\n').slice(-2).join(' ') || 'unknown'})`);
    }
  } catch (e) {
    console.log(`(Frame extraction skipped: ${e.message})`);
  }
}

// ── 6. Write render metadata ───────────────────────────────────────────────────

writeFileSync(resolve(projectDir, 'render.json'), JSON.stringify({
  status: mp4Exists ? 'complete' : 'failed',
  target: targetName, accession,
  manifestVersion: manifest.payloadVersion,
  presentationTitle: manifest.presentationTitle,
  sectionCount: manifest.sections.length,
  imageSceneCount,
  evidenceSource,
  assetMode: 'data-url',
  embeddedAssets,
  evidenceProvenance: hashReport,
  compositionPath: indexPath,
  renderInputScreenshot: renderInputShot,
  renderInputImageDecoded: inputImageOk,
  outputPath,
  renderedFrameScreenshot: existsSync(renderedFrameShot) ? renderedFrameShot : null,
  renderedFrameContainsImage: frameHasImage,
  renderedAt: new Date().toISOString(),
  mp4SizeKB: mp4Exists ? Math.round(mp4Bytes / 1024) : null,
  mp4Sha256,
  mp4Version: mp4Sha256 ? mp4Sha256.slice(0, 12) : null,
}, null, 2));

// ── 7. Report ──────────────────────────────────────────────────────────────────

console.log('\n=== Render complete ===');
console.log(`Evidence:        ${evidenceSource}`);
console.log(`Embedded images: ${embeddedAssets} (inline data URLs)`);
console.log(`Composition:     ${indexPath}`);
console.log(`Render input:    ${renderInputShot} (image decoded: ${inputImageOk ? 'YES' : 'NO'})`);
console.log(`MP4:             ${outputPath} (${mp4Exists ? (mp4Bytes / 1024).toFixed(0) + ' KB' : 'NOT FOUND'})`);
if (existsSync(renderedFrameShot)) {
  console.log(`Rendered frame:  ${renderedFrameShot} (CT image present: ${frameHasImage ? 'YES' : 'NO'})`);
}
const servedBase = presentationStyle !== 'v1' ? `${accession}-${presentationStyle}` : accession;
console.log(`\nServed at:       http://localhost:4173/generated/hyperframes/${servedBase}/renders/${accession}${styleSuffix}.mp4`);

if (frameHasImage === false) {
  console.error('\nWARNING: rendered frame appears to be placeholder-only (no CT image detected).');
  process.exit(3);
}

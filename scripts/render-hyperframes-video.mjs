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
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const { exportHtmlComposition } =
  await import(`${ROOT}/web/esm/lv/presentation/htmlPresentationExporter.mjs`);

// ── Config map: name → accession ───────────────────────────────────────────────
const TARGETS = {
  'ct-head':  'NI9f7ff9',
  'mr-knee':  '3852755662087132',
  'cxr':      'CXR-88997',
};

const targetName = process.argv[2] || 'ct-head';
const accession  = TARGETS[targetName];

if (!accession) {
  console.error(`Unknown target "${targetName}". Available: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

console.log(`\n=== HyperFrames MP4 render: ${targetName} (${accession}) ===\n`);

const projectDir = resolve(ROOT, 'web', 'generated', 'hyperframes', accession);
const rendersDir = resolve(projectDir, 'renders');
mkdirSync(rendersDir, { recursive: true });

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

console.log(`Evidence source: ${evidenceSource}`);
console.log(`Title:           ${manifest.presentationTitle}`);
console.log(`Sections:        ${manifest.sections?.length ?? 0}`);
manifest.sections?.forEach((s, i) =>
  console.log(`  Slide ${i + 1}: ${s.title} (${s.navigable
    ? `Series ${s.seriesNumber}, Image ${s.imageNumber}` : 'text-only'})`));

if ((manifest.sections?.length ?? 0) === 0) {
  console.log('\nNo positive findings — nothing to render.');
  process.exit(0);
}

// ── 2. Export HTML composition ─────────────────────────────────────────────────

const html = exportHtmlComposition(manifest, { projectDir });
const indexPath = resolve(projectDir, 'index.html');
writeFileSync(indexPath, html, 'utf8');
console.log(`\nComposition:  ${indexPath}`);

writeFileSync(resolve(projectDir, 'meta.json'), JSON.stringify({
  id: accession, name: manifest.presentationTitle, targetName, accession,
  evidenceSource, createdAt: new Date().toISOString(),
}, null, 2));

writeFileSync(resolve(projectDir, 'hyperframes.json'), JSON.stringify({
  '$schema': 'https://hyperframes.heygen.com/schema/hyperframes.json',
  registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
}, null, 2));

// ── 3. Screenshot of composition before render (optional, non-fatal) ───────────

const shotDir  = resolve(ROOT, 'test-artifacts', 'hyperframes');
const shotPath = resolve(shotDir, `composition-${accession}.png`);
mkdirSync(shotDir, { recursive: true });
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto(`file://${indexPath}`);
  await page.waitForTimeout(800);
  // Seek to middle of slide 1 so the screenshot shows real content, not opacity:0 initial state.
  // Intro = 2s, slide = 7s each → middle of slide 1 = 2 + 3.5 = 5.5s
  const slideSeekTime = 5.5;
  await page.evaluate((t) => {
    const timelines = window.__timelines || {};
    const tl = Object.values(timelines)[0];
    if (tl && typeof tl.seek === 'function') tl.seek(t);
  }, slideSeekTime);
  await page.waitForTimeout(200);
  await page.screenshot({ path: shotPath, fullPage: false });
  await browser.close();
  console.log(`Composition screenshot: ${shotPath}`);
} catch (e) {
  console.log(`(Composition screenshot skipped: ${e.message})`);
}

// ── 4. Run HyperFrames render ──────────────────────────────────────────────────

const outputPath = resolve(rendersDir, `${accession}.mp4`);
const hfBin      = resolve(ROOT, 'node_modules', '.bin', 'hyperframes');

console.log(`\nRendering (${manifest.sections.length * 6 + 2}s composition at 30fps)…\n`);

const result = spawnSync(
  hfBin,
  ['render', projectDir, '--output', outputPath, '--quality', 'draft'],
  { stdio: 'inherit', cwd: ROOT, timeout: 10 * 60 * 1000 }
);

const exitCode = result.status ?? 1;
if (exitCode !== 0) {
  console.error(`\nhyperframes render exited with code ${exitCode}`);
  if (result.error) console.error(result.error.message);
  process.exit(exitCode);
}

// ── 5. Write render metadata ───────────────────────────────────────────────────

const mp4Exists = existsSync(outputPath);
const mp4Bytes  = mp4Exists ? readFileSync(outputPath).byteLength : 0;

writeFileSync(resolve(projectDir, 'render.json'), JSON.stringify({
  target: targetName, accession,
  manifestVersion: manifest.payloadVersion,
  presentationTitle: manifest.presentationTitle,
  sectionCount: manifest.sections.length,
  evidenceSource,
  compositionPath: indexPath,
  outputPath,
  renderedAt: new Date().toISOString(),
  mp4SizeKB: mp4Exists ? Math.round(mp4Bytes / 1024) : null,
}, null, 2));

// ── 6. Report ──────────────────────────────────────────────────────────────────

console.log('\n=== Render complete ===');
console.log(`Evidence:     ${evidenceSource}`);
console.log(`Composition:  ${indexPath}`);
console.log(`MP4:          ${outputPath} (${mp4Exists ? (mp4Bytes / 1024).toFixed(0) + ' KB' : 'NOT FOUND'})`);
console.log(`\nServed at:    http://localhost:4173/generated/hyperframes/${accession}/renders/${accession}.mp4`);

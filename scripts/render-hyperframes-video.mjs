#!/usr/bin/env node
// Render a presentation manifest as an MP4 using the HyperFrames CLI.
//
// Usage:
//   node scripts/render-hyperframes-video.mjs ct-head
//   node scripts/render-hyperframes-video.mjs mr-knee
//   npm run render:hyperframes:ct-head
//
// Output (directory keyed by accession so the browser can find it by HEAD):
//   web/generated/hyperframes/<accession>/index.html   — HyperFrames composition
//   web/generated/hyperframes/<accession>/meta.json    — HyperFrames project meta
//   web/generated/hyperframes/<accession>/hyperframes.json
//   web/generated/hyperframes/<accession>/renders/<accession>.mp4   — rendered video
//   web/generated/hyperframes/<accession>/render.json  — metadata about this render
//
// Notes:
//   - Image evidence from the browser (DICOM canvas captures) is NOT available
//     in this Node.js context. Slides will use placeholder panels instead.
//     Run PRESENT in the Elvie browser viewer and click "Export JSON" to obtain
//     a manifest with captured evidence, then pass it via stdin or a file path
//     (see --manifest-file flag, not yet implemented).
//   - web/generated/ is gitignored; do not commit generated files.
//   - Requires: ffmpeg, Chrome (auto-installed by hyperframes), Node 18+.

import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Dynamic ESM imports (modules cannot be required, must be imported) ─────────
const { listFindings, listNegativeFindings, getReport } =
  await import(`${ROOT}/web/esm/lv/findings/reportRegistry.mjs`);
const { buildPresentationManifest } =
  await import(`${ROOT}/web/esm/lv/presentation/presentationManifest.mjs`);
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

// ── 1. Build manifest from registry demo data ──────────────────────────────────

const report = getReport(accession);
if (!report) {
  console.error(`No demo report found for accession "${accession}"`);
  process.exit(1);
}

const context = {
  source: 'demo',
  accession,
  positiveFindings: listFindings(accession),
  negativeFindings: listNegativeFindings(accession),
  document: null,
};

// No browser canvas evidence available in Node — slides use placeholders.
const manifest = buildPresentationManifest(context, { evidenceMap: new Map() });

console.log(`Manifest: ${manifest.sections.length} section(s), ${manifest.findings.length} finding(s)`);
console.log(`Title: ${manifest.presentationTitle}`);
manifest.sections.forEach((s, i) =>
  console.log(`  Slide ${i + 1}: ${s.title} (${s.navigable ? `Series ${s.seriesNumber}, Image ${s.imageNumber}` : 'text-only'})`));

if (manifest.sections.length === 0) {
  console.log('\nNo positive findings — nothing to render.');
  process.exit(0);
}

// ── 2. Export HTML composition ─────────────────────────────────────────────────
// Project dir is keyed by accession so the browser can HEAD-check
// /generated/hyperframes/{accession}/renders/{accession}.mp4 without a name lookup.

const projectDir = resolve(ROOT, 'web', 'generated', 'hyperframes', accession);
const rendersDir = resolve(projectDir, 'renders');
mkdirSync(rendersDir, { recursive: true });

const html = exportHtmlComposition(manifest);
const indexPath = resolve(projectDir, 'index.html');
writeFileSync(indexPath, html, 'utf8');
console.log(`\nComposition: ${indexPath}`);

writeFileSync(resolve(projectDir, 'meta.json'), JSON.stringify({
  id: accession,
  name: manifest.presentationTitle,
  targetName,
  accession,
  createdAt: new Date().toISOString(),
}, null, 2));

writeFileSync(resolve(projectDir, 'hyperframes.json'), JSON.stringify({
  '$schema': 'https://hyperframes.heygen.com/schema/hyperframes.json',
  registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
}, null, 2));

// ── 3. Run HyperFrames render ──────────────────────────────────────────────────

const outputPath = resolve(rendersDir, `${accession}.mp4`);
const hfBin     = resolve(ROOT, 'node_modules', '.bin', 'hyperframes');

console.log(`\nRendering: ${hfBin} render "${projectDir}" --output "${outputPath}" --quality draft --quiet`);
console.log('(This may take 30–120 seconds. Chrome headless renders each frame in sequence.)\n');

const result = spawnSync(
  hfBin,
  ['render', projectDir, '--output', outputPath, '--quality', 'draft'],
  { stdio: 'inherit', cwd: ROOT, timeout: 5 * 60 * 1000 }
);

const exitCode = result.status ?? 1;
if (exitCode !== 0) {
  console.error(`\nhyperframes render exited with code ${exitCode}`);
  if (result.error) console.error(result.error.message);
  process.exit(exitCode);
}

// ── 4. Write render metadata ───────────────────────────────────────────────────

const mp4Exists = existsSync(outputPath);
const mp4Size   = mp4Exists
  ? (readFileSync(outputPath).byteLength / 1024).toFixed(0) + ' KB'
  : '(not found)';

const renderMeta = {
  target: targetName,
  accession,
  manifestVersion: manifest.payloadVersion,
  presentationTitle: manifest.presentationTitle,
  sectionCount: manifest.sections.length,
  compositionPath: indexPath,
  outputPath,
  renderedAt: new Date().toISOString(),
  mp4SizeKB: mp4Exists ? Math.round(readFileSync(outputPath).byteLength / 1024) : null,
  evidenceNote: 'No DICOM canvas evidence — placeholder panels used. Run PRESENT in browser and Export JSON for real captures.',
};

writeFileSync(resolve(projectDir, 'render.json'), JSON.stringify(renderMeta, null, 2));

// ── 5. Report ──────────────────────────────────────────────────────────────────

console.log('\n=== Render complete ===');
console.log(`Composition:  ${indexPath}`);
console.log(`MP4 output:   ${outputPath}`);
console.log(`MP4 size:     ${mp4Size}`);
console.log(`Sections:     ${manifest.sections.length}`);
console.log(`\nServed at (when dev server is running):`);
console.log(`  http://localhost:4173/generated/hyperframes/${accession}/renders/${accession}.mp4`);
console.log('\nTo link from Elvie Preview Deck, run PRESENT on a loaded report.');
console.log(`Metadata:     ${resolve(projectDir, 'render.json')}`);

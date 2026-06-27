#!/usr/bin/env node
// Browser-assisted evidence exporter for HyperFrames MP4 generation.
//
// Uses a headless Chromium (via Playwright) to load the Elvie viewer, navigate
// to each positive finding, let the viewer capture canvas evidence, then saves:
//
//   web/generated/hyperframes/<accession>/presentation.json  — manifest with asset paths
//   web/generated/hyperframes/<accession>/assets/finding-N.png  — captured CT images
//   test-artifacts/hyperframes/export-<accession>-preview.png  — screenshot of preview deck
//
// Usage:
//   node scripts/export-hyperframes-evidence.mjs [ct-head|mr-knee]
//   npm run export:hyperframes:ct-head
//
// Environment variables:
//   ELVIE_URL       Base URL of the running viewer (default: http://localhost:4173/index.html)
//   DICOMWEB_URL    DICOMweb base URL (default: https://elvie-server.ggg.ad/dicom-web)
//   SETTLE_MS       ms to wait after each finding navigation (default: 2000)
//
// Prerequisites:
//   - Viewer running at ELVIE_URL (npm run serve or python3 -m http.server 4173 from web/)
//   - DICOM server accessible at DICOMWEB_URL with the target accession loaded

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const VIEWER_URL  = process.env.ELVIE_URL      || 'http://localhost:4173/index.html';
const DICOMWEB    = process.env.DICOMWEB_URL   || 'https://elvie-server.ggg.ad/dicom-web';
const SETTLE_MS   = parseInt(process.env.SETTLE_MS || '2000', 10);

const TARGETS = {
  'ct-head': 'NI9f7ff9',
  'mr-knee': '3852755662087132',
};

const targetName = process.argv[2] || 'ct-head';
const accession  = TARGETS[targetName];

if (!accession) {
  console.error(`Unknown target "${targetName}". Available: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

const outputDir   = resolve(ROOT, 'web', 'generated', 'hyperframes', accession);
const assetsDir   = resolve(outputDir, 'assets');
const debugDir    = resolve(outputDir, 'debug');
const shotDir     = resolve(ROOT, 'test-artifacts', 'hyperframes');
mkdirSync(assetsDir, { recursive: true });
mkdirSync(debugDir,  { recursive: true });
mkdirSync(shotDir,   { recursive: true });

console.log(`\n=== HyperFrames evidence export: ${targetName} (${accession}) ===`);
console.log(`Viewer:   ${VIEWER_URL}`);
console.log(`DICOMweb: ${DICOMWEB}`);
console.log(`Settle:   ${SETTLE_MS}ms per finding\n`);

// ── 1. Launch browser ──────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await ctx.newPage();

page.on('console', msg => {
  if (msg.type() === 'error') console.error(`[browser error] ${msg.text()}`);
});

// ── 2. Load viewer and set DICOMweb URL ───────────────────────────────────────

// First visit to set localStorage, then reload so loadConfig() picks it up.
await page.goto(VIEWER_URL);
await page.waitForFunction(() => typeof window.loadConfig === 'function' ||
                                  typeof window.setActiveReportContext === 'function',
                            { timeout: 15_000 });
await page.evaluate((url) => {
  localStorage.setItem('lv_hermes_dicomweb', url);
}, DICOMWEB);
await page.reload({ waitUntil: 'networkidle' });

await page.waitForFunction(() => typeof window.setActiveReportContext === 'function',
                            { timeout: 15_000 });

// Enable test hook and configure longer settle time for evidence capture.
await page.evaluate((settleMs) => {
  window.__ELVIE_TEST__ = true;
  window.__ELVIE_EVIDENCE_SETTLE_MS__ = settleMs;
}, SETTLE_MS);

// Wait for PRESENT button and service worker
await page.locator('#rpPresentBtn').waitFor({ state: 'visible', timeout: 10_000 });
await page.waitForFunction(
  () => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
  { timeout: 10_000 }
);

// ── 3. Load demo report ───────────────────────────────────────────────────────

console.log(`Loading demo report: ${accession}...`);
const loaded = await page.evaluate(async (acc) => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await window.openAgentxReport(acc);
      if (res?.ok) return true;
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}, accession);

if (!loaded) {
  await browser.close();
  console.error('openAgentxReport never returned ok — is the demo report registered?');
  process.exit(1);
}
console.log('Report loaded.');

// Give the native viewer time to request and render the first series before PRESENT.
console.log('Waiting for initial image load...');
await page.waitForTimeout(4000);

// ── 4. Click PRESENT (triggers evidence collection + manifest build) ───────────

console.log('Clicking PRESENT...');
await page.evaluate(() => {
  window.__capturedLaunchUrls = [];
  window.open = (url) => { window.__capturedLaunchUrls.push(String(url)); return null; };
});
await page.locator('#rpPresentBtn').click();

// Wait for preview deck to open (or error). Allow extra time for DICOM captures.
await page.waitForFunction(
  () => !!document.querySelector('[data-testid="presentation-preview"]') ||
        document.getElementById('rpErrorBanner')?.classList.contains('visible'),
  { timeout: 60_000 }
);

const hasPreview = await page.evaluate(
  () => !!document.querySelector('[data-testid="presentation-preview"]')
);
if (!hasPreview) {
  const errText = await page.evaluate(
    () => document.getElementById('rpErrorBanner')?.textContent || '(no error text)'
  );
  await browser.close();
  console.error(`Preview did not open. Error: ${errText}`);
  process.exit(1);
}
console.log('Preview deck opened.');

// ── 5. Extract manifest ───────────────────────────────────────────────────────

const manifest = await page.evaluate(() => window.__ELVIE_TEST_LAST_PRESENTATION_MANIFEST__);
if (!manifest) {
  await browser.close();
  console.error('window.__ELVIE_TEST_LAST_PRESENTATION_MANIFEST__ is undefined — test hook not active?');
  process.exit(1);
}

const sectionCount  = manifest.sections?.length ?? 0;
const capturedCount = manifest.sections?.filter(s =>
  s.imageEvidence?.some(e => e.status === 'captured')
).length ?? 0;
console.log(`\nManifest: ${sectionCount} section(s), ${capturedCount} with captured evidence`);

// ── 6. Screenshot of preview deck ────────────────────────────────────────────

const shotPath = resolve(shotDir, `export-${accession}-preview.png`);
await page.locator('[data-testid="preview-slide"]').screenshot({ path: shotPath });
console.log(`Screenshot: ${shotPath}`);

// ── 7. The Preview Deck is the single source of truth ─────────────────────────
// The exact image the Preview Deck displays (imageEvidence.dataUrl) becomes the
// canonical evidence artifact. We decode it once to a PNG, hash it, and reference
// that asset from presentation.json. No second viewport render/capture happens.

const processedManifest = JSON.parse(JSON.stringify(manifest));
const savedAssets = [];

for (let i = 0; i < processedManifest.sections.length; i++) {
  const section = processedManifest.sections[i];
  if (!Array.isArray(section.imageEvidence)) continue;

  for (const evidence of section.imageEvidence) {
    if (evidence.status !== 'captured' || !evidence.dataUrl) continue;

    const assetName = `finding-${i + 1}.png`;
    const assetPath = resolve(assetsDir, assetName);
    const b64 = evidence.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    const hash = sha256(buf);
    writeFileSync(assetPath, buf);
    console.log(`Asset: ${assetPath} (${(buf.byteLength / 1024).toFixed(0)} KB) sha256=${hash.slice(0, 16)}…`);
    savedAssets.push({ section: i + 1, sectionId: section.id, assetName, sizeKB: Math.round(buf.byteLength / 1024), sha256: hash });

    // Canonical evidence: the exact bytes the Preview Deck displays.
    // Replace the inline data URL with an asset reference + provenance for the render step.
    delete evidence.dataUrl;
    evidence.assetPath = `assets/${assetName}`;
    evidence.previewSource = 'preview-deck:imageEvidence.dataUrl';
    evidence.sha256 = hash;
  }
}

// ── 8. Save presentation.json ─────────────────────────────────────────────────

const presentationPath = resolve(outputDir, 'presentation.json');
writeFileSync(presentationPath, JSON.stringify(processedManifest, null, 2));
console.log(`Manifest: ${presentationPath}`);

// Log detected viewport state per captured finding (audit).
processedManifest.sections.forEach((s, i) => {
  const ev = (s.imageEvidence || []).find(e => e.status === 'captured');
  if (!ev) return;
  const vs = ev.viewportState || {};
  console.log(`Finding ${i + 1} W/L: preset=${ev.appliedPreset || '(none)'} ` +
    `WC=${vs.windowCenter ?? '?'} WW=${vs.windowWidth ?? '?'} ` +
    `zoom=${vs.zoom != null ? vs.zoom.toFixed(1) : '?'}`);
});

// ── 9. Prove the Preview Deck shows exactly the canonical asset ───────────────
// Walk the open Preview Deck slides, screenshot each, and hash the displayed
// <img> src. This reads the rendered deck DOM — it does NOT re-render the viewer.

const previewProofs = [];
for (let i = 0; i < processedManifest.sections.length; i++) {
  // Screenshot the current Preview Deck slide.
  const deckShot = resolve(debugDir, `preview-deck-finding-${i + 1}.png`);
  try {
    await page.locator('[data-testid="preview-slide"]').screenshot({ path: deckShot });
  } catch { /* non-fatal */ }

  // Hash the image the deck is actually displaying for this slide.
  const domHash = await page.evaluate(async () => {
    const img = document.querySelector('[data-testid="preview-evidence-img"]');
    const src = img?.getAttribute('src') || '';
    if (!src.startsWith('data:')) return { src: src ? 'non-data-url' : 'none', sha256: null };
    const b64 = src.replace(/^data:image\/\w+;base64,/, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { src: 'preview-deck:img[data-testid=preview-evidence-img]', sha256: hex };
  });
  previewProofs.push({ section: i + 1, deckShot, ...domHash });

  // Advance to the next slide (if any).
  if (i < processedManifest.sections.length - 1) {
    await page.locator('[data-testid="preview-next-btn"]').click().catch(() => {});
    await page.waitForTimeout(150);
  }
}

await browser.close();

// ── 10. Debug report: Preview vs HTML-asset hashes ────────────────────────────
// (HTML-asset hash == the PNG we just wrote == the decoded Preview data URL.)

console.log('\n=== Evidence provenance (Preview Deck → asset) ===');
let allMatch = true;
for (const a of savedAssets) {
  const proof = previewProofs.find(p => p.section === a.section);
  const previewHash = proof?.sha256 || '(n/a)';
  const match = proof?.sha256 ? (proof.sha256 === a.sha256) : null;
  if (match === false) allMatch = false;
  console.log(`Finding:        ${a.sectionId}`);
  console.log(`  Preview source: ${proof?.src || 'preview-deck:imageEvidence.dataUrl'}`);
  console.log(`  Asset source:   ${a.assetName} (decoded from Preview data URL)`);
  console.log(`  Preview SHA256: ${previewHash}`);
  console.log(`  Asset SHA256:   ${a.sha256}`);
  console.log(`  Match:          ${match === null ? 'UNKNOWN (no DOM img)' : (match ? 'YES' : 'NO')}`);
}
if (!allMatch) {
  console.error('\nERROR: Preview Deck image hash does not match the exported asset.');
  process.exit(2);
}

console.log('\n=== Export complete ===');
console.log(`Target:       ${targetName} (${accession})`);
console.log(`Sections:     ${sectionCount}  |  Captured: ${capturedCount}`);
console.log(`Manifest:     ${presentationPath}`);
for (const a of savedAssets) {
  console.log(`Asset ${a.section}:      ${resolve(assetsDir, a.assetName)} (${a.sizeKB} KB)`);
}
console.log(`Screenshot:   ${shotPath}`);
if (capturedCount === 0) {
  console.log('\nWARNING: No image evidence was captured.');
  console.log('  - The DICOM viewer may not have loaded images (no Orthanc/DICOMweb data).');
  console.log(`  - Check that ${DICOMWEB} has accession ${accession}.`);
  console.log('  - The render will use placeholder panels instead.');
}
console.log('\nNext: npm run render:hyperframes:' + targetName);

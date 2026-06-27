#!/usr/bin/env node
// Storyboard screenshots: load a generated HyperFrames composition, seek the
// GSAP timeline to representative scene times, and capture each beat. Output goes
// to test-artifacts/hyperframes/storyboard/. Read-only — does not render video.
//
// Usage: node scripts/screenshot-hyperframes-scenes.mjs [ct-head]

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TARGETS = { 'ct-head': 'NI9f7ff9', 'mr-knee': '3852755662087132' };
const targetName = process.argv[2] || 'ct-head';
const accession = TARGETS[targetName];
if (!accession) { console.error(`Unknown target "${targetName}"`); process.exit(1); }

const indexPath = resolve(ROOT, 'web', 'generated', 'hyperframes', accession, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`Composition not found: ${indexPath}\nRun: npm run build:hyperframes:${targetName}`);
  process.exit(1);
}

const outDir = resolve(ROOT, 'test-artifacts', 'hyperframes', 'storyboard');
mkdirSync(outDir, { recursive: true });

// Scene times mirror htmlPresentationExporter.mjs scene timing.
const SHOTS = [
  { name: '1-opening-title',     t: 1.6 },
  { name: '2-summary',           t: 5.0 },
  { name: '3-finding1-report',   t: 8.6 },
  { name: '4-finding1-image',    t: 13.0 },
  { name: '5-finding2-image',    t: 22.0 },
  { name: '6-closing-impression',t: 27.6 },
];

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.goto(`file://${indexPath}`);
await page.waitForTimeout(900); // let fonts + images decode

for (const shot of SHOTS) {
  await page.evaluate((t) => {
    const tl = Object.values(window.__timelines || {})[0];
    if (tl && typeof tl.seek === 'function') tl.seek(t);
  }, shot.t);
  await page.waitForTimeout(220);
  const out = resolve(outDir, `${targetName}-${shot.name}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`@${shot.t}s → ${out}`);
}

await browser.close();
console.log(`\nStoryboard screenshots written to ${outDir}`);

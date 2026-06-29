#!/usr/bin/env node
// Storyboard screenshots: load a generated HyperFrames composition, introspect
// its clips, seek the GSAP timeline to representative scene times, and capture
// each beat. Output → test-artifacts/hyperframes/storyboard/. Read-only.
//
// Usage: node scripts/screenshot-hyperframes-scenes.mjs --accession <acc>

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const { resolveTarget } = await import(`${ROOT}/scripts/lib/resolveTarget.mjs`);
const { accession, label } = resolveTarget(process.argv.slice(2));

const indexPath = resolve(ROOT, 'web', 'generated', 'hyperframes', accession, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`Composition not found: ${indexPath}\nRun: npm run build:hyperframes -- --accession ${accession}`);
  process.exit(1);
}
const outDir = resolve(ROOT, 'test-artifacts', 'hyperframes', 'storyboard');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.goto(`file://${indexPath}`);
await page.waitForTimeout(900);

// Build the shot list from the actual clips in the composition.
const shots = await page.evaluate(() => {
  const mid = (el) => {
    const s = parseFloat(el.getAttribute('data-start'));
    const d = parseFloat(el.getAttribute('data-duration'));
    return s + d / 2;
  };
  const list = [];
  const title = document.querySelector('#sc-title');
  if (title) list.push({ name: '1-opening-title', t: mid(title) });
  const summary = document.querySelector('#sc-summary');
  if (summary) list.push({ name: '2-summary', t: parseFloat(summary.getAttribute('data-start')) + 2.0 });
  // finding beats
  const reportBeats = [...document.querySelectorAll('[id^="sc-find-"][id$="-a"]')];
  const imageBeats  = [...document.querySelectorAll('[id^="sc-find-"][id$="-b"]')];
  if (reportBeats[0]) list.push({ name: '3-finding1-report', t: parseFloat(reportBeats[0].getAttribute('data-start')) + 1.6 });
  imageBeats.forEach((el, i) => list.push({ name: `${4 + i}-finding${i + 1}-image`, t: mid(el) }));
  const closing = document.querySelector('#sc-closing');
  if (closing) list.push({ name: '9-closing-impression', t: parseFloat(closing.getAttribute('data-start')) + 3.0 });
  return list;
});

for (const shot of shots) {
  await page.evaluate((t) => {
    const tl = Object.values(window.__timelines || {})[0];
    if (tl && typeof tl.seek === 'function') tl.seek(t);
  }, shot.t);
  await page.waitForTimeout(220);
  const out = resolve(outDir, `${label}-${shot.name}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`@${shot.t.toFixed(1)}s → ${out}`);
}

await browser.close();
console.log(`\nStoryboard screenshots written to ${outDir}`);

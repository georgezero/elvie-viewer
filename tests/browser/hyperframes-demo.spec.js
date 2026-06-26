// Browser tests: Hyperframes presentation manifests from the three built-in demo reports.
//
// Exercises the real openAgentxReport() loading path (not injected mock state).
// window.open is stubbed so no request reaches hyperframes.heygen.com.
// The generated manifest is captured via window.__ELVIE_TEST_LAST_PRESENTATION_MANIFEST__
// (set by the test hook in launchHyperframesPresentation when window.__ELVIE_TEST__ is truthy).
//
// Screenshot output: test-artifacts/hyperframes/
//
// Demo report → manifest mapping:
//
//   CXR-88997  (CXR)       — 0 navigable findings; non-navigable deck mode
//   NI9f7ff9   (CT Head)   — 2 navigable findings (Series 2 Image 21, Series 2 Image 36)
//   3852755662087132 (MR Knee) — 2 navigable findings + 1 non-navigable positive
//
// Known limitation: v1 manifest transport uses session-scoped blob: URLs.
// The manifest= param carries a blob: reference visible in the captured URL;
// Hyperframes cannot fetch it cross-origin until a server-side publish step is added.

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, '../../test-artifacts/hyperframes');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const PAGE_URL = '/index.html';
const HYPERFRAMES_ORIGIN = 'https://hyperframes.heygen.com';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadPage(page) {
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => typeof window.setActiveReportContext === 'function');
  // Enable test hook before any PRESENT click
  await page.evaluate(() => { window.__ELVIE_TEST__ = true; });
  await page.locator('#rpPresentBtn').waitFor({ state: 'visible', timeout: 8000 });
}

async function loadDemoReport(page, accession) {
  // Retry until modules are loaded and the report loads successfully.
  // openAgentxReport returns { ok: false, reason: 'modules_not_ready' } until
  // the report panel modules resolve, then returns { ok: true } on success.
  const loaded = await page.evaluate(async (acc) => {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await window.openAgentxReport(acc);
        if (res?.ok) return true;
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }, accession);
  expect(loaded, `openAgentxReport('${accession}') never succeeded`).toBe(true);
  // Allow rendering to settle
  await page.waitForTimeout(300);
}

async function stubWindowOpen(page) {
  await page.evaluate(() => {
    window.__capturedLaunchUrls = [];
    window.open = (url) => { window.__capturedLaunchUrls.push(String(url)); return null; };
  });
}

async function clickPresentAndWait(page) {
  await stubWindowOpen(page);
  await page.locator('#rpPresentBtn').click();
  // Wait for launch (async import + manifest generation + window.open or error)
  await page.waitForFunction(
    () => (window.__capturedLaunchUrls?.length > 0) ||
          document.getElementById('rpErrorBanner')?.classList.contains('visible'),
    { timeout: 12_000 }
  );
}

async function getCapturedUrls(page) {
  return page.evaluate(() => window.__capturedLaunchUrls || []);
}

async function getManifest(page) {
  return page.evaluate(() => window.__ELVIE_TEST_LAST_PRESENTATION_MANIFEST__ || null);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false });
}

function assertManifestStructure(manifest, { accession, source = 'demo' }) {
  // Required top-level fields
  for (const key of ['payloadVersion', 'source', 'generatedAt', 'accession', 'reportContext', 'findings']) {
    expect(manifest, `missing field: ${key}`).toHaveProperty(key);
  }
  expect(manifest.accession).toBe(accession);
  // reportContext fields
  const rc = manifest.reportContext;
  expect(rc.accession).toBe(accession);
  expect(rc.reportSource).toBe(source);
  expect(typeof rc.findingCount).toBe('number');
  expect(typeof rc.navigableFindingCount).toBe('number');
  expect(rc.navigableFindingCount).toBeGreaterThanOrEqual(0);
  // findings array
  expect(Array.isArray(manifest.findings)).toBe(true);
  // No raw report text in the default payload
  expect(manifest).not.toHaveProperty('trace');
  const json = JSON.stringify(manifest);
  expect(json).not.toContain('CLINICAL HISTORY');
  expect(json).not.toContain('TECHNIQUE');
}

function assertFindingStructure(finding, { expectedAccession }) {
  for (const key of ['id', 'title', 'text', 'accession', 'navigable', 'navigationStatus', 'imageAnchors', 'navigation']) {
    expect(finding, `finding missing field: ${key}`).toHaveProperty(key);
  }
  expect(finding.accession).toBe(expectedAccession);
  expect(Array.isArray(finding.imageAnchors)).toBe(true);
  if (!finding.navigable) {
    expect(finding.nonNavigableReason).toBeTruthy();
  }
}

// ── CXR (CXR-88997) — all findings negative → non-navigable deck ──────────────

test.describe('CXR demo report', () => {
  test('loads report, launches in non-navigable mode, manifest has correct structure', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, 'CXR-88997');
    await screenshot(page, 'cxr-report-loaded');

    await clickPresentAndWait(page);

    // CXR has no navigable image anchors → non-navigable launch (no error, just opens)
    const urls = await getCapturedUrls(page);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(HYPERFRAMES_ORIGIN);
    expect(urls[0]).toContain('manifest=');
    expect(urls[0]).toContain('source=elvie-viewer');

    const manifest = await getManifest(page);
    expect(manifest).not.toBeNull();

    assertManifestStructure(manifest, { accession: 'CXR-88997', source: 'demo' });

    // CXR: all 8 seeded findings are negative → 0 navigable
    expect(manifest.reportContext.navigableFindingCount).toBe(0);
    expect(manifest.findings.length).toBeGreaterThan(0);
    expect(manifest.findings.every(f => !f.navigable)).toBe(true);
    expect(manifest.findings.every(f => f.nonNavigableReason)).toBe(true);
    expect(manifest.findings.every(f => f.imageAnchors.length === 0)).toBe(true);

    // Every finding is accession-linked
    for (const f of manifest.findings) {
      assertFindingStructure(f, { expectedAccession: 'CXR-88997' });
    }

    await screenshot(page, 'cxr-launch-non-navigable');
  });
});

// ── CT Head (NI9f7ff9) — 2 navigable findings ────────────────────────────────

test.describe('CT Head demo report', () => {
  test('loads report, launches with 2 navigable findings, anchors correct', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, 'NI9f7ff9');
    await screenshot(page, 'ct-head-report-loaded');

    await clickPresentAndWait(page);

    const urls = await getCapturedUrls(page);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(HYPERFRAMES_ORIGIN);
    expect(urls[0]).toContain('manifest=');

    const manifest = await getManifest(page);
    expect(manifest).not.toBeNull();

    assertManifestStructure(manifest, { accession: 'NI9f7ff9', source: 'demo' });

    // CT Head: 2 navigable positive findings
    expect(manifest.reportContext.navigableFindingCount).toBe(2);
    expect(manifest.findings.length).toBeGreaterThan(2);

    // Inspect the two known navigable findings
    const caudate = manifest.findings.find(f => f.id === 'chronic-left-caudate-infarct');
    expect(caudate).toBeDefined();
    expect(caudate.navigable).toBe(true);
    expect(caudate.navigation.seriesNumber).toBe(2);
    expect(caudate.navigation.imageNumber).toBe(21);
    expect(caudate.imageAnchors).toEqual([{ type: 'series-image', seriesNumber: 2, imageNumber: 21 }]);
    expect(caudate.navigation.accession).toBe('NI9f7ff9');
    expect(caudate.title).toBeTruthy();

    const fracture = manifest.findings.find(f => f.id === 'healed-left-vertex-fracture');
    expect(fracture).toBeDefined();
    expect(fracture.navigable).toBe(true);
    expect(fracture.navigation.seriesNumber).toBe(2);
    expect(fracture.navigation.imageNumber).toBe(36);
    expect(fracture.imageAnchors).toEqual([{ type: 'series-image', seriesNumber: 2, imageNumber: 36 }]);

    // Non-navigable findings are represented explicitly, not dropped
    const nonNav = manifest.findings.filter(f => !f.navigable);
    expect(nonNav.length).toBeGreaterThan(0);
    expect(nonNav.every(f => f.nonNavigableReason)).toBe(true);

    // No raw report text
    const json = JSON.stringify(manifest);
    expect(json).not.toContain('ACCESSION: NI9f7ff9');

    for (const f of manifest.findings) {
      assertFindingStructure(f, { expectedAccession: 'NI9f7ff9' });
    }

    await screenshot(page, 'ct-head-launch-navigable');
  });
});

// ── MR Knee (3852755662087132) — 2 navigable + 1 non-navigable positive ──────

test.describe('MR Knee demo report', () => {
  test('loads report, launches with 2 navigable findings and explicit non-navigable representation', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, '3852755662087132');
    await screenshot(page, 'mr-knee-report-loaded');

    await clickPresentAndWait(page);

    const urls = await getCapturedUrls(page);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(HYPERFRAMES_ORIGIN);
    expect(urls[0]).toContain('manifest=');

    const manifest = await getManifest(page);
    expect(manifest).not.toBeNull();

    assertManifestStructure(manifest, { accession: '3852755662087132', source: 'demo' });

    // MR Knee: 2 navigable (meniscus + effusion), 1 non-navigable positive (chondromalacia)
    expect(manifest.reportContext.navigableFindingCount).toBe(2);
    expect(manifest.findings.length).toBeGreaterThan(3);

    // Inspect navigable findings
    const meniscus = manifest.findings.find(f => f.id === 'medial-meniscus-tear');
    expect(meniscus).toBeDefined();
    expect(meniscus.navigable).toBe(true);
    expect(meniscus.navigation.seriesNumber).toBe(6);
    expect(meniscus.navigation.imageNumber).toBe(23);
    expect(meniscus.imageAnchors).toEqual([{ type: 'series-image', seriesNumber: 6, imageNumber: 23 }]);
    expect(meniscus.navigation.accession).toBe('3852755662087132');

    const effusion = manifest.findings.find(f => f.id === 'joint-effusion');
    expect(effusion).toBeDefined();
    expect(effusion.navigable).toBe(true);
    expect(effusion.navigation.seriesNumber).toBe(3);
    expect(effusion.navigation.imageNumber).toBe(14);
    expect(effusion.imageAnchors).toEqual([{ type: 'series-image', seriesNumber: 3, imageNumber: 14 }]);

    // chondromalacia is a positive finding with no coords → non-navigable, still in manifest
    const chondro = manifest.findings.find(f => f.id === 'chondromalacia-patella');
    expect(chondro).toBeDefined();
    expect(chondro.navigable).toBe(false);
    expect(chondro.nonNavigableReason).toBeTruthy();
    expect(chondro.imageAnchors).toEqual([]);

    // manifest URL transport: blob ref, not inline payload
    const launchUrl = new URL(urls[0]);
    expect(launchUrl.searchParams.get('manifest')).toMatch(/^blob:/);
    // The launch URL itself must not contain the manifest payload inline
    expect(urls[0]).not.toContain('payloadVersion');

    for (const f of manifest.findings) {
      assertFindingStructure(f, { expectedAccession: '3852755662087132' });
    }

    await screenshot(page, 'mr-knee-launch-navigable');
  });
});

// Browser tests for the Hyperframes/PRESENT integration.
//
// Run:   npx playwright test
// Shots: test-artifacts/hyperframes/
//
// These tests exercise the PRESENT button, launch guardrails, manifest URL
// construction, and non-navigable deck mode without touching the real
// Hyperframes endpoint. window.open is stubbed at the page level so no
// external navigation occurs.

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, '../../test-artifacts/hyperframes');

fs.mkdirSync(SHOT_DIR, { recursive: true });

const PAGE_URL = '/index.html';
const HYPERFRAMES_ORIGIN = 'https://hyperframes.heygen.com';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NAV_CONTEXT = {
  source: 'test',
  accession: '3852755662087132',
  reportText: 'Medial meniscus tear (Series 6, Image 23).',
  positiveFindings: [
    {
      id: 'medial-meniscus-tear',
      accession: '3852755662087132',
      label: 'Medial meniscus tear',
      description: 'Posterior horn horizontal tear pattern on T2',
      seriesNumber: 6,
      imageNumber: 23,
      navigationStatus: 'navigable',
      windowPreset: null,
      severity: 'abnormal',
      source: 'seeded',
      confidence: 1,
      rawText: 'Medial meniscus tear (Series 6, Image 23).'
    }
  ],
  negativeFindings: [
    {
      id: 'acl-intact',
      accession: '3852755662087132',
      label: 'ACL intact',
      navigationStatus: 'negative',
      severity: 'negative',
      source: 'seeded'
    }
  ],
  document: null
};

const NON_NAV_CONTEXT = {
  source: 'test',
  accession: 'TEST-NON-NAV',
  reportText: 'Mild chondromalacia patella.',
  positiveFindings: [
    {
      id: 'chondromalacia-patella',
      label: 'Chondromalacia patella',
      description: 'Mild chondromalacia patella grade 1',
      seriesNumber: null,
      imageNumber: null,
      navigationStatus: 'non_navigable',
      severity: 'mild',
      source: 'seeded'
    }
  ],
  negativeFindings: [],
  document: null
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadPage(page) {
  await page.goto(PAGE_URL);
  // Wait for the global functions to be available (they're in the inline script)
  await page.waitForFunction(() => typeof window.setActiveReportContext === 'function');
  // Open the report panel (it's display:none by default in the layout)
  await page.evaluate(() => {
    if (typeof openReportPanel === 'function') openReportPanel();
    else document.querySelector('.app')?.classList.add('report-open');
  });
  // Wait for the report panel to be visible
  await page.locator('#rpPresentBtn').waitFor({ state: 'visible', timeout: 5000 });
}

/** Stub window.open to capture launched URLs instead of actually navigating. */
async function stubWindowOpen(page) {
  await page.evaluate(() => {
    window.__capturedLaunchUrls = [];
    window.open = (url, _target, _features) => {
      window.__capturedLaunchUrls.push(url);
      return null; // no window handle needed
    };
  });
}

async function getCapturedUrls(page) {
  return page.evaluate(() => window.__capturedLaunchUrls || []);
}

async function screenshot(page, name) {
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: false
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Hyperframes PRESENT integration', () => {

  test('T1 — PRESENT button renders beside PASTE and UPLOAD', async ({ page }) => {
    await loadPage(page);

    const present = page.locator('#rpPresentBtn');
    const paste   = page.locator('#rpPasteBtn');
    const upload  = page.locator('#rpUploadBtn');

    await expect(present).toBeVisible();
    await expect(paste).toBeVisible();
    await expect(upload).toBeVisible();

    await expect(present).toHaveText('PRESENT');

    // PRESENT and PASTE should be within the same header row
    const hdr = page.locator('.report-panel-hdr');
    await expect(hdr).toBeVisible();
    await expect(hdr.locator('#rpPresentBtn')).toBeVisible();
    await expect(hdr.locator('#rpPasteBtn')).toBeVisible();
    await expect(hdr.locator('#rpUploadBtn')).toBeVisible();

    await screenshot(page, '01-present-button-baseline');
  });

  test('T2 — clicking PRESENT with no report shows guardrail message', async ({ page }) => {
    await loadPage(page);

    // Ensure no report is loaded
    await page.evaluate(() => {
      if (typeof clearCurrentReport === 'function') clearCurrentReport();
      if (typeof setActiveReportContext === 'function') setActiveReportContext(null);
    });

    await stubWindowOpen(page);
    await page.locator('#rpPresentBtn').click();

    // Wait for the async import + guardrail to fire
    const errorBanner = page.locator('#rpErrorBanner');
    await errorBanner.waitFor({ state: 'visible', timeout: 8000 });

    const msg = page.locator('#rpErrorMsg');
    await expect(msg).toBeVisible();
    const text = await msg.textContent();
    expect(text?.toLowerCase()).toMatch(/report/);

    // window.open must NOT have been called — launch was blocked
    const captured = await getCapturedUrls(page);
    expect(captured).toHaveLength(0);

    await screenshot(page, '02-guardrail-no-report');
  });

  test('T3 — with navigable findings, PRESENT launches Hyperframes with manifest URL', async ({ page }) => {
    await loadPage(page);

    // Inject navigable report context
    await page.evaluate((ctx) => {
      window.setActiveReportContext(ctx);
    }, NAV_CONTEXT);

    await stubWindowOpen(page);
    await page.locator('#rpPresentBtn').click();

    // Wait for window.open to be called (async import + launch)
    await page.waitForFunction(
      () => (window.__capturedLaunchUrls?.length ?? 0) > 0,
      { timeout: 10_000 }
    );

    const captured = await getCapturedUrls(page);
    expect(captured).toHaveLength(1);
    const launchUrl = captured[0];

    // Must point to Hyperframes
    expect(launchUrl).toContain(HYPERFRAMES_ORIGIN);
    // Must use stable manifest reference, not inline payload
    expect(launchUrl).toContain('manifest=');
    expect(launchUrl).toContain('source=elvie-viewer');
    // Manifest payload must NOT be inlined in the URL
    expect(launchUrl).not.toContain('payloadVersion');
    expect(launchUrl).not.toContain('positiveFindings');

    // Error banner should not be visible after a successful launch
    const errorBanner = page.locator('#rpErrorBanner');
    const bannerVisible = await errorBanner.isVisible().catch(() => false);
    expect(bannerVisible).toBe(false);

    await screenshot(page, '03-launch-navigable');
  });

  test('T3b — seeded report state — PRESENT button visible with report loaded', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => {
      window.setActiveReportContext(ctx);
    }, NAV_CONTEXT);

    // Report context is set in the active context; confirm accession is stored
    const accession = await page.evaluate(() => window.getActiveReportContext?.()?.accession);
    expect(accession).toBe(NAV_CONTEXT.accession);

    // PRESENT button must remain visible
    await expect(page.locator('#rpPresentBtn')).toBeVisible();

    await screenshot(page, '04-report-loaded-present-visible');
  });

  test('T4 — non-navigable context: launch is allowed in non-navigable mode', async ({ page }) => {
    await loadPage(page);

    // Inject context with no navigable findings
    await page.evaluate((ctx) => {
      window.setActiveReportContext(ctx);
    }, NON_NAV_CONTEXT);

    await stubWindowOpen(page);
    await page.locator('#rpPresentBtn').click();

    // window.open should still be called (non-navigable deck is allowed)
    await page.waitForFunction(
      () => (window.__capturedLaunchUrls?.length ?? 0) > 0,
      { timeout: 10_000 }
    );

    const captured = await getCapturedUrls(page);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain(HYPERFRAMES_ORIGIN);
    expect(captured[0]).toContain('manifest=');

    // Guardrail should NOT block a non-navigable launch
    const errorBanner = page.locator('#rpErrorBanner');
    const bannerVisible = await errorBanner.isVisible().catch(() => false);
    expect(bannerVisible).toBe(false);

    await screenshot(page, '05-launch-non-navigable');
  });

  test('T5 — manifest URL contains a blob: reference (stable URL, not inline payload)', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => {
      window.setActiveReportContext(ctx);
    }, NAV_CONTEXT);

    await stubWindowOpen(page);
    await page.locator('#rpPresentBtn').click();

    await page.waitForFunction(
      () => (window.__capturedLaunchUrls?.length ?? 0) > 0,
      { timeout: 10_000 }
    );

    const captured = await getCapturedUrls(page);
    const launchUrl = new URL(captured[0]);
    const manifestParam = launchUrl.searchParams.get('manifest');
    expect(manifestParam).toBeTruthy();
    // v1 transport: session-scoped blob URL
    expect(manifestParam).toMatch(/^blob:/);
    // Must point to the right origin
    expect(launchUrl.origin).toBe(HYPERFRAMES_ORIGIN);
  });

});

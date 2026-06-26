// Browser tests for the Hyperframes/PRESENT integration.
//
// Run:   npx playwright test
// Shots: test-artifacts/hyperframes/
//
// These tests exercise the PRESENT button, launch guardrails, manifest URL
// construction, preview deck, and non-navigable deck mode without touching
// the real Hyperframes endpoint. window.open is stubbed at the page level.

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
  await page.waitForFunction(() => typeof window.setActiveReportContext === 'function');
  await page.evaluate(() => {
    if (typeof openReportPanel === 'function') openReportPanel();
    else document.querySelector('.app')?.classList.add('report-open');
  });
  await page.locator('#rpPresentBtn').waitFor({ state: 'visible', timeout: 5000 });
}

async function stubWindowOpen(page) {
  await page.evaluate(() => {
    window.__capturedLaunchUrls = [];
    window.open = (url, _target, _features) => {
      window.__capturedLaunchUrls.push(url);
      return null;
    };
  });
}

async function getCapturedUrls(page) {
  return page.evaluate(() => window.__capturedLaunchUrls || []);
}

// Wait for the preview overlay to appear or an error banner to show.
async function waitForPreviewOrError(page, timeout = 12_000) {
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="presentation-preview"]') ||
          document.getElementById('rpErrorBanner')?.classList.contains('visible'),
    { timeout }
  );
}

// Click the "Open in Hyperframes" button inside the preview and wait for the URL.
async function launchFromPreview(page) {
  const btn = page.locator('[data-testid="preview-launch-btn"]');
  await btn.waitFor({ state: 'visible', timeout: 4000 });
  await btn.click();
  await page.waitForFunction(() => (window.__capturedLaunchUrls?.length ?? 0) > 0, { timeout: 6000 });
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false });
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

    const hdr = page.locator('.report-panel-hdr');
    await expect(hdr).toBeVisible();
    await expect(hdr.locator('#rpPresentBtn')).toBeVisible();
    await expect(hdr.locator('#rpPasteBtn')).toBeVisible();
    await expect(hdr.locator('#rpUploadBtn')).toBeVisible();

    await screenshot(page, '01-present-button-baseline');
  });

  test('T2 — clicking PRESENT with no report shows guardrail, no preview', async ({ page }) => {
    await loadPage(page);

    await page.evaluate(() => {
      if (typeof clearCurrentReport === 'function') clearCurrentReport();
      if (typeof setActiveReportContext === 'function') setActiveReportContext(null);
    });

    await stubWindowOpen(page);
    await page.locator('#rpPresentBtn').click();

    const errorBanner = page.locator('#rpErrorBanner');
    await errorBanner.waitFor({ state: 'visible', timeout: 8000 });

    const msg = page.locator('#rpErrorMsg');
    await expect(msg).toBeVisible();
    const text = await msg.textContent();
    expect(text?.toLowerCase()).toMatch(/report/);

    // window.open must NOT have been called — launch was blocked
    const captured = await getCapturedUrls(page);
    expect(captured).toHaveLength(0);

    // Preview must NOT have opened
    const previewVisible = await page.locator('[data-testid="presentation-preview"]').isVisible().catch(() => false);
    expect(previewVisible).toBe(false);

    await screenshot(page, '02-guardrail-no-report');
  });

  test('T3 — with navigable findings, PRESENT shows preview then launches on button click', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => { window.setActiveReportContext(ctx); }, NAV_CONTEXT);
    await stubWindowOpen(page);
    await page.locator('#rpPresentBtn').click();

    // Preview should open
    await waitForPreviewOrError(page);
    const preview = page.locator('[data-testid="presentation-preview"]');
    await expect(preview).toBeVisible();

    // Slide shows the finding
    await expect(page.locator('[data-testid="preview-finding-title"]')).toHaveText('Medial meniscus tear');
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('1 / 1');

    // No error banner
    const bannerVisible = await page.locator('#rpErrorBanner').isVisible().catch(() => false);
    expect(bannerVisible).toBe(false);

    await screenshot(page, '03-preview-navigable');

    // Click "Open in Hyperframes" to trigger external launch
    await launchFromPreview(page);

    const captured = await getCapturedUrls(page);
    expect(captured).toHaveLength(1);
    const launchUrl = captured[0];
    expect(launchUrl).toContain(HYPERFRAMES_ORIGIN);
    expect(launchUrl).toContain('manifest=');
    expect(launchUrl).toContain('source=elvie-viewer');
    expect(launchUrl).not.toContain('payloadVersion');
    expect(launchUrl).not.toContain('positiveFindings');
  });

  test('T3b — seeded report state — PRESENT button visible with report loaded', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => { window.setActiveReportContext(ctx); }, NAV_CONTEXT);

    const accession = await page.evaluate(() => window.getActiveReportContext?.()?.accession);
    expect(accession).toBe(NAV_CONTEXT.accession);

    await expect(page.locator('#rpPresentBtn')).toBeVisible();

    await screenshot(page, '04-report-loaded-present-visible');
  });

  test('T4 — non-navigable context: preview opens in text-only mode, launch still works', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => { window.setActiveReportContext(ctx); }, NON_NAV_CONTEXT);
    await stubWindowOpen(page);
    await page.locator('#rpPresentBtn').click();

    await waitForPreviewOrError(page);
    const preview = page.locator('[data-testid="presentation-preview"]');
    await expect(preview).toBeVisible();

    // Non-navigable badge should appear (no series/image)
    await expect(page.locator('[data-testid="preview-non-navigable-badge"]')).toBeVisible();
    // Evidence placeholder shown instead of image
    await expect(page.locator('[data-testid="preview-evidence-placeholder"]')).toBeVisible();

    // No error banner
    const bannerVisible = await page.locator('#rpErrorBanner').isVisible().catch(() => false);
    expect(bannerVisible).toBe(false);

    await screenshot(page, '05-preview-non-navigable');

    // External launch still works from preview
    await launchFromPreview(page);
    const captured = await getCapturedUrls(page);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain(HYPERFRAMES_ORIGIN);
    expect(captured[0]).toContain('manifest=');
  });

  test('T5 — manifest URL contains a blob: reference (stable URL, not inline payload)', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => { window.setActiveReportContext(ctx); }, NAV_CONTEXT);
    await stubWindowOpen(page);
    await page.locator('#rpPresentBtn').click();

    await waitForPreviewOrError(page);
    await launchFromPreview(page);

    const captured = await getCapturedUrls(page);
    const launchUrl = new URL(captured[0]);
    const manifestParam = launchUrl.searchParams.get('manifest');
    expect(manifestParam).toBeTruthy();
    expect(manifestParam).toMatch(/^blob:/);
    expect(launchUrl.origin).toBe(HYPERFRAMES_ORIGIN);
  });

});

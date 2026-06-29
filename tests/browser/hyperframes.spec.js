// Browser tests for the PRESENT / Preview Deck integration.
//
// Run:   npx playwright test
// Shots: test-artifacts/hyperframes/
//
// These tests exercise the PRESENT button, guardrails, the published (fetchable)
// manifest URL, the preview deck, and non-navigable deck mode. There is no
// external HyperFrames launch — the deck is rendered to MP4 by the CLI. The
// published manifest URL is read via the window.__ELVIE_TEST_LAST_MANIFEST_URL__
// hook (set only when window.__ELVIE_TEST__ is truthy).

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, '../../test-artifacts/hyperframes');

fs.mkdirSync(SHOT_DIR, { recursive: true });

const PAGE_URL = '/index.html';

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
  // Enable test hooks (exposes manifest + published manifest URL) before PRESENT.
  await page.evaluate(() => { window.__ELVIE_TEST__ = true; });
  await page.evaluate(() => {
    if (typeof openReportPanel === 'function') openReportPanel();
    else document.querySelector('.app')?.classList.add('report-open');
  });
  await page.locator('#rpPresentBtn').waitFor({ state: 'visible', timeout: 5000 });
  // Ensure service worker is controlling the page so publishManifest returns
  // a fetchable http: URL rather than falling back to a blob: URL.
  await page.waitForFunction(
    () => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
    { timeout: 8000 }
  );
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

// Read the published (fetchable) manifest URL exposed by the test hook.
async function getPublishedManifestUrl(page) {
  await page.waitForFunction(
    () => typeof window.__ELVIE_TEST_LAST_MANIFEST_URL__ === 'string',
    { timeout: 6000 }
  );
  return page.evaluate(() => window.__ELVIE_TEST_LAST_MANIFEST_URL__);
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

    await expect(present).toHaveText('Video Report');

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

  test('T3 — with navigable findings, PRESENT shows preview, no export/launch controls', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => { window.setActiveReportContext(ctx); }, NAV_CONTEXT);
    await page.locator('#rpPresentBtn').click();

    // Preview should open
    await waitForPreviewOrError(page);
    const preview = page.locator('[data-testid="presentation-preview"]');
    await expect(preview).toBeVisible();

    // Slide shows the finding
    await expect(page.locator('[data-testid="preview-finding-title"]')).toHaveText('Medial meniscus tear');
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('1 / 1');

    // Developer-only controls are gone: no export package button, no external launch.
    await expect(page.locator('[data-testid="preview-export-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="preview-integration-status"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="preview-transport-note"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="preview-launch-btn"]')).toHaveCount(0);

    // No error banner
    const bannerVisible = await page.locator('#rpErrorBanner').isVisible().catch(() => false);
    expect(bannerVisible).toBe(false);

    await screenshot(page, '03-preview-navigable');
  });

  test('T3b — seeded report state — PRESENT button visible with report loaded', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => { window.setActiveReportContext(ctx); }, NAV_CONTEXT);

    const accession = await page.evaluate(() => window.getActiveReportContext?.()?.accession);
    expect(accession).toBe(NAV_CONTEXT.accession);

    await expect(page.locator('#rpPresentBtn')).toBeVisible();

    await screenshot(page, '04-report-loaded-present-visible');
  });

  test('T4 — non-navigable context: preview opens in text-only mode', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => { window.setActiveReportContext(ctx); }, NON_NAV_CONTEXT);
    await page.locator('#rpPresentBtn').click();

    await waitForPreviewOrError(page);
    const preview = page.locator('[data-testid="presentation-preview"]');
    await expect(preview).toBeVisible();

    // Non-navigable badge should appear (no series/image)
    await expect(page.locator('[data-testid="preview-non-navigable-badge"]')).toBeVisible();
    // Evidence placeholder shown instead of image
    await expect(page.locator('[data-testid="preview-evidence-placeholder"]')).toBeVisible();

    // No external launch button
    await expect(page.locator('[data-testid="preview-launch-btn"]')).toHaveCount(0);

    // No error banner
    const bannerVisible = await page.locator('#rpErrorBanner').isVisible().catch(() => false);
    expect(bannerVisible).toBe(false);

    await screenshot(page, '05-preview-non-navigable');
  });

  test('T5 — published manifest URL is a fetchable service-worker URL, not a blob: reference', async ({ page }) => {
    await loadPage(page);

    await page.evaluate((ctx) => { window.setActiveReportContext(ctx); }, NAV_CONTEXT);
    await page.locator('#rpPresentBtn').click();

    await waitForPreviewOrError(page);

    const manifestUrl = await getPublishedManifestUrl(page);
    expect(manifestUrl).toBeTruthy();
    // Must not be a session-scoped blob: URL
    expect(manifestUrl).not.toMatch(/^blob:/);
    // Must be a real http URL served by the local dev server via service worker
    expect(manifestUrl).toMatch(/^http:\/\/localhost/);

    // Verify the manifest URL is actually fetchable and returns valid JSON
    const fetched = await page.evaluate(url => fetch(url).then(r => r.json()), manifestUrl);
    expect(fetched.payloadVersion).toBe('presentation-manifest-v1');
    expect(fetched.accession).toBe(NAV_CONTEXT.accession);

    await screenshot(page, '06-t5-fetchable-manifest');
  });

});

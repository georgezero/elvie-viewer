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
// Manifest transport: the service worker at /lv-manifest-worker.js intercepts
// GET /lv-manifest/{id}.json and serves the manifest from memory with CORS.
// This produces a fetchable localhost URL, not a session-scoped blob: URL.
// Remote servers (hyperframes.heygen.com) still cannot reach localhost URLs;
// a cloud-storage publish step is needed for that handoff.

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
  // Wait for service worker to take control so publishManifest returns a
  // fetchable http: URL rather than falling back to a blob: URL.
  await page.waitForFunction(
    () => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
    { timeout: 8000 }
  );
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
  // Wait for preview to open OR error banner to show
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="presentation-preview"]') ||
          document.getElementById('rpErrorBanner')?.classList.contains('visible'),
    { timeout: 12_000 }
  );
  // If preview opened, trigger external launch so tests can check the URL
  const hasPreview = await page.evaluate(
    () => !!document.querySelector('[data-testid="presentation-preview"]')
  );
  if (hasPreview) {
    const launchBtn = page.locator('[data-testid="preview-launch-btn"]');
    await launchBtn.waitFor({ state: 'visible', timeout: 3000 });
    await launchBtn.click();
    await page.waitForFunction(
      () => (window.__capturedLaunchUrls?.length ?? 0) > 0,
      { timeout: 6000 }
    );
  }
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
  for (const key of ['payloadVersion', 'source', 'generatedAt', 'accession', 'reportContext', 'findings', 'sections', 'presentationTitle', 'studyLabel']) {
    expect(manifest, `missing field: ${key}`).toHaveProperty(key);
  }
  expect(manifest.accession).toBe(accession);
  expect(manifest.studyLabel).toBe(accession);
  expect(manifest.presentationTitle).toBeTruthy();
  // reportContext fields
  const rc = manifest.reportContext;
  expect(rc.accession).toBe(accession);
  expect(rc.reportSource).toBe(source);
  expect(typeof rc.findingCount).toBe('number');
  expect(typeof rc.navigableFindingCount).toBe('number');
  expect(rc.navigableFindingCount).toBeGreaterThanOrEqual(0);
  expect(typeof rc.sectionCount).toBe('number');
  // sections and findings arrays
  expect(Array.isArray(manifest.sections)).toBe(true);
  expect(Array.isArray(manifest.findings)).toBe(true);
  expect(manifest.sections.length).toBe(rc.sectionCount);
  // No raw report text in the default payload
  expect(manifest).not.toHaveProperty('trace');
  const json = JSON.stringify(manifest);
  expect(json).not.toContain('CLINICAL HISTORY');
  expect(json).not.toContain('TECHNIQUE');
}

const EVIDENCE_STATUSES = new Set(['captured', 'no_viewer', 'no_canvas', 'canvas_empty', 'capture_failed', 'skipped_non_navigable']);

function assertSectionEvidence(section, { expectNavigable, expectEvidenceStatus } = {}) {
  expect(section, 'section missing id').toHaveProperty('id');
  expect(section, 'section missing speakerNotes').toHaveProperty('speakerNotes');
  expect(Array.isArray(section.imageEvidence), 'imageEvidence must be array').toBe(true);
  for (const ev of section.imageEvidence) {
    expect(EVIDENCE_STATUSES.has(ev.status), `unknown evidence status: ${ev.status}`).toBe(true);
  }
  if (expectEvidenceStatus) {
    expect(section.imageEvidence.length).toBeGreaterThan(0);
    expect(section.imageEvidence[0].status).toBe(expectEvidenceStatus);
  }
  if (typeof expectNavigable === 'boolean') {
    expect(section.navigable).toBe(expectNavigable);
  }
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

    // CXR: all findings negative → 0 positive → sections is empty
    expect(manifest.sections).toEqual([]);
    expect(manifest.reportContext.sectionCount).toBe(0);

    await screenshot(page, 'cxr-launch-non-navigable');
  });
});

// ── CT Head (NI9f7ff9) — 2 navigable findings ────────────────────────────────

test.describe('CT Head demo report', () => {
  test('loads report, launches with 2 navigable findings, anchors correct, sections with evidence', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, 'NI9f7ff9');
    await screenshot(page, 'ct-head-presentation-source');

    await clickPresentAndWait(page);
    await screenshot(page, 'ct-head-evidence-captured');

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

    // Phase 3: sections — positive findings only, with speakerNotes and imageEvidence
    // CT Head has 2 navigable positive findings in sections
    expect(manifest.sections.length).toBeGreaterThanOrEqual(2);
    const caudateSection = manifest.sections.find(s => s.id === 'chronic-left-caudate-infarct');
    const fractureSection = manifest.sections.find(s => s.id === 'healed-left-vertex-fracture');
    expect(caudateSection).toBeDefined();
    expect(fractureSection).toBeDefined();

    // Each navigable section must have evidence assigned (status varies by environment)
    assertSectionEvidence(caudateSection, { expectNavigable: true });
    assertSectionEvidence(fractureSection, { expectNavigable: true });

    // Navigable section speakerNotes must mention location
    expect(caudateSection.speakerNotes).toContain('Series 2');
    expect(caudateSection.speakerNotes).toContain('Image 21');
    expect(fractureSection.speakerNotes).toContain('Series 2');
    expect(fractureSection.speakerNotes).toContain('Image 36');

    // presentationTitle should include the accession
    expect(manifest.presentationTitle).toContain('NI9f7ff9');

    await screenshot(page, 'ct-head-launch-navigable');
  });
});

// ── MR Knee (3852755662087132) — 2 navigable + 1 non-navigable positive ──────

test.describe('MR Knee demo report', () => {
  test('loads report, launches with 2 navigable findings, chondromalacia text-only, sections with evidence', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, '3852755662087132');
    await screenshot(page, 'mr-knee-presentation-source');

    await clickPresentAndWait(page);
    await screenshot(page, 'mr-knee-evidence-captured');

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

    // manifest URL transport: service-worker URL, not a session-scoped blob: ref
    const launchUrl = new URL(urls[0]);
    const manifestParam = launchUrl.searchParams.get('manifest');
    expect(manifestParam).not.toMatch(/^blob:/);
    expect(manifestParam).toMatch(/^http/);
    // The launch URL itself must not contain the manifest payload inline
    expect(urls[0]).not.toContain('payloadVersion');
    // The manifest URL must be fetchable and return the correct JSON
    const fetched = await page.evaluate(url => fetch(url).then(r => r.json()), manifestParam);
    expect(fetched.payloadVersion).toBe('presentation-manifest-v1');
    expect(fetched.accession).toBe('3852755662087132');

    for (const f of manifest.findings) {
      assertFindingStructure(f, { expectedAccession: '3852755662087132' });
    }

    // Phase 3: sections — 3 positive findings become 3 sections
    // MR Knee positive findings: meniscus (navigable), effusion (navigable), chondromalacia (non-navigable)
    expect(manifest.sections.length).toBe(3);
    expect(manifest.reportContext.sectionCount).toBe(3);

    const meniscusSection = manifest.sections.find(s => s.id === 'medial-meniscus-tear');
    const effusionSection = manifest.sections.find(s => s.id === 'joint-effusion');
    const chondroSection = manifest.sections.find(s => s.id === 'chondromalacia-patella');

    expect(meniscusSection).toBeDefined();
    expect(effusionSection).toBeDefined();
    expect(chondroSection).toBeDefined();

    // Navigable sections: meniscus and effusion have evidence records
    assertSectionEvidence(meniscusSection, { expectNavigable: true });
    assertSectionEvidence(effusionSection, { expectNavigable: true });

    // chondromalacia is non-navigable → evidence is skipped_non_navigable (text-only section)
    assertSectionEvidence(chondroSection, {
      expectNavigable: false,
      expectEvidenceStatus: 'skipped_non_navigable'
    });

    // Non-navigable section speakerNotes must note absence of location
    expect(chondroSection.speakerNotes).toContain('No specific image location');
    expect(chondroSection.speakerNotes).not.toContain('Series');

    // Navigable speakerNotes mention location
    expect(meniscusSection.speakerNotes).toContain('Series 6');
    expect(meniscusSection.speakerNotes).toContain('Image 23');
    expect(effusionSection.speakerNotes).toContain('Series 3');
    expect(effusionSection.speakerNotes).toContain('Image 14');

    await screenshot(page, 'mr-knee-launch-navigable');
  });
});

// ── Phase 4: preview deck navigation ─────────────────────────────────────────
// Tests that assert the preview overlay renders correctly and slide navigation
// works for both demo studies.

async function clickPresentWaitForPreview(page) {
  await page.locator('#rpPresentBtn').click();
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="presentation-preview"]') ||
          document.getElementById('rpErrorBanner')?.classList.contains('visible'),
    { timeout: 12_000 }
  );
  // Assert preview opened (not an error)
  const hasPreview = await page.evaluate(() => !!document.querySelector('[data-testid="presentation-preview"]'));
  expect(hasPreview, 'preview must open after PRESENT click').toBe(true);
}

test.describe('CT Head presentation preview', () => {
  test('preview opens with 2 slides, navigation works, screenshots captured', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, 'NI9f7ff9');

    await stubWindowOpen(page);
    await clickPresentWaitForPreview(page);

    const preview = page.locator('[data-testid="presentation-preview"]');
    await expect(preview).toBeVisible();

    // Slide 1: chronic-left-caudate-infarct
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('1 / 2');
    await expect(page.locator('[data-testid="preview-finding-title"]')).toContainText('caudate', { ignoreCase: true });
    await expect(page.locator('[data-testid="preview-location"]')).toContainText('Series 2');
    await expect(page.locator('[data-testid="preview-location"]')).toContainText('Image 21');
    // Prev is disabled on first slide
    await expect(page.locator('[data-testid="preview-prev-btn"]')).toBeDisabled();
    // Evidence area is present (status varies)
    await expect(page.locator('[data-testid="preview-evidence-area"]')).toBeVisible();

    await screenshot(page, 'ct-head-preview-slide-1');

    // Navigate to slide 2: healed-left-vertex-fracture
    await page.locator('[data-testid="preview-next-btn"]').click();
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('2 / 2');
    await expect(page.locator('[data-testid="preview-finding-title"]')).toContainText('fracture', { ignoreCase: true });
    await expect(page.locator('[data-testid="preview-location"]')).toContainText('Series 2');
    await expect(page.locator('[data-testid="preview-location"]')).toContainText('Image 36');
    // Next is disabled on last slide
    await expect(page.locator('[data-testid="preview-next-btn"]')).toBeDisabled();

    await screenshot(page, 'ct-head-preview-slide-2');

    // Navigate back to slide 1
    await page.locator('[data-testid="preview-prev-btn"]').click();
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('1 / 2');

    // External launch from preview
    await launchFromPreviewInner(page);
    const urls = await getCapturedUrls(page);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(HYPERFRAMES_ORIGIN);
    expect(urls[0]).toContain('manifest=');
  });
});

test.describe('MR Knee presentation preview', () => {
  test('preview shows 3 slides, chondromalacia is text-only, navigation works', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, '3852755662087132');

    await stubWindowOpen(page);
    await clickPresentWaitForPreview(page);

    const preview = page.locator('[data-testid="presentation-preview"]');
    await expect(preview).toBeVisible();

    // Slide 1: medial-meniscus-tear (navigable)
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('1 / 3');
    await expect(page.locator('[data-testid="preview-finding-title"]')).toContainText('meniscus', { ignoreCase: true });
    await expect(page.locator('[data-testid="preview-location"]')).toBeVisible();
    // No text-only badge on navigable slide
    await expect(page.locator('[data-testid="preview-non-navigable-badge"]')).not.toBeVisible();

    await screenshot(page, 'mr-knee-preview-slide-1');

    // Slide 2: joint-effusion (navigable)
    await page.locator('[data-testid="preview-next-btn"]').click();
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('2 / 3');
    await expect(page.locator('[data-testid="preview-finding-title"]')).toContainText('effusion', { ignoreCase: true });
    await expect(page.locator('[data-testid="preview-location"]')).toBeVisible();

    // Slide 3: chondromalacia-patella (non-navigable, text-only)
    await page.locator('[data-testid="preview-next-btn"]').click();
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('3 / 3');
    await expect(page.locator('[data-testid="preview-finding-title"]')).toContainText('chondromalacia', { ignoreCase: true });
    // Text-only badge must appear
    await expect(page.locator('[data-testid="preview-non-navigable-badge"]')).toBeVisible();
    // Evidence placeholder (not an img) for text-only slide
    await expect(page.locator('[data-testid="preview-evidence-placeholder"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-evidence-img"]')).not.toBeVisible();
    // Next is disabled on last slide
    await expect(page.locator('[data-testid="preview-next-btn"]')).toBeDisabled();

    await screenshot(page, 'mr-knee-preview-text-only-slide');

    // External launch from preview
    await launchFromPreviewInner(page);
    const urls = await getCapturedUrls(page);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(HYPERFRAMES_ORIGIN);
  });
});

// Triggers "Open in Hyperframes" from inside an already-open preview.
async function launchFromPreviewInner(page) {
  const btn = page.locator('[data-testid="preview-launch-btn"]');
  await btn.waitFor({ state: 'visible', timeout: 3000 });
  await btn.click();
  await page.waitForFunction(() => (window.__capturedLaunchUrls?.length ?? 0) > 0, { timeout: 6000 });
}

// ── Phase 5: fetchable manifest / preview deck named screenshots ───────────────
// Produces the six canonical screenshots documenting the current preview-deck
// and fetchable-manifest flow.  File names are stable identifiers for the flow,
// distinct from the generic slide screenshots captured by earlier tests.

test.describe('fetchable manifest preview deck screenshots', () => {
  test('CT Head: Preview Deck label, slide nav, Export JSON button, launch stub', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, 'NI9f7ff9');
    await stubWindowOpen(page);
    await clickPresentWaitForPreview(page);

    // Slide 1 — caudate infarct, navigable, shows Series/Image location
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('1 / 2');
    await expect(page.locator('[data-testid="preview-finding-title"]')).toContainText('caudate', { ignoreCase: true });
    await screenshot(page, 'fetchable-preview-deck-ct-head-slide-1');

    // Export JSON button: screenshot the slide panel so the footer buttons are visible
    await page.locator('[data-testid="preview-export-btn"]').scrollIntoViewIfNeeded();
    await page.locator('[data-testid="preview-slide"]').screenshot({
      path: path.join(SHOT_DIR, 'fetchable-preview-deck-export-json-button.png')
    });

    // Slide 2 — vertex fracture
    await page.locator('[data-testid="preview-next-btn"]').click();
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('2 / 2');
    await expect(page.locator('[data-testid="preview-finding-title"]')).toContainText('fracture', { ignoreCase: true });
    await screenshot(page, 'fetchable-preview-deck-ct-head-slide-2');

    // Click "Open in Hyperframes" — window.open is stubbed, so no real window opens.
    // Inject a debug banner showing the captured manifest URL for the screenshot.
    await page.locator('[data-testid="preview-launch-btn"]').click();
    await page.waitForFunction(() => (window.__capturedLaunchUrls?.length ?? 0) > 0, { timeout: 6000 });
    await page.evaluate(() => {
      const raw = window.__capturedLaunchUrls?.[0] || '';
      const manifestParam = raw ? (() => { try { return new URL(raw).searchParams.get('manifest') || raw; } catch { return raw; } })() : '';
      const div = Object.assign(document.createElement('div'), {
        id: 'lv-launch-stub-banner',
        innerHTML:
          '<span style="color:#7ab8f5;font-weight:600">window.open stubbed</span>' +
          ' &nbsp;manifest= <span style="color:#6ee7b7;word-break:break-all">' +
          manifestParam.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>'
      });
      Object.assign(div.style, {
        position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '99999',
        background: '#0a0a1a', borderTop: '1px solid #2d4fa8',
        padding: '9px 16px', fontFamily: 'monospace', fontSize: '11px',
        color: '#93c5fd', lineHeight: '1.6'
      });
      document.body.appendChild(div);
    });
    await screenshot(page, 'external-launch-url-or-popup-stub-state');
  });

  test('MR Knee: slide 1 navigable and slide 3 text-only named screenshots', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, '3852755662087132');
    await stubWindowOpen(page);
    await clickPresentWaitForPreview(page);

    // Slide 1 — meniscus tear, navigable
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('1 / 3');
    await expect(page.locator('[data-testid="preview-finding-title"]')).toContainText('meniscus', { ignoreCase: true });
    await screenshot(page, 'fetchable-preview-deck-mr-knee-slide-1');

    // Navigate to slide 3 — chondromalacia patella, text-only (non-navigable)
    await page.locator('[data-testid="preview-next-btn"]').click();
    await page.locator('[data-testid="preview-next-btn"]').click();
    await expect(page.locator('[data-testid="preview-slide-counter"]')).toHaveText('3 / 3');
    await expect(page.locator('[data-testid="preview-non-navigable-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-evidence-placeholder"]')).toBeVisible();
    await screenshot(page, 'fetchable-preview-deck-mr-knee-text-only-slide');
  });
});

test.describe('MP4 render status in preview deck', () => {
  // CT Head has a pre-rendered MP4 when `npm run render:hyperframes:ct-head` has been run.
  // When the MP4 exists (served at /generated/hyperframes/NI9f7ff9/renders/NI9f7ff9.mp4),
  // the preview shows a watch link. When absent, it shows a status / run-command hint.

  test('CT Head preview shows mp4-status or mp4-link element', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, 'NI9f7ff9');
    await stubWindowOpen(page);
    await clickPresentWaitForPreview(page);

    // Exactly one of mp4-status or mp4-link must be present
    const statusEl = page.locator('[data-testid="preview-mp4-status"]');
    const linkEl   = page.locator('[data-testid="preview-mp4-link"]');
    const statusCount = await statusEl.count();
    const linkCount   = await linkEl.count();
    expect(statusCount + linkCount).toBeGreaterThanOrEqual(1);

    if (linkCount > 0) {
      // MP4 exists — link must point to the served file
      const href = await linkEl.locator('a').getAttribute('href');
      expect(href).toMatch(/\/generated\/hyperframes\/NI9f7ff9\/renders\/NI9f7ff9\.mp4/);
      await screenshot(page, 'ct-head-preview-with-mp4-link');
    } else {
      // MP4 not yet rendered — status hint must be visible
      await expect(statusEl).toBeVisible();
      await screenshot(page, 'ct-head-preview-with-mp4-status');
    }
  });

  test('MR Knee preview shows mp4-status element (no pre-rendered MP4 by default)', async ({ page }) => {
    await loadPage(page);
    await loadDemoReport(page, '3852755662087132');
    await stubWindowOpen(page);
    await clickPresentWaitForPreview(page);

    // MR Knee render is not run by default test setup, so status should be shown.
    // If it was run, a link is acceptable too — the test just verifies one exists.
    const statusEl = page.locator('[data-testid="preview-mp4-status"]');
    const linkEl   = page.locator('[data-testid="preview-mp4-link"]');
    const count = await statusEl.count() + await linkEl.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

test.describe('CT Head exported evidence package', () => {
  // These tests validate the output of `npm run export:hyperframes:ct-head`.
  // They run against files on disk — no browser load needed.
  // They are skipped if the package has not been generated yet.

  const pkgDir     = path.join(__dirname, '../../web/generated/hyperframes/NI9f7ff9');
  const manifestPath = path.join(pkgDir, 'presentation.json');
  const assetsDir  = path.join(pkgDir, 'assets');
  const mp4Path    = path.join(pkgDir, 'renders/NI9f7ff9.mp4');

  test.skip(!fs.existsSync(manifestPath), 'presentation.json not yet generated — run npm run export:hyperframes:ct-head');

  test('presentation.json has sections with imageEvidence asset paths', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.payloadVersion).toBe('presentation-manifest-v1');
    expect(manifest.accession).toBe('NI9f7ff9');
    expect(Array.isArray(manifest.sections)).toBe(true);
    expect(manifest.sections.length).toBeGreaterThan(0);

    const captured = manifest.sections.filter(s =>
      s.imageEvidence?.some(e => e.status === 'captured' && e.assetPath)
    );
    expect(captured.length).toBeGreaterThan(0);

    for (const section of captured) {
      const ev = section.imageEvidence.find(e => e.status === 'captured' && e.assetPath);
      expect(ev.assetPath).toMatch(/^assets\/finding-\d+\.png$/);
      // No data URLs should remain (they are replaced with asset paths during export)
      expect(ev.dataUrl).toBeUndefined();
    }
  });

  test('exported PNG assets exist and are non-zero', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const assetNames = manifest.sections
      .flatMap(s => s.imageEvidence ?? [])
      .filter(e => e.status === 'captured' && e.assetPath)
      .map(e => e.assetPath.replace(/^assets\//, ''));

    expect(assetNames.length).toBeGreaterThan(0);

    for (const name of assetNames) {
      const assetPath = path.join(assetsDir, name);
      expect(fs.existsSync(assetPath), `Asset missing: ${assetPath}`).toBe(true);
      const size = fs.statSync(assetPath).size;
      expect(size, `Asset empty: ${name}`).toBeGreaterThan(1000);
    }
  });

  test('rendered MP4 exists and is non-zero', () => {
    test.skip(!fs.existsSync(mp4Path), 'MP4 not yet generated — run npm run render:hyperframes:ct-head');
    const size = fs.statSync(mp4Path).size;
    expect(size).toBeGreaterThan(50_000); // at least 50 KB
  });
});

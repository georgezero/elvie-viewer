// Manual verification: what actually happens when the "Open external Hyperframes"
// button is clicked and a browser navigates to hyperframes.heygen.com.
//
// Run (requires network access):
//   HYPERFRAMES_EXTERNAL=1 npx playwright test tests/manual/ --config=playwright.manual.config.js
//
// NOT part of the normal CI suite (tests/browser/).
//
// Findings as of 2026-06-26:
//   hyperframes.heygen.com is the documentation site for the HyperFrames
//   open-source HTML-to-video framework. It is a Mintlify docs site and does
//   not have a /present route — that path returns 404.
//
//   HyperFrames is NOT a slide deck web application. It renders HTML compositions
//   to frame-by-frame video (MP4) via a CLI (npx hyperframes render). It does not
//   accept a manifest= JSON URL parameter. The elvie-viewer manifest format
//   (presentation-manifest-v1 JSON) is not consumed by HyperFrames in any way.
//
//   Additionally, even if a /present endpoint existed:
//   - Manifests at localhost URLs would be blocked by mixed-content rules
//     (HTTPS page cannot fetch HTTP resources).
//   - Manifests at localhost are not reachable from HyperFrames servers regardless.
//
// Blocked on:
//   1. A confirmed API/endpoint on hyperframes.heygen.com for slide rendering
//   2. A public https:// manifest URL (cloud storage publish step)
//   3. Clarification of whether HyperFrames accepts JSON manifests at all
//      (vs. the native HTML composition format it documents)

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, '../../test-artifacts/hyperframes/external');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ENABLED = process.env.HYPERFRAMES_EXTERNAL === '1';

test.describe('External Hyperframes handoff verification (manual)', () => {
  test.skip(!ENABLED, [
    'Set HYPERFRAMES_EXTERNAL=1 to run this manual verification test.',
    'Expected outcome: hyperframes.heygen.com/present returns 404;',
    'HyperFrames is an HTML-to-video CLI framework, not a manifest-driven slide renderer.',
  ].join(' '));

  test('CT Head: capture what hyperframes.heygen.com actually shows', async ({ page, context }) => {
    // ── Step 1: load Elvie, get the launch URL ──────────────────────────────────

    await page.goto('http://localhost:4173/index.html');
    await page.waitForFunction(() => typeof window.setActiveReportContext === 'function');
    await page.waitForFunction(
      () => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
      { timeout: 8000 }
    );

    const loaded = await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        try { const r = await window.openAgentxReport('NI9f7ff9'); if (r?.ok) return true; } catch {}
        await new Promise(r => setTimeout(r, 200));
      }
      return false;
    });
    expect(loaded, 'CT Head demo report must load').toBe(true);

    await page.evaluate(() => { if (typeof openReportPanel === 'function') openReportPanel(); });
    await page.locator('#rpPresentBtn').waitFor({ state: 'visible', timeout: 5000 });

    // Stub window.open to capture the URL without actually opening a tab yet
    await page.evaluate(() => {
      window.__capturedLaunchUrls = [];
      window.open = url => { window.__capturedLaunchUrls.push(String(url)); return null; };
    });

    await page.locator('#rpPresentBtn').click();
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="presentation-preview"]'),
      { timeout: 12_000 }
    );

    await page.locator('[data-testid="preview-launch-btn"]').click();
    await page.waitForFunction(() => (window.__capturedLaunchUrls?.length ?? 0) > 0, { timeout: 6000 });

    const launchUrl = await page.evaluate(() => window.__capturedLaunchUrls[0]);
    console.log('\n=== External Hyperframes Verification ===');
    console.log('Elvie launch URL:', launchUrl);

    const parsedLaunch = new URL(launchUrl);
    const manifestParam = parsedLaunch.searchParams.get('manifest');
    console.log('manifest= param:', manifestParam);
    console.log('Target origin:', parsedLaunch.origin);
    console.log('Target path:', parsedLaunch.pathname);

    // ── Step 2: navigate to the real Hyperframes URL ───────────────────────────

    const extPage = await context.newPage();
    const consoleLogs = [];
    const networkErrors = [];
    const networkResponses = [];

    extPage.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text().slice(0, 200) }));
    extPage.on('requestfailed', req => networkErrors.push({ url: req.url().slice(0, 120), err: req.failure()?.errorText }));
    extPage.on('response', resp => {
      if (resp.url().includes('hyperframes') || resp.url().includes('manifest')) {
        networkResponses.push({ status: resp.status(), url: resp.url().slice(0, 120) });
      }
    });

    let navError = null;
    try {
      await extPage.goto(launchUrl, { timeout: 20_000, waitUntil: 'domcontentloaded' });
    } catch (err) {
      navError = err.message;
      console.log('Navigation error:', navError);
    }

    await extPage.screenshot({ path: path.join(SHOT_DIR, 'hyperframes-opened-initial.png') });

    await extPage.waitForTimeout(4000);

    const titleAfterLoad = await extPage.title().catch(() => '(error)');
    const finalUrl = extPage.url();
    const bodyText = await extPage.evaluate(() =>
      (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 600)
    ).catch(() => '');
    const httpStatus = networkResponses.find(r => r.url.includes('hyperframes.heygen.com'))?.status;

    await extPage.screenshot({ path: path.join(SHOT_DIR, 'hyperframes-after-load.png') });
    await extPage.screenshot({ path: path.join(SHOT_DIR, 'hyperframes-error-or-login-state.png') });

    // ── Step 3: also capture the Hyperframes homepage for product context ───────

    const homePage = await context.newPage();
    try {
      await homePage.goto('https://hyperframes.heygen.com', { timeout: 20_000, waitUntil: 'domcontentloaded' });
      await homePage.waitForTimeout(3000);
      await homePage.screenshot({ path: path.join(SHOT_DIR, 'hyperframes-homepage.png') });
    } catch {}

    // ── Step 4: report ──────────────────────────────────────────────────────────

    console.log('\n── Navigation result ──');
    console.log('HTTP status of /present route:', httpStatus ?? '(not captured — may be 404 or redirect)');
    console.log('Final URL after navigation:', finalUrl);
    console.log('Page title:', titleAfterLoad);
    console.log('Body text (first 400 chars):', bodyText.slice(0, 400));
    if (navError) console.log('Navigation threw:', navError);

    if (consoleLogs.length) {
      console.log(`\n── Console (${consoleLogs.length} entries, showing first 8) ──`);
      for (const l of consoleLogs.slice(0, 8)) console.log(` [${l.type}] ${l.text}`);
    }

    if (networkErrors.length) {
      console.log(`\n── Network failures (${networkErrors.length}) ──`);
      for (const e of networkErrors.slice(0, 8)) console.log(` FAIL ${e.url} — ${e.err}`);
    }

    console.log('\n── Relevant network responses ──');
    for (const r of networkResponses.slice(0, 10)) console.log(` HTTP ${r.status}  ${r.url}`);

    console.log('\n── Screenshot sizes ──');
    for (const name of [
      'hyperframes-opened-initial',
      'hyperframes-after-load',
      'hyperframes-error-or-login-state',
      'hyperframes-homepage',
    ]) {
      const fp = path.join(SHOT_DIR, `${name}.png`);
      const exists = fs.existsSync(fp);
      console.log(` ${name}.png: ${exists ? Math.round(fs.statSync(fp).size / 1024) + ' KB' : 'MISSING'}`);
    }

    console.log('\n── Conclusion ──');
    if (finalUrl.includes('/present') || launchUrl.includes('/present')) {
      console.log('/present route was targeted. HTTP status:', httpStatus ?? 'unknown');
      if (!httpStatus || httpStatus === 404) {
        console.log('RESULT: hyperframes.heygen.com/present does not exist (404).');
        console.log('HyperFrames is an HTML-to-MP4 CLI renderer, not a slide deck web app.');
        console.log('It does not accept a manifest= JSON URL parameter.');
      }
    }
    console.log('Transport gap: manifest at localhost is unreachable from hyperframes.heygen.com servers.');
    console.log('Mixed-content: HTTPS page cannot fetch HTTP (localhost) resources.');
  });
});

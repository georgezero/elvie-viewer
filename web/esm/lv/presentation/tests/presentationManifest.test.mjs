import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPresentationManifest,
  assessPresentationReadiness,
  PRESENTATION_MANIFEST_VERSION
} from '../presentationManifest.mjs';
import {
  launchHyperframesPresentation,
  buildHyperframesLaunchUrl,
  HYPERFRAMES_BASE_URL
} from '../hyperframesLauncher.mjs';

// ── Fixtures ────────────────────────────────────────────────────────────────

const NAV_FINDING = {
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
};

const NON_NAV_FINDING = {
  id: 'chondromalacia-patella',
  accession: '3852755662087132',
  label: 'Chondromalacia patella',
  description: 'Mild chondromalacia patella grade 1',
  seriesNumber: null,
  imageNumber: null,
  severity: 'mild',
  source: 'seeded',
  confidence: 0.9,
  rawText: 'Mild chondromalacia patella grade 1.'
};

const NEGATIVE_FINDING = {
  id: 'acl-intact',
  accession: '3852755662087132',
  label: 'ACL intact',
  navigationStatus: 'negative',
  severity: 'negative',
  source: 'seeded',
  rawText: 'ACL is intact with normal signal and course.'
};

function makeContext(overrides = {}) {
  return {
    source: 'report-panel',
    accession: '3852755662087132',
    reportText: 'Medial meniscus tear (Series 6, Image 23). ACL intact.',
    positiveFindings: [NAV_FINDING, NON_NAV_FINDING],
    negativeFindings: [NEGATIVE_FINDING],
    document: null,
    ...overrides
  };
}

const FIXED_TS = '2026-06-26T00:00:00.000Z';

// ── Required fields ───────────────────────────────────────────────────────────

test('manifest includes all required top-level fields', () => {
  const m = buildPresentationManifest(makeContext(), { generatedAt: FIXED_TS });
  for (const key of ['payloadVersion', 'source', 'generatedAt', 'accession', 'reportContext', 'findings']) {
    assert.ok(key in m, `missing required field: ${key}`);
  }
  assert.equal(m.payloadVersion, PRESENTATION_MANIFEST_VERSION);
  assert.equal(m.generatedAt, FIXED_TS);
  assert.equal(m.accession, '3852755662087132');
  assert.equal(m.source, 'elvie-viewer');
  assert.ok(Array.isArray(m.findings));
});

test('manifest generation is deterministic for a fixed timestamp', () => {
  const a = buildPresentationManifest(makeContext(), { generatedAt: FIXED_TS });
  const b = buildPresentationManifest(makeContext(), { generatedAt: FIXED_TS });
  assert.deepEqual(a, b);
});

// ── Privacy: raw report text excluded by default ──────────────────────────────

test('full raw report text is excluded from the default payload', () => {
  const m = buildPresentationManifest(makeContext(), { generatedAt: FIXED_TS });
  const json = JSON.stringify(m);
  assert.ok(!('trace' in m), 'no top-level trace by default');
  assert.equal(m.reportContext.hasReportText, true);
  assert.ok(!json.includes('Medial meniscus tear (Series 6, Image 23). ACL intact.'),
    'raw report text must not appear in default payload');
  // Per-finding rawText also excluded by default.
  for (const f of m.findings) {
    assert.ok(!('trace' in f), 'no per-finding trace by default');
  }
});

// ── includeTrace gated behind debug flag ──────────────────────────────────────

test('includeTrace is ignored without the debug flag', () => {
  const m = buildPresentationManifest(makeContext(), { generatedAt: FIXED_TS, includeTrace: true });
  assert.ok(!('trace' in m), 'trace must not appear without debug');
  assert.ok(m.findings.every((f) => !('trace' in f)));
});

test('includeTrace only works with explicit debug flag', () => {
  const m = buildPresentationManifest(makeContext(), {
    generatedAt: FIXED_TS,
    debug: true,
    includeTrace: true
  });
  assert.ok('trace' in m, 'trace present when debug+includeTrace');
  assert.equal(m.trace.reportText, 'Medial meniscus tear (Series 6, Image 23). ACL intact.');
  const navFinding = m.findings.find((f) => f.id === 'medial-meniscus-tear');
  assert.ok(navFinding.trace, 'per-finding trace present');
  assert.equal(navFinding.trace.rawText, 'Medial meniscus tear (Series 6, Image 23).');
});

test('debug alone (without includeTrace) does not emit trace', () => {
  const m = buildPresentationManifest(makeContext(), { generatedAt: FIXED_TS, debug: true });
  assert.ok(!('trace' in m));
});

// ── Navigation metadata + anchors ─────────────────────────────────────────────

test('navigable findings carry navigation metadata and image anchors', () => {
  const m = buildPresentationManifest(makeContext(), { generatedAt: FIXED_TS });
  const f = m.findings.find((x) => x.id === 'medial-meniscus-tear');
  assert.equal(f.navigable, true);
  assert.equal(f.navigationStatus, 'navigable');
  assert.equal(f.navigation.findingId, 'medial-meniscus-tear');
  assert.equal(f.navigation.accession, '3852755662087132');
  assert.equal(f.navigation.seriesNumber, 6);
  assert.equal(f.navigation.imageNumber, 23);
  assert.deepEqual(f.imageAnchors, [{ type: 'series-image', seriesNumber: 6, imageNumber: 23 }]);
  assert.equal(f.title, 'Medial meniscus tear');
  assert.equal(f.text, 'Posterior horn horizontal tear pattern on T2');
});

test('image anchors derive from snake_case parser fields too', () => {
  const ctx = makeContext({
    positiveFindings: [{
      id: 'snake-finding',
      label: 'Snake finding',
      series_number: 4,
      image_number: 12,
      navigation_status: 'navigable'
    }],
    negativeFindings: []
  });
  const m = buildPresentationManifest(ctx, { generatedAt: FIXED_TS });
  const f = m.findings[0];
  assert.equal(f.navigation.seriesNumber, 4);
  assert.equal(f.navigation.imageNumber, 12);
  assert.equal(f.navigable, true);
});

// ── Non-navigable findings remain represented ─────────────────────────────────

test('non-navigable findings are represented explicitly, not dropped', () => {
  const m = buildPresentationManifest(makeContext(), { generatedAt: FIXED_TS });
  const chond = m.findings.find((x) => x.id === 'chondromalacia-patella');
  assert.ok(chond, 'non-navigable finding present');
  assert.equal(chond.navigable, false);
  assert.equal(chond.nonNavigableReason, 'no_image_anchor');
  assert.deepEqual(chond.imageAnchors, []);

  const neg = m.findings.find((x) => x.id === 'acl-intact');
  assert.ok(neg, 'negative finding present');
  assert.equal(neg.navigable, false);
  assert.equal(neg.nonNavigableReason, 'negative_finding');

  assert.equal(m.reportContext.findingCount, 3);
  assert.equal(m.reportContext.navigableFindingCount, 1);
  assert.equal(m.reportContext.nonNavigableFindingCount, 2);
});

// ── Readiness guardrails ──────────────────────────────────────────────────────

test('readiness blocks when there is no active report', () => {
  assert.equal(assessPresentationReadiness(null).ok, false);
  assert.equal(assessPresentationReadiness(null).reason, 'no_active_report');
  assert.equal(assessPresentationReadiness({}).ok, false);
});

test('readiness allows a non-navigable deck when no findings are navigable', () => {
  const ctx = makeContext({ positiveFindings: [NON_NAV_FINDING], negativeFindings: [NEGATIVE_FINDING] });
  const r = assessPresentationReadiness(ctx);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'non_navigable');
  assert.equal(r.navigableCount, 0);
});

test('readiness reports navigable mode when navigable findings exist', () => {
  const r = assessPresentationReadiness(makeContext());
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'navigable');
  assert.equal(r.navigableCount, 1);
});

// ── Hyperframes launcher adapter ──────────────────────────────────────────────

test('launch is blocked with a clear message when no report is active', () => {
  const res = launchHyperframesPresentation({ context: null });
  assert.equal(res.ok, false);
  assert.equal(res.blocked, true);
  assert.equal(res.reason, 'no_active_report');
  assert.match(res.message, /report/i);
});

test('launch builds manifest, publishes a stable URL, and opens Hyperframes', () => {
  const opened = [];
  const res = launchHyperframesPresentation({
    context: makeContext(),
    generatedAt: FIXED_TS,
    publishManifest: () => 'blob:fake-manifest-url',
    openWindow: (url) => { opened.push(url); return { url }; }
  });
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'navigable');
  assert.equal(res.manifestUrl, 'blob:fake-manifest-url');
  assert.equal(opened.length, 1);
  assert.ok(opened[0].startsWith(HYPERFRAMES_BASE_URL));
  assert.ok(opened[0].includes('manifest=blob%3Afake-manifest-url'));
  // The launch must not inline the manifest payload into the query string.
  assert.ok(!opened[0].includes('payloadVersion'), 'manifest payload must not be inlined');
});

test('launch with non-navigable deck still succeeds', () => {
  const res = launchHyperframesPresentation({
    context: makeContext({ positiveFindings: [NON_NAV_FINDING], negativeFindings: [] }),
    generatedAt: FIXED_TS,
    publishManifest: () => 'blob:fake',
    openWindow: () => null
  });
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'non_navigable');
  assert.match(res.message, /non-navigable/i);
});

test('buildHyperframesLaunchUrl encodes the manifest URL as a query param', () => {
  const url = buildHyperframesLaunchUrl('https://store.example/m/abc.json');
  assert.ok(url.startsWith(HYPERFRAMES_BASE_URL));
  assert.ok(url.includes('manifest=https%3A%2F%2Fstore.example%2Fm%2Fabc.json'));
});

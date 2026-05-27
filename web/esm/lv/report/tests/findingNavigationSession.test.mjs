import assert from 'node:assert/strict';
import { createFindingNavigationSession, navigateCurrentFinding } from '../findingNavigationSession.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NAV_A = {
  id: 'nav-a', label: 'Finding A',
  navigationStatus: 'navigable', seriesNumber: 2, imageNumber: 21,
  severity: 'abnormal', confidence: 0.95
};
const NAV_B = {
  id: 'nav-b', label: 'Finding B',
  navigationStatus: 'navigable', seriesNumber: 3, imageNumber: 14,
  severity: 'abnormal', confidence: 0.80
};
const NAV_C = {
  id: 'nav-c', label: 'Finding C',
  navigationStatus: 'navigable', seriesNumber: 6, imageNumber: 5,
  severity: 'chronic', confidence: 0.70
};
const SERIES_ONLY = {
  id: 'series-only', label: 'Series only finding',
  navigationStatus: 'series_only', seriesNumber: 4, imageNumber: null,
  severity: 'abnormal', confidence: 0.60
};
const NON_NAV = {
  id: 'non-nav', label: 'Report only finding',
  navigationStatus: 'non_navigable', seriesNumber: null, imageNumber: null,
  severity: 'mild', confidence: 0.50
};
const NEGATIVE = {
  id: 'negative-a', label: 'No hemorrhage',
  navigationStatus: 'negative', seriesNumber: null, imageNumber: null,
  severity: 'negative', confidence: 0.95
};
const LOW_CONF = {
  id: 'low-conf', label: 'Low confidence finding',
  navigationStatus: 'navigable', seriesNumber: 1, imageNumber: 1,
  severity: 'abnormal', confidence: 0.20
};
const TAGGED = {
  id: 'tagged-a', label: 'Tagged finding',
  navigationStatus: 'navigable', seriesNumber: 7, imageNumber: 10,
  severity: 'abnormal', confidence: 0.90, tags: ['acute', 'actionable']
};
const TAGGED_B = {
  id: 'tagged-b', label: 'Another tagged',
  navigationStatus: 'navigable', seriesNumber: 8, imageNumber: 3,
  severity: 'abnormal', confidence: 0.85, tags: ['actionable']
};

const ALL_FINDINGS = [NAV_A, NAV_B, SERIES_ONLY, NON_NAV, NEGATIVE, NAV_C, LOW_CONF];

// ── T1: default filter — navigable only ──────────────────────────────────────

{
  const session = createFindingNavigationSession(ALL_FINDINGS);
  const progress = session.getProgress();
  assert.equal(progress.total, 4, 'should include only navigable findings (NAV_A, NAV_B, NAV_C, LOW_CONF)');
}

// ── T2: stable report ordering preserved ─────────────────────────────────────

{
  const session = createFindingNavigationSession(ALL_FINDINGS);
  const ids = [];
  let f;
  while ((f = session.nextFinding()) !== null) ids.push(f.id);
  assert.deepEqual(ids, ['nav-a', 'nav-b', 'nav-c', 'low-conf'], 'order should match input order');
}

// ── T3: cursor starts before first (currentFinding returns null) ──────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B]);
  assert.equal(session.currentFinding(), null, 'before first nextFinding, currentFinding should be null');
}

// ── T4: nextFinding advances cursor and returns finding ───────────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B, NAV_C]);
  const f1 = session.nextFinding();
  assert.equal(f1.id, 'nav-a');
  assert.equal(session.currentFinding().id, 'nav-a');

  const f2 = session.nextFinding();
  assert.equal(f2.id, 'nav-b');

  const f3 = session.nextFinding();
  assert.equal(f3.id, 'nav-c');
}

// ── T5: nextFinding at end returns null, cursor stays at last ─────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B]);
  session.nextFinding(); // nav-a
  session.nextFinding(); // nav-b (last)
  const atEnd = session.nextFinding();
  assert.equal(atEnd, null, 'at last item, nextFinding should return null');
  assert.equal(session.currentFinding().id, 'nav-b', 'cursor should remain at last finding');
}

// ── T6: previousFinding retreats cursor ──────────────────────────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B, NAV_C]);
  session.nextFinding(); // nav-a
  session.nextFinding(); // nav-b
  session.nextFinding(); // nav-c

  const prev = session.previousFinding();
  assert.equal(prev.id, 'nav-b');
  assert.equal(session.currentFinding().id, 'nav-b');
}

// ── T7: previousFinding at first item (cursor=0) returns null ────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B]);
  session.nextFinding(); // nav-a (cursor=0)
  const atStart = session.previousFinding();
  assert.equal(atStart, null, 'at first item (cursor=0), previousFinding should return null');
  assert.equal(session.currentFinding().id, 'nav-a', 'cursor should remain at first finding');
}

// ── T8: previousFinding before start (cursor=-1) returns null ────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B]);
  // cursor=-1, no nextFinding called
  const result = session.previousFinding();
  assert.equal(result, null, 'previousFinding before start should return null');
}

// ── T9: reset returns cursor to before-first ──────────────────────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B, NAV_C]);
  session.nextFinding();
  session.nextFinding();
  session.reset();
  assert.equal(session.currentFinding(), null, 'after reset, currentFinding should be null');
  const p = session.getProgress();
  assert.equal(p.index, -1);
  assert.equal(p.hasPrevious, false);
  assert.equal(p.hasNext, true);
  const first = session.nextFinding();
  assert.equal(first?.id, 'nav-a', 'after reset, nextFinding should restart from beginning');
}

// ── T10: getProgress tracks state correctly ───────────────────────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B, NAV_C]);

  const p0 = session.getProgress();
  assert.equal(p0.index, -1);
  assert.equal(p0.total, 3);
  assert.equal(p0.hasPrevious, false);
  assert.equal(p0.hasNext, true);

  session.nextFinding(); // index=0
  const p1 = session.getProgress();
  assert.equal(p1.index, 0);
  assert.equal(p1.hasPrevious, false);
  assert.equal(p1.hasNext, true);

  session.nextFinding(); // index=1
  const p2 = session.getProgress();
  assert.equal(p2.index, 1);
  assert.equal(p2.hasPrevious, true);
  assert.equal(p2.hasNext, true);

  session.nextFinding(); // index=2 (last)
  const p3 = session.getProgress();
  assert.equal(p3.index, 2);
  assert.equal(p3.hasPrevious, true);
  assert.equal(p3.hasNext, false);
}

// ── T11: empty findings list → total:0, nextFinding returns null ──────────────

{
  const session = createFindingNavigationSession([]);
  assert.equal(session.nextFinding(), null);
  const p = session.getProgress();
  assert.equal(p.total, 0);
  assert.equal(p.hasNext, false);
}

// ── T12: null/undefined findings → graceful empty session ────────────────────

{
  const s1 = createFindingNavigationSession(null);
  assert.equal(s1.getProgress().total, 0);

  const s2 = createFindingNavigationSession(undefined);
  assert.equal(s2.getProgress().total, 0);
}

// ── T13: navigableOnly:false includes non-navigable, series_only, negative ────

{
  const session = createFindingNavigationSession(ALL_FINDINGS, { navigableOnly: false });
  const p = session.getProgress();
  assert.equal(p.total, ALL_FINDINGS.length, 'navigableOnly:false should include all findings');
}

// ── T14: excludeNegative filters out negative status and severity ─────────────

{
  const findings = [NAV_A, NEGATIVE, NON_NAV, NAV_B];
  const session = createFindingNavigationSession(findings, {
    navigableOnly: false,
    excludeNegative: true
  });
  const ids = [];
  let f;
  while ((f = session.nextFinding()) !== null) ids.push(f.id);
  assert.ok(!ids.includes('negative-a'), 'negative finding should be excluded');
  assert.ok(ids.includes('nav-a') && ids.includes('nav-b'), 'positive findings should remain');
}

// ── T15: positiveOnly is an alias for excludeNegative ────────────────────────

{
  const findings = [NAV_A, NEGATIVE, NAV_B];
  const session = createFindingNavigationSession(findings, {
    navigableOnly: false,
    positiveOnly: true
  });
  let count = 0;
  while (session.nextFinding() !== null) count++;
  assert.equal(count, 2, 'positiveOnly should exclude 1 negative finding');
}

// ── T16: minConfidence filters by confidence score ────────────────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B, NAV_C, LOW_CONF], {
    navigableOnly: false,
    minConfidence: 0.75
  });
  const ids = [];
  let f;
  while ((f = session.nextFinding()) !== null) ids.push(f.id);
  assert.ok(ids.includes('nav-a'), 'conf 0.95 should pass minConfidence 0.75');
  assert.ok(ids.includes('nav-b'), 'conf 0.80 should pass');
  assert.ok(!ids.includes('nav-c'), 'conf 0.70 should be excluded');
  assert.ok(!ids.includes('low-conf'), 'conf 0.20 should be excluded');
}

// ── T17: minConfidence 0 or absent → no confidence filtering ─────────────────

{
  const session = createFindingNavigationSession([NAV_A, LOW_CONF]);
  const p = session.getProgress();
  assert.equal(p.total, 2, 'no minConfidence → both included (both navigable)');
}

// ── T18: tags filter — require at least one matching tag ──────────────────────

{
  const findings = [NAV_A, TAGGED, TAGGED_B, NAV_B];
  const session = createFindingNavigationSession(findings, {
    navigableOnly: false,
    tags: ['acute']
  });
  const ids = [];
  let f;
  while ((f = session.nextFinding()) !== null) ids.push(f.id);
  assert.deepEqual(ids, ['tagged-a'], 'only finding with acute tag should be included');
}

// ── T19: tags filter — multiple tags, any match passes ───────────────────────

{
  const findings = [NAV_A, TAGGED, TAGGED_B];
  const session = createFindingNavigationSession(findings, {
    navigableOnly: false,
    tags: ['actionable']
  });
  const ids = [];
  let f;
  while ((f = session.nextFinding()) !== null) ids.push(f.id);
  assert.ok(ids.includes('tagged-a') && ids.includes('tagged-b'), 'both actionable findings included');
  assert.ok(!ids.includes('nav-a'), 'untagged finding excluded');
}

// ── T20: tags filter — findings without tags field are excluded ───────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B], {
    navigableOnly: false,
    tags: ['acute']
  });
  assert.equal(session.getProgress().total, 0, 'findings without tags field should be excluded when tag filter active');
}

// ── T21: combined filters — navigable + minConfidence ────────────────────────

{
  const session = createFindingNavigationSession(ALL_FINDINGS, { minConfidence: 0.75 });
  const ids = [];
  let f;
  while ((f = session.nextFinding()) !== null) ids.push(f.id);
  // navigable: NAV_A (0.95), NAV_B (0.80), NAV_C (0.70), LOW_CONF (0.20)
  // + minConfidence 0.75 → keeps NAV_A (0.95), NAV_B (0.80)
  assert.deepEqual(ids, ['nav-a', 'nav-b']);
}

// ── T22: source mutations do not affect queue ─────────────────────────────────

{
  const source = [{ ...NAV_A }, { ...NAV_B }];
  const session = createFindingNavigationSession(source);
  source.push(NAV_C);
  assert.equal(session.getProgress().total, 2, 'source array mutation should not change session queue');
}

// ── T23: navigateCurrentFinding — no_current_finding before any next ──────────

{
  const session = createFindingNavigationSession([NAV_A]);
  const result = await navigateCurrentFinding(session, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_current_finding');
}

// ── T24: navigateCurrentFinding — no_provider when provider missing ───────────

{
  const session = createFindingNavigationSession([NAV_A]);
  session.nextFinding();
  const result = await navigateCurrentFinding(session, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_provider');
}

// ── T25: navigateCurrentFinding — delegates to provider.navigateToFinding ─────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B]);
  session.nextFinding(); // current = NAV_A

  const dispatched = [];
  const mockProvider = {
    async navigateToFinding(finding) {
      dispatched.push(finding);
      return { ok: true };
    }
  };

  const result = await navigateCurrentFinding(session, mockProvider);
  assert.equal(result.ok, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].id, 'nav-a', 'should navigate to current finding');
}

// ── T26: navigateCurrentFinding — does not advance cursor ────────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B]);
  session.nextFinding(); // cursor=0, current=NAV_A

  const mockProvider = { navigateToFinding: async () => ({ ok: true }) };
  await navigateCurrentFinding(session, mockProvider);
  await navigateCurrentFinding(session, mockProvider);

  assert.equal(session.currentFinding().id, 'nav-a', 'navigateCurrentFinding should not advance cursor');
  assert.equal(session.getProgress().index, 0);
}

// ── T27: full tour workflow — next through all, then back ─────────────────────

{
  const session = createFindingNavigationSession([NAV_A, NAV_B, NAV_C]);
  const dispatched = [];
  const mockProvider = {
    async navigateToFinding(f) { dispatched.push(f.id); return { ok: true }; }
  };

  // Forward pass: nextFinding() returns null at end
  let f;
  while ((f = session.nextFinding()) !== null) {
    await navigateCurrentFinding(session, mockProvider);
  }
  assert.deepEqual(dispatched, ['nav-a', 'nav-b', 'nav-c'], 'forward tour should visit all in order');

  // Backward pass: previousFinding() returns null before start
  const backIds = [];
  while ((f = session.previousFinding()) !== null) {
    backIds.push(f.id);
  }
  assert.deepEqual(backIds, ['nav-b', 'nav-a'], 'backward pass should retreat in reverse');
}

console.log('findingNavigationSession: all tests passed');

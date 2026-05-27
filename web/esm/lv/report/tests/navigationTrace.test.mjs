import assert from 'node:assert/strict';
import { createNavigationTrace, summarizeNavigationTrace } from '../navigationTrace.mjs';

// ── T1: createNavigationTrace — full success shape ────────────────────────────

{
  const trace = createNavigationTrace({
    commandType: 'openFinding',
    accession: 'NI9f7ff9',
    findingId: 'caudate-infarct',
    studyResolved: false,
    studyOpened: false,
    playbookApplied: false,
    targetPaneId: 0,
    seriesNumber: 2,
    imageNumber: 21,
    operations: [{ op: 'loadSeriesInPane' }, { op: 'scrollPaneToIndex' }],
    ok: true
  });

  assert.equal(trace.commandType, 'openFinding');
  assert.equal(trace.accession, 'NI9f7ff9');
  assert.equal(trace.findingId, 'caudate-infarct');
  assert.equal(trace.studyResolved, false);
  assert.equal(trace.studyOpened, false);
  assert.equal(trace.playbookApplied, false);
  assert.equal(trace.targetPaneId, 0);
  assert.equal(trace.seriesNumber, 2);
  assert.equal(trace.imageNumber, 21);
  assert.equal(trace.operations.length, 2);
  assert.equal(trace.ok, true);
  assert.equal(trace.reason, null);
  assert.equal(trace.confidence, null);
  assert.equal(trace.resolverReason, null);
}

// ── T2: createNavigationTrace — failure shape ─────────────────────────────────

{
  const trace = createNavigationTrace({
    commandType: 'openFinding',
    findingId: 'bad-finding',
    ok: false,
    reason: 'loadSeriesInPane action not available'
  });

  assert.equal(trace.ok, false);
  assert.equal(trace.reason, 'loadSeriesInPane action not available');
  assert.equal(trace.findingId, 'bad-finding');
  assert.equal(trace.accession, null);
  assert.equal(trace.seriesNumber, null);
  assert.equal(trace.imageNumber, null);
  assert.equal(trace.operations.length, 0);
}

// ── T3: createNavigationTrace — result is frozen ──────────────────────────────

{
  const trace = createNavigationTrace({ ok: true, commandType: 'openFinding' });
  assert.ok(Object.isFrozen(trace), 'trace object should be frozen');
}

// ── T4: createNavigationTrace — operations array is a copy ───────────────────

{
  const ops = [{ op: 'loadSeriesInPane' }];
  const trace = createNavigationTrace({ ok: true, commandType: 'openFinding', operations: ops });
  ops.push({ op: 'extra' });
  assert.equal(trace.operations.length, 1, 'mutations to original ops should not affect trace');
}

// ── T5: createNavigationTrace — with confidence and resolverReason ────────────

{
  const trace = createNavigationTrace({
    commandType: 'openStudyThenFinding',
    ok: true,
    studyOpened: true,
    playbookApplied: true,
    targetPaneId: 2,
    seriesNumber: 4,
    imageNumber: 10,
    confidence: 'high',
    resolverReason: 'modality_match'
  });

  assert.equal(trace.commandType, 'openStudyThenFinding');
  assert.equal(trace.studyOpened, true);
  assert.equal(trace.playbookApplied, true);
  assert.equal(trace.confidence, 'high');
  assert.equal(trace.resolverReason, 'modality_match');
}

// ── T6: createNavigationTrace — defaults for missing fields ───────────────────

{
  const trace = createNavigationTrace({});
  assert.equal(trace.commandType, 'openFinding');
  assert.equal(trace.accession, null);
  assert.equal(trace.findingId, null);
  assert.equal(trace.studyResolved, false);
  assert.equal(trace.studyOpened, false);
  assert.equal(trace.playbookApplied, false);
  assert.equal(trace.targetPaneId, null);
  assert.equal(trace.seriesNumber, null);
  assert.equal(trace.imageNumber, null);
  assert.equal(trace.confidence, null);
  assert.equal(trace.resolverReason, null);
  assert.deepEqual(trace.operations, []);
  assert.equal(trace.ok, false);
  assert.equal(trace.reason, null);
}

// ── T7: summarizeNavigationTrace — null/undefined input ──────────────────────

{
  assert.equal(summarizeNavigationTrace(null), 'no trace');
  assert.equal(summarizeNavigationTrace(undefined), 'no trace');
}

// ── T8: summarizeNavigationTrace — failure ────────────────────────────────────

{
  const trace = createNavigationTrace({ ok: false, reason: 'scrollPaneToIndex failed', commandType: 'openFinding' });
  const summary = summarizeNavigationTrace(trace);
  assert.ok(summary.includes('failed'), `summary should mention failure, got: ${summary}`);
  assert.ok(summary.includes('scrollPaneToIndex failed'), `summary should include reason, got: ${summary}`);
}

// ── T9: summarizeNavigationTrace — active pane success ────────────────────────

{
  const trace = createNavigationTrace({
    commandType: 'openFinding',
    ok: true,
    playbookApplied: false,
    targetPaneId: 0,
    seriesNumber: 2,
    imageNumber: 21
  });
  const summary = summarizeNavigationTrace(trace);
  assert.ok(summary.includes('active pane'), `summary should mention active pane, got: ${summary}`);
  assert.ok(summary.includes('series 2'), `summary should include seriesNumber, got: ${summary}`);
  assert.ok(summary.includes('image 21'), `summary should include imageNumber, got: ${summary}`);
}

// ── T10: summarizeNavigationTrace — HP pane ───────────────────────────────────

{
  const trace = createNavigationTrace({
    commandType: 'openStudyThenFinding',
    ok: true,
    studyOpened: true,
    playbookApplied: true,
    targetPaneId: 3,
    seriesNumber: 7,
    imageNumber: 5
  });
  const summary = summarizeNavigationTrace(trace);
  assert.ok(summary.includes('HP pane 3'), `summary should mention HP pane 3, got: ${summary}`);
  assert.ok(summary.includes('study opened'), `summary should mention study opened, got: ${summary}`);
  assert.ok(summary.includes('series 7'), `summary should include series, got: ${summary}`);
  assert.ok(summary.includes('image 5'), `summary should include image, got: ${summary}`);
}

// ── T11: summarizeNavigationTrace — confidence shown for non-exact ────────────

{
  const trace = createNavigationTrace({
    commandType: 'openFinding',
    ok: true,
    playbookApplied: false,
    targetPaneId: 0,
    seriesNumber: 2,
    imageNumber: 10,
    confidence: 'medium'
  });
  const summary = summarizeNavigationTrace(trace);
  assert.ok(summary.includes('[medium]'), `summary should show confidence, got: ${summary}`);
}

// ── T12: summarizeNavigationTrace — exact confidence not shown ────────────────

{
  const trace = createNavigationTrace({
    commandType: 'openFinding',
    ok: true,
    playbookApplied: false,
    targetPaneId: 0,
    seriesNumber: 2,
    imageNumber: 10,
    confidence: 'exact'
  });
  const summary = summarizeNavigationTrace(trace);
  assert.ok(!summary.includes('[exact]'), `exact confidence should be omitted, got: ${summary}`);
}

console.log('navigationTrace: all tests passed');

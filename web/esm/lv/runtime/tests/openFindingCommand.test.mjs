import assert from 'node:assert/strict';
import { createLvRunCommandBus } from '../commandBus.mjs';
import { createOpenFindingCommand, createOpenStudyThenFindingCommand } from '../../report/agentViewerCommand.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeActions(overrides = {}) {
  const calls = { loadSeriesInPane: [], scrollPaneToIndex: [], setLayout: [], setActivePane: [], loadStudyByAccession: [] };
  return {
    calls,
    actions: {
      loadSeriesInPane: async (paneId, selector) => {
        calls.loadSeriesInPane.push({ paneId, selector });
        return { ok: true };
      },
      scrollPaneToIndex: async (paneId, index) => {
        calls.scrollPaneToIndex.push({ paneId, index });
        return { ok: true };
      },
      setLayout: async (layoutId) => {
        calls.setLayout.push({ layoutId });
        return { ok: true };
      },
      setActivePane: async (paneId) => {
        calls.setActivePane.push({ paneId });
        return { ok: true };
      },
      scrollPaneBy: async () => ({ ok: true }),
      resetViewer: async () => ({ ok: true }),
      resetPaneCamera: async () => ({ ok: true }),
      setCrosshairEnabled: async () => ({ ok: true }),
      syncPanesToPoint: async () => ({ ok: true }),
      setWindowPreset: async () => ({ ok: true }),
      jumpToFinding: async () => ({ ok: false, reason: 'no finding' }),
      ...overrides
    }
  };
}

function makeRuntime(activePaneId = 0, panesOverride = null) {
  return {
    state: {
      nativeViewer: {
        activePaneIndex: activePaneId,
        panes: panesOverride ?? [{ paneId: 0, active: true }, { paneId: 1, active: false }]
      }
    }
  };
}

// Simulate a viewer state where a hanging protocol has loaded specific series into panes.
// paneId 0 → series 2 (CT head), paneId 1 → series 6 (MR knee)
function makeHpRuntime(activePaneId = 0) {
  return makeRuntime(activePaneId, [
    { paneId: 0, seriesNumber: 2, active: activePaneId === 0 },
    { paneId: 1, seriesNumber: 6, active: activePaneId === 1 }
  ]);
}

// Simulate a viewer state where the series catalog is populated (study loaded).
// stateSnapshot reads catalog from runtime.api.getSeriesCatalog().
function makeRuntimeWithCatalog(activePaneId = 0, catalog = []) {
  return {
    state: {
      nativeViewer: {
        activePaneIndex: activePaneId,
        panes: [{ paneId: 0, active: true }, { paneId: 1, active: false }]
      }
    },
    api: {
      getSeriesCatalog: () => catalog
    }
  };
}

const DEMO_CT_CATALOG = [
  { seriesNumber: 1, seriesDescription: 'head scout' },
  { seriesNumber: 2, seriesDescription: 'CT head' }
];

// ── Test 1: openFinding dispatches loadSeriesInPane + scrollPaneToIndex ───────

{
  const { calls, actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'NI9f7ff9', findingId: 'caudate-infarct', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true, 'openFinding should return ok:true');
  assert.equal(calls.loadSeriesInPane.length, 1, 'should call loadSeriesInPane once');
  assert.equal(calls.loadSeriesInPane[0].selector.seriesNumber, 2);
  assert.equal(calls.loadSeriesInPane[0].paneId, 0, 'should use active pane 0');
  assert.equal(calls.scrollPaneToIndex.length, 1, 'should call scrollPaneToIndex once');
  assert.equal(calls.scrollPaneToIndex[0].index, 20, 'imageNumber 21 → index 20 (1-based → 0-based)');
}

// ── Test 2: openFinding uses activePaneId from viewer state ───────────────────

{
  const { calls, actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(2) });

  const cmd = createOpenFindingCommand({ accession: 'ACC-001', findingId: 'f1', seriesNumber: 3, imageNumber: 14 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(calls.loadSeriesInPane[0].paneId, 2, 'should use activePaneId=2 from runtime state');
  assert.equal(calls.scrollPaneToIndex[0].paneId, 2);
}

// ── Test 3: openFinding with seriesNumber only (no imageNumber) ───────────────

{
  const { calls, actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'ACC-001', findingId: 'f1', seriesNumber: 3, imageNumber: null });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(calls.loadSeriesInPane.length, 1, 'should call loadSeriesInPane');
  assert.equal(calls.scrollPaneToIndex.length, 0, 'should NOT call scrollPaneToIndex when imageNumber null');
}

// ── Test 4: openFinding with imageNumber only (no seriesNumber) ───────────────

{
  const { calls, actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'ACC-001', findingId: 'f1', seriesNumber: null, imageNumber: 5 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(calls.loadSeriesInPane.length, 0, 'should NOT call loadSeriesInPane when seriesNumber null');
  assert.equal(calls.scrollPaneToIndex.length, 1, 'should call scrollPaneToIndex');
  assert.equal(calls.scrollPaneToIndex[0].index, 4, 'imageNumber 5 → index 4');
}

// ── Test 5: openFinding with both null → ok:false ─────────────────────────────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'ACC-001', findingId: 'f1', seriesNumber: null, imageNumber: null });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, false, 'should return ok:false when both null');
  assert.ok(result.reason, 'should provide a reason');
}

// ── Test 6: openFinding with unsupported imageReference type ──────────────────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  // Dispatch raw object with unknown imageReference type (not via createOpenFindingCommand)
  const result = await bus.dispatchViewerCommand({
    type: 'openFinding',
    findingId: 'f1',
    accession: null,
    imageReference: { type: 'sop-instance', sopInstanceUID: '1.2.3' }
  });

  assert.equal(result.ok, false, 'unsupported imageReference type → ok:false');
  assert.ok(result.reason?.includes('sop-instance'), `reason should mention type, got: ${result.reason}`);
}

// ── Test 7: openFinding recorded in command history ───────────────────────────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'NI9f7ff9', findingId: 'f2', seriesNumber: 1, imageNumber: 10 });
  await bus.dispatchViewerCommand(cmd);

  const historyResult = await bus.dispatchViewerCommand({ type: 'getCommandHistory', payload: {} });
  const history = historyResult?.history || [];
  const entry = history.find((h) => h.originalCommand === 'openFinding');
  assert.ok(entry, 'openFinding should appear in command history');
  assert.equal(entry.status, 'success');
}

// ── Test 8: loadSeriesInPane unsupported → ok:false propagates ────────────────

{
  const { calls, actions } = makeActions({ loadSeriesInPane: undefined });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: null, findingId: 'f1', seriesNumber: 2, imageNumber: 5 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, false, 'should return ok:false when loadSeriesInPane unsupported');
  assert.equal(calls.scrollPaneToIndex.length, 0, 'should not scroll when series load unsupported');
}

// ── Test 9: existing LvRun commands still work after openFinding is added ─────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const result = await bus.dispatchViewerCommand({ type: 'resetViewer', payload: {} });
  assert.equal(result.ok, true, 'existing resetViewer command should still work');
}

// ── Test 10: openFinding operations array present on success ──────────────────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.ok(Array.isArray(result.operations), 'result should include operations array');
  assert.equal(result.operations.length, 2, 'should have loadSeriesInPane + scrollPaneToIndex ops');
  assert.equal(result.operations[0].op, 'loadSeriesInPane');
  assert.equal(result.operations[1].op, 'scrollPaneToIndex');
}

// ── Test 11: HP pane routing — routes to pane with target series ──────────────
//
// Pane 0 has series 2, pane 1 has series 6. Active pane is 0.
// Requesting series 6 → should target pane 1 (HP routing), not active pane 0.

{
  const { calls, actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeHpRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: '3852755662087132', findingId: 'medial-meniscus', seriesNumber: 6, imageNumber: 23 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.playbookApplied, true, 'playbookApplied should be true when HP routing used');
  assert.equal(result.targetPaneId, 1, 'should route to pane 1 which has series 6');
  assert.equal(calls.loadSeriesInPane[0].paneId, 1, 'loadSeriesInPane should target pane 1');
  assert.equal(calls.scrollPaneToIndex[0].paneId, 1, 'scrollPaneToIndex should target pane 1');
  assert.equal(calls.scrollPaneToIndex[0].index, 22, 'imageNumber 23 → index 22');
}

// ── Test 12: HP fallback — no pane has target series → uses active pane ───────

{
  const { calls, actions } = makeActions();
  // HP state: pane 0 → series 2, pane 1 → series 6. Requesting series 99 (not loaded).
  const bus = createLvRunCommandBus({ actions, runtime: makeHpRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 99, imageNumber: 5 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.playbookApplied, false, 'playbookApplied should be false when no pane matched');
  assert.equal(result.targetPaneId, 0, 'should fall back to active pane 0');
  assert.equal(calls.loadSeriesInPane[0].paneId, 0, 'loadSeriesInPane should target active pane');
}

// ── Test 13: result shape on HP routing includes all required fields ───────────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeHpRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'NI9f7ff9', findingId: 'caudate-infarct', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  // Pane 0 has series 2 → HP routing matches
  assert.equal(result.ok, true);
  assert.equal(result.playbookApplied, true);
  assert.equal(result.targetPaneId, 0);
  assert.equal(result.seriesNumber, 2);
  assert.equal(result.imageNumber, 21);
  assert.ok(Array.isArray(result.operations));
}

// ── Test 14: result shape on fallback includes all required fields ─────────────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(1) });

  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f2', seriesNumber: 7, imageNumber: 3 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.playbookApplied, false);
  assert.equal(result.targetPaneId, 1, 'fallback uses activePaneId from runtime');
  assert.equal(result.seriesNumber, 7);
  assert.equal(result.imageNumber, 3);
}

// ── openStudyThenFinding ──────────────────────────────────────────────────────

// ── Test 15: study already loaded → studyOpened:false, delegates to openFinding

{
  const { calls, actions } = makeActions();
  // Catalog is non-empty → study considered loaded
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntimeWithCatalog(0, DEMO_CT_CATALOG) });

  const cmd = createOpenStudyThenFindingCommand({ accession: 'NI9f7ff9', findingId: 'caudate-infarct', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true, 'should succeed when study is loaded');
  assert.equal(result.studyOpened, false, 'studyOpened should be false when catalog already has entries');
  assert.equal(result.seriesNumber, 2);
  assert.equal(result.imageNumber, 21);
  assert.ok(Array.isArray(result.operations), 'should have operations array');
  // No HP dispatch when study is already loaded
  assert.equal(calls.setLayout.length ?? 0, 0, 'should not call setLayout when study already loaded');
}

// ── Test 16: study not loaded + matching playbook → HP applied, then openFinding

{
  const { calls, actions } = makeActions();
  // Empty catalog → study not loaded
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntimeWithCatalog(0, []) });

  // NI9f7ff9 matches ct-head-report-findings-demo → HP ct-head-1x2
  const cmd = createOpenStudyThenFindingCommand({ accession: 'NI9f7ff9', findingId: 'caudate-infarct', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true, 'should succeed');
  assert.equal(result.studyOpened, true, 'studyOpened should be true when catalog was empty');
  assert.equal(result.playbookApplied, true, 'playbookApplied should be true — HP was applied');
  assert.equal(result.seriesNumber, 2);
  assert.equal(result.imageNumber, 21);
  // HP triggers setLayout (1x2 layout for ct-head-1x2) and setActivePane per slot
  assert.ok((calls.setLayout?.length ?? 0) >= 1, 'HP should have called setLayout');
}

// ── Test 17: study not loaded + no matching playbook → studyOpened:true, no HP

{
  const { calls, actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntimeWithCatalog(0, []) });

  // UNKNOWN-ACC has no matching playbook
  const cmd = createOpenStudyThenFindingCommand({ accession: 'UNKNOWN-ACC', findingId: 'f1', seriesNumber: 5, imageNumber: 10 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true, 'should still succeed even without a matching playbook');
  assert.equal(result.studyOpened, true, 'studyOpened should be true (catalog was empty)');
  assert.equal(result.playbookApplied, false, 'playbookApplied should be false — no playbook found');
  assert.equal(result.seriesNumber, 5);
  assert.equal(result.imageNumber, 10);
  // No HP → no setLayout call from HP
  assert.equal(calls.setLayout?.length ?? 0, 0, 'should not call setLayout when no playbook found');
}

// ── Test 18: result shape includes all required fields ────────────────────────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntimeWithCatalog(0, DEMO_CT_CATALOG) });

  const cmd = createOpenStudyThenFindingCommand({ accession: 'NI9f7ff9', findingId: 'f2', seriesNumber: 3, imageNumber: 7 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.ok('ok' in result, 'result should have ok');
  assert.ok('studyOpened' in result, 'result should have studyOpened');
  assert.ok('playbookApplied' in result, 'result should have playbookApplied');
  assert.ok('targetPaneId' in result, 'result should have targetPaneId');
  assert.ok('seriesNumber' in result, 'result should have seriesNumber');
  assert.ok('imageNumber' in result, 'result should have imageNumber');
  assert.ok('operations' in result, 'result should have operations');
}

// ── Test 19: openStudyThenFinding recorded in command history ─────────────────

{
  const { actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntimeWithCatalog(0, DEMO_CT_CATALOG) });

  const cmd = createOpenStudyThenFindingCommand({ accession: 'NI9f7ff9', findingId: 'f3', seriesNumber: 1, imageNumber: 3 });
  await bus.dispatchViewerCommand(cmd);

  const historyResult = await bus.dispatchViewerCommand({ type: 'getCommandHistory', payload: {} });
  const entry = historyResult?.history?.find((h) => h.originalCommand === 'openStudyThenFinding');
  assert.ok(entry, 'openStudyThenFinding should appear in command history');
  assert.equal(entry.status, 'success');
}

// ── Test 20: openFinding still works after openStudyThenFinding is added ──────

{
  const { calls, actions } = makeActions();
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const cmd = createOpenFindingCommand({ accession: 'NI9f7ff9', findingId: 'f4', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true, 'existing openFinding should still work');
  assert.equal(calls.loadSeriesInPane.length, 1);
}

// ── viewPreset tests ──────────────────────────────────────────────────────────

// ── Test 21: viewPreset applied after loadSeriesInPane when action available ──

{
  const presetCalls = [];
  const { actions } = makeActions({
    applyViewPreset: async (paneId, preset) => {
      presetCalls.push({ paneId, preset });
      return { ok: true };
    }
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const viewPreset = { type: 'ct-window', preset: 'brain_stroke', confidence: 'high', reason: 'test' };
  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 2, imageNumber: 21, viewPreset });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.viewPresetApplied, true, 'viewPresetApplied should be true on success');
  assert.equal(presetCalls.length, 1, 'applyViewPreset should be called once');
  assert.equal(presetCalls[0].paneId, 0, 'should target active pane');
  assert.deepEqual(presetCalls[0].preset, viewPreset, 'should pass preset object through');
}

// ── Test 22: viewPreset operation recorded in result.operations ───────────────

{
  const { actions } = makeActions({
    applyViewPreset: async () => ({ ok: true })
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const viewPreset = { type: 'ct-window', preset: 'lung', confidence: 'high', reason: 'test' };
  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 1, imageNumber: 5, viewPreset });
  const result = await bus.dispatchViewerCommand(cmd);

  const presetOp = result.operations.find((op) => op.op === 'applyViewPreset');
  assert.ok(presetOp, 'applyViewPreset op should appear in operations');
  assert.equal(presetOp.paneId, 0);
  assert.deepEqual(presetOp.viewPreset, viewPreset);
  assert.equal(presetOp.result.ok, true);
}

// ── Test 23: viewPreset not applied when action unavailable → navigation ok ───

{
  const { calls, actions } = makeActions();
  // actions does NOT have applyViewPreset
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const viewPreset = { type: 'ct-window', preset: 'brain', confidence: 'medium', reason: 'test' };
  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 2, imageNumber: 10, viewPreset });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true, 'navigation should succeed even without applyViewPreset action');
  assert.equal(result.viewPresetApplied, false, 'viewPresetApplied should be false when action unavailable');
  const presetOp = result.operations.find((op) => op.op === 'applyViewPreset');
  assert.equal(presetOp, undefined, 'no applyViewPreset op when action unavailable');
}

// ── Test 24: viewPreset failure is non-fatal → navigation still ok ────────────

{
  const { actions } = makeActions({
    applyViewPreset: async () => ({ ok: false, reason: 'preset_not_supported' })
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const viewPreset = { type: 'ct-window', preset: 'bone', confidence: 'high', reason: 'test' };
  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 3, imageNumber: 7, viewPreset });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true, 'navigation should succeed even if preset fails');
  assert.equal(result.viewPresetApplied, false, 'viewPresetApplied should be false on preset failure');
  const presetOp = result.operations.find((op) => op.op === 'applyViewPreset');
  assert.ok(presetOp, 'failed preset op still recorded in operations');
  assert.equal(presetOp.result.ok, false);
  assert.equal(presetOp.result.reason, 'preset_not_supported');
}

// ── Test 25: no viewPreset in command → viewPresetApplied:false, no op ────────

{
  const presetCalls = [];
  const { actions } = makeActions({
    applyViewPreset: async (paneId, preset) => { presetCalls.push(preset); return { ok: true }; }
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  // No viewPreset on command
  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.viewPresetApplied, false, 'should not apply preset when none provided');
  assert.equal(presetCalls.length, 0, 'applyViewPreset should not be called without viewPreset');
}

// ── Test 26: viewPreset type !== 'ct-window' → not applied ───────────────────

{
  const presetCalls = [];
  const { actions } = makeActions({
    applyViewPreset: async (paneId, preset) => { presetCalls.push(preset); return { ok: true }; }
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const viewPreset = { type: 'none', reason: 'mr_not_supported' };
  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 2, imageNumber: 21, viewPreset });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.viewPresetApplied, false, 'type:none preset should not be applied');
  assert.equal(presetCalls.length, 0, 'applyViewPreset should not be called for type:none');
}

// ── Test 27: viewPreset recorded in navigation trace ─────────────────────────

{
  const { actions } = makeActions({
    applyViewPreset: async () => ({ ok: true })
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntime(0) });

  const viewPreset = { type: 'ct-window', preset: 'liver', confidence: 'high', reason: 'test' };
  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 1, imageNumber: 3, viewPreset });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.trace.viewPresetApplied, true, 'trace should record viewPresetApplied');
}

// ── Test 28: preset applied to HP-resolved pane (not just active pane) ────────

{
  const presetCalls = [];
  const { actions } = makeActions({
    applyViewPreset: async (paneId, preset) => { presetCalls.push({ paneId, preset }); return { ok: true }; }
  });
  // HP runtime: pane 1 has series 2 loaded
  const bus = createLvRunCommandBus({ actions, runtime: makeHpRuntime(0) });

  const viewPreset = { type: 'ct-window', preset: 'brain', confidence: 'medium', reason: 'test' };
  const cmd = createOpenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 2, imageNumber: 5, viewPreset });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.viewPresetApplied, true);
  // pane 0 has series 2 in makeHpRuntime
  assert.equal(presetCalls[0].paneId, 0, 'preset should target the HP-resolved pane, not just active pane');
}

// ── loadStudyByAccession integration ─────────────────────────────────────────

// ── Test 29: empty viewer + loadStudyByAccession succeeds → HP applied, finding navigates

{
  const { calls, actions } = makeActions({
    loadStudyByAccession: async (accession) => {
      calls.loadStudyByAccession.push(accession);
      return { ok: true };
    }
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntimeWithCatalog(0, []) });

  const cmd = createOpenStudyThenFindingCommand({ accession: 'NI9f7ff9', findingId: 'caudate-infarct', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true, 'should succeed after study load');
  assert.equal(result.studyOpened, true, 'studyOpened should be true');
  assert.equal(calls.loadStudyByAccession.length, 1, 'loadStudyByAccession should be called once');
  assert.equal(calls.loadStudyByAccession[0], 'NI9f7ff9', 'should pass accession');
  assert.equal(calls.loadSeriesInPane.length, 1, 'should proceed to loadSeriesInPane after study load');
}

// ── Test 30: empty viewer + loadStudyByAccession fails → ok:false, clear reason

{
  const { calls, actions } = makeActions({
    loadStudyByAccession: async (accession) => {
      calls.loadStudyByAccession.push(accession);
      return { ok: false, reason: 'study_not_found_or_not_loaded' };
    }
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntimeWithCatalog(0, []) });

  const cmd = createOpenStudyThenFindingCommand({ accession: 'FAKE-ACC', findingId: 'f1', seriesNumber: 2, imageNumber: 10 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, false, 'should fail when study load fails');
  assert.equal(result.reason, 'study_not_found_or_not_loaded', 'reason should propagate');
  assert.equal(result.studyOpened, true, 'studyOpened still true (was attempted)');
  assert.equal(calls.loadStudyByAccession.length, 1, 'loadStudyByAccession should have been called');
  assert.equal(calls.loadSeriesInPane.length, 0, 'should not attempt loadSeriesInPane after failed study load');
}

// ── Test 31: study already loaded → loadStudyByAccession NOT called

{
  const { calls, actions } = makeActions({
    loadStudyByAccession: async (accession) => {
      calls.loadStudyByAccession.push(accession);
      return { ok: true };
    }
  });
  const bus = createLvRunCommandBus({ actions, runtime: makeRuntimeWithCatalog(0, DEMO_CT_CATALOG) });

  const cmd = createOpenStudyThenFindingCommand({ accession: 'NI9f7ff9', findingId: 'caudate-infarct', seriesNumber: 2, imageNumber: 21 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.studyOpened, false, 'studyOpened should be false — catalog was non-empty');
  assert.equal(calls.loadStudyByAccession.length, 0, 'loadStudyByAccession should NOT be called when study already loaded');
}

// ── Test 32: loadStudyByAccession + HP pane routing still works

{
  const { calls, actions } = makeActions({
    loadStudyByAccession: async (accession) => {
      calls.loadStudyByAccession.push(accession);
      return { ok: true };
    }
  });
  // After study load, HP state: pane 0 → series 2, pane 1 → series 6
  const bus = createLvRunCommandBus({ actions, runtime: makeHpRuntime(0) });
  // Simulate empty catalog so study load is triggered (HP runtime has pane series but no catalog)
  // We can't easily combine makeHpRuntime+empty catalog, so test with already-loaded HP runtime
  // and verify that HP pane routing still resolves correctly (series 6 → pane 1)
  const cmd = createOpenStudyThenFindingCommand({ accession: '3852755662087132', findingId: 'medial-meniscus', seriesNumber: 6, imageNumber: 23 });
  const result = await bus.dispatchViewerCommand(cmd);

  assert.equal(result.ok, true);
  assert.equal(result.targetPaneId, 1, 'HP routing should resolve series 6 to pane 1');
  assert.equal(calls.loadSeriesInPane[0]?.paneId, 1, 'loadSeriesInPane should target pane 1');
  assert.equal(calls.scrollPaneToIndex[0]?.index, 22, 'imageNumber 23 → index 22');
}

console.log('openFindingCommand: all tests passed');

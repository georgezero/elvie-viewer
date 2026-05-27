const BUILTIN_PROTOCOLS = [
  {
    id: 'ct-chest-1x2',
    name: 'CT Chest 1x2',
    modality: 'CT',
    layout: '1x2',
    slots: [
      { paneId: 0, series: { descriptionIncludes: 'lung' }, windowPreset: 'lung' },
      { paneId: 1, series: { descriptionIncludes: 'soft' }, windowPreset: 'soft_tissue' }
    ],
    commands: []
  },
  {
    id: 'ct-head-1x1',
    name: 'CT Head 1x1',
    modality: 'CT',
    layout: '1x1',
    slots: [
      { paneId: 0, series: { descriptionIncludes: 'head' }, windowPreset: 'brain' }
    ],
    commands: []
  },
  {
    id: 'ct-head-1x2',
    name: 'CT Head 1x2',
    modality: 'CT',
    layout: '1x2',
    slots: [
      { paneId: 0, series: { descriptionIncludes: 'head' }, windowPreset: 'brain' },
      { paneId: 1, series: { descriptionIncludes: 'head' }, windowPreset: 'brain_hemorrhage' }
    ],
    commands: []
  },
  {
    id: 'mr-knee-2x2',
    name: 'MR Knee 2x2',
    modality: 'MR',
    layout: '2x2',
    // Slot order matches demo study layout: TL=axial, TR=sag-T2, BL=cor-PD(s6), BR=cor-PD-FS(s5).
    // Coronal slots use seriesNumber because the two coronal series share description keywords;
    // descriptionIncludes:'cor' would match the same (first) series for both slots.
    slots: [
      { paneId: 0, series: { descriptionIncludes: 'ax' }, windowPreset: 'default' },
      { paneId: 1, series: { descriptionIncludes: 'sag' }, windowPreset: 'default' },
      { paneId: 2, series: { seriesNumber: 6 }, windowPreset: 'default' },
      { paneId: 3, series: { seriesNumber: 5 }, windowPreset: 'default' }
    ],
    commands: []
  },
  {
    id: 'xr-chest-1x1',
    name: 'XR Chest 1x1',
    modality: 'XR',
    layout: '1x1',
    slots: [
      { paneId: 0, series: { descriptionIncludes: 'chest' }, windowPreset: 'default' }
    ],
    commands: []
  }
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isOk(result) {
  if (!result || typeof result !== 'object') return !!result;
  if (result.ok === false) return false;
  return true;
}

function matchSeries(seriesCatalog = [], selector = {}) {
  const uid = selector.seriesInstanceUID || selector.seriesUid || null;
  if (uid) {
    const found = seriesCatalog.find((s) => String(s.seriesUid || s.seriesInstanceUID || '') === String(uid));
    if (found) return found;
  }

  if (selector.seriesNumber != null) {
    const wanted = Number(selector.seriesNumber);
    const found = seriesCatalog.find((s) => Number(s.seriesNumber) === wanted);
    if (found) return found;
  }

  const text = normalizeText(selector.descriptionIncludes || selector.seriesDescription);
  if (text) {
    const found = seriesCatalog.find((s) => normalizeText(s.description || s.seriesDescription).includes(text));
    if (found) return found;
  }

  return null;
}

export function listHangingProtocols() {
  return BUILTIN_PROTOCOLS.map((p) => ({
    id: p.id,
    name: p.name,
    modality: p.modality,
    layout: p.layout,
    slotCount: Array.isArray(p.slots) ? p.slots.length : 0
  }));
}

export function getHangingProtocol(protocolId) {
  const id = String(protocolId || '').trim();
  if (!id) return null;
  const found = BUILTIN_PROTOCOLS.find((p) => p.id === id);
  if (!found) return null;
  return { id: found.id, name: found.name, modality: found.modality, layout: found.layout, slotCount: Array.isArray(found.slots) ? found.slots.length : 0 };
}

export function getHangingProtocolState({ getViewerStateSnapshot, hangingProtocolState } = {}) {
  const snapshot = typeof getViewerStateSnapshot === 'function' ? getViewerStateSnapshot() : null;
  const hpState = hangingProtocolState || {};
  const paneAssignments = Array.isArray(snapshot?.panes)
    ? snapshot.panes.map((pane) => ({
        paneId: pane.paneId,
        seriesInstanceUID: pane.seriesInstanceUID || pane.seriesUid || null,
        seriesNumber: pane.seriesNumber,
        seriesDescription: pane.seriesDescription || null
      }))
    : [];

  return {
    availableProtocols: listHangingProtocols(),
    activeProtocolId: hpState.activeProtocolId || null,
    lastAppliedAt: hpState.lastAppliedAt || null,
    lastStatus: hpState.lastStatus || null,
    lastResult: hpState.lastResult || null,
    lastErrors: Array.isArray(hpState.lastErrors) ? hpState.lastErrors : [],
    lastWarnings: Array.isArray(hpState.lastWarnings) ? hpState.lastWarnings : [],
    activeLayout: snapshot?.viewer?.layoutId || hpState?.lastResult?.activeLayout || null,
    slotAssignments: paneAssignments,
    viewer: snapshot?.viewer || null
  };
}

export async function applyHangingProtocol({ dispatchViewerCommand, getViewerStateSnapshot }, input = {}) {
  if (typeof dispatchViewerCommand !== 'function') {
    throw new Error('applyHangingProtocol requires dispatchViewerCommand');
  }

  const requestedId = String(input?.protocolId || input?.id || '').trim();
  const protocol = BUILTIN_PROTOCOLS.find((p) => p.id === requestedId);
  if (!protocol) {
    return {
      ok: false,
      protocolId: requestedId || null,
      status: 'failed',
      startedAt: Date.now(),
      completedAt: Date.now(),
      durationMs: 0,
      steps_total: 0,
      steps_completed: 0,
      layoutResult: null,
      slots: [],
      warnings: [],
      errors: [{ reason: `Unknown hanging protocol: ${requestedId || '(empty)'}` }]
    };
  }

  const startedAt = Date.now();
  const slotResults = [];
  const warnings = [];
  const errors = [];
  let stepsTotal = 1; // layout
  let stepsCompleted = 0;

  const layoutResult = await dispatchViewerCommand({ type: 'setLayout', payload: { layoutId: protocol.layout } });
  if (isOk(layoutResult)) stepsCompleted += 1;

  const snapshot = typeof getViewerStateSnapshot === 'function' ? getViewerStateSnapshot() : null;
  const seriesCatalog = Array.isArray(snapshot?.seriesCatalog) ? snapshot.seriesCatalog : [];

  for (const slot of (protocol.slots || [])) {
    const paneId = Number.isFinite(Number(slot.paneId)) ? Math.max(0, Math.trunc(Number(slot.paneId))) : 0;
    const slotResult = {
      paneId,
      activePaneResult: null,
      matchedSeries: null,
      seriesLoadResult: null,
      windowPresetResult: null,
      operationOrder: [],
      warnings: [],
      errors: []
    };

    stepsTotal += 1;
    slotResult.activePaneResult = await dispatchViewerCommand({ type: 'setActivePane', payload: { paneId } });
    slotResult.operationOrder.push('setActivePane');
    if (isOk(slotResult.activePaneResult)) stepsCompleted += 1;
    else slotResult.errors.push({ type: 'setActivePane', result: slotResult.activePaneResult });

    // HP slot invariant:
    // 1) setActivePane
    // 2) loadSeriesInPane
    // 3) setWindowPreset
    // `loadSeriesInPane` may reset VOI/WL, so window preset must be applied after series load.
    if (slot.series && Object.keys(slot.series).length) {
      const match = matchSeries(seriesCatalog, slot.series);
      slotResult.matchedSeries = match
        ? {
            seriesInstanceUID: match.seriesInstanceUID || match.seriesUid || null,
            seriesNumber: match.seriesNumber ?? null,
            seriesDescription: match.seriesDescription || match.description || null
          }
        : null;

      if (match) {
        stepsTotal += 1;
        slotResult.seriesLoadResult = await dispatchViewerCommand({
          type: 'loadSeriesInPane',
          payload: {
            paneId,
            seriesInstanceUID: match.seriesInstanceUID || match.seriesUid || null,
            seriesNumber: match.seriesNumber ?? null,
            seriesDescription: match.seriesDescription || match.description || null
          }
        });
        slotResult.operationOrder.push('loadSeriesInPane');
        if (isOk(slotResult.seriesLoadResult)) stepsCompleted += 1;
        else slotResult.errors.push({ type: 'loadSeriesInPane', result: slotResult.seriesLoadResult });
      } else {
        const warning = { type: 'seriesMatch', unavailable: true, reason: 'No matching series found in current catalog' };
        slotResult.warnings.push(warning);
        warnings.push({ paneId, ...warning });
      }
    }

    if (slot.windowPreset) {
      stepsTotal += 1;
      if (slot.series && Object.keys(slot.series).length && !slotResult.operationOrder.includes('loadSeriesInPane')) {
        const warning = {
          type: 'orderingInvariant',
          reason: 'setWindowPreset attempted without prior loadSeriesInPane despite series selector'
        };
        slotResult.warnings.push(warning);
        warnings.push({ paneId, ...warning });
      }
      slotResult.windowPresetResult = await dispatchViewerCommand({
        type: 'setWindowPreset',
        payload: { paneId, presetId: slot.windowPreset }
      });
      slotResult.operationOrder.push('setWindowPreset');
      if (isOk(slotResult.windowPresetResult)) stepsCompleted += 1;
      else slotResult.errors.push({ type: 'windowPreset', result: slotResult.windowPresetResult });
    }

    slotResults.push(slotResult);
  }

  for (const command of (protocol.commands || [])) {
    stepsTotal += 1;
    const result = await dispatchViewerCommand(command);
    if (isOk(result)) stepsCompleted += 1;
    else errors.push({ type: 'command', command: command?.type || null, result });
  }

  if (!isOk(layoutResult)) errors.push({ type: 'layout', result: layoutResult });
  for (const slot of slotResults) {
    if (slot.errors.length) errors.push({ type: 'slot', paneId: slot.paneId, errors: slot.errors });
  }

  const status = stepsCompleted === stepsTotal ? 'success' : (stepsCompleted > 0 ? 'partial' : 'failed');
  const completedAt = Date.now();
  return {
    ok: status !== 'failed',
    protocolId: protocol.id,
    status,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    steps_total: stepsTotal,
    steps_completed: stepsCompleted,
    layoutResult,
    slots: slotResults,
    activeLayout: protocol.layout,
    warnings,
    errors
  };
}

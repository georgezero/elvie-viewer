import { setLayoutAndWaitForConvergence } from './layoutSettle.mjs';

function asFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createViewerActions(runtime = {}) {
  const api = runtime.api || {};
  const state = runtime.state || {};

  async function setActivePane(paneId) {
    const idx = Math.max(0, Math.trunc(asFiniteNumber(paneId, 0)));
    if (typeof api.setNativeViewerActivePaneFromKeyboard === 'function') {
      api.setNativeViewerActivePaneFromKeyboard(idx);
      return { ok: true, paneId: idx };
    }
    state.nativeViewer = state.nativeViewer || {};
    state.nativeViewer.activePaneIndex = idx;
    return { ok: true, paneId: idx };
  }

  async function setLayout(layoutId) {
    const result = await setLayoutAndWaitForConvergence(runtime, layoutId);
    return {
      ok: true,
      layoutId: result.layoutId,
      layoutConvergence: result
    };
  }

  async function scrollPaneBy(paneId, delta) {
    if (typeof api.nativeViewerScrollPaneBy !== 'function') throw new Error('nativeViewerScrollPaneBy unavailable');
    await api.nativeViewerScrollPaneBy(paneId, delta);
    return { ok: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)), delta: Math.trunc(asFiniteNumber(delta, 0)) };
  }

  async function scrollPaneToIndex(paneId, imageIndex) {
    if (typeof api.scrollToIndex !== 'function') throw new Error('scrollToIndex unavailable');
    const idx = Math.trunc(asFiniteNumber(imageIndex, 0));
    await api.scrollToIndex(paneId, idx, {
      userInitiated: true,
      reason: 'action_scroll_to_index',
      direction: 0,
      cineActive: false
    });
    return { ok: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)), imageIndex: idx };
  }

  async function scrollPaneToImageNumber(paneId, imageNumber) {
    if (typeof api.scrollPaneToImageNumber === 'function') {
      const result = await api.scrollPaneToImageNumber(paneId, imageNumber);
      return { ok: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)), imageNumber: Number(imageNumber), ...result };
    }
    // Fallback: positional index if instance-aware action not available
    if (typeof api.scrollToIndex !== 'function') throw new Error('scrollToIndex unavailable');
    const idx = Math.max(0, Math.trunc(asFiniteNumber(imageNumber, 1)) - 1);
    await api.scrollToIndex(paneId, idx, { userInitiated: false, reason: 'scrollPaneToImageNumber_fallback', direction: 0, cineActive: false });
    return { ok: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)), imageNumber: Number(imageNumber) };
  }

  async function scrollPaneToPatientPoint(paneId, pointMm) {
    if (typeof api.nativeViewerScrollPaneToPatientPoint !== 'function') {
      return { ok: false, unsupported: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)), pointMm };
    }
    await api.nativeViewerScrollPaneToPatientPoint(paneId, pointMm);
    return { ok: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)), pointMm };
  }

  async function syncPanesToPoint(sourcePaneId, pointMm) {
    if (typeof api.nativeViewerSyncPanesToPoint !== 'function') {
      return { ok: false, unsupported: true, sourcePaneId: Math.trunc(asFiniteNumber(sourcePaneId, 0)), pointMm };
    }
    await api.nativeViewerSyncPanesToPoint(sourcePaneId, pointMm);
    return { ok: true, sourcePaneId: Math.trunc(asFiniteNumber(sourcePaneId, 0)), pointMm };
  }

  async function jumpToFinding(findingId) {
    if (typeof api.jumpToFinding !== 'function') throw new Error('jumpToFinding unavailable');
    const idx = Math.trunc(asFiniteNumber(findingId, -1));
    await api.jumpToFinding(idx);
    return { ok: true, findingId: idx };
  }

  async function applyViewPreset(paneId, viewPreset) {
    if (typeof api.applyViewPreset !== 'function') {
      return { ok: false, unsupported: true, reason: 'applyViewPreset unavailable' };
    }
    try {
      const result = await api.applyViewPreset(
        Math.max(0, Math.trunc(asFiniteNumber(paneId, 0))),
        viewPreset
      );
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: !!result };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function loadStudyByAccession(accession) {
    if (typeof api.loadStudyByAccession !== 'function') {
      return { ok: false, unsupported: true, reason: 'loadStudyByAccession unavailable' };
    }
    try {
      const result = await api.loadStudyByAccession(String(accession || '').trim());
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: !!result };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function navigateToFindingFull(finding) {
    if (typeof api.navigateToFindingFull !== 'function') {
      return { ok: false, unsupported: true, reason: 'navigateToFindingFull unavailable' };
    }
    try {
      const result = await api.navigateToFindingFull(finding);
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: !!result };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function loadSeriesInPane(paneId, selector = {}) {
    if (typeof api.loadSeriesInPane !== 'function') {
      return { ok: false, unsupported: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)), selector };
    }
    try {
      const result = await api.loadSeriesInPane(paneId, selector);
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: !!result, paneId: Math.trunc(asFiniteNumber(paneId, 0)), selector };
    } catch (error) {
      return {
        ok: false,
        unavailable: true,
        paneId: Math.trunc(asFiniteNumber(paneId, 0)),
        selector,
        error: String(error?.message || error)
      };
    }
  }

  async function replayFindingPreview(findingId) {
    if (typeof api.replayFindingPreviewByIndex === 'function') {
      await api.replayFindingPreviewByIndex(Math.trunc(asFiniteNumber(findingId, -1)));
      return { ok: true, findingId: Math.trunc(asFiniteNumber(findingId, -1)) };
    }
    if (typeof api.replayCurrentFindingAction === 'function') {
      await api.replayCurrentFindingAction();
      return { ok: true, findingId: Math.trunc(asFiniteNumber(findingId, -1)), fallbackCurrent: true };
    }
    throw new Error('replayFindingPreview unavailable');
  }

  async function setWindowPreset(paneId, presetId) {
    if (typeof paneId === 'number' && typeof api.setNativeViewerActivePaneFromKeyboard === 'function') {
      api.setNativeViewerActivePaneFromKeyboard(Math.max(0, Math.trunc(asFiniteNumber(paneId, 0))));
    }
    if (typeof api.applyWindowPresetLocal !== 'function') throw new Error('applyWindowPresetLocal unavailable');
    try {
      await api.applyWindowPresetLocal(String(presetId || ''), { silent: true, logTag: 'viewer_action_set_window_preset' });
      return { ok: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)), presetId: String(presetId || '') };
    } catch (error) {
      return {
        ok: false,
        unavailable: true,
        paneId: Math.trunc(asFiniteNumber(paneId, 0)),
        presetId: String(presetId || ''),
        error: String(error?.message || error)
      };
    }
  }

  async function resetPaneCamera(paneId) {
    if (typeof paneId === 'number' && typeof api.setNativeViewerActivePaneFromKeyboard === 'function') {
      api.setNativeViewerActivePaneFromKeyboard(Math.max(0, Math.trunc(asFiniteNumber(paneId, 0))));
    }
    if (typeof api.nativeViewerResetActivePaneCameraOnly !== 'function') throw new Error('nativeViewerResetActivePaneCameraOnly unavailable');
    api.nativeViewerResetActivePaneCameraOnly();
    return { ok: true, paneId: Math.trunc(asFiniteNumber(paneId, 0)) };
  }

  async function resetViewer() {
    if (typeof api.resetViewer !== 'function') throw new Error('resetViewer unavailable');
    try {
      await api.resetViewer();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  async function setCrosshairEnabled(enabled) {
    if (typeof api.setCrosshairEnabled !== 'function') throw new Error('setCrosshairEnabled unavailable');
    const result = await api.setCrosshairEnabled(!!enabled);
    return { ok: true, enabled: !!result };
  }

  async function toggleCrosshairEnabled() {
    if (typeof api.toggleCrosshairEnabled !== 'function') throw new Error('toggleCrosshairEnabled unavailable');
    const result = await api.toggleCrosshairEnabled();
    return { ok: true, enabled: !!result };
  }

  async function setLinkedScrollEnabled(enabled) {
    if (typeof api.setLinkedScrollEnabled === 'function') {
      const value = await api.setLinkedScrollEnabled(!!enabled);
      return { ok: true, enabled: !!value };
    }
    state.nativeViewer = state.nativeViewer || {};
    state.nativeViewer.linkedLocationScrollEnabled = !!enabled;
    return { ok: true, enabled: !!state.nativeViewer.linkedLocationScrollEnabled };
  }

  async function setReferenceLinesEnabled(enabled) {
    if (typeof api.setReferenceLinesEnabled === 'function') {
      const value = await api.setReferenceLinesEnabled(!!enabled);
      return { ok: true, enabled: !!value };
    }
    state.nativeViewer = state.nativeViewer || {};
    state.nativeViewer.referenceLinesEnabled = !!enabled;
    return { ok: true, enabled: !!state.nativeViewer.referenceLinesEnabled };
  }

  return {
    setActivePane,
    setLayout,
    scrollPaneBy,
    scrollPaneToIndex,
    scrollPaneToImageNumber,
    scrollPaneToPatientPoint,
    syncPanesToPoint,
    jumpToFinding,
    applyViewPreset,
    loadStudyByAccession,
    navigateToFindingFull,
    loadSeriesInPane,
    replayFindingPreview,
    setWindowPreset,
    resetPaneCamera,
    resetViewer,
    setLinkedScrollEnabled,
    setReferenceLinesEnabled,
    setCrosshairEnabled,
    toggleCrosshairEnabled
  };
}

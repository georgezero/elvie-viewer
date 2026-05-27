function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePane(pane = {}, index = 0) {
  const seriesUid = pane.seriesInstanceUID || pane.seriesUid || pane.series_uid || null;
  return {
    paneId: asNumber(pane.paneId ?? pane.index ?? index, index),
    seriesUid,
    seriesInstanceUID: seriesUid,
    seriesNumber: asNumber(pane.seriesNumber, NaN),
    seriesDescription: pane.seriesDescription || null,
    imageIndex: asNumber(pane.imageIndex ?? pane.image_index, 0),
    imageCount: asNumber(pane.imageCount ?? pane.image_count, 0),
    active: !!pane.active,
    visible: pane.visible !== false,
    viewportId: pane.viewportId || pane.viewport_id || null
  };
}

export function getViewerStateSnapshot(runtime = {}) {
  const state = runtime.state || {};
  const api = runtime.api || {};
  const nativeViewer = state.nativeViewer || {};

  const panesRaw = typeof api.getViewportCatalog === 'function'
    ? (api.getViewportCatalog() || [])
    : (nativeViewer.panes || []);
  const panes = Array.isArray(panesRaw) ? panesRaw.map((pane, idx) => normalizePane(pane, idx)) : [];

  const seriesCatalog = typeof api.getSeriesCatalog === 'function' ? (api.getSeriesCatalog() || []) : [];
  const normalizedSeriesCatalog = Array.isArray(seriesCatalog)
    ? seriesCatalog.map((series = {}, index) => ({
        index,
        seriesUid: series.seriesInstanceUID || series.seriesUid || series.series_uid || null,
        seriesInstanceUID: series.seriesInstanceUID || series.seriesUid || series.series_uid || null,
        seriesNumber: asNumber(series.seriesNumber ?? series.series_number, NaN),
        seriesDescription: series.seriesDescription || series.description || series.series_description || null,
        modality: series.modality || null,
        numInstances: asNumber(series.numInstances ?? series.num_instances, 0)
      }))
    : [];
  const wlPresets = typeof api.getWindowLevelPresets === 'function' ? (api.getWindowLevelPresets() || []) : [];

  return {
    viewer: {
      layoutId: nativeViewer.layoutMode || nativeViewer.layoutId || null,
      activePaneId: asNumber(nativeViewer.activePaneIndex, 0),
      linkedScrollEnabled: !!nativeViewer.linkedLocationScrollEnabled,
      referenceLinesEnabled: !!nativeViewer.referenceLinesEnabled,
      crosshairEnabled: !!nativeViewer.crosshairSyncEnabled
    },
    panes,
    seriesCatalog: normalizedSeriesCatalog,
    windowLevelPresets: wlPresets,
    timestamp: Date.now()
  };
}

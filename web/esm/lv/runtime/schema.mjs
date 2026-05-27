const COMMAND_CATEGORIES = {
  State: ['getViewerState', 'getSeriesCatalog', 'getViewportCatalog', 'getWindowLevelPresets', 'getCommandHistory'],
  Reports: ['parseReport', 'parseReportLocal', 'upsertFindings', 'listReports', 'getReport', 'listFindings', 'getFinding', 'resolveFinding'],
  Layout: ['setLayout', 'loadView'],
  Navigation: ['setActivePane', 'scrollPaneBy', 'scrollPaneToIndex', 'scrollPaneToImageNumber', 'scrollPaneToPatientPoint', 'jumpToFinding', 'replayFindingPreview', 'loadSeriesInPane', 'openFinding', 'openStudyThenFinding'],
  Display: ['setWindowPreset', 'setWindowLevel', 'zoomPane', 'panPane', 'resetPaneCamera', 'resetViewer', 'cinePane'],
  Sync: ['setLinkedScrollEnabled', 'setReferenceLinesEnabled', 'setCrosshairEnabled', 'toggleCrosshairEnabled', 'syncPanesToPoint'],
  Playbooks: ['listPlaybooks', 'getPlaybook', 'getPlaybookHistory', 'executePlaybook'],
  HangingProtocols: ['listHangingProtocols', 'getHangingProtocolState', 'applyHangingProtocol']
};

const LEGACY_ALIASES = {
  // OHIF-era and bridge-era aliases preserved for compatibility.
  setViewport: 'setActivePane',
  setViewportActive: 'setActivePane',
  switchSeries: 'loadSeriesInPane',
  switch_series: 'loadSeriesInPane',
  scroll: 'scrollPaneBy',
  scrollViewport: 'scrollPaneBy',
  scrollToIndex: 'scrollPaneToIndex',
  scrollToImageNumber: 'scrollPaneToImageNumber',
  pointSync: 'syncPanesToPoint',
  setCrosshair: 'setCrosshairEnabled',
  setRefLines: 'setReferenceLinesEnabled',
  setLinkedScroll: 'setLinkedScrollEnabled',
  runPlaybook: 'executePlaybook',
  replayFinding: 'replayFindingPreview',
  listHP: 'listHangingProtocols',
  applyHP: 'applyHangingProtocol'
};

const CANONICAL_COMMAND_SET = new Set(Object.values(COMMAND_CATEGORIES).flat());

export function getLvRunCommandCategories() {
  return COMMAND_CATEGORIES;
}

export function normalizeLvRunCommandType(type) {
  const key = String(type || '').trim();
  if (!key) return '';
  return LEGACY_ALIASES[key] || key;
}

export function isSupportedLvRunCommand(type) {
  return CANONICAL_COMMAND_SET.has(normalizeLvRunCommandType(type));
}

export function createLvRunCommandEnvelope(command = {}, defaults = {}) {
  const normalizedType = normalizeLvRunCommandType(command?.type);
  return {
    id: command?.id || defaults.id || null,
    client_id: command?.client_id || defaults.client_id || null,
    session_id: command?.session_id || defaults.session_id || null,
    type: normalizedType,
    payload: command?.payload || {},
    meta: command?.meta || {}
  };
}

export function listLvRunSupportedCommands() {
  return Array.from(CANONICAL_COMMAND_SET);
}

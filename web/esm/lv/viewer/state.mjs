export function createViewerState(runtime = {}) {
  const getState = () => runtime.state || null;
  const getNativeViewer = () => getState()?.nativeViewer || null;

  return {
    get state() {
      return getState();
    },
    get nativeViewer() {
      return getNativeViewer();
    },
    getActivePaneId() {
      return Number(getNativeViewer()?.activePaneIndex || 0);
    },
    getLayoutId() {
      const state = getState();
      return String(state?.findingLayoutMode || state?.nativeViewer?.layout || '1x1');
    },
    getFindingIndex() {
      return Number(getState()?.currentFindingIndex || 0);
    }
  };
}

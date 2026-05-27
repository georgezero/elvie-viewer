export function normalizeLayoutId(layout) {
  const value = String(layout || '').toLowerCase();
  return /^(1x1|1x2|1x3|2x2)$/.test(value) ? value : '1x1';
}

export function getExpectedPaneCount(layoutId) {
  const normalized = normalizeLayoutId(layoutId);
  if (normalized === '2x2') return 4;
  if (normalized === '1x3') return 3;
  if (normalized === '1x2') return 2;
  return 1;
}

export async function setLayoutAndWaitForConvergence(context = {}, layoutId, options = {}) {
  const api = context.api || {};
  const state = context.state || {};
  if (typeof api.nativeViewerSetLayoutMode !== 'function') {
    throw new Error('nativeViewerSetLayoutMode unavailable');
  }
  const normalizedLayoutId = normalizeLayoutId(layoutId);
  const expectedPaneCount = getExpectedPaneCount(normalizedLayoutId);
  const maxAttempts = Math.max(1, Math.trunc(Number(options.maxAttempts) || 3));
  const pollMs = Math.max(8, Math.trunc(Number(options.pollMs) || 16));
  const timeoutMs = Math.max(50, Math.trunc(Number(options.timeoutMs) || 350));
  const startedAt = Date.now();
  const getPaneCount = () => {
    const panes = state.nativeViewer?.panes;
    return Array.isArray(panes) ? panes.length : 0;
  };
  const waitForPaneCount = async () => {
    const t0 = Date.now();
    while ((Date.now() - t0) < timeoutMs) {
      if (getPaneCount() === expectedPaneCount) return true;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return getPaneCount() === expectedPaneCount;
  };

  let converged = false;
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i += 1) {
    attempts += 1;
    await api.nativeViewerSetLayoutMode(normalizedLayoutId);
    if (await waitForPaneCount()) {
      converged = true;
      break;
    }
  }
  const actualPaneCount = getPaneCount();
  return {
    ok: converged,
    layoutId: normalizedLayoutId,
    expectedPaneCount,
    actualPaneCount,
    attempts,
    converged,
    durationMs: Math.max(0, Date.now() - startedAt)
  };
}

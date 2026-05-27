const DEFAULT_MAX_CONCURRENT = 6;
const DEFAULT_DIRECTION_BIAS_FACTOR = 2;

export const PREFETCH_RADII = Object.freeze({
  '1x1': { active: 60, inactive: 0 },
  '1x2': { active: 42, inactive: 8 },
  '2x2': { active: 25, inactive: 8 }
});

export function getPrefetchOrder(currentIndex, totalCount, radius, direction = 0, opts = {}) {
  const total = Math.max(0, Math.trunc(Number(totalCount) || 0));
  const current = Math.max(0, Math.min(Math.max(0, total - 1), Math.trunc(Number(currentIndex) || 0)));
  const r = Math.max(0, Math.trunc(Number(radius) || 0));
  const bias = Math.max(1, Number(opts.directionBiasFactor ?? DEFAULT_DIRECTION_BIAS_FACTOR) || DEFAULT_DIRECTION_BIAS_FACTOR);
  if (total <= 1 || r < 1) return [];
  const add = (out, seen, offset) => {
    const idx = current + offset;
    if (idx < 0 || idx >= total || idx === current || seen.has(idx)) return;
    seen.add(idx);
    out.push(idx);
  };
  const out = [];
  const seen = new Set();
  const dir = Number(direction) > 0 ? 1 : (Number(direction) < 0 ? -1 : 0);
  if (dir > 0) {
    const trailingRadius = Math.max(1, Math.ceil(r / bias));
    for (let d = 1; d <= r; d++) add(out, seen, d);
    for (let d = 1; d <= trailingRadius; d++) add(out, seen, -d);
    return out;
  }
  if (dir < 0) {
    const trailingRadius = Math.max(1, Math.ceil(r / bias));
    for (let d = 1; d <= r; d++) add(out, seen, -d);
    for (let d = 1; d <= trailingRadius; d++) add(out, seen, d);
    return out;
  }
  for (let d = 1; d <= r; d++) {
    add(out, seen, d);
    add(out, seen, -d);
  }
  return out;
}

export function getLayoutPrefetchRadius(layout, isActivePane, radii = PREFETCH_RADII) {
  const source = radii || PREFETCH_RADII;
  const key = Object.prototype.hasOwnProperty.call(source, layout) ? layout : '1x1';
  return source[key]?.[isActivePane ? 'active' : 'inactive'] ?? 0;
}

export function getNextCineIndex(currentIndex, totalCount, direction = 1, loop = true) {
  const total = Math.max(0, Math.trunc(Number(totalCount) || 0));
  if (total <= 0) return { index: 0, wrapped: false, stop: true };
  const current = Math.max(0, Math.min(total - 1, Math.trunc(Number(currentIndex) || 0)));
  const dir = Number(direction) < 0 ? -1 : 1;
  const next = current + dir;
  if (next >= 0 && next < total) return { index: next, wrapped: false, stop: false };
  if (!loop) return { index: current, wrapped: false, stop: true };
  return { index: dir > 0 ? 0 : total - 1, wrapped: true, stop: false };
}

export function createCineTimerController({
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  const state = { isPlaying: false, timerId: null };
  return {
    start(callback, intervalMs) {
      if (state.timerId != null) return false;
      state.isPlaying = true;
      state.timerId = setIntervalFn(callback, intervalMs);
      return true;
    },
    stop() {
      if (state.timerId == null) {
        state.isPlaying = false;
        return false;
      }
      clearIntervalFn(state.timerId);
      state.timerId = null;
      state.isPlaying = false;
      return true;
    },
    getState() {
      return { ...state };
    }
  };
}

export function createImagePrefetchManager({
  loadAndCacheImage,
  isImageCached = () => false,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  logger = () => {},
  now = () => performance.now()
} = {}) {
  if (typeof loadAndCacheImage !== 'function') {
    throw new Error('createImagePrefetchManager requires loadAndCacheImage');
  }

  const queue = [];
  const queued = new Set();
  const inFlight = new Set();
  const paneTokens = new Map();
  const stats = {
    cancelCount: 0,
    skippedCached: 0,
    skippedInFlight: 0,
    skippedQueued: 0,
    skippedStale: 0,
    loadedCount: 0,
    totalLoadMs: 0,
    firstLoadStartMs: null,
    lastLoadEndMs: null,
    fullStackQueued: 0,
    fullStackLoaded: 0,
    fullStackSkippedCached: 0,
    fullStackSkippedInFlight: 0,
    fullStackSkippedQueued: 0,
    fullStackSkippedStale: 0
  };
  let active = 0;
  let currentMaxConcurrent = Math.max(1, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT);

  const getStats = () => ({
    ...stats,
    queueLength: queue.length,
    inFlightCount: inFlight.size,
    activeCount: active,
    averageLoadMs: stats.loadedCount ? Math.round((stats.totalLoadMs / stats.loadedCount) * 10) / 10 : null,
    throughputImagesPerSec: (stats.loadedCount && stats.firstLoadStartMs != null && stats.lastLoadEndMs != null && stats.lastLoadEndMs > stats.firstLoadStartMs)
      ? Math.round((stats.loadedCount / ((stats.lastLoadEndMs - stats.firstLoadStartMs) / 1000)) * 10) / 10
      : null
  });

  const log = (event, data = {}) => logger(event, { ...data, stats: getStats() });

  function nextPaneToken(paneIndex) {
    const pane = Number(paneIndex);
    const next = (paneTokens.get(pane) || 0) + 1;
    paneTokens.set(pane, next);
    return next;
  }

  function getPaneToken(paneIndex) {
    return paneTokens.get(Number(paneIndex)) || 0;
  }

  function removeQueued(predicate) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!predicate(queue[i])) continue;
      queued.delete(queue[i].imageId);
      queue.splice(i, 1);
    }
  }

  function cancelPrefetchForPane(paneIndex, opts = {}) {
    const includeFullStack = opts.includeFullStack !== false;
    const token = includeFullStack ? nextPaneToken(paneIndex) : getPaneToken(paneIndex);
    removeQueued((task) => Number(task.paneIndex) === Number(paneIndex) && (includeFullStack || task.kind !== 'full_stack'));
    stats.cancelCount += 1;
    log('cancel_pane', { paneIndex: Number(paneIndex), token, queueLength: queue.length, includeFullStack });
    return token;
  }

  function cancelPrefetchForSeries(seriesInstanceUID) {
    const series = String(seriesInstanceUID || '').trim();
    if (!series) return;
    removeQueued((task) => String(task.seriesInstanceUID || '') === series);
    stats.cancelCount += 1;
    log('cancel_series', { seriesInstanceUID: series, queueLength: queue.length });
  }

  function reset() {
    queue.length = 0;
    queued.clear();
    inFlight.clear();
    paneTokens.clear();
    stats.cancelCount = 0;
    stats.skippedCached = 0;
    stats.skippedInFlight = 0;
    stats.skippedQueued = 0;
    stats.skippedStale = 0;
    stats.loadedCount = 0;
    stats.totalLoadMs = 0;
    stats.firstLoadStartMs = null;
    stats.lastLoadEndMs = null;
    stats.fullStackQueued = 0;
    stats.fullStackLoaded = 0;
    stats.fullStackSkippedCached = 0;
    stats.fullStackSkippedInFlight = 0;
    stats.fullStackSkippedQueued = 0;
    stats.fullStackSkippedStale = 0;
    active = 0;
    currentMaxConcurrent = Math.max(1, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT);
  }

  function setMaxConcurrent(nextMaxConcurrent) {
    currentMaxConcurrent = Math.max(1, Number(nextMaxConcurrent) || DEFAULT_MAX_CONCURRENT);
    log('set_max_concurrent', { maxConcurrent: currentMaxConcurrent });
    runNext();
  }

  function runNext() {
    while (active < currentMaxConcurrent && queue.length) {
      const task = queue.shift();
      queued.delete(task.imageId);
      if (task.token !== getPaneToken(task.paneIndex)) {
        stats.skippedStale += 1;
        if (task.kind === 'full_stack') stats.fullStackSkippedStale += 1;
        log('skip_stale', task);
        continue;
      }
      if (inFlight.has(task.imageId)) {
        stats.skippedInFlight += 1;
        if (task.kind === 'full_stack') stats.fullStackSkippedInFlight += 1;
        log('skip_in_flight', task);
        continue;
      }
      if (isImageCached(task.imageId)) {
        stats.skippedCached += 1;
        if (task.kind === 'full_stack') stats.fullStackSkippedCached += 1;
        log('skip_cached', task);
        continue;
      }

      inFlight.add(task.imageId);
      active += 1;
      const startedAt = now();
      if (stats.firstLoadStartMs == null) stats.firstLoadStartMs = startedAt;
      log('load_start', { ...task, queueLength: queue.length, inFlight: active });
      Promise.resolve()
        .then(() => loadAndCacheImage(task.imageId, task.options || {}))
        .then(() => {
          const endedAt = now();
          const durationMs = Math.round((endedAt - startedAt) * 10) / 10;
          stats.loadedCount += 1;
          if (task.kind === 'full_stack') stats.fullStackLoaded += 1;
          stats.totalLoadMs += durationMs;
          stats.lastLoadEndMs = endedAt;
          log('load_done', {
            ...task,
            durationMs,
            queueLength: queue.length
          });
        })
        .catch((error) => {
          log('load_failed', {
            ...task,
            durationMs: Math.round((now() - startedAt) * 10) / 10,
            error: String(error?.message || error)
          });
        })
        .finally(() => {
          inFlight.delete(task.imageId);
          active = Math.max(0, active - 1);
          runNext();
        });
    }
  }

  function enqueueImageIndexes({
    imageIds,
    indexes,
    priority = -5,
    paneIndex = 0,
    seriesInstanceUID = '',
    token = getPaneToken(paneIndex),
    kind = 'prefetch',
    requestType = 'prefetch',
    directionBiasFactor = DEFAULT_DIRECTION_BIAS_FACTOR
  } = {}) {
    const ids = Array.isArray(imageIds) ? imageIds : [];
    const order = Array.isArray(indexes) ? indexes : [];
    if (!ids.length || !order.length) return { queued: 0, token, order: [] };
    let added = 0;
    for (const idx of order) {
      const imageId = ids[idx];
      if (!imageId) continue;
      if (queued.has(imageId)) {
        stats.skippedQueued += 1;
        if (kind === 'full_stack') stats.fullStackSkippedQueued += 1;
        log('skip_queued', { imageId, imageIndex: idx, paneIndex: Number(paneIndex) || 0, seriesInstanceUID, token, kind });
        continue;
      }
      if (inFlight.has(imageId)) {
        stats.skippedInFlight += 1;
        if (kind === 'full_stack') stats.fullStackSkippedInFlight += 1;
        log('skip_in_flight', { imageId, imageIndex: idx, paneIndex: Number(paneIndex) || 0, seriesInstanceUID, token, kind });
        continue;
      }
      if (isImageCached(imageId)) {
        stats.skippedCached += 1;
        if (kind === 'full_stack') stats.fullStackSkippedCached += 1;
        log('skip_cached', { imageId, imageIndex: idx, paneIndex: Number(paneIndex) || 0, seriesInstanceUID, token, kind });
        continue;
      }
      queued.add(imageId);
      queue.push({
        imageId,
        imageIndex: idx,
        paneIndex: Number(paneIndex) || 0,
        seriesInstanceUID: String(seriesInstanceUID || ''),
        token,
        kind,
        options: { priority, requestType }
      });
      queue.sort((a, b) => Number(b.options?.priority || 0) - Number(a.options?.priority || 0));
      added += 1;
    }
    if (added) {
      if (kind === 'full_stack') stats.fullStackQueued += added;
      log('queued', { paneIndex: Number(paneIndex) || 0, seriesInstanceUID, queued: added, queueLength: queue.length, token, directionBiasFactor, kind });
      runNext();
    }
    return { queued: added, token, order };
  }

  function prefetchStackImages({
    imageIds,
    currentIndex = 0,
    radius = 0,
    direction = 0,
    priority = -5,
    paneIndex = 0,
    seriesInstanceUID = '',
    token = getPaneToken(paneIndex),
    maxImages = Infinity,
    directionBiasFactor = DEFAULT_DIRECTION_BIAS_FACTOR
  } = {}) {
    const ids = Array.isArray(imageIds) ? imageIds : [];
    if (!ids.length || radius < 1) return { queued: 0, token, order: [] };
    const order = getPrefetchOrder(currentIndex, ids.length, radius, direction, { directionBiasFactor });
    const limit = Math.max(0, Math.min(order.length, Number(maxImages) || 0));
    return enqueueImageIndexes({
      imageIds: ids,
      indexes: order.slice(0, limit),
      priority,
      paneIndex,
      seriesInstanceUID,
      token,
      kind: 'prefetch',
      requestType: 'prefetch',
      directionBiasFactor
    });
  }

  function preloadFullStackImages({
    imageIds,
    currentIndex = 0,
    priority = -20,
    paneIndex = 0,
    seriesInstanceUID = '',
    token = getPaneToken(paneIndex)
  } = {}) {
    const ids = Array.isArray(imageIds) ? imageIds : [];
    if (!ids.length) return { queued: 0, token, order: [] };
    const current = Math.max(0, Math.min(ids.length - 1, Math.trunc(Number(currentIndex) || 0)));
    const order = [];
    for (let i = current + 1; i < ids.length; i++) order.push(i);
    for (let i = current - 1; i >= 0; i--) order.push(i);
    return enqueueImageIndexes({
      imageIds: ids,
      indexes: order,
      priority,
      paneIndex,
      seriesInstanceUID,
      token,
      kind: 'full_stack',
      requestType: 'prefetch'
    });
  }

  return {
    prefetchStackImages,
    preloadFullStackImages,
    cancelPrefetchForPane,
    cancelPrefetchForSeries,
    nextPaneToken,
    getPaneToken,
    reset,
    getStats,
    setMaxConcurrent,
    getQueueLength: () => queue.length,
    getInFlightCount: () => inFlight.size,
    isInFlight: (imageId) => inFlight.has(imageId)
  };
}

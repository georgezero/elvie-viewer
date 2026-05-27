import assert from 'node:assert/strict';
import {
  createCineTimerController,
  createImagePrefetchManager,
  getLayoutPrefetchRadius,
  getNextCineIndex,
  getPrefetchOrder
} from '../nativeImagePrefetch.mjs';

assert.deepEqual(getPrefetchOrder(5, 12, 3, 0), [6, 4, 7, 3, 8, 2]);
assert.deepEqual(getPrefetchOrder(5, 12, 3, 1), [6, 7, 8, 4, 3]);
assert.deepEqual(getPrefetchOrder(5, 12, 3, -1), [4, 3, 2, 6, 7]);
assert.deepEqual(getPrefetchOrder(5, 12, 4, 1, { directionBiasFactor: 4 }), [6, 7, 8, 9, 4]);
assert.deepEqual(getPrefetchOrder(0, 5, 3, 0), [1, 2, 3]);
assert.deepEqual(getPrefetchOrder(4, 5, 3, 1), [3, 2]);

assert.equal(getLayoutPrefetchRadius('1x1', true), 60);
assert.equal(getLayoutPrefetchRadius('1x1', false), 0);
assert.equal(getLayoutPrefetchRadius('1x2', true), 42);
assert.equal(getLayoutPrefetchRadius('1x2', false), 8);
assert.equal(getLayoutPrefetchRadius('2x2', true), 25);
assert.equal(getLayoutPrefetchRadius('2x2', false), 8);
assert.equal(getLayoutPrefetchRadius('2x2', false, { '2x2': { active: 20, inactive: 6 } }), 6);

assert.deepEqual(getNextCineIndex(0, 4, 1, true), { index: 1, wrapped: false, stop: false });
assert.deepEqual(getNextCineIndex(3, 4, 1, true), { index: 0, wrapped: true, stop: false });
assert.deepEqual(getNextCineIndex(0, 4, -1, true), { index: 3, wrapped: true, stop: false });
assert.deepEqual(getNextCineIndex(3, 4, 1, false), { index: 3, wrapped: false, stop: true });

const timerIds = [];
const clearedTimerIds = [];
const cineTimer = createCineTimerController({
  setIntervalFn: () => {
    const id = `timer-${timerIds.length + 1}`;
    timerIds.push(id);
    return id;
  },
  clearIntervalFn: (id) => clearedTimerIds.push(id)
});
assert.equal(cineTimer.start(() => {}, 66), true, 'cine timer should start once');
assert.equal(cineTimer.start(() => {}, 66), false, 'cine timer should not create duplicates');
assert.deepEqual(timerIds, ['timer-1']);
assert.equal(cineTimer.stop(), true, 'cine stop should clear timer');
assert.deepEqual(clearedTimerIds, ['timer-1']);
assert.equal(cineTimer.getState().timerId, null);
assert.equal(cineTimer.getState().isPlaying, false);

const loaded = [];
const cached = new Set(['img-2']);
let release;
const gate = new Promise((resolve) => { release = resolve; });
const manager = createImagePrefetchManager({
  maxConcurrent: 1,
  isImageCached: (imageId) => cached.has(imageId),
  loadAndCacheImage: async (imageId) => {
    loaded.push(imageId);
    await gate;
    cached.add(imageId);
  }
});

const imageIds = ['img-0', 'img-1', 'img-2', 'img-3', 'img-4'];
const token = manager.nextPaneToken(0);
const first = manager.prefetchStackImages({
  imageIds,
  currentIndex: 1,
  radius: 3,
  direction: 1,
  paneIndex: 0,
  token,
  maxImages: 3
});
assert.equal(first.queued, 2, 'cached image should not queue and maxImages should cap the initial window');
assert.equal(manager.getQueueLength(), 1, 'one request starts immediately, one remains queued');

const duplicate = manager.prefetchStackImages({
  imageIds,
  currentIndex: 1,
  radius: 3,
  direction: 1,
  paneIndex: 0,
  token,
  maxImages: 3
});
assert.equal(duplicate.queued, 0, 'queued/in-flight imageIds should be deduped');
let stats = manager.getStats();
assert.equal(stats.skippedCached, 2, 'cached skips should be counted across repeated requests');
assert.equal(stats.skippedInFlight, 1, 'in-flight skips should be counted');
assert.equal(stats.skippedQueued, 1, 'queued skips should be counted');

manager.cancelPrefetchForPane(0);
assert.equal(manager.getQueueLength(), 0, 'pane cancellation removes queued stale work');
stats = manager.getStats();
assert.equal(stats.cancelCount, 1, 'pane cancellations should be counted');
release();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(loaded, ['img-3']);

const burstLoads = [];
let burstRelease;
const burstGate = new Promise((resolve) => { burstRelease = resolve; });
const burstManager = createImagePrefetchManager({
  maxConcurrent: 1,
  loadAndCacheImage: async (imageId) => {
    burstLoads.push(imageId);
    await burstGate;
  }
});
const burstToken = burstManager.nextPaneToken(0);
burstManager.prefetchStackImages({
  imageIds: ['b0', 'b1', 'b2', 'b3'],
  currentIndex: 0,
  radius: 3,
  paneIndex: 0,
  token: burstToken
});
assert.equal(burstManager.getInFlightCount(), 1);
burstManager.setMaxConcurrent(3);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(burstManager.getInFlightCount(), 3, 'burst max concurrency should start additional queued requests');
burstManager.setMaxConcurrent(1);
burstRelease();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(burstLoads, ['b1', 'b2', 'b3']);
const burstStats = burstManager.getStats();
assert.equal(burstStats.loadedCount, 3);
assert(Number.isFinite(burstStats.averageLoadMs) || burstStats.averageLoadMs === 0);
assert(Number.isFinite(burstStats.throughputImagesPerSec) || burstStats.throughputImagesPerSec === null);

const fullStackLoaded = [];
const fullStackManager = createImagePrefetchManager({
  maxConcurrent: 1,
  isImageCached: (imageId) => imageId === 'fs2',
  loadAndCacheImage: async (imageId) => {
    fullStackLoaded.push(imageId);
  }
});
const fullStackToken = fullStackManager.nextPaneToken(0);
const fullStackResult = fullStackManager.preloadFullStackImages({
  imageIds: ['fs0', 'fs1', 'fs2', 'fs3', 'fs4'],
  currentIndex: 2,
  paneIndex: 0,
  token: fullStackToken
});
assert.equal(fullStackResult.queued, 4, 'full-stack preload should walk forward then backward and skip only when starting work');
fullStackManager.cancelPrefetchForPane(0, { includeFullStack: false });
assert(fullStackManager.getQueueLength() > 0, 'nearby prefetch cancellation should not remove full-stack queued work');
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(fullStackLoaded, ['fs3', 'fs4', 'fs1', 'fs0']);
const fullStackStats = fullStackManager.getStats();
assert.equal(fullStackStats.fullStackQueued, 4);
assert.equal(fullStackStats.fullStackLoaded, 4);
assert.equal(fullStackStats.fullStackSkippedCached, 0);

console.log('nativeImagePrefetch tests passed');

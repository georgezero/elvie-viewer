const TOUCH_SCROLL_THRESHOLD_PX = 18;
const TOUCH_PAN_JITTER_PX = 2;
const TOUCH_PAN_THRESHOLD_PX = 8;
const TOUCH_PINCH_THRESHOLD_PX = 12;
const TOUCH_PINCH_VS_PAN_RATIO = 0.35;
const TOUCH_WL_JITTER_PX = 2;
const DOUBLE_TAP_MAX_DELAY_MS = 250;
const DOUBLE_TAP_MAX_MOVE_PX = 16;

const noop = () => {};
const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : undefined);
const bool = (fn, fallback = false) => (typeof fn === 'function' ? !!fn() : fallback);

function getVoiRange(viewport) {
  const props = typeof viewport?.getProperties === 'function' ? viewport.getProperties() : {};
  const range = props?.voiRange;
  if (range && Number.isFinite(range.lower) && Number.isFinite(range.upper)) return { lower: range.lower, upper: range.upper };
  return { lower: -1000, upper: 1000 };
}

function windowViewport(viewport, startRange, dx, dy, hooks = {}) {
  if (!viewport || typeof viewport.setProperties !== 'function') return false;
  const width0 = Math.max(1, startRange.upper - startRange.lower);
  const center0 = (startRange.upper + startRange.lower) / 2;
  const width = Math.max(1, width0 + dx * 4);
  const center = center0 + dy * 2;
  viewport.setProperties({ voiRange: { lower: center - width / 2, upper: center + width / 2 } });
  viewport.render?.();
  call(hooks.updateReferenceLines);
  call(hooks.onWindowLevelChanged, { viewport, dx, dy });
  return true;
}

function zoomViewport(viewport, factor, hooks = {}) {
  const camera = typeof viewport?.getCamera === 'function' ? viewport.getCamera() : null;
  if (!camera || !Number.isFinite(camera.parallelScale) || typeof viewport.setCamera !== 'function') return false;
  viewport.setCamera({ ...camera, parallelScale: Math.max(0.01, camera.parallelScale / factor) });
  viewport.render?.();
  call(hooks.updateReferenceLines);
  call(hooks.onZoomChanged, { viewport, factor });
  return true;
}

function panViewport(viewport, _startCamera, dx, dy, element, hooks = {}) {
  if (!viewport || typeof viewport.getCamera !== 'function' || typeof viewport.setCamera !== 'function') return false;
  const camera = viewport.getCamera?.();
  if (!camera) return false;
  const next = { ...camera };
  let applied = false;
  if (camera.translation && Number.isFinite(Number(camera.translation.x)) && Number.isFinite(Number(camera.translation.y))) {
    next.translation = {
      ...camera.translation,
      x: Number(camera.translation.x) + Number(dx || 0),
      y: Number(camera.translation.y) + Number(dy || 0)
    };
    applied = true;
  }
  if (!applied && typeof viewport.canvasToWorld === 'function') {
    const w = Math.max(1, element?.clientWidth || element?.getBoundingClientRect?.().width || 1);
    const h = Math.max(1, element?.clientHeight || element?.getBoundingClientRect?.().height || 1);
    const centerCanvas = [w / 2, h / 2];
    const targetCanvas = [centerCanvas[0] - dx, centerCanvas[1] - dy];
    const centerWorld = viewport.canvasToWorld(centerCanvas);
    const targetWorld = viewport.canvasToWorld(targetCanvas);
    if (Array.isArray(centerWorld) && Array.isArray(targetWorld)) {
      const delta = targetWorld.map((v, i) => Number(v) - Number(centerWorld[i] || 0));
      if (delta.every(Number.isFinite)) {
        const add = (arr) => Array.isArray(arr) ? arr.map((v, i) => Number(v) + (delta[i] || 0)) : arr;
        next.position = add(camera.position);
        next.focalPoint = add(camera.focalPoint);
        applied = true;
      }
    }
  }
  if (!applied) {
    const h = Math.max(1, element?.clientHeight || 1);
    const scale = (Number(camera.parallelScale) || 1) / h;
    const shiftX = -dx * scale;
    const shiftY = -dy * scale;
    const add = (arr, x, y) => Array.isArray(arr) ? [arr[0] + x, arr[1] + y, arr[2] || 0] : arr;
    next.position = add(camera.position, shiftX, shiftY);
    next.focalPoint = add(camera.focalPoint, shiftX, shiftY);
  }
  viewport.setCamera(next);
  viewport.render?.();
  call(hooks.logImageCache, 'pan_applied', {
    dx: Number(dx || 0),
    dy: Number(dy || 0),
    used_translation: !!(camera.translation && Number.isFinite(Number(camera.translation.x)) && Number.isFinite(Number(camera.translation.y)))
  });
  call(hooks.logImageCache, 'camera_after_pan', {
    translation: next.translation ? { x: Number(next.translation.x || 0), y: Number(next.translation.y || 0) } : null,
    position: Array.isArray(next.position) ? next.position.map((v) => Number(v)) : null,
    focal_point: Array.isArray(next.focalPoint) ? next.focalPoint.map((v) => Number(v)) : null,
    parallel_scale: Number(next.parallelScale || 0)
  });
  call(hooks.updateReferenceLines);
  call(hooks.onPanChanged, { viewport, dx, dy, camera: next });
  return true;
}

export function attachNativeCornerstoneInteractions(options = {}) {
  const {
    element,
    viewport,
    pane,
    viewportId,
    paneIndex = Number(element?.getAttribute?.('data-pane-index') || 0),
    getInteractionMode,
    enableThreeFingerWindowLevel = true,
    focusViewerContainer = noop,
    stopCine = noop,
    setActivePane = noop,
    markUserInteracted = noop,
    beginTouchInteraction = noop,
    endTouchInteraction = noop,
    toggleViewportLayout = noop,
    scrollPane = noop,
    syncPointFromCanvas = null,
    isPointSyncEnabled = null,
    isPointSyncModifierArmed = null,
    log = noop,
    logImageCache = noop,
    logWheel = noop,
    updateReferenceLines = noop,
    onWindowLevelChanged = noop,
    onZoomChanged = noop,
    onPanChanged = noop
  } = options;

  if (!element || !viewport || element.dataset.nativeCsBound === '1') return false;
  element.dataset.nativeCsBound = '1';
  const hooks = { updateReferenceLines, onWindowLevelChanged, onZoomChanged, onPanChanged, logImageCache };
  element.addEventListener('contextmenu', (e) => e.preventDefault());

  const hasPointSyncModifier = (e) => {
    const direct = !!(e.altKey || e.metaKey || e.ctrlKey || e.shiftKey);
    const gm = (k) => {
      try { return !!e.getModifierState?.(k); } catch { return false; }
    };
    const viaGetModifierState = gm('Alt') || gm('Meta') || gm('Control') || gm('Shift');
    return direct || viaGetModifierState || bool(isPointSyncModifierArmed, false);
  };
  const tryPointSyncFromEvent = (e, source = 'pointerdown') => {
    if (typeof syncPointFromCanvas !== 'function') return;
    const toggleOn = bool(isPointSyncEnabled, false);
    const quickModifier = hasPointSyncModifier(e);
    if (!(toggleOn || quickModifier)) return;
    const rect = element.getBoundingClientRect();
    const x = Number(e.clientX || 0) - Number(rect.left || 0);
    const y = Number(e.clientY || 0) - Number(rect.top || 0);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    void Promise.resolve(syncPointFromCanvas({
      paneIndex,
      point: [x, y],
      reason: toggleOn ? `point_sync_click_${source}` : `point_sync_modifier_${source}`,
      force: !toggleOn,
      source
    })).catch((err) => {
      log('sync_point_error', {
        source_pane_index: paneIndex,
        error: String(err?.message || err)
      });
    });
  };

  element.addEventListener('pointerdown', (e) => {
    tryPointSyncFromEvent(e, 'pointerdown');
  }, { capture: true });
  element.addEventListener('click', (e) => {
    tryPointSyncFromEvent(e, 'click');
  }, { capture: true });

  const touchGesture = {
    active: false,
    mode: null,
    startY: 0,
    scrollRemainder: 0,
    scrollInFlight: false,
    pendingScrollDir: 0,
    startCamera: null,
    startVoiRange: null,
    startCentroid: null,
    lastCentroid: null,
    startDistance: 0,
    lastDistance: 0,
    multiTouchActive: false
  };
  const tapState = {
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
    startX: 0,
    startY: 0,
    moved: false,
    multiTouch: false
  };

  const pointFromTouch = (t) => ({ x: Number(t?.clientX || 0), y: Number(t?.clientY || 0) });
  const centroidForTouches = (list) => {
    if (!list?.length) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < list.length; i++) {
      sx += Number(list[i].clientX || 0);
      sy += Number(list[i].clientY || 0);
    }
    return { x: sx / list.length, y: sy / list.length };
  };
  const distanceBetweenTouches = (a, b) => {
    if (!a || !b) return 0;
    const dx = Number(a.clientX || 0) - Number(b.clientX || 0);
    const dy = Number(a.clientY || 0) - Number(b.clientY || 0);
    return Math.hypot(dx, dy);
  };
  const resetTouchGesture = () => {
    touchGesture.active = false;
    touchGesture.mode = null;
    touchGesture.startY = 0;
    touchGesture.scrollRemainder = 0;
    touchGesture.scrollInFlight = false;
    touchGesture.pendingScrollDir = 0;
    touchGesture.startCamera = null;
    touchGesture.startVoiRange = null;
    touchGesture.startCentroid = null;
    touchGesture.lastCentroid = null;
    touchGesture.startDistance = 0;
    touchGesture.lastDistance = 0;
    touchGesture.multiTouchActive = false;
  };

  element.addEventListener('touchstart', (e) => {
    const touches = e.touches;
    const count = Number(touches?.length || 0);
    if (count < 1 || count > 3) {
      resetTouchGesture();
      return;
    }
    if (count === 3 && enableThreeFingerWindowLevel === false) {
      resetTouchGesture();
      return;
    }
    element.focus();
    setActivePane(paneIndex);
    stopCine();
    markUserInteracted(`touchstart_${count}`);
    beginTouchInteraction(`touchstart_${count}`);
    touchGesture.active = true;
    touchGesture.mode = count === 1 ? 'scroll' : (count === 2 ? 'pan_or_pinch' : 'wl');
    touchGesture.multiTouchActive = count > 1;
    if (count > 1) {
      tapState.multiTouch = true;
      tapState.moved = true;
    } else {
      tapState.startX = Number(touches[0].clientX || 0);
      tapState.startY = Number(touches[0].clientY || 0);
      tapState.moved = false;
    }
    touchGesture.scrollRemainder = 0;
    touchGesture.scrollInFlight = false;
    touchGesture.pendingScrollDir = 0;
    touchGesture.startCamera = typeof viewport.getCamera === 'function' ? viewport.getCamera() : null;
    touchGesture.startVoiRange = getVoiRange(viewport);
    if (count === 1) {
      const p = pointFromTouch(touches[0]);
      touchGesture.startY = p.y;
    } else {
      const c = centroidForTouches(touches);
      touchGesture.startCentroid = c;
      touchGesture.lastCentroid = c;
      if (count === 2) {
        const d = distanceBetweenTouches(touches[0], touches[1]);
        touchGesture.startDistance = d;
        touchGesture.lastDistance = d;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }, { passive: false, capture: true });

  element.addEventListener('touchmove', async (e) => {
    if (!touchGesture.active) return;
    const touches = e.touches;
    const count = Number(touches?.length || 0);
    if (count < 1 || count > 3) {
      resetTouchGesture();
      return;
    }
    if (count === 3 && enableThreeFingerWindowLevel === false) {
      resetTouchGesture();
      return;
    }
    try {
      if (count === 1) {
        const x = Number(touches[0].clientX || 0);
        const y = Number(touches[0].clientY || 0);
        if (!tapState.moved) {
          const moveX = x - Number(tapState.startX || x);
          const moveY = y - Number(tapState.startY || y);
          if (Math.hypot(moveX, moveY) > DOUBLE_TAP_MAX_MOVE_PX) tapState.moved = true;
        }
        const dy = y - touchGesture.startY;
        touchGesture.startY = y;
        const total = (touchGesture.scrollRemainder || 0) + dy;
        const steps = Math.trunc(total / TOUCH_SCROLL_THRESHOLD_PX);
        if (steps) {
          touchGesture.scrollRemainder = total - (steps * TOUCH_SCROLL_THRESHOLD_PX);
          const runTouchScrollStep = async (dir) => {
            touchGesture.scrollInFlight = true;
            try {
              await scrollPane(viewport, pane, viewportId, dir, { userInitiated: true, reason: 'touch_scroll', cineActive: false, linkedSyncSource: true });
            } catch (err) {
              logImageCache('touch_scroll_step_error', { viewport_id: viewportId, direction: dir, error: String(err?.message || err) });
            } finally {
              touchGesture.scrollInFlight = false;
              const pending = Number(touchGesture.pendingScrollDir || 0);
              touchGesture.pendingScrollDir = 0;
              if (pending && touchGesture.active && touchGesture.mode === 'scroll') {
                void runTouchScrollStep(pending > 0 ? 1 : -1);
              }
            }
          };
          const dir = steps > 0 ? 1 : -1;
          if (touchGesture.scrollInFlight) touchGesture.pendingScrollDir = dir;
          else void runTouchScrollStep(dir);
        } else {
          touchGesture.scrollRemainder = total;
        }
      } else if (count === 2) {
        touchGesture.multiTouchActive = true;
        tapState.multiTouch = true;
        tapState.moved = true;
        const centroid = centroidForTouches(touches);
        const dist = distanceBetweenTouches(touches[0], touches[1]);
        const dist0 = Math.max(1, Number(touchGesture.startDistance || dist || 1));
        const distanceDelta = dist - dist0;
        const absDistanceDelta = Math.abs(distanceDelta);
        const totalCentroidDx = centroid.x - Number(touchGesture.startCentroid?.x || centroid.x);
        const totalCentroidDy = centroid.y - Number(touchGesture.startCentroid?.y || centroid.y);
        const centroidMovement = Math.hypot(totalCentroidDx, totalCentroidDy);
        const centroidDx = centroid.x - Number(touchGesture.lastCentroid?.x || centroid.x);
        const centroidDy = centroid.y - Number(touchGesture.lastCentroid?.y || centroid.y);
        const centroidMoveStep = Math.hypot(centroidDx, centroidDy);
        if (touchGesture.mode === 'pan_or_pinch') {
          if (absDistanceDelta > TOUCH_PINCH_THRESHOLD_PX && absDistanceDelta > (centroidMovement * TOUCH_PINCH_VS_PAN_RATIO)) {
            touchGesture.mode = 'pinch';
          } else if (centroidMovement > TOUCH_PAN_THRESHOLD_PX) {
            touchGesture.mode = 'pan';
          }
        }
        if (touchGesture.mode === 'pinch') {
          const prevDist = Math.max(1, Number(touchGesture.lastDistance || dist));
          const factor = dist / prevDist;
          if (Number.isFinite(factor) && Math.abs(factor - 1) > 0.001) zoomViewport(viewport, Math.max(0.01, factor), hooks);
          touchGesture.lastDistance = dist;
          touchGesture.lastCentroid = centroid;
        } else if ((touchGesture.mode === 'pan' || touchGesture.mode === 'pan_or_pinch') && centroidMoveStep >= TOUCH_PAN_JITTER_PX) {
          panViewport(viewport, touchGesture.startCamera, centroidDx, centroidDy, element, hooks);
          touchGesture.lastCentroid = centroid;
        } else {
          touchGesture.lastCentroid = centroid;
          touchGesture.lastDistance = dist;
        }
      } else if (count === 3) {
        touchGesture.multiTouchActive = true;
        tapState.multiTouch = true;
        tapState.moved = true;
        if (enableThreeFingerWindowLevel === false) {
          resetTouchGesture();
          return;
        }
        const centroid = centroidForTouches(touches);
        const dx = centroid.x - Number(touchGesture.startCentroid?.x || centroid.x);
        const dy = centroid.y - Number(touchGesture.startCentroid?.y || centroid.y);
        if (Math.abs(dx) >= TOUCH_WL_JITTER_PX || Math.abs(dy) >= TOUCH_WL_JITTER_PX) {
          windowViewport(viewport, touchGesture.startVoiRange, dx, dy, hooks);
        }
      }
    } catch (err) {
      log('native viewer touch gesture failed', { viewport_id: viewportId, mode: touchGesture.mode, error: String(err?.message || err) });
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }, { passive: false, capture: true });

  const endTouchGesture = (e) => {
    const wasMultiTouch = touchGesture.multiTouchActive || tapState.multiTouch;
    const ended = e?.changedTouches?.[0];
    const now = Date.now();
    if (!wasMultiTouch && ended && !tapState.moved && Number(e?.touches?.length || 0) === 0) {
      const x = Number(ended.clientX || 0);
      const y = Number(ended.clientY || 0);
      const dt = now - Number(tapState.lastTapAt || 0);
      const dist = Math.hypot(x - Number(tapState.lastTapX || x), y - Number(tapState.lastTapY || y));
      if (tapState.lastTapAt > 0 && dt <= DOUBLE_TAP_MAX_DELAY_MS && dist <= DOUBLE_TAP_MAX_MOVE_PX) {
        tapState.lastTapAt = 0;
        tapState.lastTapX = 0;
        tapState.lastTapY = 0;
        void Promise.resolve(toggleViewportLayout(paneIndex)).catch((err) => {
          log('native viewer layout toggle failed', { source: 'double_tap', viewport_id: viewportId, error: String(err?.message || err) });
        });
      } else {
        tapState.lastTapAt = now;
        tapState.lastTapX = x;
        tapState.lastTapY = y;
      }
    } else if (wasMultiTouch) {
      tapState.lastTapAt = 0;
      tapState.lastTapX = 0;
      tapState.lastTapY = 0;
    }
    tapState.multiTouch = false;
    tapState.moved = false;
    endTouchInteraction('touchend');
    if (!touchGesture.active) return;
    resetTouchGesture();
  };
  element.addEventListener('touchend', endTouchGesture, { passive: true, capture: true });
  element.addEventListener('touchcancel', endTouchGesture, { passive: true, capture: true });
  element.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    void Promise.resolve(toggleViewportLayout(paneIndex)).catch((err) => {
      log('native viewer layout toggle failed', { source: 'double_click', viewport_id: viewportId, error: String(err?.message || err) });
    });
  }, { capture: true });

  element.addEventListener('wheel', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    stopCine();
    setActivePane(paneIndex);
    markUserInteracted('wheel');
    try {
      if (e.ctrlKey || e.metaKey) {
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        zoomViewport(viewport, delta > 0 ? 0.92 : 1.08, hooks);
        logWheel('zoom', { viewport_id: viewportId, delta_x: e.deltaX, delta_y: e.deltaY });
        return;
      }
      if (e.altKey || e.shiftKey) {
        panViewport(viewport, viewport.getCamera?.(), e.deltaX, e.deltaY, element, hooks);
        logWheel('pan', { viewport_id: viewportId, delta_x: e.deltaX, delta_y: e.deltaY });
        return;
      }
      const dir = e.deltaY > 0 ? 1 : -1;
      await scrollPane(viewport, pane, viewportId, dir, { linkedSyncSource: true });
    } catch (err) {
      log('native viewer scroll failed', { viewport_id: viewportId, error: String(err?.message || err) });
    }
  }, { passive: false, capture: true });

  let drag = null;
  element.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    focusViewerContainer();
    stopCine();
    setActivePane(paneIndex);
    markUserInteracted('pointerdown');
    const mode = (e.button === 1 || e.button === 2 || e.altKey || e.shiftKey)
      ? 'pan'
      : ((e.ctrlKey || e.metaKey) ? 'wl' : (call(getInteractionMode) || 'wl'));
    drag = {
      mode,
      x: e.clientX,
      y: e.clientY,
      scrollRemainder: 0,
      camera: typeof viewport.getCamera === 'function' ? viewport.getCamera() : null,
      voiRange: getVoiRange(viewport)
    };
    element.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  element.addEventListener('pointermove', async (e) => {
    if (e.pointerType === 'touch') return;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    try {
      if (drag.mode === 'pan') {
        panViewport(viewport, drag.camera, dx, dy, element, hooks);
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.camera = typeof viewport.getCamera === 'function' ? viewport.getCamera() : drag.camera;
      } else if (drag.mode === 'wl') {
        windowViewport(viewport, drag.voiRange, dx, dy, hooks);
      } else if (drag.mode === 'zoom') {
        const steps = Math.trunc(dy / 8);
        if (steps) {
          const stepFactor = 1.055;
          const factor = Math.pow(stepFactor, Math.abs(steps));
          zoomViewport(viewport, steps > 0 ? (1 / factor) : factor, hooks);
          drag.y += steps * 8;
          drag.x = e.clientX;
        }
      } else {
        const total = dy + (drag.scrollRemainder || 0);
        const steps = Math.trunc(-total / 24);
        if (steps) {
          drag.scrollRemainder = total + steps * 24;
          drag.y = e.clientY;
          drag.x = e.clientX;
          await scrollPane(viewport, pane, viewportId, steps, { linkedSyncSource: true });
        }
      }
    } catch (err) {
      log('native viewer drag failed', { viewport_id: viewportId, mode: drag.mode, error: String(err?.message || err) });
    }
    e.preventDefault();
  });
  const endDrag = (e) => {
    if (e.pointerType === 'touch') return;
    if (!drag) return;
    drag = null;
    try { element.releasePointerCapture?.(e.pointerId); } catch {}
  };
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  return true;
}

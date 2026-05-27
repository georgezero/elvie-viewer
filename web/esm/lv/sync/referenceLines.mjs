function resetNativeReflineStyle(line) {
  if (!line) return;
  line.style.display = 'none';
  line.style.left = '';
  line.style.top = '';
  line.style.right = '';
  line.style.width = '';
  line.style.transformOrigin = '';
  line.style.transform = '';
  line.style.height = '';
}

function resetNativeReflineLabel(label) {
  if (!label) return;
  label.style.display = 'none';
  label.style.left = '';
  label.style.top = '';
  label.textContent = '';
}

function formatNativeRefline(line, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 1)) return false;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  line.style.display = 'block';
  line.style.left = `${x1}px`;
  line.style.top = `${y1}px`;
  line.style.right = 'auto';
  line.style.width = `${len}px`;
  line.style.transformOrigin = '0 50%';
  line.style.transform = `rotate(${angleDeg}deg)`;
  line.style.height = '1px';
  return true;
}

function getCurrentPlane(context, entry) {
  const pane = entry?.pane;
  const idx = Math.max(0, Number(pane?.currentIndex || 0));
  const raw = context.getNativePlaneForPaneIndex?.(pane, idx);
  if (!raw) return { ok: false, reason: 'missing_instance_metadata' };
  // Keep parity with legacy inline behavior: current-plane payloads used by
  // reference-line code are expected to carry `ok: true` when metadata exists.
  return { ok: true, ...raw };
}

function getCachedNormalizedPlane(context, entry, geom) {
  const raw = getCurrentPlane(context, entry);
  if (!raw) return { ok: false, reason: 'missing_instance_metadata' };
  const imageId = entry?.pane?.imageIds?.[raw.imageIndex];
  if (!imageId) return geom.normalizeImagePlane(raw);

  const state = context.state;
  state.nativeViewer = state.nativeViewer || {};
  state.nativeViewer.referencePlaneCache = state.nativeViewer.referencePlaneCache || {};

  const cache = state.nativeViewer.referencePlaneCache;
  const cached = cache[imageId];
  if (cached && cached.norm?.ok) return cached.norm;
  const norm = geom.normalizeImagePlane(raw);
  cache[imageId] = { norm };
  return norm;
}

export function initializeReferenceLines(context = {}) {
  const state = context.state || (context.getState ? context.getState() : null);
  if (!state) return;
  state.nativeViewer = state.nativeViewer || {};
  state.nativeViewer.referencePlaneCache = state.nativeViewer.referencePlaneCache || {};
  if (typeof state.nativeViewer.referenceLinesEnabled !== 'boolean') {
    state.nativeViewer.referenceLinesEnabled = false;
  }
}

export function setReferenceLinesEnabled(context = {}, enabled) {
  const state = context.state;
  if (!state) return false;
  state.nativeViewer = state.nativeViewer || {};
  state.nativeViewer.referenceLinesEnabled = !!enabled;
  context.localStorage?.setItem?.('lv_hermes_native_ref_lines', state.nativeViewer.referenceLinesEnabled ? '1' : '0');
  context.syncNativeReferenceLinesButton?.();
  updateReferenceLines(context);

  const csState = state.nativeViewer?.cornerstone;
  const mode = csState?.usingBuiltInReferenceLines ? 'built_in_reference_lines' : 'geometry_fallback';
  context.dbg?.('native viewer reference lines toggle', {
    enabled: state.nativeViewer.referenceLinesEnabled,
    status: mode
  });
  return state.nativeViewer.referenceLinesEnabled;
}

export function updateReferenceLines(context = {}) {
  const state = context.state;
  const csState = state?.nativeViewer?.cornerstone;
  if (!csState?.viewports?.length) return;

  const enabled = !!state.nativeViewer?.referenceLinesEnabled;
  const mode = csState.usingBuiltInReferenceLines ? 'built-in' : 'fallback';
  const reason = mode === 'fallback' ? (csState.builtInReferenceLinesReason || 'unknown') : 'ok';
  const modeKey = `${mode}::${reason}`;

  if (state.nativeViewer?.lastReferenceLinesModeKey !== modeKey) {
    state.nativeViewer.lastReferenceLinesModeKey = modeKey;
    context.dbg?.(`referenceLines mode: ${mode}`, {
      enabled,
      viewport_count: csState.viewports.length,
      reason
    });
  }

  if (enabled && state.nativeViewer?.referenceLinesDebugEnabled) {
    const now = Date.now();
    const last = Number(state.nativeViewer?.lastReferenceLinesModeLogMs || 0);
    if (now - last >= 1200) {
      state.nativeViewer.lastReferenceLinesModeLogMs = now;
      context.dbg?.(`referenceLines mode: ${mode}`, {
        enabled,
        viewport_count: csState.viewports.length,
        periodic: true,
        reason
      });
    }
  }

  if (csState.usingBuiltInReferenceLines) {
    let builtInOk = true;
    csState.viewports.forEach((vp) => {
      const cell = context.document?.getElementById(vp.viewportId)?.closest('.native-cell');
      if (!cell) return;
      resetNativeReflineStyle(cell.querySelector('.native-refline'));
      resetNativeReflineLabel(cell.querySelector('.native-refline-label'));
    });
    try {
      const tg = csState.tools?.ToolGroupManager?.getToolGroup?.(csState.toolGroupId);
      const refToolName = csState.tools?.ReferenceLinesTool?.toolName;
      const crossToolName = csState.tools?.CrosshairsTool?.toolName;
      if (!tg) throw new Error('missing_tool_group');
      if (refToolName) {
        if (enabled) tg.setToolEnabled(refToolName);
        else tg.setToolDisabled(refToolName);
      }
      if (crossToolName) tg.setToolDisabled(crossToolName);
      csState.viewports.forEach((vp) => vp?.viewport?.render?.());
    } catch (e) {
      builtInOk = false;
      csState.usingBuiltInReferenceLines = false;
      context.dbg?.('native viewer built-in reference tools runtime failure; falling back', { error: String(e?.message || e) });
    }
    if (builtInOk) return;
  }

  const hideOverlay = (cell) => {
    if (!cell) return;
    resetNativeReflineStyle(cell.querySelector('.native-refline'));
    resetNativeReflineLabel(cell.querySelector('.native-refline-label'));
  };

  if (!enabled || csState.viewports.length < 2) {
    csState.viewports.forEach((vp) => {
      const cell = context.document?.getElementById(vp.viewportId)?.closest('.native-cell');
      hideOverlay(cell);
    });
    return;
  }

  const sourceEntry = context.getNativeActiveViewportEntry?.();
  if (!sourceEntry?.pane) return;
  const sourcePaneIndex = Number(state.nativeViewer?.activePaneIndex || 0);

  context.loadDicomGeometryUtil?.().then((geom) => {
    const srcNorm = getCachedNormalizedPlane(context, sourceEntry, geom);

    csState.viewports.forEach((vp, idx) => {
      const cell = context.document?.getElementById(vp.viewportId)?.closest('.native-cell');
      if (!cell) return;

      if (idx === sourcePaneIndex) {
        hideOverlay(cell);
        return;
      }

      let line = cell.querySelector('.native-refline');
      let label = cell.querySelector('.native-refline-label');
      if (!line) {
        line = context.document.createElement('div');
        line.className = 'native-refline';
        cell.appendChild(line);
      }
      if (!label) {
        label = context.document.createElement('div');
        label.className = 'native-refline-label';
        cell.appendChild(label);
      }

      const targetPlaneRaw = getCurrentPlane(context, vp);
      const logBase = {
        source_pane_index: sourcePaneIndex,
        target_pane_index: idx,
        source_image_index: Number(sourceEntry?.pane?.currentIndex || 0),
        target_image_index: Number(vp?.pane?.currentIndex || 0),
        source_series: Number(sourceEntry?.pane?.seriesNumber || NaN),
        target_series: Number(vp?.pane?.seriesNumber || NaN)
      };

      if (!srcNorm?.ok) {
        hideOverlay(cell);
        context.dbgNativeReference?.('native viewer reference line skip', { ...logBase, reason: srcNorm?.reason || 'source_invalid' });
        return;
      }
      if (!targetPlaneRaw?.ok) {
        hideOverlay(cell);
        context.dbgNativeReference?.('native viewer reference line skip', { ...logBase, reason: targetPlaneRaw?.reason || 'target_invalid' });
        return;
      }

      const targetNorm = getCachedNormalizedPlane(context, vp, geom);
      const result = geom.computeReferenceLinePixels(srcNorm, targetNorm);
      if (!result.ok) {
        hideOverlay(cell);
        context.dbgNativeReference?.('native viewer reference line skip', {
          ...logBase,
          reason: result.reason || 'geometry_failed',
          normal_dot: Number.isFinite(result.normalDot) ? result.normalDot : null
        });
        return;
      }

      const worldToCanvas = vp?.viewport?.worldToCanvas;
      if (typeof worldToCanvas !== 'function') {
        hideOverlay(cell);
        context.dbgNativeReference?.('native viewer reference line skip', { ...logBase, reason: 'missing_world_to_canvas' });
        return;
      }

      const cA = worldToCanvas(result.patientA);
      const cB = worldToCanvas(result.patientB);
      if (!Array.isArray(cA) || !Array.isArray(cB) || !Number.isFinite(cA[0]) || !Number.isFinite(cA[1]) || !Number.isFinite(cB[0]) || !Number.isFinite(cB[1])) {
        hideOverlay(cell);
        context.dbgNativeReference?.('native viewer reference line skip', { ...logBase, reason: 'invalid_canvas_projection' });
        return;
      }

      const drew = formatNativeRefline(line, cA[0], cA[1], cB[0], cB[1]);
      if (!drew) {
        hideOverlay(cell);
        context.dbgNativeReference?.('native viewer reference line skip', { ...logBase, reason: 'degenerate_canvas_line' });
        return;
      }

      if (state.nativeViewer?.referenceLinesDebugEnabled) {
        label.style.display = 'block';
        label.style.left = `${Math.min(cell.clientWidth - 56, Math.max(4, cA[0] + 4))}px`;
        label.style.top = `${Math.min(cell.clientHeight - 14, Math.max(2, cA[1] - 10))}px`;
        label.textContent = `Im ${Number(vp?.pane?.imageNumber || (Number(vp?.pane?.currentIndex || 0) + 1))}`;
      } else {
        resetNativeReflineLabel(label);
      }

      const normalDot = Math.max(-1, Math.min(1, Number(result.normalDot || 0)));
      const angleDeg = (Math.acos(Math.abs(normalDot)) * 180) / Math.PI;
      context.dbgNativeReference?.('native viewer reference line draw', {
        ...logBase,
        angle_deg: Number.isFinite(angleDeg) ? Number(angleDeg.toFixed(3)) : null,
        pixel_a: result.pixelA,
        pixel_b: result.pixelB,
        canvas_a: cA,
        canvas_b: cB
      });
    });
  }).catch((e) => {
    context.dbg?.('native viewer reference line geometry module failed', { error: String(e?.message || e) });
    csState.viewports.forEach((vp) => {
      const cell = context.document?.getElementById(vp.viewportId)?.closest('.native-cell');
      if (!cell) return;
      resetNativeReflineStyle(cell.querySelector('.native-refline'));
      resetNativeReflineLabel(cell.querySelector('.native-refline-label'));
    });
  });
}

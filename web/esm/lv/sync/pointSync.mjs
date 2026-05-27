function toPaneIndex(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function dot3(a, b, fallbackDot3) {
  if (typeof fallbackDot3 === 'function') return fallbackDot3(a, b);
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function initializePointSync(context = {}) {
  const state = context.state || (context.getState ? context.getState() : null);
  if (!state) return;
  state.nativeViewer = state.nativeViewer || {};
  if (typeof state.nativeViewer.pointSyncEnabled !== 'boolean') {
    state.nativeViewer.pointSyncEnabled = false;
  }
}

export async function syncPanesToPoint(context = {}, sourcePaneId, pointInput, opts = {}) {
  const state = context.state;
  if (!state?.nativeViewer) return false;

  const pointSyncEnabled = !!state.nativeViewer.pointSyncEnabled;
  const force = !!opts.force;
  if (!pointSyncEnabled && !force) return false;

  const csState = state.nativeViewer.cornerstone;
  if (!csState?.viewports?.length || csState.viewports.length < 2) return false;

  const sourcePaneIndex = toPaneIndex(sourcePaneId);
  const sourceEntry = context.getNativeViewportEntryByPaneIndex?.(sourcePaneIndex);
  if (!sourceEntry?.pane?.imageIds?.length || !sourceEntry?.viewport) return false;

  const geom = await context.loadDicomGeometryUtil?.();
  if (!geom?.normalizeImagePlane) return false;

  const sourcePlaneRaw = context.getNativePlaneForPaneIndex?.(sourceEntry.pane, Number(sourceEntry.pane.currentIndex || 0));
  const sourcePlane = geom.normalizeImagePlane(sourcePlaneRaw);
  if (!sourcePlane?.ok || !sourcePlane.frameOfReferenceUID) {
    context.dbg?.('sync_point_start', { source_pane_index: sourcePaneIndex, skipped_reason: sourcePlane?.reason || 'source_invalid' });
    return false;
  }

  let patientPoint = null;
  let sourceCanvas = null;

  if (Array.isArray(pointInput) && pointInput.length >= 3 && pointInput.every((v) => Number.isFinite(Number(v)))) {
    patientPoint = [Number(pointInput[0]), Number(pointInput[1]), Number(pointInput[2])];
  } else {
    sourceCanvas = [
      Number(opts?.sourceCanvasPoint?.[0] ?? pointInput?.[0] ?? 0),
      Number(opts?.sourceCanvasPoint?.[1] ?? pointInput?.[1] ?? 0)
    ];
    if (typeof sourceEntry.viewport.canvasToWorld !== 'function') {
      context.dbg?.('sync_point_start', { source_pane_index: sourcePaneIndex, skipped_reason: 'missing_canvas_to_world' });
      return false;
    }
    const worldPoint = sourceEntry.viewport.canvasToWorld(sourceCanvas);
    if (!Array.isArray(worldPoint) || worldPoint.length < 3 || !worldPoint.every((v) => Number.isFinite(Number(v)))) {
      context.dbg?.('sync_point_start', { source_pane_index: sourcePaneIndex, skipped_reason: 'invalid_world_point' });
      return false;
    }
    patientPoint = [Number(worldPoint[0]), Number(worldPoint[1]), Number(worldPoint[2])];
  }

  const sourcePixel = geom.patientPointToPixel?.(patientPoint, sourcePlane);
  const reason = String(opts?.reason || 'cmd_click');
  context.dbg?.('sync_point_start', { source_pane_index: sourcePaneIndex, source_index: Number(sourceEntry.pane.currentIndex || 0), reason });
  context.dbg?.('source pane/index/pixel/patient point', {
    source_pane_index: sourcePaneIndex,
    source_index: Number(sourceEntry.pane.currentIndex || 0),
    source_pixel: sourcePixel,
    source_patient_point: patientPoint,
    source_canvas_point: sourceCanvas
  });

  let applied = false;
  for (let paneIndex = 0; paneIndex < csState.viewports.length; paneIndex++) {
    if (paneIndex === sourcePaneIndex) continue;
    const entry = context.getNativeViewportEntryByPaneIndex?.(paneIndex);
    const pane = entry?.pane;
    if (!pane?.imageIds?.length) {
      context.dbg?.('skipped reason', { source_pane_index: sourcePaneIndex, target_pane_index: paneIndex, skipped_reason: 'missing_target_pane' });
      continue;
    }

    let best = null;
    let compatibleGeometry = false;
    for (let i = 0; i < pane.imageIds.length; i++) {
      const raw = context.getNativePlaneForPaneIndex?.(pane, i);
      const plane = geom.normalizeImagePlane(raw);
      if (!plane?.ok) continue;
      if (!plane.frameOfReferenceUID || plane.frameOfReferenceUID !== sourcePlane.frameOfReferenceUID) continue;
      compatibleGeometry = true;
      const distance = Math.abs(dot3([
        patientPoint[0] - plane.origin[0],
        patientPoint[1] - plane.origin[1],
        patientPoint[2] - plane.origin[2]
      ], plane.normal, context.dot3));
      if (!best || distance < best.distance) best = { index: i, distance };
    }

    if (!compatibleGeometry) {
      context.dbg?.('skipped reason', { source_pane_index: sourcePaneIndex, target_pane_index: paneIndex, skipped_reason: 'frame_of_reference_mismatch_or_missing_geometry' });
      continue;
    }
    if (!best) {
      context.dbg?.('skipped reason', { source_pane_index: sourcePaneIndex, target_pane_index: paneIndex, skipped_reason: 'closest_slice_not_found' });
      continue;
    }

    context.dbg?.('target pane closest index/distance', {
      source_pane_index: sourcePaneIndex,
      target_pane_index: paneIndex,
      closest_index: best.index,
      distance: Number.isFinite(best.distance) ? Number(best.distance.toFixed(6)) : null
    });

    const changed = await context.scrollToIndex?.(paneIndex, best.index, {
      userInitiated: false,
      reason: 'point_sync',
      direction: Math.sign(best.index - Number(pane.currentIndex || 0)) || 0,
      cineActive: false
    });
    if (changed) {
      applied = true;
      context.flashNativeLinkedSyncedPane?.(paneIndex);
    }
  }

  context.updateNativeReferenceLines?.();
  return applied;
}

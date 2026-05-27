function toPaneIndex(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function dot3(a, b, fallbackDot3) {
  if (typeof fallbackDot3 === 'function') return fallbackDot3(a, b);
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

async function runLinkedScroll(context, sourcePaneIndex, reason = 'scroll') {
  const state = context.state;
  if (!state?.nativeViewer?.linkedLocationScrollEnabled) return false;
  const csState = state.nativeViewer.cornerstone;
  if (!csState?.viewports?.length || csState.viewports.length < 2) return false;
  if (state.nativeViewer.linkedLocationSyncInProgress) {
    state.nativeViewer.linkedLocationSyncQueued = true;
    return false;
  }

  const sourceEntry = context.getNativeViewportEntryByPaneIndex?.(sourcePaneIndex);
  if (!sourceEntry?.pane?.imageIds?.length) return false;

  state.nativeViewer.linkedLocationSyncInProgress = true;
  state.nativeViewer.linkedLocationSyncQueued = false;

  try {
    const geom = await context.loadDicomGeometryUtil?.();
    if (!geom?.normalizeImagePlane || !geom?.pixelToPatientPoint) return false;

    const sourceRaw = context.getNativePlaneForPaneIndex?.(sourceEntry.pane, Number(sourceEntry.pane.currentIndex || 0));
    const sourcePlane = geom.normalizeImagePlane(sourceRaw);
    if (!sourcePlane?.ok || !sourcePlane.frameOfReferenceUID) {
      context.dbg?.('linked_scroll_source', {
        source_pane_index: sourcePaneIndex,
        source_index: Number(sourceEntry.pane.currentIndex || 0),
        reason,
        skipped_reason: sourcePlane?.reason || 'source_missing_frame_of_reference'
      });
      return false;
    }

    const sourcePoint = geom.pixelToPatientPoint([sourcePlane.columns / 2, sourcePlane.rows / 2], sourcePlane);
    if (!Array.isArray(sourcePoint) || sourcePoint.length < 3) {
      context.dbg?.('linked_scroll_source', {
        source_pane_index: sourcePaneIndex,
        source_index: Number(sourceEntry.pane.currentIndex || 0),
        reason,
        skipped_reason: 'source_patient_point_invalid'
      });
      return false;
    }

    context.dbg?.('linked_scroll_source', {
      source_pane_index: sourcePaneIndex,
      source_index: Number(sourceEntry.pane.currentIndex || 0),
      frame_of_reference_uid: sourcePlane.frameOfReferenceUID,
      source_patient_point: sourcePoint,
      reason
    });

    let applied = false;
    for (let paneIndex = 0; paneIndex < csState.viewports.length; paneIndex++) {
      if (paneIndex === sourcePaneIndex) continue;
      const entry = context.getNativeViewportEntryByPaneIndex?.(paneIndex);
      const pane = entry?.pane;
      if (!pane?.imageIds?.length) {
        context.dbg?.('linked_scroll_target', { source_pane_index: sourcePaneIndex, target_pane_index: paneIndex, skipped_reason: 'missing_target_pane' });
        continue;
      }

      let best = null;
      let hasCompatible = false;
      for (let i = 0; i < pane.imageIds.length; i++) {
        const raw = context.getNativePlaneForPaneIndex?.(pane, i);
        const plane = geom.normalizeImagePlane(raw);
        if (!plane?.ok) continue;
        if (!plane.frameOfReferenceUID || plane.frameOfReferenceUID !== sourcePlane.frameOfReferenceUID) continue;
        hasCompatible = true;
        const distance = Math.abs(dot3([
          sourcePoint[0] - plane.origin[0],
          sourcePoint[1] - plane.origin[1],
          sourcePoint[2] - plane.origin[2]
        ], plane.normal, context.dot3));
        if (!best || distance < best.distance) best = { index: i, distance };
      }

      if (!hasCompatible) {
        context.dbg?.('linked_scroll_target', { source_pane_index: sourcePaneIndex, target_pane_index: paneIndex, skipped_reason: 'frame_of_reference_mismatch_or_geometry_missing' });
        continue;
      }
      if (!best) {
        context.dbg?.('linked_scroll_target', { source_pane_index: sourcePaneIndex, target_pane_index: paneIndex, skipped_reason: 'closest_slice_not_found' });
        continue;
      }

      context.dbg?.('linked_scroll_target', {
        source_pane_index: sourcePaneIndex,
        target_pane_index: paneIndex,
        closest_index: best.index,
        distance: Number.isFinite(best.distance) ? Number(best.distance.toFixed(6)) : null
      });

      const changed = await context.scrollToIndex?.(paneIndex, best.index, {
        userInitiated: false,
        reason: 'linked_scroll_sync',
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
  } finally {
    state.nativeViewer.linkedLocationSyncInProgress = false;
    if (state.nativeViewer.linkedLocationSyncQueued) {
      state.nativeViewer.linkedLocationSyncQueued = false;
      context.window?.setTimeout?.(() => {
        void runLinkedScroll(context, sourcePaneIndex, 'queued').catch((err) => {
          context.dbg?.('linked_scroll_error', { source_pane_index: sourcePaneIndex, reason: 'queued', error: String(err?.message || err) });
        });
      }, 0);
    }
  }
}

export function initializeLinkedScroll(context = {}) {
  const state = context.state || (context.getState ? context.getState() : null);
  if (!state) return;
  state.nativeViewer = state.nativeViewer || {};
  if (typeof state.nativeViewer.linkedLocationScrollEnabled !== 'boolean') {
    state.nativeViewer.linkedLocationScrollEnabled = true;
  }
  if (typeof state.nativeViewer.linkedLocationSyncInProgress !== 'boolean') {
    state.nativeViewer.linkedLocationSyncInProgress = false;
  }
  if (typeof state.nativeViewer.linkedLocationSyncQueued !== 'boolean') {
    state.nativeViewer.linkedLocationSyncQueued = false;
  }
}

export async function syncLinkedScrollFromPane(context = {}, sourcePaneId, reason = 'scroll') {
  const state = context.state;
  if (!state?.nativeViewer?.linkedLocationScrollEnabled) return false;
  const sourcePaneIndex = toPaneIndex(sourcePaneId);

  if (state.nativeViewer.linkedLocationSyncInProgress) {
    state.nativeViewer.linkedLocationSyncQueued = true;
    return false;
  }

  context.window?.setTimeout?.(() => {
    void runLinkedScroll(context, sourcePaneIndex, reason).catch((err) => {
      context.dbg?.('linked_scroll_error', { source_pane_index: sourcePaneIndex, reason, error: String(err?.message || err) });
    });
  }, 0);
  return true;
}

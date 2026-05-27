import { syncPanesToPoint as syncPointAcrossPanes } from './pointSync.mjs';

function ensureNativeViewer(state) {
  if (!state.nativeViewer) state.nativeViewer = {};
  return state.nativeViewer;
}

function toPaneIndex(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function pointFromPointerEvent(context, event, paneId) {
  const entry = context.getNativeViewportEntryByPaneIndex?.(toPaneIndex(paneId));
  const element = entry?.viewport?.element || context.document?.getElementById?.(entry?.viewportId);
  if (!element || !event) return null;
  const rect = element.getBoundingClientRect?.();
  if (!rect) return null;
  return [Number(event.clientX || 0) - Number(rect.left || 0), Number(event.clientY || 0) - Number(rect.top || 0)];
}

export function initializeCrosshairSync(context = {}) {
  const state = context.state || (context.getState ? context.getState() : null);
  if (!state) return;
  const nativeViewer = ensureNativeViewer(state);
  if (typeof nativeViewer.crosshairSyncEnabled !== 'boolean') nativeViewer.crosshairSyncEnabled = false;
  nativeViewer.crosshairDrag = nativeViewer.crosshairDrag || {
    active: false,
    pointerId: null,
    sourcePaneId: null
  };
}

export function isCrosshairEnabled(context = {}) {
  const state = context.state || (context.getState ? context.getState() : null);
  return !!state?.nativeViewer?.crosshairSyncEnabled;
}

export function setCrosshairEnabled(context = {}, enabled) {
  const state = context.state;
  if (!state) return false;
  const nativeViewer = ensureNativeViewer(state);
  nativeViewer.crosshairSyncEnabled = !!enabled;
  context.localStorage?.setItem?.('lv_hermes_crosshair_sync', nativeViewer.crosshairSyncEnabled ? '1' : '0');
  if (!nativeViewer.crosshairSyncEnabled && nativeViewer.crosshairDrag) {
    nativeViewer.crosshairDrag.active = false;
    nativeViewer.crosshairDrag.pointerId = null;
    nativeViewer.crosshairDrag.sourcePaneId = null;
  }
  context.syncNativeCrosshairSyncButton?.();
  context.dbg?.('crosshair sync toggled', { enabled: nativeViewer.crosshairSyncEnabled });
  return nativeViewer.crosshairSyncEnabled;
}

export function toggleCrosshairEnabled(context = {}) {
  const enabled = !isCrosshairEnabled(context);
  return setCrosshairEnabled(context, enabled);
}

export function handleCrosshairPointerDown(context = {}, event, paneId) {
  const state = context.state;
  if (!state?.nativeViewer?.crosshairSyncEnabled) return false;
  if (!event || event.pointerType === 'touch') return false;
  if (Number(event.button) !== 0) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;

  const nativeViewer = ensureNativeViewer(state);
  nativeViewer.crosshairDrag = nativeViewer.crosshairDrag || {};
  nativeViewer.crosshairDrag.active = true;
  nativeViewer.crosshairDrag.pointerId = event.pointerId ?? null;
  nativeViewer.crosshairDrag.sourcePaneId = toPaneIndex(paneId);

  const point = pointFromPointerEvent(context, event, paneId);
  if (point) {
    void updateCrosshairPoint(context, toPaneIndex(paneId), point).catch((err) => {
      context.dbg?.('crosshair sync error', { source_pane_index: toPaneIndex(paneId), error: String(err?.message || err) });
    });
  }
  return true;
}

export async function updateCrosshairPoint(context = {}, sourcePaneId, canvasPoint) {
  const state = context.state;
  if (!state?.nativeViewer?.crosshairSyncEnabled) return false;
  const paneIndex = toPaneIndex(sourcePaneId);

  const sourceEntry = context.getNativeViewportEntryByPaneIndex?.(paneIndex);
  if (!sourceEntry?.viewport || !sourceEntry?.pane?.imageIds?.length) return false;
  if (typeof sourceEntry.viewport.canvasToWorld !== 'function') return false;

  const c = [Number(canvasPoint?.[0] || 0), Number(canvasPoint?.[1] || 0)];
  const worldPoint = sourceEntry.viewport.canvasToWorld(c);
  if (!Array.isArray(worldPoint) || worldPoint.length < 3 || !worldPoint.every((v) => Number.isFinite(Number(v)))) return false;

  const patientPoint = [Number(worldPoint[0]), Number(worldPoint[1]), Number(worldPoint[2])];
  return await syncPointAcrossPanes(context, paneIndex, patientPoint, { reason: 'crosshair_drag', force: true });
}

// Viewport evidence collector.
//
// For each navigable positive finding, navigate the viewer to that finding and
// capture the active Cornerstone canvas as a data URL. Non-navigable findings
// get an explicit status record instead of image data.
//
// This module is browser-only (uses document, setTimeout). It is tested via
// Playwright, not node unit tests.
//
// The captured evidence is intended to be passed to buildPresentationManifest
// via the evidenceMap option. Each entry in the map is an array of
// EvidenceResult objects (one per capture attempt per finding).
//
// Transport gap (v1): dataUrl values are local data URIs. The caller is
// responsible for any upload or omission needed before publishing the manifest
// to a cross-origin consumer.

function norm(value) {
  return String(value == null ? '' : value).trim();
}

function asFiniteInt(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function findViewerCanvas(getCanvas) {
  if (typeof getCanvas === 'function') return getCanvas();
  if (typeof document === 'undefined') return null;
  return (
    document.querySelector('#nativeViewerCanvas .native-cs-viewport canvas') ||
    document.querySelector('.native-cs-viewport canvas') ||
    null
  );
}

// Best-effort blank-canvas check. Draws the (WebGL) viewport canvas onto a small
// 2D canvas and inspects the luma spread. A blank/black frame has near-zero
// spread; a rendered CT has a wide spread. Returns null if it cannot be computed.
function isCanvasBlank(canvas) {
  try {
    if (typeof document === 'undefined' || !canvas?.width || !canvas?.height) return null;
    const probe = document.createElement('canvas');
    probe.width = 32; probe.height = 32;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      if (luma < min) min = luma;
      if (luma > max) max = luma;
    }
    return (max - min) < 4; // virtually no contrast → blank
  } catch {
    return null;
  }
}

// Gather diagnostics about the current viewer canvases, for logging when a
// capture is missing/blank or for audit. All fields are best-effort.
function collectCanvasDiagnostics(canvas, readViewportState) {
  const diag = {};
  try {
    if (typeof document !== 'undefined') {
      diag.canvasCount = document.querySelectorAll('canvas').length;
      diag.viewportCanvasCount = document.querySelectorAll('.native-cs-viewport canvas').length;
    }
  } catch { /* ignore */ }
  if (canvas) {
    diag.viewportWidth = canvas.width || null;
    diag.viewportHeight = canvas.height || null;
    diag.blank = isCanvasBlank(canvas);
  } else {
    diag.viewportWidth = null;
    diag.viewportHeight = null;
    diag.blank = null;
  }
  if (typeof readViewportState === 'function') {
    try {
      const vs = readViewportState();
      if (vs) {
        diag.viewportId = vs.viewportId ?? null;
        diag.windowCenter = vs.windowCenter ?? null;
        diag.windowWidth = vs.windowWidth ?? null;
      }
    } catch { /* ignore */ }
  }
  return diag;
}

function isNavigableFinding(finding) {
  const status = norm(finding?.navigationStatus).toLowerCase();
  const severity = norm(finding?.severity).toLowerCase();
  if (status === 'negative' || severity === 'negative') return false;
  if (status === 'non_navigable') return false;
  const seriesNumber = asFiniteInt(finding?.seriesNumber ?? finding?.series_number);
  const imageNumber = asFiniteInt(finding?.imageNumber ?? finding?.image_number);
  return seriesNumber != null && imageNumber != null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Capture viewport canvas evidence for one finding.
 *
 * Capture mirrors the live viewer as closely as possible:
 *   1. navigate to the finding's series/image
 *   2. let elvie-viewer derive and apply the window/level for this finding
 *      (applyViewerWindowing runs the viewer's own classifier — the capture does
 *      not guess or trust a seeded preset hint)
 *   3. read back the actual viewport VOI/camera state for the evidence metadata
 *   4. capture the rendered Cornerstone canvas (no DOM PHI overlays are included —
 *      patient banners are HTML siblings, not part of the WebGL canvas)
 *
 * @param {object} finding
 * @param {object} [options]
 * @param {function} [options.dispatchViewerCommand] - viewer command bus
 * @param {number}   [options.settleMs=600]          - ms to wait after navigation
 * @param {number}   [options.presetSettleMs=450]    - ms to wait after applying W/L
 * @param {function} [options.getCanvas]             - injectable canvas accessor (tests)
 * @param {function} [options.applyViewerWindowing]  - async (finding) => presetName|null;
 *                                                      derives + applies W/L via the viewer's
 *                                                      own classifier; returns the applied preset
 * @param {function} [options.readViewportState]     - () => { windowCenter, windowWidth, ... }
 * @returns {Promise<EvidenceResult>}
 */
export async function captureViewportEvidence(finding, {
  dispatchViewerCommand,
  settleMs = 600,
  presetSettleMs = 450,
  getCanvas,
  applyViewerWindowing,
  readViewportState
} = {}) {
  const findingId = norm(finding?.id);
  const seriesNumber = asFiniteInt(finding?.seriesNumber ?? finding?.series_number);
  const imageNumber = asFiniteInt(finding?.imageNumber ?? finding?.image_number);
  const accession = norm(finding?.accession);
  // The seeded preset is only a hint recorded for reference; the viewer's own
  // classifier (applyViewerWindowing) is the source of truth for what is applied.
  const windowPresetHint = norm(finding?.windowPreset ?? finding?.window_preset) || null;

  const base = {
    type: 'viewport-capture',
    captureSource: 'viewport-canvas',
    findingId: findingId || null,
    accession: accession || null,
    seriesNumber,
    imageNumber,
    windowPresetHint
  };

  if (!isNavigableFinding(finding)) {
    return { ...base, status: 'skipped_non_navigable' };
  }

  // Navigate the viewer to this finding.
  const dispatch = dispatchViewerCommand ??
    (typeof window !== 'undefined' ? window.dispatchViewerCommand : null);
  if (typeof dispatch === 'function') {
    try {
      await dispatch({
        type: 'openStudyThenFinding',
        accession: accession || undefined,
        findingId: findingId || undefined,
        imageReference: seriesNumber != null && imageNumber != null
          ? { type: 'series-image', seriesNumber, imageNumber }
          : undefined
      });
    } catch { /* navigation is best-effort; capture whatever is in the canvas */ }
  }

  // Wait for the viewport to settle after navigation.
  if (settleMs > 0) await sleep(settleMs);

  // Let elvie-viewer derive + apply the window/level for this finding (its own
  // classifier — not the seeded hint). appliedPreset is what the viewer chose.
  let appliedPreset = null;
  if (typeof applyViewerWindowing === 'function') {
    try {
      const chosen = await applyViewerWindowing(finding);
      if (typeof chosen === 'string' && chosen) appliedPreset = chosen;
      if (presetSettleMs > 0) await sleep(presetSettleMs);
    } catch { /* windowing is best-effort; capture whatever is rendered */ }
  }

  // Read back the live viewport state (VOI/camera) for audit metadata.
  let viewportState = null;
  if (typeof readViewportState === 'function') {
    try { viewportState = readViewportState() || null; } catch { viewportState = null; }
  }

  const canvas = findViewerCanvas(getCanvas);
  if (!canvas) {
    return { ...base, appliedPreset, viewportState,
      status: 'no_viewer', diagnostics: collectCanvasDiagnostics(null, readViewportState) };
  }
  if (!canvas.width || !canvas.height) {
    return { ...base, appliedPreset, viewportState,
      status: 'canvas_empty', diagnostics: collectCanvasDiagnostics(canvas, readViewportState) };
  }

  try {
    const dataUrl = canvas.toDataURL('image/png');
    const diagnostics = collectCanvasDiagnostics(canvas, readViewportState);
    const result = { ...base, appliedPreset, viewportState, status: 'captured', dataUrl };
    // Surface a blank-canvas warning without discarding the capture.
    if (diagnostics.blank === true) result.warning = 'canvas_appears_blank';
    result.diagnostics = diagnostics;
    return result;
  } catch (e) {
    return { ...base, appliedPreset, viewportState,
      status: 'capture_failed', reason: norm(e?.message || String(e)),
      diagnostics: collectCanvasDiagnostics(canvas, readViewportState) };
  }
}

/**
 * Collect evidence for all positive findings and return a Map keyed by finding ID.
 *
 * Only navigable findings are navigated. Non-navigable findings get an explicit
 * status record.  The returned Map can be passed directly to buildPresentationManifest
 * as options.evidenceMap.
 *
 * @param {object[]} positiveFindings
 * @param {object} [options]
 * @param {function} [options.dispatchViewerCommand]
 * @param {number}   [options.settleMs=600]
 * @param {function} [options.getCanvas]
 * @returns {Promise<Map<string, EvidenceResult[]>>}
 */
export async function collectPresentationEvidence(positiveFindings, options = {}) {
  const evidenceMap = new Map();
  const findings = Array.isArray(positiveFindings) ? positiveFindings : [];
  for (const finding of findings) {
    const result = await captureViewportEvidence(finding, options);
    const id = norm(finding?.id);
    if (id) {
      evidenceMap.set(id, [result]);
    }
  }
  return evidenceMap;
}

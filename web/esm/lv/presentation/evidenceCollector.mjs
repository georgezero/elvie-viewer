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

function isNavigableFinding(finding) {
  const status = norm(finding?.navigationStatus).toLowerCase();
  const severity = norm(finding?.severity).toLowerCase();
  if (status === 'negative' || severity === 'negative') return false;
  if (status === 'non_navigable') return false;
  const seriesNumber = asFiniteInt(finding?.seriesNumber ?? finding?.series_number);
  const imageNumber = asFiniteInt(finding?.imageNumber ?? finding?.image_number);
  return seriesNumber != null && imageNumber != null;
}

/**
 * Capture viewport canvas evidence for one finding.
 *
 * @param {object} finding
 * @param {object} [options]
 * @param {function} [options.dispatchViewerCommand] - viewer command bus
 * @param {number}   [options.settleMs=600]          - ms to wait for render
 * @param {function} [options.getCanvas]             - injectable canvas accessor (tests)
 * @returns {Promise<EvidenceResult>}
 */
export async function captureViewportEvidence(finding, {
  dispatchViewerCommand,
  settleMs = 600,
  getCanvas
} = {}) {
  const findingId = norm(finding?.id);
  const seriesNumber = asFiniteInt(finding?.seriesNumber ?? finding?.series_number);
  const imageNumber = asFiniteInt(finding?.imageNumber ?? finding?.image_number);
  const accession = norm(finding?.accession);

  const base = {
    type: 'viewport-capture',
    findingId: findingId || null,
    accession: accession || null,
    seriesNumber,
    imageNumber
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

  // Wait for the viewport to settle.
  if (settleMs > 0) {
    await new Promise(r => setTimeout(r, settleMs));
  }

  const canvas = findViewerCanvas(getCanvas);
  if (!canvas) {
    return { ...base, status: 'no_viewer' };
  }
  if (!canvas.width || !canvas.height) {
    return { ...base, status: 'canvas_empty' };
  }

  try {
    const dataUrl = canvas.toDataURL('image/png');
    return { ...base, status: 'captured', dataUrl };
  } catch (e) {
    return { ...base, status: 'capture_failed', reason: norm(e?.message || String(e)) };
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

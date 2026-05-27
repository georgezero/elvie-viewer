// Report viewer registry — tracks the currently active report in the viewer.
// Separate from web/esm/lv/findings/reportRegistry.mjs (finding data store).

import { ingestDemoReport, ingestPastedReport, ingestApiReport, parseAndIngestReport } from './reportIngestion.mjs';

let _current = null;

export function loadDemoReport(accession) {
  const result = ingestDemoReport(accession);
  if (result.ok) _current = result;
  return result;
}

export function ingestReport({ accession, text, sourceType = 'api' } = {}) {
  const result = ingestApiReport({ accession, text, sourceType });
  if (result.ok) _current = result;
  return result;
}

// Sync paste (no parsing) — kept for backward compat.
export function pasteReport({ accession, text } = {}) {
  const result = ingestPastedReport({ accession, text });
  if (result.ok) _current = result;
  return result;
}

// Async paste with LLM parse pipeline. Falls back to mock gracefully.
// opts.onProgress(event) is forwarded to parseAndIngestReport for stage tracking.
export async function parseAndIngestPastedReport(opts = {}) {
  const result = await parseAndIngestReport(opts);
  if (result.ok) _current = result;
  return result;
}

export function getCurrentReport() {
  return _current ? { ..._current } : null;
}

export function clearCurrentReport() {
  _current = null;
}

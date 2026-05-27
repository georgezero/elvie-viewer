function summarizeResult(result) {
  if (result == null) return null;
  if (typeof result !== 'object') return result;
  const summary = {};
  if ('ok' in result) summary.ok = !!result.ok;
  if ('status' in result) summary.status = result.status;
  if ('unavailable' in result) summary.unavailable = !!result.unavailable;
  if ('unsupported' in result) summary.unsupported = !!result.unsupported;
  if ('protocolId' in result) summary.protocolId = result.protocolId;
  if ('steps_total' in result) summary.steps_total = result.steps_total;
  if ('steps_completed' in result) summary.steps_completed = result.steps_completed;
  if (Array.isArray(result.errors)) summary.errorCount = result.errors.length;
  if (Array.isArray(result.warnings)) summary.warningCount = result.warnings.length;
  return summary;
}

export function createCommandHistory(maxEntries = 200) {
  let seq = 0;
  let entries = [];

  function push(entry = {}) {
    seq += 1;
    const normalized = {
      id: entry.id || `cmd_${seq}`,
      timestamp: Number(entry.timestamp || Date.now()),
      canonicalCommand: String(entry.canonicalCommand || ''),
      originalCommand: String(entry.originalCommand || ''),
      payload: entry.payload || {},
      status: entry.status || 'success',
      durationMs: Math.max(0, Number(entry.durationMs || 0)),
      unavailable: !!entry.unavailable,
      error: entry.error ? String(entry.error) : null,
      resultSummary: entry.resultSummary ?? summarizeResult(entry.result)
    };
    entries.push(normalized);
    if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
    return normalized;
  }

  function list() {
    return entries.slice();
  }

  return {
    push,
    list
  };
}

export { summarizeResult };

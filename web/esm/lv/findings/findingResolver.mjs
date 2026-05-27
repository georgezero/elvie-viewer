import { getBestFinding } from './reportRegistry.mjs';

export function resolveFinding(selector = {}) {
  const result = getBestFinding(selector);
  if (!result?.ok) return result;
  return {
    ok: true,
    finding: result.finding,
    alternatives: Array.isArray(result.alternatives) ? result.alternatives : [],
    resolvedBy: result.reason || 'best_match',
    reason: result.reason || 'best_match'
  };
}

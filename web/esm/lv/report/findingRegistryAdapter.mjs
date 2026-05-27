// FindingRegistryProvider interface and default adapter.
// Abstracts the finding store dependency so report ingestion functions
// do not directly import from findings/reportRegistry.mjs.
// Swap the default adapter to substitute any alternative store.

import { listFindings, listNegativeFindings } from '../findings/reportRegistry.mjs';

/**
 * Minimal interface for a finding registry provider.
 * Implement this to substitute the default store in any ingestion function.
 *
 * @typedef {Object} FindingRegistryProvider
 * @property {(accession: string) => object[]} listFindings   - Positive findings for accession
 * @property {(accession: string) => object[]} listNegativeFindings - Negative findings for accession
 */

/** Default adapter: delegates to the built-in findings/reportRegistry store. */
export const defaultFindingRegistryAdapter = Object.freeze({
  listFindings,
  listNegativeFindings
});

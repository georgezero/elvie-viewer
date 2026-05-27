// API-ready ingestion boundary.
//
// Single structured entrypoint for loading a report programmatically.
// The agentr paste flow and any future HTTP POST handler both call ingestReportApi.
//
// Future server implementation:
//   POST /api/ingest { text, accession, metadata, parserOptions, ... }
//   → deserialize body → ingestReportApi(body) → serialize return value
//
// No backend is implemented here. This module is client-side only.

import { parseAndIngestPastedReport } from './reportRegistry.mjs';
import { defaultFindingRegistryAdapter } from './findingRegistryAdapter.mjs';

export const API_SCHEMA_VERSION = 'lv-findings-v1';
export const API_REPORT_VIEWER_VERSION = 'v0';

/**
 * Optional metadata attached to an ingested report.
 * Fields are informational only — not used by the grounding or parse pipeline.
 * Handle patient field as PHI.
 *
 * @typedef {Object} ReportApiMetadata
 * @property {string|null} [patient]   - Patient identifier (PHI)
 * @property {string|null} [study]     - Study description
 * @property {string|null} [modality]  - Modality (CT, MR, CR, ...)
 * @property {string|null} [source]    - Source system identifier
 */

/**
 * LLM parser options passed to the ingestion pipeline.
 *
 * @typedef {Object} ReportApiParserOptions
 * @property {'local'|'mock'} [provider]  - LLM provider key (default: 'local')
 * @property {string|null} [endpoint]     - LLM endpoint URL or preset label
 * @property {string|null} [model]        - Model name
 * @property {number|null} [maxTokens]    - Max tokens for LLM response
 * @property {number|null} [timeoutMs]    - Request timeout ms (0 = no timeout)
 */

/**
 * Input payload for ingestReportApi.
 * All fields except `text` are optional.
 *
 * Future POST body shape (HTTP):
 *   POST /api/ingest
 *   Content-Type: application/json
 *   {
 *     "text": "...",
 *     "accession": "ACC-001",
 *     "metadata": { "modality": "CT", "study": "Head WO" },
 *     "imageAvailability": "available",
 *     "studyInstanceUID": "1.2.840.10008.5.1.4.1.1.4",
 *     "parserOptions": { "provider": "local", "endpoint": "...", "model": "...", "maxTokens": 4096 }
 *   }
 *
 * @typedef {Object} ReportApiPayload
 * @property {string} text                                   - Verbatim report text (required)
 * @property {string|null} [accession]                       - Accession number
 * @property {ReportApiMetadata|null} [metadata]             - Informational metadata
 * @property {string|null} [imageAvailability]               - unknown | not_available | querying | retrieving | available | loaded | failed
 * @property {string|null} [studyInstanceUID]                - DICOM Study Instance UID
 * @property {ReportApiParserOptions|null} [parserOptions]   - LLM parser options
 * @property {import('./findingRegistryAdapter.mjs').FindingRegistryProvider|null} [findingRegistry] - Adapter injection point
 * @property {function|null} [onProgress]                    - ({ stage, ...extra }) => void
 */

/**
 * Primary API ingestion entrypoint.
 *
 * Normalizes a ReportApiPayload and runs the full parse + grounding pipeline.
 * Returns the standard ingestion result extended with bundle metadata fields.
 *
 * The return value is compatible with both:
 *   - renderCurrentReport(result) — reads ok, document, findings, spans, parseStatus, etc.
 *   - exportReviewBundle()        — reads schemaVersion, reportViewerVersion, findings, spans, etc.
 *
 * @param {ReportApiPayload} payload
 * @returns {Promise<object>}
 */
export async function ingestReportApi({
  text,
  accession = null,
  metadata = null,
  imageAvailability = null,
  studyInstanceUID = null,
  parserOptions = null,
  findingRegistry = null,   // injected adapter; currently flows to demo/sync paths via future routing
  onProgress = null
} = {}) {
  const opts = parserOptions || {};

  // parseAndIngestPastedReport updates the report/reportRegistry.mjs singleton
  // (required so getCurrentReport() stays consistent with the paste flow).
  const raw = await parseAndIngestPastedReport({
    accession: accession || undefined,
    text: String(text || ''),
    provider: opts.provider,
    endpoint: opts.endpoint,
    model: opts.model,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    findingRegistry: findingRegistry || defaultFindingRegistryAdapter,
    onProgress: typeof onProgress === 'function' ? onProgress : undefined
  });

  return {
    ...raw,
    schemaVersion: API_SCHEMA_VERSION,
    reportViewerVersion: API_REPORT_VIEWER_VERSION,
    ingestedAt: new Date().toISOString(),
    metadata: metadata || null,
    studyInstanceUID: studyInstanceUID || null
  };
}

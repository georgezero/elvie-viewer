// Presentation manifest builder.
//
// Deterministic, side-effect-free transform from already-parsed report/finding
// state into a versioned PresentationManifest. The manifest links report
// findings to image anchors and viewer navigation metadata so an external
// presentation consumer can map findings back to the viewer.
//
// This module is intentionally generic — it knows nothing about Hyperframes or
// any specific launch target. The external launch adapter lives separately in
// hyperframesLauncher.mjs.
//
// Privacy defaults:
//   - Full raw report text is NOT included in the default payload.
//   - Per-finding raw text, provenance, and report text are only included in an
//     optional `trace` block, and only when BOTH debug is enabled AND
//     includeTrace is requested.

import { normalizeFindingImageReference } from '../report/imageLinkProvider.mjs';

export const PRESENTATION_MANIFEST_VERSION = 'presentation-manifest-v1';
export const DEFAULT_MANIFEST_SOURCE = 'elvie-viewer';

function norm(value) {
  return String(value == null ? '' : value).trim();
}

function asFiniteInt(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Tolerant accessor for camelCase (normalized model) and snake_case (parser)
// finding shapes.
function pick(finding, camel, snake) {
  const c = finding?.[camel];
  if (c != null && c !== '') return c;
  const s = finding?.[snake];
  return s != null && s !== '' ? s : null;
}

// Concise, presentation-safe finding text. Prefers the curated description /
// impression over raw report text so the default payload never leaks the raw
// report. rawText is reserved for the trace block.
function conciseFindingText(finding) {
  return (
    norm(pick(finding, 'description', 'description')) ||
    norm(pick(finding, 'impressionText', 'impression_text')) ||
    norm(finding?.label) ||
    ''
  );
}

// Resolve series/image coordinates from either the structured imageReference,
// the normalized camelCase fields, or the raw snake_case parser fields.
function resolveCoords(finding) {
  const ref = normalizeFindingImageReference(finding);
  const seriesNumber = asFiniteInt(ref.seriesNumber ?? pick(finding, 'seriesNumber', 'series_number'));
  const imageNumber = asFiniteInt(ref.imageNumber ?? pick(finding, 'imageNumber', 'image_number'));
  return { seriesNumber, imageNumber };
}

// Mirrors report/findingNavigationSession.mjs#isNavigable without importing the
// session machinery: a finding is navigable when it is not negative/blocked and
// has both series and image coordinates.
function deriveNavigability(finding, coords) {
  const status = norm(pick(finding, 'navigationStatus', 'navigation_status')).toLowerCase();
  const severity = norm(finding?.severity).toLowerCase();
  if (status === 'negative' || severity === 'negative') {
    return { navigable: false, navigationStatus: status || 'negative', reason: 'negative_finding' };
  }
  if (status === 'non_navigable') {
    return { navigable: false, navigationStatus: 'non_navigable', reason: 'no_image_anchor' };
  }
  const hasCoords = coords.seriesNumber != null && coords.imageNumber != null;
  if (!hasCoords) {
    return {
      navigable: false,
      navigationStatus: status || 'non_navigable',
      reason: coords.seriesNumber != null ? 'no_image_number' : 'no_image_anchor'
    };
  }
  return { navigable: true, navigationStatus: status || 'navigable', reason: null };
}

function buildImageAnchors(coords) {
  if (coords.seriesNumber == null) return [];
  const anchor = { type: 'series-image', seriesNumber: coords.seriesNumber };
  if (coords.imageNumber != null) anchor.imageNumber = coords.imageNumber;
  return [anchor];
}

function normalizeFindingEntry(finding, accession, index, { debug, includeTrace }) {
  const coords = resolveCoords(finding);
  const nav = deriveNavigability(finding, coords);
  const findingId = norm(finding?.id) || `finding-${index + 1}`;
  const findingAccession = norm(finding?.accession) || norm(accession) || null;

  const entry = {
    id: findingId,
    title: norm(finding?.label) || findingId,
    text: conciseFindingText(finding),
    accession: findingAccession,
    navigable: nav.navigable,
    navigationStatus: nav.navigationStatus,
    nonNavigableReason: nav.reason,
    imageAnchors: buildImageAnchors(coords),
    // Primary navigation key (finding ID + accession) plus the fallback anchor.
    navigation: {
      findingId,
      accession: findingAccession,
      seriesNumber: coords.seriesNumber,
      imageNumber: coords.imageNumber,
      windowPreset: norm(pick(finding, 'windowPreset', 'window_preset')) || null
    }
  };

  if (debug && includeTrace) {
    entry.trace = {
      rawText: norm(finding?.rawText),
      severity: norm(finding?.severity) || null,
      source: norm(finding?.source) || null,
      confidence: Number.isFinite(Number(finding?.confidence)) ? Number(finding.confidence) : null,
      seriesNumberSource: norm(pick(finding, 'seriesNumberSource', 'series_number_source')) || null,
      imageNumberSource: norm(pick(finding, 'imageNumberSource', 'image_number_source')) || null
    };
  }

  return entry;
}

/**
 * Build a deterministic, versioned PresentationManifest from a PresentationContext.
 *
 * The PresentationContext mirrors the viewer's active report context:
 *   { source, accession, reportText, positiveFindings, negativeFindings, document }
 *
 * @param {object} context - PresentationContext (already-parsed report state)
 * @param {object} [options]
 * @param {string}  [options.source]       - Manifest origin label (default DEFAULT_MANIFEST_SOURCE)
 * @param {string}  [options.generatedAt]  - ISO timestamp; injectable for deterministic tests
 * @param {boolean} [options.debug=false]  - Master switch for trace/debug content
 * @param {boolean} [options.includeTrace=false] - Request trace; only honored when debug is true
 * @param {boolean} [options.includeNegative=true] - Represent negative/non-navigable findings
 * @returns {object} PresentationManifest
 */
export function buildPresentationManifest(context, options = {}) {
  const ctx = context && typeof context === 'object' ? context : {};
  const source = norm(options.source) || DEFAULT_MANIFEST_SOURCE;
  const generatedAt = norm(options.generatedAt) || new Date().toISOString();
  const debug = !!options.debug;
  // includeTrace is only ever honored behind the explicit debug flag.
  const includeTrace = debug && !!options.includeTrace;
  const includeNegative = options.includeNegative !== false;

  const accession = norm(ctx.accession) || null;
  const positive = Array.isArray(ctx.positiveFindings) ? ctx.positiveFindings : [];
  const negative = Array.isArray(ctx.negativeFindings) ? ctx.negativeFindings : [];
  const sourceFindings = includeNegative ? [...positive, ...negative] : [...positive];

  const findings = sourceFindings.map((f, i) =>
    normalizeFindingEntry(f, accession, i, { debug, includeTrace })
  );
  const navigableCount = findings.filter((f) => f.navigable).length;

  const manifest = {
    payloadVersion: PRESENTATION_MANIFEST_VERSION,
    source,
    generatedAt,
    accession,
    reportContext: {
      accession,
      reportSource: norm(ctx.source) || null,
      modality: norm(ctx.modality) || null,
      title: norm(ctx.title) || null,
      hasReportText: !!norm(ctx.reportText),
      findingCount: findings.length,
      navigableFindingCount: navigableCount,
      nonNavigableFindingCount: findings.length - navigableCount
    },
    findings
  };

  if (includeTrace) {
    // Raw report text is trace-only and never present in the default payload.
    manifest.trace = {
      reportText: norm(ctx.reportText),
      positiveFindingCount: positive.length,
      negativeFindingCount: negative.length
    };
  }

  return manifest;
}

/**
 * Launch readiness guardrail.
 *
 * Resolution model:
 *   - no active report            -> { ok: false }  (caller blocks launch)
 *   - report but no navigable      -> { ok: true, mode: 'non_navigable' }
 *   - report with navigable        -> { ok: true, mode: 'navigable' }
 *
 * Does not mutate the context. Non-navigable findings are surfaced explicitly
 * rather than dropped.
 *
 * @param {object} context - PresentationContext
 * @returns {{ ok: boolean, reason?: string, mode?: string, message: string,
 *             findingCount: number, navigableCount: number }}
 */
export function assessPresentationReadiness(context) {
  const ctx = context && typeof context === 'object' ? context : null;
  const positive = Array.isArray(ctx?.positiveFindings) ? ctx.positiveFindings : [];
  const negative = Array.isArray(ctx?.negativeFindings) ? ctx.negativeFindings : [];
  const hasReport = !!ctx && (!!norm(ctx.accession) || positive.length > 0 || negative.length > 0);

  if (!hasReport) {
    return {
      ok: false,
      reason: 'no_active_report',
      message: 'Load or parse a report before launching a presentation.',
      findingCount: 0,
      navigableCount: 0
    };
  }

  const all = [...positive, ...negative];
  const navigableCount = all.filter((f) => {
    const coords = resolveCoords(f);
    return deriveNavigability(f, coords).navigable;
  }).length;

  if (navigableCount === 0) {
    return {
      ok: true,
      mode: 'non_navigable',
      reason: 'no_navigable_findings',
      message: 'No navigable findings — generating a non-navigable presentation deck.',
      findingCount: all.length,
      navigableCount: 0
    };
  }

  return {
    ok: true,
    mode: 'navigable',
    message: `Ready: ${navigableCount} navigable finding${navigableCount !== 1 ? 's' : ''}.`,
    findingCount: all.length,
    navigableCount
  };
}

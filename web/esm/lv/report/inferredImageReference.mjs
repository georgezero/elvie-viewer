// Inferred image reference — weak series matching for findings without explicit
// image coordinates.
//
// Conservative by design: returns ok:false rather than guessing when evidence
// is ambiguous. Never infers imageNumber — only seriesNumber.
//
// Usage:
//   import { inferImageReference } from './inferredImageReference.mjs';
//   const result = inferImageReference({ finding, seriesCatalog, report });
//   if (result.ok && result.confidence === 'inferred') {
//     // series-level navigation possible; imageNumber still unknown
//   }

import { normalizeFindingImageReference } from './imageLinkProvider.mjs';

// Common words that don't help discriminate series descriptions.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'or', 'of', 'for', 'in', 'on', 'with',
  'no', 'not', 'without', 'to', 'is', 'as', 'at', 'by', 'be', 'are',
  'was', 'has', 'its', 'via', 'per', 'any', 'all', 'this', 'that',
  'from', 'into', 'over', 'also', 'both', 'each', 'than', 'there'
]);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Extract meaningful location/anatomy keywords from finding and report context.
 * Avoids severity, source, and generic descriptors that won't appear in a
 * series description.
 */
function extractKeywords(finding, report) {
  const sources = [
    finding?.anatomy,
    finding?.label,
    finding?.description,
    finding?.bodyPart,
    report?.bodyPart,
    report?.title,
    report?.document?.bodyPart,
    report?.document?.title
  ];
  const words = new Set();
  for (const src of sources) {
    if (!src) continue;
    for (const word of normalizeText(src).split(/[\s\W]+/)) {
      if (word.length >= 3 && !STOP_WORDS.has(word)) {
        words.add(word);
      }
    }
  }
  return Array.from(words);
}

/**
 * Score a series entry by keyword overlap with its description (and modality).
 */
function scoreSeries(series, keywords) {
  const text = normalizeText(
    [series.seriesDescription, series.modality].filter(Boolean).join(' ')
  );
  return keywords.reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
}

/**
 * Attempt to infer the most likely series for a finding.
 *
 * Priority:
 *   1. Finding already has explicit imageReference or seriesNumber → return as-is
 *   2. Blocked navigationStatus (negative, non_navigable) → ok:false
 *   3. Modality filter on series catalog (soft — skip if no modality match)
 *   4. Keyword scoring over series descriptions
 *   5. Require unique best scorer; ties → ok:false (ambiguous)
 *
 * Inferred results carry imageNumber: null. The openFinding command still
 * requires imageNumber, so inferred findings are series-level only.
 *
 * @param {object} params
 * @param {object}   params.finding        - Finding object (may have navigationStatus, anatomy, etc.)
 * @param {object[]} params.seriesCatalog  - Normalized series list from getViewerStateSnapshot
 * @param {object}   [params.report]       - Report document context (bodyPart, title, modality)
 *
 * @returns {{ ok: true,  imageReference, confidence: 'explicit'|'inferred', reason, seriesDescription? }
 *          |{ ok: false, reason }}
 */
export function inferImageReference({ finding, seriesCatalog, report } = {}) {
  // ── Step 1: explicit reference already present ──────────────────────────────
  const existingRef = normalizeFindingImageReference(finding);
  if (existingRef.seriesNumber != null) {
    const reason = existingRef.imageNumber != null ? 'explicit_series_image' : 'explicit_series_only';
    return { ok: true, imageReference: existingRef, confidence: 'explicit', reason };
  }

  // ── Step 2: blocked navigation statuses ────────────────────────────────────
  const status = normalizeText(finding?.navigationStatus || '');
  if (status === 'negative' || status === 'non_navigable') {
    return { ok: false, reason: 'finding_not_navigable' };
  }

  // ── Step 3: require a catalog with valid entries ────────────────────────────
  const catalog = Array.isArray(seriesCatalog)
    ? seriesCatalog.filter((s) => Number.isFinite(Number(s?.seriesNumber)))
    : [];
  if (catalog.length === 0) {
    return { ok: false, reason: 'no_series_catalog' };
  }

  // ── Step 4: extract keywords from finding + report context ─────────────────
  const keywords = extractKeywords(finding, report);
  if (keywords.length === 0) {
    return { ok: false, reason: 'no_keywords' };
  }

  // ── Step 5: optional modality filter (soft — fall back if nothing matches) ──
  const findingModality = normalizeText(
    finding?.modality ?? report?.modality ?? report?.document?.modality ?? ''
  );
  let candidates = catalog;
  if (findingModality) {
    const modalityMatched = catalog.filter(
      (s) => normalizeText(s.modality || '') === findingModality
    );
    if (modalityMatched.length > 0) candidates = modalityMatched;
    // 0 modality matches → keep all candidates (don't fail on modality alone)
  }

  // ── Step 6: keyword scoring ─────────────────────────────────────────────────
  const scored = candidates
    .map((s) => ({ series: s, score: scoreSeries(s, keywords) }))
    .sort((a, b) => b.score - a.score);

  if (scored[0].score === 0) {
    return { ok: false, reason: 'no_match' };
  }

  // Require unique best — ties are ambiguous
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { ok: false, reason: 'ambiguous' };
  }

  const best = scored[0].series;
  return {
    ok: true,
    imageReference: Object.freeze({
      type: 'series-image',
      seriesNumber: Number(best.seriesNumber),
      imageNumber: null    // intentionally not inferred
    }),
    confidence: 'inferred',
    reason: 'keyword_match',
    seriesDescription: best.seriesDescription ?? null
  };
}

// Study resolver — pure resolution logic, no PACS queries.
//
// Given caller-supplied studies and patient/finding/report context,
// resolves the best study to navigate to before calling openStudyThenFinding.
//
// Priority:
//   1. Exact accession match
//   2. Exact studyInstanceUID match
//   3. Modality match (single remaining candidate)
//   4. Description keyword match (uniquely highest score)
//   5. Most recent study fallback (only when studyDate is available)
//   → ok:false when none of the above can resolve unambiguously

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'or', 'of', 'for', 'in', 'on', 'with',
  'no', 'not', 'without', 'to', 'is', 'as', 'at', 'by', 'be', 'are', 'was'
]);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Parse a study date into a Unix timestamp (ms) for ordering.
 * Accepts: DICOM YYYYMMDD string, ISO date string, numeric timestamp, Date.
 * Returns null when the value is unparseable.
 */
function parseStudyDate(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const s = String(value).replace(/\D/g, '');
  if (s.length === 8) {
    const ts = Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
    return Number.isFinite(ts) ? ts : null;
  }
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Extract meaningful keywords from finding and report context for description scoring.
 */
function extractKeywords(finding, report) {
  const sources = [
    finding?.label,
    finding?.description,
    finding?.bodyPart,
    report?.modality,
    report?.title,
    report?.bodyPart,
    report?.document?.modality,
    report?.document?.title,
    report?.document?.bodyPart
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
 * Score a study by keyword overlap with description, modality, and body part.
 * Higher is better.
 */
function scoreStudy(study, keywords) {
  const text = normalizeText(
    [study.studyDescription, study.description, study.modality, study.bodyPart].join(' ')
  );
  return keywords.reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0);
}

function pickFirst(matches) {
  const s = matches[0];
  return {
    ok: true,
    accession: s.accession ?? null,
    studyInstanceUID: s.studyInstanceUID ?? s.studyUid ?? null
  };
}

/**
 * Resolve the best study from a caller-supplied list for a given finding/report context.
 *
 * @param {object} params
 * @param {object}   [params.patient]  - Patient context (reserved for future validation)
 * @param {object[]}  params.studies   - Caller-supplied study list; must not be empty
 * @param {object}   [params.finding]  - Finding ref (accession, studyInstanceUID, modality, etc.)
 * @param {object}   [params.report]   - Report document context (accession, modality, title, etc.)
 *
 * @returns {{ ok: true,  accession: string|null, studyInstanceUID: string|null,
 *             confidence: 'exact'|'high'|'medium'|'low', reason: string }
 *          |{ ok: false, reason: string, candidates: object[] }}
 */
export function resolveStudyForFinding({ patient, studies, finding, report } = {}) {
  if (!Array.isArray(studies) || studies.length === 0) {
    return { ok: false, reason: 'no_studies_provided', candidates: [] };
  }

  // ── Priority 1: Exact accession match ────────────────────────────────────────
  const accession = normalizeText(
    finding?.accession ?? report?.accession ?? report?.document?.accession ?? ''
  );
  if (accession) {
    const matches = studies.filter((s) => normalizeText(s.accession) === accession);
    if (matches.length >= 1) {
      return { ...pickFirst(matches), confidence: 'exact', reason: 'accession_match' };
    }
  }

  // ── Priority 2: Exact studyInstanceUID match ──────────────────────────────────
  const uid = normalizeText(
    finding?.studyInstanceUID ?? report?.studyInstanceUID ?? report?.document?.studyInstanceUID ?? ''
  );
  if (uid) {
    const matches = studies.filter(
      (s) => normalizeText(s.studyInstanceUID ?? s.studyUid ?? '') === uid
    );
    if (matches.length >= 1) {
      return { ...pickFirst(matches), confidence: 'exact', reason: 'study_uid_match' };
    }
  }

  let candidates = studies.slice();

  // ── Priority 3: Modality filter ───────────────────────────────────────────────
  const modality = normalizeText(
    finding?.modality ?? report?.modality ?? report?.document?.modality ?? ''
  );
  if (modality) {
    const modalityMatches = candidates.filter((s) => normalizeText(s.modality) === modality);
    if (modalityMatches.length === 1) {
      return { ...pickFirst(modalityMatches), confidence: 'high', reason: 'modality_match' };
    }
    if (modalityMatches.length > 1) {
      candidates = modalityMatches;
    }
    // 0 matches: modality present but unmatched — skip filter, keep all candidates
  }

  // ── Priority 4: Description keyword match ────────────────────────────────────
  const keywords = extractKeywords(finding, report);
  if (keywords.length > 0) {
    const scored = candidates
      .map((s) => ({ study: s, score: scoreStudy(s, keywords) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) {
      const uniqueBest = scored.length === 1 || scored[0].score > scored[1].score;
      if (uniqueBest) {
        return { ...pickFirst([scored[0].study]), confidence: 'medium', reason: 'description_match' };
      }
    }
  }

  // ── Priority 5: Most recent study fallback ────────────────────────────────────
  const dated = candidates
    .map((s) => ({ study: s, ts: parseStudyDate(s.studyDate) }))
    .filter((x) => x.ts != null)
    .sort((a, b) => b.ts - a.ts);

  if (dated.length > 0) {
    return { ...pickFirst([dated[0].study]), confidence: 'low', reason: 'recent_fallback' };
  }

  // ── No resolution ─────────────────────────────────────────────────────────────
  return { ok: false, reason: 'ambiguous', candidates };
}

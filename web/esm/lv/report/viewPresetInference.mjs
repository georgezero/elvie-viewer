// Pure CT window-level preset inference for findings.
// No commandBus, viewer, or PACS access.
//
// Supported CT presets: soft_tissue, lung, liver, bone, brain, brain_hemorrhage, brain_stroke, reset
// MR (and other non-CT modalities) → { type: 'none', reason }
//
// Priority ordering within CT:
//   head context: hemorrhage > stroke > bone > brain (default)
//   body:         lung > liver > bone > soft_tissue > reset (no match)

export const CT_WL_PRESETS = Object.freeze([
  'soft_tissue', 'lung', 'liver', 'bone',
  'brain', 'brain_hemorrhage', 'brain_stroke', 'reset'
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function lc(v) { return String(v || '').toLowerCase(); }

// Match a term against lowercased text.
// Short abbreviations (≤4 chars) use word-boundary regex; longer terms use includes.
function termHit(text, term) {
  if (term.length <= 4) return new RegExp(`\\b${term}\\b`).test(text);
  return text.includes(term);
}

function matchedTerms(text, terms) { return terms.filter(t => termHit(text, t)); }
function hasAny(text, terms)       { return terms.some(t => termHit(text, t)); }

// ── Term lists ────────────────────────────────────────────────────────────────

const HEAD_CTX    = ['head', 'brain', 'intracranial', 'intraventricular', 'ventricle', 'calvarium', 'skull', 'cranial', 'cranium'];
const HEMORRHAGE  = ['hemorrhage', 'haemorrhage', 'hemorrhagic', 'haemorrhagic',
                     'bleed', 'bleeding', 'hematoma', 'haematoma',
                     'subarachnoid', 'subdural', 'epidural', 'sah', 'sdh', 'edh',
                     'intracerebral', 'intraparenchymal'];
const STROKE      = ['stroke', 'infarct', 'infarction', 'ischemia', 'ischaemia', 'ischemic', 'ischaemic',
                     'encephalomalacia', 'lacunar'];
const HEAD_BONE   = ['fracture', 'osseous', 'skull', 'calvarium'];
const LUNG        = ['lung', 'pulmonary', 'nodule', 'emphysema', 'pleural', 'pneumothorax', 'consolidation'];
const LIVER       = ['liver', 'hepatic', 'hepatobiliary', 'hepatocellular'];
const BONE        = ['fracture', 'osseous'];
const SOFT_TISSUE = ['abdomen', 'abdominal', 'pelvis', 'pelvic', 'soft tissue', 'mass', 'mediastin'];

const NON_CT = new Set(['mr', 'mri', 'pt', 'nm', 'us', 'dx', 'cr', 'mg', 'xa', 'rf', 'fl']);

// ── Modality detection ────────────────────────────────────────────────────────

function detectModality(finding, seriesEntry) {
  const explicit = lc(finding?.modality || seriesEntry?.modality || '');
  if (explicit) return explicit;
  const desc = lc(seriesEntry?.seriesDescription || seriesEntry?.series_description || '');
  if (/\b(mr|mri)\b/.test(desc)) return 'mr';
  if (/\bct\b/.test(desc)) return 'ct';
  return null;
}

// ── CT preset classification ──────────────────────────────────────────────────

function classifyCtPreset(findingText, contextText) {
  const allText = `${findingText} ${contextText}`;
  const isHead = hasAny(allText, HEAD_CTX);

  if (isHead) {
    const hTerms = matchedTerms(allText, HEMORRHAGE);
    if (hTerms.length) {
      return { preset: 'brain_hemorrhage', confidence: 'high', reason: `head; hemorrhage: ${hTerms.join(', ')}` };
    }
    const sTerms = matchedTerms(allText, STROKE);
    if (sTerms.length) {
      return { preset: 'brain_stroke', confidence: 'high', reason: `head; stroke: ${sTerms.join(', ')}` };
    }
    const bTerms = matchedTerms(allText, HEAD_BONE);
    if (bTerms.length) {
      return { preset: 'bone', confidence: 'high', reason: `head; bone: ${bTerms.join(', ')}` };
    }
    const ctxTerms = matchedTerms(allText, HEAD_CTX);
    return { preset: 'brain', confidence: 'medium', reason: `head_context: ${ctxTerms.join(', ')}` };
  }

  const lTerms = matchedTerms(allText, LUNG);
  if (lTerms.length) return { preset: 'lung',        confidence: 'high',   reason: `lung: ${lTerms.join(', ')}` };

  const livTerms = matchedTerms(allText, LIVER);
  if (livTerms.length) return { preset: 'liver',     confidence: 'high',   reason: `liver: ${livTerms.join(', ')}` };

  const boTerms = matchedTerms(allText, BONE);
  if (boTerms.length) return { preset: 'bone',       confidence: 'high',   reason: `bone: ${boTerms.join(', ')}` };

  const stTerms = matchedTerms(allText, SOFT_TISSUE);
  if (stTerms.length) return { preset: 'soft_tissue', confidence: 'medium', reason: `soft_tissue: ${stTerms.join(', ')}` };

  return { preset: 'reset', confidence: 'low', reason: 'no_keyword_match' };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Infer the best CT window-level preset for a finding.
 *
 * @param {object} params
 * @param {object}  params.finding     - Finding (label, anatomy, description, explanation, modality)
 * @param {object}  [params.seriesEntry] - Series entry (modality, seriesDescription/series_description)
 * @param {object}  [params.report]    - Report context (bodyPart, title, document.title)
 *
 * @returns {{ type: 'ct-window', preset: string, confidence: 'high'|'medium'|'low', reason: string }
 *          |{ type: 'none', reason: string }}
 */
export function inferViewPreset({ finding, seriesEntry, report } = {}) {
  const modality = detectModality(finding, seriesEntry);
  if (NON_CT.has(modality)) {
    return {
      type: 'none',
      reason: (modality === 'mr' || modality === 'mri') ? 'mr_not_supported' : 'non_ct_modality'
    };
  }

  const findingText = [finding?.label, finding?.anatomy, finding?.description, finding?.explanation]
    .filter(Boolean).map(lc).join(' ');

  const contextText = [
    seriesEntry?.seriesDescription, seriesEntry?.series_description,
    report?.bodyPart, report?.title,
    report?.document?.bodyPart, report?.document?.title
  ].filter(Boolean).map(lc).join(' ');

  const { preset, confidence, reason } = classifyCtPreset(findingText, contextText);
  return { type: 'ct-window', preset, confidence, reason };
}

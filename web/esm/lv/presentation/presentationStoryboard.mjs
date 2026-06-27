// Presentation storyboard generator.
//
// Pure, deterministic transforms that turn structured finding data into the
// narrative scaffolding a cinematic case video needs:
//   - a one-line study summary
//   - impression bullets
//   - per-scene narration text (stored in the manifest; no TTS here)
//   - per-finding highlight phrase + pointer hint
//
// Narration is engine-agnostic: it is plain text stored on the manifest so a
// later pass can feed it to browser TTS, OpenAI, ElevenLabs, Cartesia, etc.
// The video renderer never depends on narration.

function norm(v) { return String(v == null ? '' : v).trim(); }

function pick(f, ...keys) {
  for (const k of keys) {
    const v = f?.[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// Lowercase the first character (for mid-sentence insertion of a Title-Cased label).
function lcFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function ucWords(s) { return norm(s).replace(/\b\w/g, c => c.toUpperCase()); }

// ── Body region inference ───────────────────────────────────────────────────
// Used for the exam name and the region-specific "no acute … abnormality" clause.
const REGION_MAP = [
  { region: 'HEAD',    negative: 'No acute intracranial abnormality.',
    terms: ['head', 'brain', 'intracranial', 'cranial', 'cranium', 'skull', 'calvari', 'caudate', 'vertex', 'ventricle', 'cerebr', 'infarct'] },
  { region: 'CHEST',   negative: 'No acute cardiopulmonary abnormality.',
    terms: ['chest', 'lung', 'pulmonary', 'pleura', 'mediasti', 'cardiac', 'thora'] },
  { region: 'ABDOMEN', negative: 'No acute intra-abdominal abnormality.',
    terms: ['abdom', 'liver', 'hepatic', 'renal', 'kidney', 'spleen', 'pancrea', 'bowel'] },
  { region: 'KNEE',    negative: 'No acute osseous abnormality.',
    terms: ['knee', 'meniscus', 'patella', 'cruciate', 'tibia', 'femor'] },
  { region: 'SPINE',   negative: 'No acute spinal abnormality.',
    terms: ['spine', 'spinal', 'vertebra', 'disc', 'cord', 'lumbar', 'cervical', 'thoracic'] },
];

function deriveRegion(findings) {
  const hay = findings.map(f =>
    `${pick(f, 'label')} ${pick(f, 'description', 'rawText')} ${pick(f, 'anatomy')} ${pick(f, 'localization_target')}`
  ).join(' ').toLowerCase();
  for (const entry of REGION_MAP) {
    if (entry.terms.some(t => hay.includes(t))) return entry;
  }
  return { region: '', negative: 'No acute abnormality.', terms: [] };
}

/**
 * Exam name for the title card, e.g. "CT HEAD".
 * Prefers an explicit examName, otherwise modality + inferred region.
 */
export function deriveExamName({ examName, modality, positiveFindings = [] } = {}) {
  if (norm(examName)) return norm(examName).toUpperCase();
  const mod = norm(modality).toUpperCase();
  const { region } = deriveRegion(positiveFindings);
  return [mod, region].filter(Boolean).join(' ') || 'STUDY';
}

/** One-line study summary sentence. */
export function buildStudySummary({ modality, positiveFindings = [], negativeFindings = [] } = {}) {
  const region = deriveRegion(positiveFindings);
  const mod = norm(modality) || 'Study';
  const regionWord = region.region ? region.region.toLowerCase() : '';
  const head = `${mod} ${regionWord}`.trim();

  const labels = positiveFindings.map(f => lcFirst(norm(pick(f, 'label')))).filter(Boolean);
  let body;
  if (labels.length === 0) {
    body = `${head} demonstrates no significant positive findings`;
  } else if (labels.length === 1) {
    body = `${head} demonstrates ${labels[0]}`;
  } else {
    body = `${head} demonstrates ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  }
  // Capitalize first letter of the whole sentence.
  const sentence = body.charAt(0).toUpperCase() + body.slice(1);
  return `${sentence}. ${region.negative}`;
}

/** Impression bullets: each positive finding + a region-level negative clause. */
export function buildImpressionBullets({ positiveFindings = [], negativeFindings = [] } = {}) {
  const region = deriveRegion(positiveFindings);
  const bullets = positiveFindings.map(f => {
    const label = norm(pick(f, 'label'));
    return /[.!?]$/.test(label) ? label : `${label}.`;
  });
  bullets.push(region.negative);
  return bullets;
}

// ── Per-finding highlight phrase ────────────────────────────────────────────
// The phrase to emphasise inside the report sentence. Picks the first candidate
// (localization target → anatomy → disease) that actually appears in the text.
export function deriveHighlightPhrase(finding, sentence) {
  const text = norm(sentence).toLowerCase();
  const candidates = [
    pick(finding, 'localization_target'),
    pick(finding, 'anatomy'),
    pick(finding, 'disease'),
  ].map(norm).filter(Boolean);
  for (const c of candidates) {
    if (text.includes(c.toLowerCase())) return c;
  }
  // Fallback: drop a leading laterality word and try the disease again.
  const disease = pick(finding, 'disease');
  if (disease && text.includes(disease.toLowerCase())) return disease;
  return '';
}

// ── Pointer hints (demo) ────────────────────────────────────────────────────
// Normalised coordinates (0–1) within the displayed CT image, manually placed
// for the demo studies. Future versions populate this from AI localization data
// (finding.localization / VLM markers) — the renderer just consumes {x,y,style}.
const DEMO_POINTERS = {
  'chronic-left-caudate-infarct': { x: 0.55, y: 0.46, style: 'ring' },
  'healed-left-vertex-fracture':  { x: 0.60, y: 0.23, style: 'ring' },
};

export function derivePointer(finding) {
  // Prefer explicit, AI-supplied localization when present.
  const loc = finding?.localization || finding?.pointer;
  if (loc && Number.isFinite(Number(loc.x)) && Number.isFinite(Number(loc.y))) {
    return { x: Number(loc.x), y: Number(loc.y), style: norm(loc.style) || 'ring', source: 'localization' };
  }
  const demo = DEMO_POINTERS[norm(finding?.id)];
  if (demo) return { ...demo, source: 'demo' };
  return null;
}

// ── Per-finding narration ───────────────────────────────────────────────────
function findingNarration(finding, sentence) {
  const base = norm(sentence) || norm(pick(finding, 'label'));
  const sn = finding?.seriesNumber ?? finding?.series_number;
  const im = finding?.imageNumber ?? finding?.image_number;
  const loc = (sn != null && im != null) ? ` Series ${sn}, image ${im}.` : '';
  const clean = /[.!?]$/.test(base) ? base : `${base}.`;
  return `${clean}${loc}`;
}

/**
 * Build the full storyboard from raw finding lists.
 *
 * @returns {{
 *   examName: string, summary: string, impression: string[],
 *   narrationScript: Array<{scene:string, findingId?:string, narration:string}>,
 *   perFinding: Object<string,{reportSentence,highlightPhrase,pointer,narration}>
 * }}
 */
export function buildStoryboard({ modality, accession, positiveFindings = [], negativeFindings = [], examName } = {}) {
  const exam = deriveExamName({ examName, modality, positiveFindings });
  const summary = buildStudySummary({ modality, positiveFindings, negativeFindings });
  const impression = buildImpressionBullets({ positiveFindings, negativeFindings });
  const count = positiveFindings.length;

  const perFinding = {};
  const narrationScript = [
    { scene: 'title', narration: `${exam}. ${count} positive ${count === 1 ? 'finding' : 'findings'} identified.` },
    { scene: 'summary', narration: summary },
  ];

  for (const f of positiveFindings) {
    const id = norm(f?.id);
    const sentence = norm(pick(f, 'description', 'rawText')) || norm(pick(f, 'label'));
    const entry = {
      reportSentence: sentence,
      highlightPhrase: deriveHighlightPhrase(f, sentence),
      pointer: derivePointer(f),
      narration: findingNarration(f, sentence),
    };
    if (id) perFinding[id] = entry;
    narrationScript.push({ scene: 'finding', findingId: id || null, narration: entry.narration });
  }

  narrationScript.push({ scene: 'closing', narration: `Impression. ${impression.join(' ')}` });

  return { examName: exam, summary, impression, narrationScript, perFinding };
}

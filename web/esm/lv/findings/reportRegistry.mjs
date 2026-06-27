function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function norm(value) {
  return String(value || '').trim();
}

function asFinite(value) {
  if (value == null) return null;  // null/undefined must not coerce to 0
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const SOURCE_PRIORITY = {
  seeded: 1,
  parsed: 2,
  agent: 3,
  user: 4
};

function normalizeSource(source, fallback = 'parsed') {
  const s = norm(source).toLowerCase();
  if (s === 'seeded' || s === 'built-in-report') return 'seeded';
  if (s === 'parsed' || s === 'parsed-report') return 'parsed';
  if (s === 'agent') return 'agent';
  if (s === 'user') return 'user';
  return fallback;
}

function normalizeFinding(accession, input = {}, sourceFallback = 'parsed') {
  const seriesNumber = asFinite(input.seriesNumber);
  let imageNumber = asFinite(input.imageNumber);
  const confidenceNum = Number(input.confidence);
  const source = normalizeSource(input.source, sourceFallback);
  const provenance = input.provenance && typeof input.provenance === 'object' ? input.provenance : null;
  const overrides = input.overrides && typeof input.overrides === 'object' ? input.overrides : null;
  const seriesNumberSource = norm(input.series_number_source || input.seriesNumberSource || '').toLowerCase();
  let imageNumberSource = norm(input.image_number_source || input.imageNumberSource || '').toLowerCase();
  let navigationStatus = norm(input.navigation_status || input.navigationStatus || '').toLowerCase();
  const explicitSeries = seriesNumber !== null;
  const explicitImage = imageNumber !== null;
  if (!navigationStatus) {
    if (String(input.severity || '').toLowerCase() === 'negative') navigationStatus = 'negative';
    else if (explicitSeries && explicitImage) navigationStatus = 'navigable';
    else if (explicitSeries) navigationStatus = 'series_only';
    else navigationStatus = 'non_navigable';
  }
  if (navigationStatus === 'negative') {
    imageNumber = null;
  }
  if (navigationStatus === 'series_only' && imageNumber === null) {
    imageNumber = 1;
  }
  if (!imageNumberSource) {
    if (navigationStatus === 'series_only') imageNumberSource = 'default';
    else if (explicitImage) imageNumberSource = 'explicit';
    else imageNumberSource = 'none';
  }
  const showFindingMarker =
    typeof input.show_finding_marker === 'boolean'
      ? input.show_finding_marker
      : (navigationStatus === 'navigable');

  let finalSeriesNumber = seriesNumber;
  let finalImageNumber = imageNumber;
  let finalSeriesNumberSource = seriesNumberSource || (explicitSeries ? 'explicit' : 'none');
  let finalImageNumberSource = imageNumberSource;
  let finalShowFindingMarker = !!showFindingMarker;

  // Negative findings are never navigable/localized.
  // Guard against 0/0 or any numeric placeholder being used as null substitute.
  if (navigationStatus === 'negative') {
    finalSeriesNumber = null;
    finalImageNumber = null;
    finalSeriesNumberSource = 'none';
    finalImageNumberSource = 'none';
    finalShowFindingMarker = false;
  }

  return {
    id: norm(input.id) || `finding-${Math.random().toString(36).slice(2, 10)}`,
    accession: norm(input.accession) || norm(accession),
    label: norm(input.label),
    description: norm(input.description),
    section: norm(input.section) || 'findings',
    impressionText: norm(input.impressionText),
    seriesNumber: finalSeriesNumber,
    imageNumber: finalImageNumber,
    windowPreset: norm(input.windowPreset) || null,
    modality: norm(input.modality) || null,
    anatomy: norm(input.anatomy) || null,
    laterality: norm(input.laterality) || null,
    disease: norm(input.disease) || null,
    localization_target: norm(input.localization_target) || null,
    modality_hint: norm(input.modality_hint) || null,
    view_hint: norm(input.view_hint) || null,
    severity: norm(input.severity) || null,
    source,
    confidence: Number.isFinite(confidenceNum) ? Math.max(0, Math.min(1, confidenceNum)) : (source === 'seeded' ? 1 : null),
    provenance: provenance ? {
      parserProvider: norm(provenance.parserProvider) || null,
      model: norm(provenance.model) || null,
      schemaVersion: norm(provenance.schemaVersion) || null,
      parsedAt: provenance.parsedAt || null
    } : null,
    rawText: norm(input.rawText),
    navigationStatus,
    seriesNumberSource: finalSeriesNumberSource,
    imageNumberSource: finalImageNumberSource,
    showFindingMarker: finalShowFindingMarker,
    uncertaintyReason: input.uncertainty_reason ?? input.uncertaintyReason ?? null,
    patientFriendlyExplanation: (typeof input.patientFriendlyExplanation === 'string' && input.patientFriendlyExplanation.trim()) ? input.patientFriendlyExplanation.trim() : null,
    overrides: overrides ? {
      seriesNumber: asFinite(overrides.seriesNumber),
      imageNumber: asFinite(overrides.imageNumber),
      windowPreset: norm(overrides.windowPreset) || null
    } : null
  };
}

function applyOverrides(finding) {
  if (!finding?.overrides) return finding;
  return {
    ...finding,
    seriesNumber: finding.overrides.seriesNumber ?? finding.seriesNumber,
    imageNumber: finding.overrides.imageNumber ?? finding.imageNumber,
    windowPreset: finding.overrides.windowPreset ?? finding.windowPreset
  };
}

function scoreFinding(f) {
  return (SOURCE_PRIORITY[f?.source] || 0) * 10 + (Number.isFinite(Number(f?.confidence)) ? Number(f.confidence) : 0);
}

const BUILTIN_REPORTS = [
  {
    id: 'report-ni9f7ff9',
    accession: 'NI9f7ff9',
    modality: 'CT',
    title: 'CT Head',
    reportText:
      'Chronic infarct involving left caudate head (Series 2, Image 21). Healed fracture near left vertex (Series 2, Image 36). No acute intracranial hemorrhage.',
    findings: [
      {
        id: 'chronic-left-caudate-infarct', accession: 'NI9f7ff9', label: 'Chronic left caudate infarct', description: 'Chronic infarct involving left caudate head', section: 'findings',
        patientFriendlyExplanation: 'This is an old area of stroke damage in a small part of the brain, not a new stroke.',
        impressionText: 'No acute intracranial hemorrhage.', seriesNumber: 2, imageNumber: 21, windowPreset: 'brain', modality: 'CT', anatomy: 'left caudate head', laterality: 'left', disease: 'chronic infarct', localization_target: 'left caudate head', modality_hint: 'CT', view_hint: 'axial', severity: 'chronic', source: 'seeded', confidence: 1, rawText: 'Chronic infarct involving left caudate head (Series 2, Image 21).'
      },
      {
        id: 'healed-left-vertex-fracture', accession: 'NI9f7ff9', label: 'Healed left vertex fracture', description: 'Healed fracture near left vertex', section: 'findings',
        patientFriendlyExplanation: 'This is a fully healed old skull fracture near the top of the head — not a new injury.',
        impressionText: 'No acute calvarial fracture.', seriesNumber: 2, imageNumber: 36, windowPreset: 'bone', modality: 'CT', anatomy: 'left vertex skull', laterality: 'left', disease: 'healed fracture', localization_target: 'left vertex skull', modality_hint: 'CT', view_hint: null, severity: 'healed', source: 'seeded', confidence: 1, rawText: 'Healed fracture near left vertex (Series 2, Image 36).'
      },
      {
        id: 'no-new-acute-infarcts', accession: 'NI9f7ff9', label: 'No new acute cortical or subcortical infarcts', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No new acute cortical or subcortical infarcts.'
      },
      {
        id: 'no-acute-calvarial-fracture', accession: 'NI9f7ff9', label: 'No acute calvarial fracture', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No acute calvarial fracture.'
      },
      {
        id: 'no-subdural-hemorrhage', accession: 'NI9f7ff9', label: 'No subdural, epidural, or subarachnoid hemorrhage', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No subdural, epidural, or subarachnoid hemorrhage.'
      },
      {
        id: 'no-hydrocephalus', accession: 'NI9f7ff9', label: 'No hydrocephalus', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No hydrocephalus.'
      },
      {
        id: 'no-acute-intracranial-hemorrhage', accession: 'NI9f7ff9', label: 'No acute intracranial hemorrhage', section: 'impression',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No acute intracranial hemorrhage.'
      },
      {
        id: 'no-mass-lesion', accession: 'NI9f7ff9', label: 'No mass or mass-effect lesion', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No mass or mass-effect lesion identified.'
      },
      {
        id: 'no-midline-shift', accession: 'NI9f7ff9', label: 'No midline shift', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No midline shift.'
      },
      {
        id: 'sinuses-mastoids-clear', accession: 'NI9f7ff9', label: 'Paranasal sinuses and mastoid air cells clear', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'Paranasal sinuses and mastoid air cells are grossly clear.'
      }
    ]
  },
  {
    id: 'report-3852755662087132',
    accession: '3852755662087132',
    modality: 'MR',
    title: 'MR Left Knee',
    reportText:
      'Medial meniscus tear (Series 6, Image 23). Knee joint effusion (Series 3, Image 14).',
    findings: [
      {
        id: 'medial-meniscus-tear', accession: '3852755662087132', label: 'Medial meniscus tear', description: 'Posterior horn horizontal tear pattern on T2', section: 'findings',
        patientFriendlyExplanation: 'The cartilage cushion on the inner side of your knee has a tear, which can cause pain and swelling when you move.',
        impressionText: 'Medial meniscal tear.', seriesNumber: 6, imageNumber: 23, windowPreset: null, modality: 'MR', anatomy: 'posterior horn medial meniscus', laterality: 'left', disease: 'tear', localization_target: 'posterior horn medial meniscus', modality_hint: 'MR', view_hint: 'sagittal', severity: 'abnormal', source: 'seeded', confidence: 1, rawText: 'Medial meniscus tear (Series 6, Image 23).'
      },
      {
        id: 'joint-effusion', accession: '3852755662087132', label: 'Joint effusion', description: 'Moderate joint effusion within suprapatellar bursa', section: 'findings',
        patientFriendlyExplanation: 'Extra fluid has built up inside the knee joint, which causes swelling and stiffness.',
        impressionText: 'Moderate joint effusion.', seriesNumber: 3, imageNumber: 14, windowPreset: null, modality: 'MR', anatomy: 'knee joint', laterality: 'left', disease: 'effusion', localization_target: 'knee joint', modality_hint: 'MR', view_hint: null, severity: 'abnormal', source: 'seeded', confidence: 1, rawText: 'Joint effusion (Series 3, Image 14).'
      },
      {
        id: 'chondromalacia-patella', accession: '3852755662087132', label: 'Chondromalacia patella', description: 'Mild chondromalacia patella grade 1', section: 'findings',
        patientFriendlyExplanation: 'There is mild softening and wear of the cartilage behind the kneecap — a common finding that can cause aching pain when climbing stairs or sitting for long periods.',
        seriesNumber: null, imageNumber: null, severity: 'mild', source: 'seeded', confidence: 0.9, rawText: 'Mild chondromalacia patella grade 1.'
      },
      {
        id: 'lateral-meniscus-intact', accession: '3852755662087132', label: 'Lateral meniscus intact', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'Lateral meniscus: Intact. No tear or signal abnormality.'
      },
      {
        id: 'acl-intact', accession: '3852755662087132', label: 'ACL intact', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'ACL is intact with normal signal and course.'
      },
      {
        id: 'pcl-intact', accession: '3852755662087132', label: 'PCL intact', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'PCL is intact.'
      },
      {
        id: 'collateral-ligaments-intact', accession: '3852755662087132', label: 'Collateral ligaments intact', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'Medial and lateral collateral ligaments are intact.'
      },
      {
        id: 'no-loose-bodies', accession: '3852755662087132', label: 'No loose bodies', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No loose bodies.'
      },
      {
        id: 'articular-cartilage-intact', accession: '3852755662087132', label: 'Articular cartilage intact', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'Tibial and femoral articular cartilage is grossly intact.'
      },
      {
        id: 'no-acute-knee-fracture', accession: '3852755662087132', label: 'No acute fracture', section: 'impression',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No acute fracture.'
      },
      {
        id: 'no-bone-marrow-edema', accession: '3852755662087132', label: 'No bone marrow edema', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No bone marrow edema.'
      },
      {
        id: 'no-subchondral-cysts', accession: '3852755662087132', label: 'No subchondral cysts', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 0.95, rawText: 'No subchondral cysts.'
      }
    ]
  },
  {
    id: 'report-cxr-88997',
    accession: 'CXR-88997',
    modality: 'XR',
    title: 'Chest Radiograph',
    reportText: 'No acute cardiopulmonary abnormality.',
    findings: [
      {
        id: 'no-acute-cardiopulmonary-abnormality', accession: 'CXR-88997', label: 'No acute cardiopulmonary abnormality', description: 'No focal airspace disease, pleural effusion, or pneumothorax.', section: 'impression',
        impressionText: 'No acute cardiopulmonary abnormality.', seriesNumber: null, imageNumber: null, windowPreset: null, modality: 'XR', anatomy: 'chest', laterality: null, disease: null, localization_target: 'chest', modality_hint: 'XR', view_hint: 'AP', severity: 'negative', source: 'seeded', confidence: 1, rawText: 'No acute cardiopulmonary abnormality.'
      },
      {
        id: 'no-focal-airspace-opacity', accession: 'CXR-88997', label: 'No focal airspace opacity', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 1, rawText: 'No focal airspace opacity, consolidation, or mass lesion.'
      },
      {
        id: 'no-pleural-effusion', accession: 'CXR-88997', label: 'No pleural effusion or pneumothorax', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 1, rawText: 'No pleural effusion or pneumothorax.'
      },
      {
        id: 'normal-mediastinum', accession: 'CXR-88997', label: 'Normal mediastinum', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 1, rawText: 'Normal in width and contour.'
      },
      {
        id: 'no-hilar-lymphadenopathy', accession: 'CXR-88997', label: 'No hilar lymphadenopathy', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 1, rawText: 'No hilar lymphadenopathy.'
      },
      {
        id: 'normal-heart-size', accession: 'CXR-88997', label: 'Normal heart size', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 1, rawText: 'Cardiac silhouette is normal in size.'
      },
      {
        id: 'no-pericardial-effusion', accession: 'CXR-88997', label: 'No pericardial effusion', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 1, rawText: 'No pericardial effusion.'
      },
      {
        id: 'no-rib-vertebral-fracture', accession: 'CXR-88997', label: 'No rib or vertebral fracture', section: 'findings',
        seriesNumber: null, imageNumber: null, severity: 'negative', source: 'seeded', confidence: 1, rawText: 'No rib or vertebral fracture.'
      }
    ]
  }
];

const REPORT_OVERRIDES = new Map();

function findBaseReport(accession) {
  const key = String(accession || '').trim();
  if (!key) return null;
  return BUILTIN_REPORTS.find((r) => String(r.accession) === key) || null;
}

function getBuckets(accession) {
  const key = String(accession || '').trim();
  if (!REPORT_OVERRIDES.has(key)) {
    REPORT_OVERRIDES.set(key, {
      parsed: [],
      parsedNegative: [],
      user: [],
      userNegative: [],
      agent: [],
      agentNegative: [],
      parserMeta: null
    });
  }
  return REPORT_OVERRIDES.get(key);
}

function isNegativeFinding(finding) {
  if (!finding || typeof finding !== 'object') return false;
  const nav = norm(finding.navigationStatus || finding.navigation_status).toLowerCase();
  const sev = norm(finding.severity).toLowerCase();
  const label = norm(finding.label).toLowerCase();
  const desc = norm(finding.description).toLowerCase();
  if (nav === 'negative') return true;
  if (sev === 'negative') return true;
  if (label.startsWith('no ') || desc.startsWith('no ')) return true;
  return false;
}

function splitPositiveAndNegative(findings = []) {
  const positive = [];
  const negative = [];
  for (const f of findings) {
    if (isNegativeFinding(f)) negative.push(f);
    else positive.push(f);
  }
  return { positive, negative };
}

function materializeFindings(accession, { includeNegative = false } = {}) {
  const base = findBaseReport(accession);
  if (!base) return { positive: [], negative: [], all: [] };
  const seededAll = (base.findings || []).map((f) => normalizeFinding(base.accession, f, 'seeded'));
  const seededSplit = splitPositiveAndNegative(seededAll);
  const buckets = getBuckets(base.accession);
  const positive = [
    ...seededSplit.positive,
    ...((buckets.parsed || []).map((f) => normalizeFinding(base.accession, f, 'parsed'))),
    ...((buckets.agent || []).map((f) => normalizeFinding(base.accession, f, 'agent'))),
    ...((buckets.user || []).map((f) => normalizeFinding(base.accession, f, 'user')))
  ].map(applyOverrides);
  const negative = [
    ...seededSplit.negative,
    ...((buckets.parsedNegative || []).map((f) => normalizeFinding(base.accession, f, 'parsed'))),
    ...((buckets.agentNegative || []).map((f) => normalizeFinding(base.accession, f, 'agent'))),
    ...((buckets.userNegative || []).map((f) => normalizeFinding(base.accession, f, 'user')))
  ].map(applyOverrides);
  return { positive, negative, all: includeNegative ? [...positive, ...negative] : positive };
}

function selectBest(candidates = []) {
  if (!candidates.length) return { chosen: null, alternatives: [] };
  const sorted = [...candidates].sort((a, b) => scoreFinding(b) - scoreFinding(a));
  return { chosen: sorted[0], alternatives: sorted.slice(1) };
}

export function listReports() {
  return BUILTIN_REPORTS.map((r) => ({
    id: r.id,
    accession: r.accession,
    modality: r.modality,
    title: r.title,
    findingCount: listFindings(r.accession).length,
    negativeFindingCount: listNegativeFindings(r.accession).length
  }));
}

export function getReport(accession) {
  const base = findBaseReport(accession);
  if (!base) return null;
  const buckets = getBuckets(base.accession);
  const findings = listFindings(base.accession);
  const negativeFindings = listNegativeFindings(base.accession);
  return {
    ...clone(base),
    findings,
    negativeFindings,
    parserMeta: clone(buckets.parserMeta || null),
    parsedFindingsCount: Array.isArray(buckets.parsed) ? buckets.parsed.length : 0,
    parsedNegativeFindingsCount: Array.isArray(buckets.parsedNegative) ? buckets.parsedNegative.length : 0
  };
}

export function getReportText(accession) {
  const report = getReport(accession);
  return report ? String(report.reportText || '') : '';
}

export function listFindings(accession) {
  return clone(materializeFindings(accession).positive);
}

export function listNegativeFindings(accession) {
  return clone(materializeFindings(accession).negative);
}

export function getBestFinding(selector = {}) {
  const accession = String(selector.accession || '').trim();
  if (!accession) return { ok: false, unavailable: true, reason: 'accession_required' };
  const includeNegative = !!selector.includeNegative;
  const store = materializeFindings(accession, { includeNegative });
  let findings = includeNegative ? store.all : store.positive;
  const sourcePref = norm(selector.findingSource || selector.source).toLowerCase();
  if (sourcePref === 'seeded' || sourcePref === 'parsed' || sourcePref === 'user' || sourcePref === 'agent') {
    findings = findings.filter((f) => String(f?.source || '').toLowerCase() === sourcePref);
  }
  if (!findings.length) return { ok: false, unavailable: true, reason: 'report_or_findings_unavailable' };

  const findBy = [];
  const id = norm(selector.findingId);
  if (id) findBy.push((f) => norm(f.id) === id);

  const labelNeedle = norm(selector.labelIncludes || selector.labelContains || selector.label).toLowerCase();
  const textNeedle = norm(selector.textIncludes || selector.textContains || selector.text).toLowerCase();
  if (labelNeedle || textNeedle) {
    findBy.push((f) => {
      const label = norm(f.label).toLowerCase();
      const desc = norm(f.description).toLowerCase();
      const raw = norm(f.rawText).toLowerCase();
      return (labelNeedle && (label.includes(labelNeedle) || desc.includes(labelNeedle) || raw.includes(labelNeedle)))
        || (textNeedle && (label.includes(textNeedle) || desc.includes(textNeedle) || raw.includes(textNeedle)));
    });
  }

  const seriesNumber = asFinite(selector.seriesNumber);
  const imageNumber = asFinite(selector.imageNumber);
  if (seriesNumber != null || imageNumber != null) {
    findBy.push((f) => {
      const s = asFinite(f.seriesNumber);
      const i = asFinite(f.imageNumber);
      if (seriesNumber != null && imageNumber != null) return s === seriesNumber && i === imageNumber;
      if (seriesNumber != null) return s === seriesNumber;
      return i === imageNumber;
    });
  }

  let matches = [];
  let reason = '';
  for (const matcher of findBy) {
    matches = findings.filter(matcher);
    if (matches.length) {
      reason = 'match';
      break;
    }
  }
  if (!matches.length) {
    return { ok: false, unavailable: true, reason: 'finding_not_resolved' };
  }

  const { chosen, alternatives } = selectBest(matches);
  return {
    ok: true,
    finding: chosen,
    alternatives,
    reason: reason || 'best_source_confidence',
    selectionRule: 'user>agent>parsed>seeded_then_confidence'
  };
}

export function getFinding({ accession, findingId } = {}) {
  const result = getBestFinding({ accession, findingId });
  return result?.ok ? result.finding : null;
}

export function upsertReportFindings(accession, findings = [], parserMeta = null, sourceHint = 'parsed') {
  const base = findBaseReport(accession);
  if (!base) return { ok: false, unavailable: true, reason: 'report_not_found' };
  const normalizedAll = Array.isArray(findings)
    ? findings
        .map((f) => normalizeFinding(base.accession, f, sourceHint))
        .filter((f) => !!f.id && !!f.label)
    : [];
  const normalizedNegativeInput = Array.isArray(parserMeta?.negativeFindings)
    ? parserMeta.negativeFindings
        .map((f) => normalizeFinding(base.accession, f, sourceHint))
        .filter((f) => !!f.id && !!f.label)
    : [];
  const split = splitPositiveAndNegative(normalizedAll);
  const normalized = split.positive;
  const normalizedNegative = [...split.negative, ...normalizedNegativeInput];
  const buckets = getBuckets(base.accession);
  const src = normalizeSource(sourceHint, 'parsed');
  if (src === 'user') {
    buckets.user = normalized;
    buckets.userNegative = normalizedNegative;
  } else if (src === 'agent') {
    buckets.agent = normalized;
    buckets.agentNegative = normalizedNegative;
  } else {
    buckets.parsed = normalized;
    buckets.parsedNegative = normalizedNegative;
  }
  if (parserMeta) buckets.parserMeta = parserMeta;
  return {
    ok: true,
    accession: base.accession,
    source: src,
    findingsCount: normalized.length,
    negativeFindingsCount: normalizedNegative.length
  };
}

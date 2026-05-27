import assert from 'node:assert/strict';
import { resolveStudyForFinding } from '../studyResolver.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CT_HEAD = {
  accession: 'NI9f7ff9',
  studyInstanceUID: '1.2.3.4.5',
  modality: 'CT',
  studyDescription: 'CT Head without contrast',
  studyDate: '20260101'
};

const MR_KNEE = {
  accession: '3852755662087132',
  studyInstanceUID: '9.8.7.6.5',
  modality: 'MR',
  studyDescription: 'MR Knee with and without contrast',
  studyDate: '20260201'
};

const XR_CHEST = {
  accession: 'CXR-88997',
  studyInstanceUID: '2.2.2.2.2',
  modality: 'CR',
  studyDescription: 'XR Chest PA and Lateral',
  studyDate: '20260115'
};

const OLDER_CT = {
  accession: 'OLD-CT-001',
  studyInstanceUID: '3.3.3.3.3',
  modality: 'CT',
  studyDescription: 'CT Chest',
  studyDate: '20250601'
};

const MIXED_STUDIES = [CT_HEAD, MR_KNEE, XR_CHEST];

// ── T1: no studies → ok:false ─────────────────────────────────────────────────

{
  const r = resolveStudyForFinding({ studies: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_studies_provided');
  assert.deepEqual(r.candidates, []);
}

{
  const r = resolveStudyForFinding({ studies: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_studies_provided');
}

// ── T2: exact accession match from finding ────────────────────────────────────

{
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: { accession: 'NI9f7ff9', seriesNumber: 2, imageNumber: 21 }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'exact');
  assert.equal(r.reason, 'accession_match');
  assert.equal(r.accession, 'NI9f7ff9');
  assert.equal(r.studyInstanceUID, '1.2.3.4.5');
}

// ── T3: exact accession match from report ─────────────────────────────────────

{
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: {},
    report: { accession: '3852755662087132' }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'exact');
  assert.equal(r.accession, '3852755662087132');
}

// ── T4: exact accession match from report.document ───────────────────────────

{
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: {},
    report: { document: { accession: 'CXR-88997' } }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'exact');
  assert.equal(r.accession, 'CXR-88997');
}

// ── T5: accession case-insensitive match ──────────────────────────────────────

{
  const r = resolveStudyForFinding({
    studies: [{ accession: 'ABC-123', modality: 'CT' }],
    finding: { accession: 'abc-123' }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'exact');
}

// ── T6: exact studyInstanceUID match ─────────────────────────────────────────

{
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: { studyInstanceUID: '9.8.7.6.5' }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'exact');
  assert.equal(r.reason, 'study_uid_match');
  assert.equal(r.accession, '3852755662087132');
}

// ── T7: accession takes precedence over studyInstanceUID ─────────────────────

{
  // accession points to CT_HEAD, UID points to MR_KNEE — accession wins
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: { accession: 'NI9f7ff9', studyInstanceUID: '9.8.7.6.5' }
  });
  assert.equal(r.confidence, 'exact');
  assert.equal(r.reason, 'accession_match');
  assert.equal(r.accession, 'NI9f7ff9');
}

// ── T8: modality match — single result → confidence:'high' ───────────────────

{
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: { modality: 'MR' }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'high');
  assert.equal(r.reason, 'modality_match');
  assert.equal(r.accession, '3852755662087132');
}

// ── T9: modality from report ──────────────────────────────────────────────────

{
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: {},
    report: { modality: 'CR' }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'high');
  assert.equal(r.accession, 'CXR-88997');
}

// ── T10: modality match narrows candidates → description differentiates ────────
// Two CT studies; description keyword "head" picks the right one.

{
  const studies = [CT_HEAD, OLDER_CT];
  const r = resolveStudyForFinding({
    studies,
    finding: { modality: 'CT', label: 'caudate infarct', description: 'head' }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'medium');
  assert.equal(r.reason, 'description_match');
  assert.equal(r.accession, 'NI9f7ff9');
}

// ── T11: description keyword match without modality filter ────────────────────

{
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: { label: 'medial meniscus tear', description: 'knee' }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'medium');
  assert.equal(r.reason, 'description_match');
  assert.equal(r.accession, '3852755662087132');
}

// ── T12: description match from report title ──────────────────────────────────

{
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: {},
    report: { title: 'CT Head without contrast', modality: 'CT' }
  });
  // modality CT → CT_HEAD (only one CT in MIXED_STUDIES)
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'high');
  assert.equal(r.accession, 'NI9f7ff9');
}

// ── T13: recent fallback — no modality/description, use most recent date ──────

{
  const older = { accession: 'OLD', modality: 'CT', studyDate: '20230101' };
  const newer = { accession: 'NEW', modality: 'CT', studyDate: '20260301' };
  const r = resolveStudyForFinding({
    studies: [older, newer],
    finding: {}    // no accession, no uid, no modality, no keywords
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'low');
  assert.equal(r.reason, 'recent_fallback');
  assert.equal(r.accession, 'NEW');
}

// ── T14: recent fallback handles DICOM date format (YYYYMMDD) ────────────────

{
  const studies = [
    { accession: 'A', studyDate: '20240601' },
    { accession: 'B', studyDate: '20260601' },
    { accession: 'C', studyDate: '20250601' }
  ];
  const r = resolveStudyForFinding({ studies, finding: {} });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'low');
  assert.equal(r.accession, 'B', 'most recent YYYYMMDD date should win');
}

// ── T15: recent fallback handles ISO date string ──────────────────────────────

{
  const studies = [
    { accession: 'X', studyDate: '2024-01-15' },
    { accession: 'Y', studyDate: '2026-03-20' }
  ];
  const r = resolveStudyForFinding({ studies, finding: {} });
  assert.equal(r.accession, 'Y');
}

// ── T16: ambiguous — multiple studies, no dates, no differentiator → ok:false ─

{
  const studies = [
    { accession: 'P', modality: 'CT' },
    { accession: 'Q', modality: 'CT' }
  ];
  // no accession, no uid in finding; modality narrows to both CTs; no keywords; no dates
  const r = resolveStudyForFinding({ studies, finding: { modality: 'CT' } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ambiguous');
  assert.ok(Array.isArray(r.candidates));
  assert.equal(r.candidates.length, 2, 'both CT studies should be returned as candidates');
}

// ── T17: ambiguous — no context at all → ok:false ────────────────────────────

{
  const studies = [
    { accession: 'X' },
    { accession: 'Y' }
  ];
  const r = resolveStudyForFinding({ studies, finding: {}, report: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ambiguous');
}

// ── T18: single study, no context → recent_fallback with date OR ambiguous ────

{
  // Single study with date → fallback succeeds
  const r1 = resolveStudyForFinding({
    studies: [{ accession: 'ONLY', studyDate: '20260101' }],
    finding: {}
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.confidence, 'low');
  assert.equal(r1.accession, 'ONLY');

  // Single study without date → ambiguous (no date to sort by, no other context)
  const r2 = resolveStudyForFinding({
    studies: [{ accession: 'NODATESTUDEY' }],
    finding: {}
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'ambiguous');
}

// ── T19: modality unmatched → falls through to description ───────────────────

{
  // Finding says PET, but no PET studies — skip modality filter, continue
  const r = resolveStudyForFinding({
    studies: MIXED_STUDIES,
    finding: { modality: 'PT', label: 'chest' }
  });
  // No modality match, keyword 'chest' matches XR_CHEST description
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'description_match');
  assert.equal(r.accession, 'CXR-88997');
}

// ── T20: patient parameter is accepted (no-op for now) ───────────────────────

{
  const r = resolveStudyForFinding({
    patient: { patientId: '12345', name: 'Test Patient' },
    studies: [CT_HEAD],
    finding: { accession: 'NI9f7ff9' }
  });
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'exact');
}

console.log('studyResolver: all tests passed');

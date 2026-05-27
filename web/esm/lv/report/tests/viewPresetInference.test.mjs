import assert from 'node:assert/strict';
import { inferViewPreset, CT_WL_PRESETS } from '../viewPresetInference.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CT_HEAD  = { modality: 'CT', seriesDescription: 'CT Head Axial' };
const CT_CHEST = { modality: 'CT', seriesDescription: 'Axial CT Chest' };
const CT_ABD   = { modality: 'CT', seriesDescription: 'Axial CT Abdomen Pelvis' };
const CT_LIVER = { modality: 'CT', seriesDescription: 'Liver Protocol Arterial' };
const MR_BRAIN = { modality: 'MR', seriesDescription: 'Axial T2 Brain' };

// ── T1: MR → type:none, reason:mr_not_supported ───────────────────────────────

{
  const r = inferViewPreset({ finding: { label: 'Meniscal tear', modality: 'MR' }, seriesEntry: MR_BRAIN });
  assert.equal(r.type, 'none');
  assert.equal(r.reason, 'mr_not_supported');
}

// ── T2: MR modality from seriesEntry (no finding modality) → none ─────────────

{
  const r = inferViewPreset({ finding: { label: 'Brain mass' }, seriesEntry: MR_BRAIN });
  assert.equal(r.type, 'none');
  assert.equal(r.reason, 'mr_not_supported');
}

// ── T3: MR from series description (no explicit modality field) → none ─────────

{
  const r = inferViewPreset({ finding: { label: 'ACL tear' }, seriesEntry: { seriesDescription: 'Sagittal MRI Knee' } });
  assert.equal(r.type, 'none');
  assert.equal(r.reason, 'mr_not_supported');
}

// ── T4: Non-CT modality (PET) → type:none, non_ct_modality ───────────────────

{
  const r = inferViewPreset({ finding: { label: 'Uptake', modality: 'PT' } });
  assert.equal(r.type, 'none');
  assert.equal(r.reason, 'non_ct_modality');
}

// ── T5: head context + hemorrhage → brain_hemorrhage, high ───────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Subdural hematoma', anatomy: 'head', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.type, 'ct-window');
  assert.equal(r.preset, 'brain_hemorrhage');
  assert.equal(r.confidence, 'high');
}

// ── T6: head context + explicit hemorrhage term in label → brain_hemorrhage ───

{
  const r = inferViewPreset({
    finding: { label: 'Acute intracranial hemorrhage', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain_hemorrhage');
  assert.equal(r.confidence, 'high');
}

// ── T7: head context + SAH abbreviation → brain_hemorrhage ───────────────────

{
  const r = inferViewPreset({
    finding: { label: 'SAH at basal cisterns', anatomy: 'brain', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain_hemorrhage');
  assert.equal(r.confidence, 'high');
}

// ── T8: head context + SDH abbreviation → brain_hemorrhage ───────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Right SDH', anatomy: 'head', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain_hemorrhage');
  assert.equal(r.confidence, 'high');
}

// ── T9: head context + EDH abbreviation → brain_hemorrhage ───────────────────

{
  const r = inferViewPreset({
    finding: { label: 'EDH left temporal', anatomy: 'skull', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain_hemorrhage');
  assert.equal(r.confidence, 'high');
}

// ── T10: head context + stroke/infarct → brain_stroke, high ──────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Acute ischemic infarct left MCA territory', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain_stroke');
  assert.equal(r.confidence, 'high');
}

// ── T11: head context + stroke keyword → brain_stroke ────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Embolic stroke pattern', anatomy: 'brain', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain_stroke');
  assert.equal(r.confidence, 'high');
}

// ── T12: head context + ischemia → brain_stroke ──────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Ischemia posterior territory', anatomy: 'brain', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain_stroke');
  assert.equal(r.confidence, 'high');
}

// ── T13: head context + fracture → bone, high ────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Vertex skull fracture', anatomy: 'head', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'bone');
  assert.equal(r.confidence, 'high');
}

// ── T14: head context + osseous → bone ───────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Osseous calvarium defect', anatomy: 'skull', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'bone');
  assert.equal(r.confidence, 'high');
}

// ── T15: head context only → brain, medium ───────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Cortical atrophy', anatomy: 'brain', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain');
  assert.equal(r.confidence, 'medium');
}

// ── T16: head context from series description → brain, medium ─────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Hypodensity', modality: 'CT' },
    seriesEntry: { modality: 'CT', seriesDescription: 'CT Head Axial' }
  });
  assert.equal(r.preset, 'brain');
  assert.equal(r.confidence, 'medium');
}

// ── T17: lung/pulmonary → lung, high ─────────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Pulmonary nodule right upper lobe', modality: 'CT' },
    seriesEntry: CT_CHEST
  });
  assert.equal(r.preset, 'lung');
  assert.equal(r.confidence, 'high');
}

// ── T18: emphysema → lung ────────────────────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Centrilobular emphysema bilateral', modality: 'CT' },
    seriesEntry: CT_CHEST
  });
  assert.equal(r.preset, 'lung');
  assert.equal(r.confidence, 'high');
}

// ── T19: pleural finding → lung ───────────────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Small pleural effusion', modality: 'CT' },
    seriesEntry: CT_CHEST
  });
  assert.equal(r.preset, 'lung');
  assert.equal(r.confidence, 'high');
}

// ── T20: liver/hepatic → liver, high ─────────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Hepatic lesion segment IV', anatomy: 'liver', modality: 'CT' },
    seriesEntry: CT_LIVER
  });
  assert.equal(r.preset, 'liver');
  assert.equal(r.confidence, 'high');
}

// ── T21: liver term in anatomy only → liver ──────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Focal lesion', anatomy: 'liver', modality: 'CT' },
    seriesEntry: CT_ABD
  });
  assert.equal(r.preset, 'liver');
  assert.equal(r.confidence, 'high');
}

// ── T22: fracture body (non-head) → bone, high ───────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Rib fracture posterior right', modality: 'CT' },
    seriesEntry: CT_CHEST
  });
  assert.equal(r.preset, 'bone');
  assert.equal(r.confidence, 'high');
}

// ── T23: osseous body → bone ─────────────────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Osseous metastasis T8', modality: 'CT' },
    seriesEntry: CT_ABD
  });
  assert.equal(r.preset, 'bone');
  assert.equal(r.confidence, 'high');
}

// ── T24: abdomen finding → soft_tissue, medium ───────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Abdominal lymphadenopathy', modality: 'CT' },
    seriesEntry: CT_ABD
  });
  assert.equal(r.preset, 'soft_tissue');
  assert.equal(r.confidence, 'medium');
}

// ── T25: pelvis finding → soft_tissue ────────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Pelvic mass', anatomy: 'pelvis', modality: 'CT' },
    seriesEntry: CT_ABD
  });
  assert.equal(r.preset, 'soft_tissue');
  assert.equal(r.confidence, 'medium');
}

// ── T26: 'mass' keyword → soft_tissue ────────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Retroperitoneal mass', modality: 'CT' },
    seriesEntry: CT_ABD
  });
  assert.equal(r.preset, 'soft_tissue');
  assert.equal(r.confidence, 'medium');
}

// ── T27: no keyword match → reset, low ───────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Incidental finding', modality: 'CT' },
    seriesEntry: { modality: 'CT', seriesDescription: 'Axial CT' }
  });
  assert.equal(r.preset, 'reset');
  assert.equal(r.confidence, 'low');
  assert.equal(r.reason, 'no_keyword_match');
}

// ── T28: no seriesEntry, CT from finding modality → infers ────────────────────

{
  const r = inferViewPreset({ finding: { label: 'Lung nodule', modality: 'CT' } });
  assert.equal(r.type, 'ct-window');
  assert.equal(r.preset, 'lung');
}

// ── T29: unknown modality (no fields) → attempts CT inference ────────────────

{
  const r = inferViewPreset({ finding: { label: 'Pulmonary nodule' } });
  assert.equal(r.type, 'ct-window');
  assert.equal(r.preset, 'lung');
}

// ── T30: no args → graceful (no crash) ────────────────────────────────────────

{
  const r = inferViewPreset();
  assert.equal(r.type, 'ct-window');
  assert.equal(r.preset, 'reset');
}

// ── T31: report title contributes context ────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Hypodensity', modality: 'CT' },
    seriesEntry: { modality: 'CT', seriesDescription: 'Axial CT' },
    report: { title: 'CT Head Non-Contrast' }
  });
  assert.equal(r.preset, 'brain');
  assert.equal(r.confidence, 'medium');
}

// ── T32: hemorrhage priority > stroke within head context ─────────────────────

{
  // finding mentions both hemorrhage AND infarct — hemorrhage wins (higher priority)
  const r = inferViewPreset({
    finding: { label: 'Hemorrhagic transformation of infarct', anatomy: 'brain', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.equal(r.preset, 'brain_hemorrhage', 'hemorrhage should take priority over stroke');
}

// ── T33: CT_WL_PRESETS exports all expected presets ──────────────────────────

{
  const expected = ['soft_tissue', 'lung', 'liver', 'bone', 'brain', 'brain_hemorrhage', 'brain_stroke', 'reset'];
  assert.deepEqual([...CT_WL_PRESETS], expected);
}

// ── T34: series description 'CT' detection without explicit modality field ─────

{
  const r = inferViewPreset({
    finding: { label: 'Liver lesion' },
    seriesEntry: { seriesDescription: 'CT Liver Protocol' }
  });
  assert.equal(r.type, 'ct-window');
  assert.equal(r.preset, 'liver');
}

// ── T35: result has all required fields ──────────────────────────────────────

{
  const r = inferViewPreset({
    finding: { label: 'Intracranial hemorrhage', modality: 'CT' },
    seriesEntry: CT_HEAD
  });
  assert.ok('type' in r);
  assert.ok('preset' in r);
  assert.ok('confidence' in r);
  assert.ok('reason' in r);
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
}

console.log('viewPresetInference: all tests passed');

import assert from 'node:assert/strict';
import { inferImageReference } from '../inferredImageReference.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Typical CT abdomen/chest series catalog
const CT_CATALOG = [
  { seriesNumber: 1,  seriesDescription: 'Axial CT Chest',         modality: 'CT', numInstances: 80  },
  { seriesNumber: 2,  seriesDescription: 'Coronal CT Chest',        modality: 'CT', numInstances: 60  },
  { seriesNumber: 3,  seriesDescription: 'Axial CT Abdomen Pelvis', modality: 'CT', numInstances: 120 },
  { seriesNumber: 4,  seriesDescription: 'Liver Protocol Arterial', modality: 'CT', numInstances: 80  },
  { seriesNumber: 5,  seriesDescription: 'Liver Protocol Portal',   modality: 'CT', numInstances: 80  },
  { seriesNumber: 6,  seriesDescription: 'CT Head Axial',           modality: 'CT', numInstances: 35  },
  { seriesNumber: 7,  seriesDescription: 'Bone Window Head',        modality: 'CT', numInstances: 35  }
];

// MR knee catalog
const MR_CATALOG = [
  { seriesNumber: 1, seriesDescription: 'Axial T2 Knee',       modality: 'MR', numInstances: 20 },
  { seriesNumber: 2, seriesDescription: 'Sagittal PD FS Knee', modality: 'MR', numInstances: 22 },
  { seriesNumber: 3, seriesDescription: 'Coronal STIR Knee',   modality: 'MR', numInstances: 18 },
  { seriesNumber: 4, seriesDescription: 'Sagittal T1 Knee',    modality: 'MR', numInstances: 22 }
];

// Mixed modality catalog
const MIXED_CATALOG = [
  { seriesNumber: 1, seriesDescription: 'CT Head',    modality: 'CT', numInstances: 35 },
  { seriesNumber: 2, seriesDescription: 'MR Brain',   modality: 'MR', numInstances: 50 },
  { seriesNumber: 3, seriesDescription: 'CT Chest',   modality: 'CT', numInstances: 80 }
];

// ── T1: explicit imageReference — returned unchanged ──────────────────────────

{
  const finding = {
    id: 'f1', navigationStatus: 'navigable',
    imageReference: { type: 'series-image', seriesNumber: 3, imageNumber: 14 }
  };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'explicit');
  assert.equal(result.reason, 'explicit_series_image');
  assert.equal(result.imageReference.seriesNumber, 3);
  assert.equal(result.imageReference.imageNumber, 14);
}

// ── T2: explicit flat seriesNumber + imageNumber ──────────────────────────────

{
  const finding = { id: 'f2', navigationStatus: 'navigable', seriesNumber: 2, imageNumber: 21 };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'explicit');
  assert.equal(result.reason, 'explicit_series_image');
  assert.equal(result.imageReference.seriesNumber, 2);
  assert.equal(result.imageReference.imageNumber, 21);
}

// ── T3: explicit series_only (seriesNumber but no imageNumber) ────────────────

{
  const finding = { id: 'f3', navigationStatus: 'series_only', seriesNumber: 4, imageNumber: null };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'explicit');
  assert.equal(result.reason, 'explicit_series_only');
  assert.equal(result.imageReference.seriesNumber, 4);
  assert.equal(result.imageReference.imageNumber, null);
}

// ── T4: negative finding → ok:false, finding_not_navigable ───────────────────

{
  const finding = { id: 'neg', navigationStatus: 'negative', seriesNumber: null, imageNumber: null };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'finding_not_navigable');
}

// ── T5: non_navigable finding → ok:false, finding_not_navigable ──────────────

{
  const finding = { id: 'non', navigationStatus: 'non_navigable', seriesNumber: null, imageNumber: null };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'finding_not_navigable');
}

// ── T6: empty series catalog → ok:false, no_series_catalog ───────────────────

{
  const finding = { id: 'f6', label: 'Liver lesion', anatomy: 'liver' };
  const result = inferImageReference({ finding, seriesCatalog: [] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_series_catalog');
}

// ── T7: null/missing catalog → ok:false, no_series_catalog ───────────────────

{
  const finding = { id: 'f7', anatomy: 'liver' };
  const r1 = inferImageReference({ finding, seriesCatalog: null });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'no_series_catalog');
  const r2 = inferImageReference({ finding });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'no_series_catalog');
}

// ── T8: finding with no useful keywords → ok:false, no_keywords ──────────────

{
  const finding = { id: 'f8', label: '', anatomy: null, description: null };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_keywords');
}

// ── T9: liver finding ambiguous — two Liver Protocol series score equally ──────

{
  const finding = { id: 'f9', label: 'Liver lesion', anatomy: 'liver', modality: 'CT' };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  // 'liver' scores 1 for series 4 ("Liver Protocol Arterial") AND series 5 ("Liver Protocol Portal")
  assert.equal(result.ok, false, 'two equally-scoring liver series should be ambiguous');
  assert.equal(result.reason, 'ambiguous');
}

// ── T9b: liver finding with unique discriminator picks one series ─────────────

{
  const finding = { id: 'f9b', label: 'Liver arterial phase enhancement', anatomy: 'liver arterial' };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'inferred');
  assert.equal(result.imageReference.seriesNumber, 4, '"arterial" should pick Liver Protocol Arterial');
  assert.equal(result.imageReference.imageNumber, null, 'imageNumber should not be inferred');
}

// ── T10: chest finding ambiguous — axial and coronal both match ───────────────

{
  const finding = { id: 'f10', anatomy: 'lung', label: 'Pulmonary nodule', description: 'right upper lobe chest' };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  // 'chest' matches series 1 ("Axial CT Chest") AND series 2 ("Coronal CT Chest") equally
  // 'lung' doesn't appear in any series description → no further discrimination
  assert.equal(result.ok, false, 'chest axial and coronal both match — should be ambiguous');
  assert.equal(result.reason, 'ambiguous');
}

// ── T10b: head finding ambiguous — CT Head and Bone Window both match ─────────

{
  const finding = { id: 'f10b', anatomy: 'head', label: 'Subdural collection', modality: 'CT' };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  // 'head' appears in series 6 ("CT Head Axial") and series 7 ("Bone Window Head")
  assert.equal(result.ok, false, 'head appears in two series — should be ambiguous');
  assert.equal(result.reason, 'ambiguous');
}

// ── T10c: single unambiguous match ───────────────────────────────────────────

{
  // "Portal" uniquely identifies one series
  const finding = { id: 'f10c', label: 'Portal venous phase liver', anatomy: 'portal liver' };
  const result = inferImageReference({ finding, seriesCatalog: CT_CATALOG });
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'inferred');
  assert.equal(result.imageReference.seriesNumber, 5, '"portal" uniquely matches Liver Protocol Portal');
}

// ── T11: modality filter narrows candidates before scoring ────────────────────

{
  const finding = { id: 'f11', label: 'Brain lesion', anatomy: 'brain', modality: 'MR' };
  const result = inferImageReference({ finding, seriesCatalog: MIXED_CATALOG });
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'inferred');
  assert.equal(result.imageReference.seriesNumber, 2, 'modality MR + brain → MR Brain series');
}

// ── T12: modality unmatched → falls back to all candidates ───────────────────

{
  // Finding says PET but no PET series → soft fallback to keyword-only
  const catalog = [
    { seriesNumber: 1, seriesDescription: 'Axial CT Abdomen', modality: 'CT', numInstances: 100 }
  ];
  const finding = { id: 'f12', label: 'Abdomen lesion', anatomy: 'abdomen', modality: 'PT' };
  const result = inferImageReference({ finding, seriesCatalog: catalog });
  // modality PT has no match → falls back to all
  // 'abdomen' matches series 1 uniquely → ok
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'inferred');
  assert.equal(result.imageReference.seriesNumber, 1);
}

// ── T13: report title contributes keywords ────────────────────────────────────

{
  // Finding has no anatomy, but report title contains discriminating word
  const catalog = [
    { seriesNumber: 1, seriesDescription: 'Axial T2 Knee', modality: 'MR', numInstances: 20 },
    { seriesNumber: 2, seriesDescription: 'Sagittal PD FS', modality: 'MR', numInstances: 22 }
  ];
  const finding = { id: 'f13', label: 'Meniscal tear', modality: 'MR' };
  const report  = { title: 'MR Knee Left' };
  const result  = inferImageReference({ finding, seriesCatalog: catalog, report });
  // report title adds 'knee' → matches series 1 uniquely ('knee' not in series 2)
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'inferred');
  assert.equal(result.imageReference.seriesNumber, 1);
}

// ── T14: report document title contributes keywords ───────────────────────────

{
  const catalog = [
    { seriesNumber: 1, seriesDescription: 'Axial T2 Knee', modality: 'MR', numInstances: 20 },
    { seriesNumber: 2, seriesDescription: 'Sagittal PD',   modality: 'MR', numInstances: 22 }
  ];
  const finding = { id: 'f14', label: 'Meniscal tear', modality: 'MR' };
  const report  = { document: { title: 'MR Right Knee' } };
  const result  = inferImageReference({ finding, seriesCatalog: catalog, report });
  assert.equal(result.ok, true);
  assert.equal(result.imageReference.seriesNumber, 1);
}

// ── T15: no match (keywords don't appear in any series) → no_match ────────────

{
  const finding = { id: 'f15', label: 'Ankle sprain', anatomy: 'ankle', modality: 'MR' };
  const result  = inferImageReference({ finding, seriesCatalog: MR_CATALOG });
  // MR catalog has only knee series — 'ankle' matches nothing
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_match');
}

// ── T16: ambiguous — two series score equally → ok:false ─────────────────────

{
  const catalog = [
    { seriesNumber: 1, seriesDescription: 'Knee Axial T2',   modality: 'MR', numInstances: 20 },
    { seriesNumber: 2, seriesDescription: 'Knee Sagittal T1', modality: 'MR', numInstances: 22 }
  ];
  const finding = { id: 'f16', label: 'Meniscal tear', anatomy: 'knee' };
  const result  = inferImageReference({ finding, seriesCatalog: catalog });
  // 'knee' scores 1 for both → tie → ambiguous
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ambiguous');
}

// ── T17: single-entry catalog with matching keyword → ok ─────────────────────

{
  const catalog = [{ seriesNumber: 1, seriesDescription: 'CT Liver', modality: 'CT', numInstances: 80 }];
  const finding = { id: 'f17', anatomy: 'liver', modality: 'CT' };
  const result  = inferImageReference({ finding, seriesCatalog: catalog });
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'inferred');
  assert.equal(result.imageReference.seriesNumber, 1);
  assert.equal(result.imageReference.imageNumber, null);
}

// ── T18: inferred imageReference is frozen ────────────────────────────────────

{
  const catalog = [{ seriesNumber: 1, seriesDescription: 'CT Liver', modality: 'CT', numInstances: 80 }];
  const finding = { id: 'f18', anatomy: 'liver', modality: 'CT' };
  const result  = inferImageReference({ finding, seriesCatalog: catalog });
  assert.ok(Object.isFrozen(result.imageReference), 'inferred imageReference should be frozen');
}

// ── T19: no finding → ok:false gracefully ────────────────────────────────────

{
  const r1 = inferImageReference({});
  assert.equal(r1.ok, false);
  const r2 = inferImageReference();
  assert.equal(r2.ok, false);
}

// ── T20: MR knee STIR uniquely matched by 'stir' keyword ─────────────────────

{
  const finding = { id: 'f20', label: 'Bone marrow edema STIR', description: 'stir sequence', modality: 'MR' };
  const result  = inferImageReference({ finding, seriesCatalog: MR_CATALOG });
  assert.equal(result.ok, true);
  assert.equal(result.imageReference.seriesNumber, 3, 'STIR keyword uniquely matches series 3');
}

console.log('inferredImageReference: all tests passed');

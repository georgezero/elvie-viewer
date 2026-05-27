// Demo report data with verbatim PACS-style radiology report text.
// rawText values in findingSpanHints must appear verbatim in reportText
// so that computeSpans can locate them via indexOf.

export const DEMO_REPORTS = [
  {
    accession: 'NI9f7ff9',
    modality: 'CT',
    title: 'CT Head Without Contrast',
    reportText: `EXAM: CT HEAD WITHOUT CONTRAST
ACCESSION: NI9f7ff9

CLINICAL HISTORY: Altered mental status.

TECHNIQUE: Axial CT images of the brain were obtained without intravenous contrast. Coronal and sagittal reformats were generated.

COMPARISON: Prior CT head from 12 months ago.

FINDINGS:

Brain parenchyma: Chronic infarct involving left caudate head (Series 2, Image 21). No new acute cortical or subcortical infarcts. No mass effect in this region.

Calvarium/Skull: Healed fracture near left vertex (Series 2, Image 36). No acute calvarial fracture. No depressed or comminuted fragments.

Extra-axial spaces: No subdural, epidural, or subarachnoid hemorrhage.

Ventricles/Cisterns: Ventricles are normal in size and configuration. Basal cisterns are patent. No hydrocephalus.

Additional: No acute intracranial hemorrhage. No mass or mass-effect lesion identified. No midline shift.

Paranasal sinuses/Mastoids: Paranasal sinuses and mastoid air cells are grossly clear.

IMPRESSION:
1. Chronic left caudate infarct, stable in appearance compared to prior study.
2. Healed left vertex fracture without acute injury.
3. No acute intracranial hemorrhage or other acute intracranial abnormality.`,
    sections: [
      { label: 'EXAM', startKeyword: 'EXAM:' },
      { label: 'CLINICAL HISTORY', startKeyword: 'CLINICAL HISTORY:' },
      { label: 'TECHNIQUE', startKeyword: 'TECHNIQUE:' },
      { label: 'COMPARISON', startKeyword: 'COMPARISON:' },
      { label: 'FINDINGS', startKeyword: 'FINDINGS:' },
      { label: 'IMPRESSION', startKeyword: 'IMPRESSION:' }
    ],
    findingSpanHints: [
      {
        findingId: 'chronic-left-caudate-infarct',
        rawText: 'Chronic infarct involving left caudate head (Series 2, Image 21).'
      },
      {
        findingId: 'healed-left-vertex-fracture',
        rawText: 'Healed fracture near left vertex (Series 2, Image 36).'
      },
      {
        findingId: 'no-acute-intracranial-hemorrhage',
        rawText: 'No acute intracranial hemorrhage.'
      }
    ]
  },
  {
    accession: '3852755662087132',
    modality: 'MR',
    title: 'MRI Left Knee Without Contrast',
    reportText: `EXAM: MRI LEFT KNEE WITHOUT CONTRAST
ACCESSION: 3852755662087132

CLINICAL HISTORY: Left knee pain and swelling. Rule out meniscal pathology.

TECHNIQUE: Multiplanar MRI of the left knee at 1.5T without intravenous contrast. Sequences: sagittal PD fat-sat, sagittal T2, coronal PD fat-sat, coronal T1, axial PD fat-sat.

COMPARISON: None.

FINDINGS:

Medial meniscus: Medial meniscus tear (Series 6, Image 23). The posterior horn demonstrates increased signal on T2-weighted sequences consistent with a horizontal tear pattern. No displaced meniscal fragment identified.

Lateral meniscus: Intact. No tear or signal abnormality.

Ligaments: ACL is intact with normal signal and course. PCL is intact. Medial and lateral collateral ligaments are intact.

Joint fluid: Joint effusion (Series 3, Image 14). Moderate joint effusion within the suprapatellar bursa and joint space. No loose bodies.

Articular cartilage: Mild chondromalacia patella grade 1. Tibial and femoral articular cartilage is grossly intact.

Bone: No acute fracture. No bone marrow edema. No subchondral cysts.

IMPRESSION:
1. Medial meniscal tear, posterior horn, horizontal pattern.
2. Moderate joint effusion.
3. No acute fracture. ACL intact.`,
    sections: [
      { label: 'EXAM', startKeyword: 'EXAM:' },
      { label: 'CLINICAL HISTORY', startKeyword: 'CLINICAL HISTORY:' },
      { label: 'TECHNIQUE', startKeyword: 'TECHNIQUE:' },
      { label: 'COMPARISON', startKeyword: 'COMPARISON:' },
      { label: 'FINDINGS', startKeyword: 'FINDINGS:' },
      { label: 'IMPRESSION', startKeyword: 'IMPRESSION:' }
    ],
    findingSpanHints: [
      {
        findingId: 'medial-meniscus-tear',
        rawText: 'Medial meniscus tear (Series 6, Image 23).'
      },
      {
        findingId: 'joint-effusion',
        rawText: 'Joint effusion (Series 3, Image 14).'
      },
      {
        findingId: 'no-acute-knee-fracture',
        rawText: 'No acute fracture.'
      }
    ]
  },
  {
    accession: 'CXR-88997',
    modality: 'XR',
    title: 'Chest Radiograph PA and Lateral',
    reportText: `EXAM: CHEST RADIOGRAPH PA AND LATERAL
ACCESSION: CXR-88997

CLINICAL HISTORY: Annual screening. No acute symptoms.

TECHNIQUE: PA and lateral chest radiograph obtained in the radiology department.

COMPARISON: Prior chest radiograph from 18 months ago.

FINDINGS:

Lungs: No focal airspace opacity, consolidation, or mass lesion. No pleural effusion or pneumothorax.

Mediastinum: Normal in width and contour. No hilar lymphadenopathy.

Heart: Cardiac silhouette is normal in size. No pericardial effusion.

Bony thorax: No rib or vertebral fracture. Vertebral body heights are maintained.

IMPRESSION:
No acute cardiopulmonary abnormality. Stable compared to prior radiograph.`,
    sections: [
      { label: 'EXAM', startKeyword: 'EXAM:' },
      { label: 'CLINICAL HISTORY', startKeyword: 'CLINICAL HISTORY:' },
      { label: 'TECHNIQUE', startKeyword: 'TECHNIQUE:' },
      { label: 'COMPARISON', startKeyword: 'COMPARISON:' },
      { label: 'FINDINGS', startKeyword: 'FINDINGS:' },
      { label: 'IMPRESSION', startKeyword: 'IMPRESSION:' }
    ],
    findingSpanHints: [
      {
        findingId: 'no-acute-cardiopulmonary-abnormality',
        rawText: 'No acute cardiopulmonary abnormality.'
      }
    ]
  }
];

export function getDemoReport(accession) {
  const key = String(accession || '').trim();
  return DEMO_REPORTS.find((r) => r.accession === key) || null;
}

export function listDemoAccessions() {
  return DEMO_REPORTS.map((r) => ({ accession: r.accession, title: r.title, modality: r.modality }));
}

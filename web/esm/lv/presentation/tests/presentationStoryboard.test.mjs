import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildStoryboard,
  buildStudySummary,
  buildImpressionBullets,
  deriveExamName,
  deriveHighlightPhrase,
} from '../presentationStoryboard.mjs';
import { exportHtmlComposition } from '../htmlPresentationExporter.mjs';
import { buildPresentationManifest } from '../presentationManifest.mjs';

const CT_POSITIVE = [
  { id: 'chronic-left-caudate-infarct', label: 'Chronic left caudate infarct',
    description: 'Chronic infarct involving left caudate head', anatomy: 'left caudate head',
    disease: 'chronic infarct', localization_target: 'left caudate head',
    seriesNumber: 2, imageNumber: 21, modality: 'CT' },
  { id: 'healed-left-vertex-fracture', label: 'Healed left vertex fracture',
    description: 'Healed fracture near left vertex', anatomy: 'left vertex skull',
    disease: 'healed fracture', localization_target: 'left vertex skull',
    seriesNumber: 2, imageNumber: 36, modality: 'CT' },
];
const CT_NEGATIVE = [
  { id: 'no-hemorrhage', label: 'No subdural, epidural, or subarachnoid hemorrhage', severity: 'negative' },
];

test('deriveExamName builds modality + region', () => {
  assert.equal(deriveExamName({ modality: 'CT', positiveFindings: CT_POSITIVE }), 'CT HEAD');
  assert.equal(deriveExamName({ examName: 'CT Head Without Contrast' }), 'CT HEAD WITHOUT CONTRAST');
});

test('buildStudySummary lists positives and a region negative clause', () => {
  const s = buildStudySummary({ modality: 'CT', positiveFindings: CT_POSITIVE, negativeFindings: CT_NEGATIVE });
  assert.match(s, /CT head demonstrates/);
  assert.match(s, /chronic left caudate infarct and healed left vertex fracture/);
  assert.match(s, /No acute intracranial abnormality\.$/);
});

test('buildImpressionBullets = positives + region negative', () => {
  const b = buildImpressionBullets({ positiveFindings: CT_POSITIVE, negativeFindings: CT_NEGATIVE });
  assert.deepEqual(b, [
    'Chronic left caudate infarct.',
    'Healed left vertex fracture.',
    'No acute intracranial abnormality.',
  ]);
});

test('deriveHighlightPhrase picks a phrase present in the sentence', () => {
  assert.equal(
    deriveHighlightPhrase(CT_POSITIVE[0], 'Chronic infarct involving left caudate head'),
    'left caudate head'
  );
  // Falls back to disease when localization/anatomy not present in the text.
  assert.equal(
    deriveHighlightPhrase(CT_POSITIVE[1], 'Healed fracture near left vertex'),
    'healed fracture'
  );
});

test('buildStoryboard emits scene narration for every scene', () => {
  const sb = buildStoryboard({ modality: 'CT', accession: 'NI9f7ff9',
    positiveFindings: CT_POSITIVE, negativeFindings: CT_NEGATIVE });
  const scenes = sb.narrationScript.map(s => s.scene);
  assert.deepEqual(scenes, ['title', 'summary', 'finding', 'finding', 'closing']);
  for (const seg of sb.narrationScript) assert.ok(seg.narration.length > 0, `narration for ${seg.scene}`);
  // per-finding pointer + highlight present
  assert.ok(sb.perFinding['chronic-left-caudate-infarct'].pointer);
  assert.equal(sb.perFinding['chronic-left-caudate-infarct'].highlightPhrase, 'left caudate head');
});

test('manifest carries study, summary, impression, narrationScript', () => {
  const ctx = { source: 'demo', accession: 'NI9f7ff9', modality: 'CT',
    positiveFindings: CT_POSITIVE, negativeFindings: CT_NEGATIVE };
  const m = buildPresentationManifest(ctx, {});
  assert.equal(m.study.examName, 'CT HEAD');
  assert.ok(m.summary.length > 0);
  assert.equal(m.impression.length, 3);
  assert.equal(m.narrationScript.length, 5);
  // sections enriched
  assert.equal(m.sections[0].highlightPhrase, 'left caudate head');
  assert.ok(m.sections[0].narration.includes('Series 2'));
});

test('exportHtmlComposition emits all cinematic scenes and is deterministic', () => {
  const ctx = { source: 'demo', accession: 'NI9f7ff9', modality: 'CT',
    positiveFindings: CT_POSITIVE, negativeFindings: CT_NEGATIVE };
  const m = buildPresentationManifest(ctx, {});
  const html = exportHtmlComposition(m, { assetMode: 'data-url' });
  for (const id of ['sc-title', 'sc-summary', 'sc-find-0-a', 'sc-find-0-b', 'sc-find-1-b', 'sc-closing']) {
    assert.ok(html.includes(id), `composition should contain ${id}`);
  }
  // No infinite GSAP repeats (HyperFrames requires deterministic finite repeats).
  assert.ok(!/repeat:\s*-1/.test(html), 'no infinite repeats allowed');
  // Highlighted phrase rendered.
  assert.match(html, /<span class="hl">left caudate head<\/span>/);
});

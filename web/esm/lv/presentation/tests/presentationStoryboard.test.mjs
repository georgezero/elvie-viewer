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

// A 1x1 PNG data URL used as captured evidence so findings become image scenes.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function evidenceMapFor(findings) {
  const map = new Map();
  for (const f of findings) map.set(f.id, [{ status: 'captured', dataUrl: PNG, appliedPreset: 'brain_stroke', seriesNumber: f.seriesNumber, imageNumber: f.imageNumber }]);
  return map;
}

test('exportHtmlComposition emits cinematic scenes for localized findings, deterministic', () => {
  const ctx = { source: 'demo', accession: 'NI9f7ff9', modality: 'CT',
    positiveFindings: CT_POSITIVE, negativeFindings: CT_NEGATIVE };
  const m = buildPresentationManifest(ctx, { evidenceMap: evidenceMapFor(CT_POSITIVE) });
  const html = exportHtmlComposition(m, { assetMode: 'data-url' });
  for (const id of ['sc-title', 'sc-summary', 'sc-find-0-a', 'sc-find-0-b', 'sc-find-1-b', 'sc-closing', 'sc-endcard']) {
    assert.ok(html.includes(id), `composition should contain ${id}`);
  }
  // No infinite GSAP repeats (HyperFrames requires deterministic finite repeats).
  assert.ok(!/repeat:\s*-1/.test(html), 'no infinite repeats allowed');
  // Highlighted phrase rendered (now carries a sweep id).
  assert.match(html, /<span class="hl" id="[^"]+">left caudate head<\/span>/);
  // Persistent ELVIE brand layer in viewer cyan.
  assert.match(html, /Bebas Neue/);
  assert.match(html, /#00d4e8/);
});

test('image scenes are completely static — no camera movement on the anatomy', () => {
  const ctx = { source: 'demo', accession: 'NI9f7ff9', modality: 'CT',
    positiveFindings: CT_POSITIVE, negativeFindings: CT_NEGATIVE };
  const m = buildPresentationManifest(ctx, { evidenceMap: evidenceMapFor(CT_POSITIVE) });
  const html = exportHtmlComposition(m, { assetMode: 'data-url' });

  // Only the GSAP timeline block can introduce motion — inspect it.
  const tl = html.slice(html.indexOf('gsap.timeline'));

  // No tween targets the image, the image stage, or the title backdrop.
  assert.ok(!/tl\.\w+\("#[^"]*-img"/.test(tl), 'the evidence image must not be animated');
  assert.ok(!/tl\.\w+\("#[^"]*-stage"/.test(tl), 'the image stage must not be animated');
  assert.ok(!/tl\.\w+\("#[^"]*-bg"/.test(tl), 'the title backdrop must not be animated (no push-in)');

  // No Ken Burns: the image stage has no transform / transform-origin.
  assert.ok(!/-stage"[^>]*transform/.test(html), 'image stage must have no transform');

  // Overlay animations still function: pointer + card + report sweep are present.
  assert.match(tl, /-ptr"/);     // pointer appears/fades
  assert.match(tl, /-ring"/);    // pointer pulse
  assert.match(tl, /-panel"/);   // narrative panel fades in
  assert.match(tl, /-hl"/);      // report reading-sweep
});

test('data-driven scene selection: non-localized findings get no image scene', () => {
  const NON_LOCALIZED = { id: 'chondromalacia-patella', label: 'Chondromalacia patella',
    description: 'Mild chondromalacia patella', anatomy: 'patella', disease: 'chondromalacia',
    seriesNumber: null, imageNumber: null, modality: 'MR' };
  const positives = [CT_POSITIVE[0], NON_LOCALIZED];
  const ctx = { source: 'demo', accession: 'X', modality: 'MR', positiveFindings: positives, negativeFindings: [] };
  // Only the first finding has captured evidence.
  const map = new Map();
  map.set(CT_POSITIVE[0].id, [{ status: 'captured', dataUrl: PNG, appliedPreset: 'brain_stroke', seriesNumber: 2, imageNumber: 21 }]);
  const m = buildPresentationManifest(ctx, { evidenceMap: map });
  const html = exportHtmlComposition(m, { assetMode: 'data-url' });
  // Localized finding → image scene.
  assert.ok(html.includes('sc-find-0-b'), 'localized finding has an image scene');
  // Non-localized finding → NO second image scene.
  assert.ok(!html.includes('sc-find-1-b'), 'non-localized finding must not get an image scene');
  // But it IS in the impression and narration.
  assert.ok(m.impression.some(b => /chondromalacia/i.test(b)), 'non-localized in impression');
  assert.ok(m.narrationScript.some(s => s.findingId === 'chondromalacia-patella'), 'non-localized in narration');
});

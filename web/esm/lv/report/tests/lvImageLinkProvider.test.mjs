import assert from 'node:assert/strict';
import { createLvImageLinkProvider } from '../lvImageLinkProvider.mjs';
import { INTERFACE_VERSION, nullImageLinkProvider } from '../imageLinkProvider.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const navigableFinding = {
  id: 'caudate-infarct',
  navigationStatus: 'navigable',
  seriesNumber: 2,
  imageNumber: 21,
  accession: 'NI9f7ff9'
};

const seriesOnlyFinding = {
  id: 'effusion',
  navigationStatus: 'series_only',
  seriesNumber: 3,
  imageNumber: null,
  accession: '3852755662087132'
};

const negativeFinding = {
  id: 'no-bleed',
  navigationStatus: 'negative',
  seriesNumber: null,
  imageNumber: null,
  accession: 'NI9f7ff9'
};

const nonNavigableFinding = {
  id: 'mild-atrophy',
  navigationStatus: 'non_navigable',
  seriesNumber: null,
  imageNumber: null,
  accession: 'NI9f7ff9'
};

const noSeriesFinding = {
  id: 'something',
  navigationStatus: 'navigable',
  seriesNumber: null,
  imageNumber: 5,
  accession: 'ACC-001'
};

const noImageFinding = {
  id: 'something-else',
  navigationStatus: 'navigable',
  seriesNumber: 3,
  imageNumber: null,
  accession: 'ACC-001'
};

function makeProvider(overrides = {}) {
  const commands = [];
  const dispatch = (cmd) => commands.push(cmd);
  const provider = createLvImageLinkProvider({ dispatchViewerCommand: dispatch, ...overrides });
  return { provider, commands };
}

// ── Test 1: navigable finding ─────────────────────────────────────────────────

{
  const { provider } = makeProvider();
  const result = await provider.canNavigateFinding(navigableFinding);
  assert.equal(result.canNavigate, true, 'navigable finding should return canNavigate: true');
  assert.equal(result.reason, undefined, 'should have no reason when navigable');
}

// ── Test 2: negative finding not navigable ────────────────────────────────────

{
  const { provider } = makeProvider();
  const result = await provider.canNavigateFinding(negativeFinding);
  assert.equal(result.canNavigate, false, 'negative finding should not be navigable');
  assert.ok(result.reason, 'should provide a reason');
  assert.ok(result.reason.includes('negative'), `reason should mention 'negative', got: ${result.reason}`);
}

// ── Test 3: non_navigable finding not navigable ───────────────────────────────

{
  const { provider } = makeProvider();
  const result = await provider.canNavigateFinding(nonNavigableFinding);
  assert.equal(result.canNavigate, false, 'non_navigable finding should not be navigable');
  assert.ok(result.reason?.includes('non_navigable'), `reason should mention 'non_navigable', got: ${result.reason}`);
}

// ── Test 4a: missing series number not navigable ──────────────────────────────

{
  const { provider } = makeProvider();
  const result = await provider.canNavigateFinding(noSeriesFinding);
  assert.equal(result.canNavigate, false, 'finding without seriesNumber should not be navigable');
  assert.ok(result.reason?.includes('series'), `reason should mention series, got: ${result.reason}`);
}

// ── Test 4b: series_only (no imageNumber) not navigable ──────────────────────

{
  const { provider } = makeProvider();
  const result = await provider.canNavigateFinding(seriesOnlyFinding);
  assert.equal(result.canNavigate, false, 'series_only finding (no imageNumber) should not be navigable');
  assert.ok(result.reason?.includes('image'), `reason should mention image number, got: ${result.reason}`);
}

// ── Test 4c: missing image number not navigable ───────────────────────────────

{
  const { provider } = makeProvider();
  const result = await provider.canNavigateFinding(noImageFinding);
  assert.equal(result.canNavigate, false, 'finding without imageNumber should not be navigable');
  assert.ok(result.reason?.includes('image'), `reason should mention image, got: ${result.reason}`);
}

// ── Test 5: navigateToFinding with accession dispatches openStudyThenFinding ──
// navigableFinding has accession → triggers orchestration path

{
  const { provider, commands } = makeProvider();
  await provider.navigateToFinding(navigableFinding, { focus: true });
  assert.equal(commands.length, 1, 'should dispatch exactly one command');
  const cmd = commands[0];
  assert.equal(cmd.type, 'openStudyThenFinding', 'accession present → should use openStudyThenFinding');
  assert.equal(cmd.findingId, navigableFinding.id);
  assert.equal(cmd.accession, navigableFinding.accession);
  assert.equal(cmd.imageReference.type, 'series-image');
  assert.equal(cmd.imageReference.seriesNumber, navigableFinding.seriesNumber);
  assert.equal(cmd.imageReference.imageNumber, navigableFinding.imageNumber);
  assert.equal(cmd.options, undefined, 'options should not leak into command shape');
}

// ── Test 5b: navigateToFinding without options still dispatches openStudyThenFinding

{
  const { provider, commands } = makeProvider();
  await provider.navigateToFinding(navigableFinding);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'openStudyThenFinding');
  assert.ok(commands[0].imageReference, 'imageReference should be present');
}

// ── Test 5c: navigateToFinding without accession falls back to openFinding ────

{
  const { provider, commands } = makeProvider();
  const noAccessionFinding = { ...navigableFinding, accession: null };
  await provider.navigateToFinding(noAccessionFinding);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'openFinding', 'no accession → should fall back to openFinding');
}

// ── Test 5d: options.accession triggers openStudyThenFinding ─────────────────

{
  const { provider, commands } = makeProvider();
  const noAccessionFinding = { ...navigableFinding, accession: null };
  await provider.navigateToFinding(noAccessionFinding, { accession: 'ACC-FROM-OPTIONS' });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'openStudyThenFinding', 'options.accession should trigger openStudyThenFinding');
  assert.equal(commands[0].accession, 'ACC-FROM-OPTIONS');
}

// ── Test 5e: finding.accession takes precedence over options.accession ─────────

{
  const { provider, commands } = makeProvider();
  await provider.navigateToFinding(navigableFinding, { accession: 'OVERRIDE' });
  assert.equal(commands[0].accession, navigableFinding.accession, 'finding.accession should win over options.accession');
}

// ── Test 5f: studyInstanceUID propagated from finding and options ─────────────

{
  const { provider, commands } = makeProvider();
  const findingWithUid = { ...navigableFinding, studyInstanceUID: '1.2.3.4.5' };
  await provider.navigateToFinding(findingWithUid);
  assert.equal(commands[0].studyInstanceUID, '1.2.3.4.5', 'finding.studyInstanceUID should be passed through');
}

{
  const { provider, commands } = makeProvider();
  const noUidFinding = { ...navigableFinding, studyInstanceUID: undefined };
  await provider.navigateToFinding(noUidFinding, { studyInstanceUID: '9.8.7' });
  assert.equal(commands[0].studyInstanceUID, '9.8.7', 'options.studyInstanceUID used when finding lacks it');
}

// ── Test 6: navigateToFinding does not dispatch when not navigable ────────────

{
  const { provider, commands } = makeProvider();
  const result = await provider.navigateToFinding(negativeFinding);
  assert.equal(commands.length, 0, 'should not dispatch for non-navigable finding');
  assert.equal(result.ok, false);
  assert.ok(result.reason, 'should return a reason');
}

{
  const { provider, commands } = makeProvider();
  const result = await provider.navigateToFinding(noSeriesFinding);
  assert.equal(commands.length, 0, 'should not dispatch when seriesNumber is null');
  assert.equal(result.ok, false);
}

// ── Test 6b: no dispatcher → navigateToFinding returns ok:false ───────────────

{
  const provider = createLvImageLinkProvider({});
  const result = await provider.navigateToFinding(navigableFinding);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes('dispatcher'), `reason should mention dispatcher, got: ${result.reason}`);
}

// ── Test 7: sendViewerCommand accepted as alternate dispatch path ─────────────

{
  const commands = [];
  const provider = createLvImageLinkProvider({ sendViewerCommand: (cmd) => commands.push(cmd) });
  await provider.navigateToFinding(navigableFinding);
  assert.equal(commands.length, 1, 'sendViewerCommand should be used when dispatchViewerCommand absent');
}

// ── Test 8: getImageAvailability delegates to deps if provided ────────────────

{
  const provider = createLvImageLinkProvider({
    getImageAvailability: async (acc) => ({ available: acc === 'NI9f7ff9', reason: acc !== 'NI9f7ff9' ? 'not found' : undefined })
  });
  const ok = await provider.getImageAvailability('NI9f7ff9');
  assert.equal(ok.available, true);
  const missing = await provider.getImageAvailability('UNKNOWN');
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'not found');
}

// ── Test 9: getImageAvailability defaults to available:true ──────────────────

{
  const { provider } = makeProvider();
  const result = await provider.getImageAvailability('any-accession');
  assert.equal(result.available, true);
}

// ── Test 10: interfaceVersion matches INTERFACE_VERSION ───────────────────────

{
  const { provider } = makeProvider();
  assert.equal(provider.interfaceVersion, INTERFACE_VERSION);
}

// ── Test 11: invalid deps throw TypeError ────────────────────────────────────

{
  assert.throws(
    () => createLvImageLinkProvider({ dispatchViewerCommand: 'not-a-function' }),
    TypeError,
    'should throw if dispatchViewerCommand is not a function'
  );
  assert.throws(
    () => createLvImageLinkProvider({ getViewerState: 42 }),
    TypeError,
    'should throw if getViewerState is not a function'
  );
  assert.throws(
    () => createLvImageLinkProvider({ getImageAvailability: {} }),
    TypeError,
    'should throw if getImageAvailability is not a function'
  );
}

// ── Test 12: nullImageLinkProvider still satisfies the contract ───────────────

{
  const r = await nullImageLinkProvider.canNavigateFinding(navigableFinding);
  assert.equal(r.canNavigate, false, 'nullImageLinkProvider always returns canNavigate:false');
  const a = await nullImageLinkProvider.getImageAvailability('NI9f7ff9');
  assert.equal(a.available, false);
}

// ── viewPreset inference tests ────────────────────────────────────────────────

// ── Test 13: CT infarct finding → brain_stroke viewPreset on command ──────────

{
  const { provider, commands } = makeProvider();
  const ctInfarct = {
    id: 'f-infarct',
    navigationStatus: 'navigable',
    seriesNumber: 2,
    imageNumber: 21,
    accession: 'NI9f7ff9',
    modality: 'CT',
    label: 'Acute ischemic infarct left MCA territory',
    anatomy: 'brain'
  };
  await provider.navigateToFinding(ctInfarct);
  const cmd = commands[0];
  assert.ok(cmd.viewPreset, 'CT infarct should have a viewPreset');
  assert.equal(cmd.viewPreset.type, 'ct-window');
  assert.equal(cmd.viewPreset.preset, 'brain_stroke', 'infarct + brain anatomy → brain_stroke');
}

// ── Test 14: CT hemorrhage finding → brain_hemorrhage viewPreset ──────────────

{
  const { provider, commands } = makeProvider();
  const ctBleed = {
    id: 'f-bleed',
    navigationStatus: 'navigable',
    seriesNumber: 2,
    imageNumber: 15,
    accession: 'NI9f7ff9',
    modality: 'CT',
    label: 'Acute subdural hemorrhage right hemisphere',
    anatomy: 'head'
  };
  await provider.navigateToFinding(ctBleed);
  const cmd = commands[0];
  assert.equal(cmd.viewPreset?.type, 'ct-window');
  assert.equal(cmd.viewPreset?.preset, 'brain_hemorrhage', 'subdural hemorrhage → brain_hemorrhage');
}

// ── Test 15: CT skull fracture → bone viewPreset ─────────────────────────────

{
  const { provider, commands } = makeProvider();
  const ctFracture = {
    id: 'f-fracture',
    navigationStatus: 'navigable',
    seriesNumber: 2,
    imageNumber: 36,
    accession: 'NI9f7ff9',
    modality: 'CT',
    label: 'Vertex skull fracture',
    anatomy: 'head'
  };
  await provider.navigateToFinding(ctFracture);
  const cmd = commands[0];
  assert.equal(cmd.viewPreset?.type, 'ct-window');
  assert.equal(cmd.viewPreset?.preset, 'bone', 'skull fracture → bone');
}

// ── Test 16: CT lung nodule → lung viewPreset ────────────────────────────────

{
  const { provider, commands } = makeProvider();
  const ctLung = {
    id: 'f-nodule',
    navigationStatus: 'navigable',
    seriesNumber: 1,
    imageNumber: 45,
    accession: 'ACC-001',
    modality: 'CT',
    label: 'Pulmonary nodule right upper lobe',
    anatomy: 'lung'
  };
  await provider.navigateToFinding(ctLung);
  const cmd = commands[0];
  assert.equal(cmd.viewPreset?.preset, 'lung', 'pulmonary nodule → lung');
}

// ── Test 17: MR finding → no viewPreset attached ─────────────────────────────

{
  const { provider, commands } = makeProvider();
  const mrFinding = {
    id: 'f-meniscus',
    navigationStatus: 'navigable',
    seriesNumber: 6,
    imageNumber: 23,
    accession: '3852755662087132',
    modality: 'MR',
    label: 'Medial meniscus tear posterior horn',
    anatomy: 'knee'
  };
  await provider.navigateToFinding(mrFinding);
  const cmd = commands[0];
  assert.equal(cmd.viewPreset, null, 'MR finding → viewPreset should be null (not inferred)');
}

// ── Test 18: options.modality drives inference when finding.modality absent ───

{
  const { provider, commands } = makeProvider();
  const noModalityFinding = {
    id: 'f-brain',
    navigationStatus: 'navigable',
    seriesNumber: 2,
    imageNumber: 10,
    accession: 'NI9f7ff9',
    label: 'Acute infarct posterior territory',
    anatomy: 'brain'
    // no modality field
  };
  await provider.navigateToFinding(noModalityFinding, { modality: 'CT' });
  const cmd = commands[0];
  assert.equal(cmd.viewPreset?.type, 'ct-window', 'options.modality:CT should drive inference');
  assert.equal(cmd.viewPreset?.preset, 'brain_stroke');
}

// ── Test 19: MR via options.modality → no viewPreset ─────────────────────────

{
  const { provider, commands } = makeProvider();
  const noModalityFinding = {
    id: 'f-mr',
    navigationStatus: 'navigable',
    seriesNumber: 3,
    imageNumber: 14,
    accession: '3852755662087132',
    label: 'Effusion joint space',
    anatomy: 'knee'
  };
  await provider.navigateToFinding(noModalityFinding, { modality: 'MR' });
  const cmd = commands[0];
  assert.equal(cmd.viewPreset, null, 'options.modality:MR → no viewPreset');
}

// ── Test 20: no modality info → CT inference attempted (unknown modality path) ─

{
  const { provider, commands } = makeProvider();
  const noModalityCtFinding = {
    id: 'f-no-mod',
    navigationStatus: 'navigable',
    seriesNumber: 1,
    imageNumber: 5,
    accession: 'ACC-001',
    label: 'Liver lesion',
    anatomy: 'liver'
    // no modality — falls through to unknown → CT inference attempted
  };
  await provider.navigateToFinding(noModalityCtFinding);
  const cmd = commands[0];
  // Unknown modality tries CT inference; 'liver' → liver preset
  assert.equal(cmd.viewPreset?.type, 'ct-window');
  assert.equal(cmd.viewPreset?.preset, 'liver');
}

// ── Test 21: preset inference does not block navigation ───────────────────────

{
  // CT finding with no keyword match → reset preset, navigation still dispatches
  const { provider, commands } = makeProvider();
  const noKeywordFinding = {
    id: 'f-nk',
    navigationStatus: 'navigable',
    seriesNumber: 3,
    imageNumber: 7,
    accession: 'ACC-001',
    modality: 'CT',
    label: 'Incidental finding',
    anatomy: null,
    description: null
  };
  await provider.navigateToFinding(noKeywordFinding);
  assert.equal(commands.length, 1, 'command should still be dispatched');
  // reset is still a valid ct-window preset
  assert.equal(commands[0].viewPreset?.type, 'ct-window');
  assert.equal(commands[0].viewPreset?.preset, 'reset');
}

// ── Test 22: viewPreset passed through on openFinding (no accession) path ─────

{
  const { provider, commands } = makeProvider();
  const noAccCtFinding = {
    id: 'f-no-acc',
    navigationStatus: 'navigable',
    seriesNumber: 2,
    imageNumber: 10,
    accession: null,
    modality: 'CT',
    label: 'Acute hemorrhage temporal lobe',
    anatomy: 'brain'
  };
  await provider.navigateToFinding(noAccCtFinding);
  const cmd = commands[0];
  assert.equal(cmd.type, 'openFinding', 'no accession → openFinding');
  assert.equal(cmd.viewPreset?.preset, 'brain_hemorrhage', 'viewPreset should be set on openFinding path too');
}

console.log('lvImageLinkProvider: all tests passed');

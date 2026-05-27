import assert from 'node:assert/strict';
import {
  COMMAND_VERSION,
  createOpenFindingCommand,
  createOpenStudyCommand,
  createOpenStudyThenFindingCommand
} from '../agentViewerCommand.mjs';

// ── Test 1: COMMAND_VERSION is stable string ──────────────────────────────────

{
  assert.equal(typeof COMMAND_VERSION, 'string');
  assert.ok(COMMAND_VERSION.length > 0);
}

// ── Test 2: createOpenFindingCommand returns correct shape ────────────────────

{
  const cmd = createOpenFindingCommand({
    accession: 'ACC-001',
    findingId: 'caudate-infarct',
    seriesNumber: 2,
    imageNumber: 21
  });
  assert.equal(cmd.type, 'openFinding');
  assert.equal(cmd.accession, 'ACC-001');
  assert.equal(cmd.findingId, 'caudate-infarct');
  assert.equal(cmd.imageReference.type, 'series-image');
  assert.equal(cmd.imageReference.seriesNumber, 2);
  assert.equal(cmd.imageReference.imageNumber, 21);
}

// ── Test 3: createOpenFindingCommand result is frozen ─────────────────────────

{
  const cmd = createOpenFindingCommand({ accession: null, findingId: 'f1', seriesNumber: 1, imageNumber: 1 });
  assert.ok(Object.isFrozen(cmd), 'command object should be frozen');
  assert.ok(Object.isFrozen(cmd.imageReference), 'imageReference should be frozen');
}

// ── Test 4: createOpenFindingCommand throws on missing findingId ──────────────

{
  assert.throws(
    () => createOpenFindingCommand({ accession: 'ACC-001', findingId: null, seriesNumber: 1, imageNumber: 1 }),
    TypeError,
    'should throw TypeError when findingId is null'
  );
  assert.throws(
    () => createOpenFindingCommand({ accession: 'ACC-001', findingId: '', seriesNumber: 1, imageNumber: 1 }),
    TypeError,
    'should throw TypeError when findingId is empty string'
  );
  assert.throws(
    () => createOpenFindingCommand({ accession: 'ACC-001', findingId: undefined, seriesNumber: 1, imageNumber: 1 }),
    TypeError,
    'should throw TypeError when findingId is undefined'
  );
}

// ── Test 5: createOpenFindingCommand null-coerces missing series/image ─────────

{
  const cmd = createOpenFindingCommand({ accession: null, findingId: 'f1', seriesNumber: undefined, imageNumber: undefined });
  assert.equal(cmd.imageReference.seriesNumber, null);
  assert.equal(cmd.imageReference.imageNumber, null);
}

// ── Test 6: createOpenStudyCommand returns correct shape ──────────────────────

{
  const cmd = createOpenStudyCommand({ accession: 'ACC-001', studyInstanceUID: '1.2.3.4' });
  assert.equal(cmd.type, 'openStudy');
  assert.equal(cmd.accession, 'ACC-001');
  assert.equal(cmd.studyInstanceUID, '1.2.3.4');
  assert.ok(Object.isFrozen(cmd), 'openStudy command should be frozen');
}

// ── Test 7: createOpenStudyCommand without studyInstanceUID ───────────────────

{
  const cmd = createOpenStudyCommand({ accession: 'ACC-002' });
  assert.equal(cmd.type, 'openStudy');
  assert.equal(cmd.accession, 'ACC-002');
  assert.equal(cmd.studyInstanceUID, null);
}

// ── Test 8: createOpenStudyCommand with no args ───────────────────────────────

{
  const cmd = createOpenStudyCommand();
  assert.equal(cmd.type, 'openStudy');
  assert.equal(cmd.accession, null);
  assert.equal(cmd.studyInstanceUID, null);
}

// ── Test 9: createOpenStudyThenFindingCommand returns correct shape ───────────

{
  const cmd = createOpenStudyThenFindingCommand({
    accession: 'NI9f7ff9',
    studyInstanceUID: '1.2.3',
    findingId: 'caudate-infarct',
    seriesNumber: 2,
    imageNumber: 21
  });
  assert.equal(cmd.type, 'openStudyThenFinding');
  assert.equal(cmd.accession, 'NI9f7ff9');
  assert.equal(cmd.studyInstanceUID, '1.2.3');
  assert.equal(cmd.findingId, 'caudate-infarct');
  assert.equal(cmd.imageReference.type, 'series-image');
  assert.equal(cmd.imageReference.seriesNumber, 2);
  assert.equal(cmd.imageReference.imageNumber, 21);
  assert.ok(Object.isFrozen(cmd), 'command should be frozen');
  assert.ok(Object.isFrozen(cmd.imageReference), 'imageReference should be frozen');
}

// ── Test 10: createOpenStudyThenFindingCommand throws on missing findingId ─────

{
  assert.throws(
    () => createOpenStudyThenFindingCommand({ accession: 'ACC', findingId: null }),
    TypeError,
    'should throw TypeError when findingId is null'
  );
  assert.throws(
    () => createOpenStudyThenFindingCommand({ accession: 'ACC', findingId: '   ' }),
    TypeError,
    'should throw TypeError when findingId is whitespace'
  );
}

// ── Test 11: createOpenStudyThenFindingCommand accepts imageReference object ──

{
  const cmd = createOpenStudyThenFindingCommand({
    accession: 'ACC',
    findingId: 'f1',
    imageReference: { type: 'series-image', seriesNumber: 6, imageNumber: 23 }
  });
  assert.equal(cmd.imageReference.seriesNumber, 6, 'imageReference object should be used');
  assert.equal(cmd.imageReference.imageNumber, 23);
}

// ── Test 12: createOpenStudyThenFindingCommand imageReference wins over flat ──

{
  const cmd = createOpenStudyThenFindingCommand({
    accession: 'ACC',
    findingId: 'f2',
    seriesNumber: 1,
    imageNumber: 5,
    imageReference: { type: 'series-image', seriesNumber: 6, imageNumber: 23 }
  });
  assert.equal(cmd.imageReference.seriesNumber, 6, 'imageReference should take precedence');
  assert.equal(cmd.imageReference.imageNumber, 23);
}

// ── Test 13: createOpenStudyThenFindingCommand without studyInstanceUID ────────

{
  const cmd = createOpenStudyThenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 1, imageNumber: 2 });
  assert.equal(cmd.studyInstanceUID, null);
}

// ── Test 14: createOpenFindingCommand viewPreset passes through ───────────────

{
  const preset = { type: 'ct-window', preset: 'brain_stroke', confidence: 'high', reason: 'head; stroke: infarct' };
  const cmd = createOpenFindingCommand({
    accession: 'ACC-001', findingId: 'f1', seriesNumber: 2, imageNumber: 21,
    viewPreset: preset
  });
  assert.deepEqual(cmd.viewPreset, preset);
}

// ── Test 15: createOpenFindingCommand viewPreset defaults to null ─────────────

{
  const cmd = createOpenFindingCommand({ accession: 'ACC-001', findingId: 'f1', seriesNumber: 2, imageNumber: 21 });
  assert.equal(cmd.viewPreset, null);
}

// ── Test 16: createOpenStudyThenFindingCommand viewPreset passes through ──────

{
  const preset = { type: 'ct-window', preset: 'lung', confidence: 'high', reason: 'lung: pulmonary' };
  const cmd = createOpenStudyThenFindingCommand({
    accession: 'ACC', findingId: 'f1', seriesNumber: 1, imageNumber: 5,
    viewPreset: preset
  });
  assert.deepEqual(cmd.viewPreset, preset);
}

// ── Test 17: createOpenStudyThenFindingCommand viewPreset defaults to null ────

{
  const cmd = createOpenStudyThenFindingCommand({ accession: 'ACC', findingId: 'f1', seriesNumber: 1, imageNumber: 2 });
  assert.equal(cmd.viewPreset, null);
}

console.log('agentViewerCommand: all tests passed');

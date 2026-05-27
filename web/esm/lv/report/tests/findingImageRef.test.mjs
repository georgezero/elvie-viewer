import assert from 'node:assert/strict';
import { normalizeFindingImageReference } from '../imageLinkProvider.mjs';
import { isImageNavigable } from '../reportViewer.mjs';
import { createOpenFindingCommand } from '../agentViewerCommand.mjs';
import { createLvImageLinkProvider } from '../lvImageLinkProvider.mjs';

// ── normalizeFindingImageReference ────────────────────────────────────────────

// ── T1: legacy flat fields ────────────────────────────────────────────────────

{
  const ref = normalizeFindingImageReference({ seriesNumber: 2, imageNumber: 21 });
  assert.equal(ref.type, 'series-image');
  assert.equal(ref.seriesNumber, 2);
  assert.equal(ref.imageNumber, 21);
}

// ── T2: imageReference object only ───────────────────────────────────────────

{
  const ref = normalizeFindingImageReference({
    imageReference: { type: 'series-image', seriesNumber: 6, imageNumber: 23 }
  });
  assert.equal(ref.seriesNumber, 6);
  assert.equal(ref.imageNumber, 23);
}

// ── T3: imageReference takes precedence over flat fields ─────────────────────

{
  const ref = normalizeFindingImageReference({
    seriesNumber: 1,
    imageNumber: 5,
    imageReference: { type: 'series-image', seriesNumber: 6, imageNumber: 23 }
  });
  assert.equal(ref.seriesNumber, 6, 'imageReference.seriesNumber should win over flat seriesNumber');
  assert.equal(ref.imageNumber, 23, 'imageReference.imageNumber should win over flat imageNumber');
}

// ── T4: malformed imageReference (string) falls back to flat fields ───────────

{
  const ref = normalizeFindingImageReference({ seriesNumber: 3, imageNumber: 10, imageReference: 'bad' });
  assert.equal(ref.seriesNumber, 3, 'string imageReference should fall back to flat fields');
  assert.equal(ref.imageNumber, 10);
}

// ── T5: malformed imageReference (array) falls back to flat fields ────────────

{
  const ref = normalizeFindingImageReference({ seriesNumber: 4, imageNumber: 7, imageReference: [1, 2] });
  assert.equal(ref.seriesNumber, 4, 'array imageReference should fall back to flat fields');
  assert.equal(ref.imageNumber, 7);
}

// ── T6: null imageReference falls back to flat fields ────────────────────────

{
  const ref = normalizeFindingImageReference({ seriesNumber: 5, imageNumber: 9, imageReference: null });
  assert.equal(ref.seriesNumber, 5);
  assert.equal(ref.imageNumber, 9);
}

// ── T7: empty finding → all null ─────────────────────────────────────────────

{
  const ref = normalizeFindingImageReference({});
  assert.equal(ref.type, 'series-image');
  assert.equal(ref.seriesNumber, null);
  assert.equal(ref.imageNumber, null);
}

// ── T8: null finding → all null ──────────────────────────────────────────────

{
  const ref = normalizeFindingImageReference(null);
  assert.equal(ref.seriesNumber, null);
  assert.equal(ref.imageNumber, null);
}

// ── T9: result is frozen ──────────────────────────────────────────────────────

{
  const ref = normalizeFindingImageReference({ seriesNumber: 1, imageNumber: 2 });
  assert.ok(Object.isFrozen(ref), 'normalized ref should be frozen');
}

// ── T10: imageReference with unknown type preserved ───────────────────────────

{
  const ref = normalizeFindingImageReference({
    imageReference: { type: 'sop-uid', seriesNumber: 7, imageNumber: 3 }
  });
  assert.equal(ref.type, 'sop-uid', 'non-standard type should be preserved');
  assert.equal(ref.seriesNumber, 7);
}

// ── T11: imageReference with null fields → stays null ────────────────────────

{
  const ref = normalizeFindingImageReference({
    seriesNumber: 99,
    imageReference: { type: 'series-image', seriesNumber: null, imageNumber: null }
  });
  assert.equal(ref.seriesNumber, null, 'explicit null in imageReference should not fall through to flat fields');
  assert.equal(ref.imageNumber, null);
}

// ── isImageNavigable ──────────────────────────────────────────────────────────

// ── T12: legacy navigable finding ────────────────────────────────────────────

{
  assert.equal(isImageNavigable({ navigationStatus: 'navigable', seriesNumber: 2, imageNumber: 21 }), true);
}

// ── T13: imageReference navigable finding ────────────────────────────────────

{
  assert.equal(isImageNavigable({
    navigationStatus: 'navigable',
    imageReference: { type: 'series-image', seriesNumber: 6, imageNumber: 23 }
  }), true);
}

// ── T14: imageReference overrides flat — still navigable ─────────────────────

{
  assert.equal(isImageNavigable({
    navigationStatus: 'navigable',
    seriesNumber: null,
    imageNumber: null,
    imageReference: { type: 'series-image', seriesNumber: 3, imageNumber: 5 }
  }), true, 'imageReference with valid coords should make finding navigable even when flat fields are null');
}

// ── T15: negative status → never navigable ────────────────────────────────────

{
  assert.equal(isImageNavigable({
    navigationStatus: 'negative',
    imageReference: { type: 'series-image', seriesNumber: 1, imageNumber: 1 }
  }), false, 'negative status should block navigation regardless of imageReference');
}

// ── T16: non_navigable status → never navigable ──────────────────────────────

{
  assert.equal(isImageNavigable({
    navigationStatus: 'non_navigable',
    seriesNumber: 3,
    imageNumber: 7
  }), false);
}

// ── T17: missing imageNumber → not navigable ─────────────────────────────────

{
  assert.equal(isImageNavigable({
    navigationStatus: 'navigable',
    imageReference: { type: 'series-image', seriesNumber: 2, imageNumber: null }
  }), false);
}

// ── createOpenFindingCommand with imageReference ──────────────────────────────

// ── T18: legacy flat fields → imageReference in command ──────────────────────

{
  const cmd = createOpenFindingCommand({ findingId: 'f1', seriesNumber: 2, imageNumber: 21 });
  assert.equal(cmd.imageReference.seriesNumber, 2);
  assert.equal(cmd.imageReference.imageNumber, 21);
}

// ── T19: imageReference object → used in command ─────────────────────────────

{
  const cmd = createOpenFindingCommand({
    findingId: 'f2',
    imageReference: { type: 'series-image', seriesNumber: 6, imageNumber: 23 }
  });
  assert.equal(cmd.imageReference.seriesNumber, 6);
  assert.equal(cmd.imageReference.imageNumber, 23);
}

// ── T20: imageReference takes precedence over flat in command ─────────────────

{
  const cmd = createOpenFindingCommand({
    findingId: 'f3',
    seriesNumber: 1,
    imageNumber: 5,
    imageReference: { type: 'series-image', seriesNumber: 6, imageNumber: 23 }
  });
  assert.equal(cmd.imageReference.seriesNumber, 6, 'imageReference should win in createOpenFindingCommand');
  assert.equal(cmd.imageReference.imageNumber, 23);
}

// ── T21: malformed imageReference falls back in command ───────────────────────

{
  const cmd = createOpenFindingCommand({ findingId: 'f4', seriesNumber: 3, imageNumber: 9, imageReference: 'bad' });
  assert.equal(cmd.imageReference.seriesNumber, 3, 'malformed imageReference should fall back to flat in command');
}

// ── lvImageLinkProvider with imageReference finding ───────────────────────────

// ── T22: canNavigateFinding accepts imageReference finding ────────────────────

{
  const commands = [];
  const provider = createLvImageLinkProvider({ dispatchViewerCommand: (cmd) => commands.push(cmd) });
  const result = await provider.canNavigateFinding({
    id: 'f5',
    navigationStatus: 'navigable',
    imageReference: { type: 'series-image', seriesNumber: 4, imageNumber: 10 }
  });
  assert.equal(result.canNavigate, true);
}

// ── T23: navigateToFinding dispatches correct imageReference ──────────────────

{
  const commands = [];
  const provider = createLvImageLinkProvider({ dispatchViewerCommand: (cmd) => commands.push(cmd) });
  await provider.navigateToFinding({
    id: 'f6',
    navigationStatus: 'navigable',
    accession: 'ACC-001',
    imageReference: { type: 'series-image', seriesNumber: 4, imageNumber: 10 }
  });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].imageReference.seriesNumber, 4);
  assert.equal(commands[0].imageReference.imageNumber, 10);
}

// ── T24: imageReference overrides flat in lvImageLinkProvider dispatch ────────

{
  const commands = [];
  const provider = createLvImageLinkProvider({ dispatchViewerCommand: (cmd) => commands.push(cmd) });
  await provider.navigateToFinding({
    id: 'f7',
    navigationStatus: 'navigable',
    accession: 'ACC-002',
    seriesNumber: 1,
    imageNumber: 1,
    imageReference: { type: 'series-image', seriesNumber: 9, imageNumber: 99 }
  });
  assert.equal(commands[0].imageReference.seriesNumber, 9, 'imageReference should win in dispatch');
  assert.equal(commands[0].imageReference.imageNumber, 99);
}

console.log('findingImageRef: all tests passed');

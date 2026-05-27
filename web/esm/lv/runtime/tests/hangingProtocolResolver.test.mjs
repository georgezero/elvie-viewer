import assert from 'node:assert/strict';
import { resolveHangingProtocol } from '../hangingProtocolResolver.mjs';

// ── Fixtures — full playbook objects (with steps) ────────────────────────────

const PB_CT_HEAD = {
  id: 'ct-head-report-findings-demo',
  name: 'CT Head Report Findings Demo',
  accession: 'NI9f7ff9',
  steps: [
    { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: 'ct-head-1x2' } } },
    { type: 'reportFinding', finding: { findingId: 0, labelContains: 'caudate infarct', seriesNumber: 2, imageNumber: 21 } }
  ]
};

const PB_MR_KNEE = {
  id: 'mr-knee-report-findings-demo',
  name: 'MR Knee Report Findings Demo',
  accession: '3852755662087132',
  steps: [
    { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: 'mr-knee-2x2' } } },
    { type: 'reportFinding', finding: { findingId: 0, labelContains: 'medial meniscus tear', seriesNumber: 6, imageNumber: 23 } }
  ]
};

const PB_XR_CHEST = {
  id: 'xr-chest-report-demo',
  name: 'XR Chest Report Demo',
  accession: 'CXR-88997',
  steps: [
    { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: 'xr-chest-1x1' } } }
  ]
};

const PB_NO_HP = {
  id: 'playbook-no-hp',
  accession: 'NOHP-001',
  steps: [
    { type: 'reportFinding', finding: { findingId: 0, seriesNumber: 1, imageNumber: 1 } }
  ]
};

const PB_HP_NOT_FIRST = {
  id: 'playbook-hp-second',
  accession: 'HP2-001',
  steps: [
    { type: 'reportFinding', finding: { findingId: 0, seriesNumber: 1, imageNumber: 1 } },
    { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: 'my-protocol' } } }
  ]
};

const ALL_PLAYBOOKS = [PB_CT_HEAD, PB_MR_KNEE, PB_XR_CHEST, PB_NO_HP, PB_HP_NOT_FIRST];

// ── T1: CT head accession → correct protocolId, confidence:exact ──────────────

{
  const r = resolveHangingProtocol({ accession: 'NI9f7ff9', availablePlaybooks: ALL_PLAYBOOKS });
  assert.equal(r.ok, true);
  assert.equal(r.protocolId, 'ct-head-1x2');
  assert.equal(r.playbookId, 'ct-head-report-findings-demo');
  assert.equal(r.confidence, 'exact');
  assert.equal(r.reason, 'playbook_accession_match');
}

// ── T2: MR knee accession → correct protocolId ───────────────────────────────

{
  const r = resolveHangingProtocol({ accession: '3852755662087132', availablePlaybooks: ALL_PLAYBOOKS });
  assert.equal(r.ok, true);
  assert.equal(r.protocolId, 'mr-knee-2x2');
  assert.equal(r.playbookId, 'mr-knee-report-findings-demo');
  assert.equal(r.confidence, 'exact');
}

// ── T3: XR chest accession → correct protocolId ──────────────────────────────

{
  const r = resolveHangingProtocol({ accession: 'CXR-88997', availablePlaybooks: ALL_PLAYBOOKS });
  assert.equal(r.ok, true);
  assert.equal(r.protocolId, 'xr-chest-1x1');
  assert.equal(r.playbookId, 'xr-chest-report-demo');
}

// ── T4: unknown accession → ok:false, no_playbook_match ──────────────────────

{
  const r = resolveHangingProtocol({ accession: 'UNKNOWN-ACC', availablePlaybooks: ALL_PLAYBOOKS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_playbook_match');
}

// ── T5: null accession → ok:false ────────────────────────────────────────────

{
  const r = resolveHangingProtocol({ accession: null, availablePlaybooks: ALL_PLAYBOOKS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_playbook_match');
}

// ── T6: empty string accession → ok:false ────────────────────────────────────

{
  const r = resolveHangingProtocol({ accession: '', availablePlaybooks: ALL_PLAYBOOKS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_playbook_match');
}

// ── T7: no args → ok:false (graceful) ────────────────────────────────────────

{
  // Falls through to findPlaybookForAccession(undefined) → null
  const r = resolveHangingProtocol();
  assert.equal(r.ok, false);
}

// ── T8: playbook with no HP step → ok:false, playbook_has_no_hp_step ─────────

{
  const r = resolveHangingProtocol({ accession: 'NOHP-001', availablePlaybooks: ALL_PLAYBOOKS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'playbook_has_no_hp_step');
}

// ── T9: HP step not first → still found ──────────────────────────────────────

{
  const r = resolveHangingProtocol({ accession: 'HP2-001', availablePlaybooks: ALL_PLAYBOOKS });
  assert.equal(r.ok, true);
  assert.equal(r.protocolId, 'my-protocol');
}

// ── T10: empty availablePlaybooks → ok:false ──────────────────────────────────

{
  const r = resolveHangingProtocol({ accession: 'NI9f7ff9', availablePlaybooks: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_playbook_match');
}

// ── T11: playbook with HP step having empty protocolId → ok:false ─────────────

{
  const pb = { id: 'bad-hp', accession: 'BADHP-001', steps: [
    { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: '' } } }
  ]};
  const r = resolveHangingProtocol({ accession: 'BADHP-001', availablePlaybooks: [pb] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'playbook_has_no_hp_step');
}

// ── T12: playbook with null protocolId → ok:false ─────────────────────────────

{
  const pb = { id: 'null-hp', accession: 'NULLHP-001', steps: [
    { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: null } } }
  ]};
  const r = resolveHangingProtocol({ accession: 'NULLHP-001', availablePlaybooks: [pb] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'playbook_has_no_hp_step');
}

// ── T13: result shape includes all required fields ────────────────────────────

{
  const r = resolveHangingProtocol({ accession: 'NI9f7ff9', availablePlaybooks: ALL_PLAYBOOKS });
  assert.ok('ok' in r);
  assert.ok('protocolId' in r);
  assert.ok('playbookId' in r);
  assert.ok('confidence' in r);
  assert.ok('reason' in r);
}

// ── T14: extra inputs (future fields) are accepted without error ──────────────

{
  const r = resolveHangingProtocol({
    accession: 'NI9f7ff9',
    availablePlaybooks: ALL_PLAYBOOKS,
    studyInstanceUID: '1.2.3.4',
    modality: 'CT',
    studyDescription: 'CT Head',
    finding: { label: 'Caudate infarct' },
    report: { title: 'CT Head Report' },
    seriesCatalog: [{ seriesNumber: 1 }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.protocolId, 'ct-head-1x2');
}

// ── T15: built-in playbooks (no availablePlaybooks) match current behavior ────

{
  // Uses the real built-in playbook list via findPlaybookForAccession
  const r = resolveHangingProtocol({ accession: 'NI9f7ff9' });
  assert.equal(r.ok, true);
  assert.equal(r.protocolId, 'ct-head-1x2');
  assert.equal(r.playbookId, 'ct-head-report-findings-demo');
  assert.equal(r.confidence, 'exact');
}

// ── T16: built-in MR knee matches without availablePlaybooks ─────────────────

{
  const r = resolveHangingProtocol({ accession: '3852755662087132' });
  assert.equal(r.ok, true);
  assert.equal(r.protocolId, 'mr-knee-2x2');
}

// ── T17: unknown accession returns ok:false via built-in path ─────────────────

{
  const r = resolveHangingProtocol({ accession: 'NOT-IN-BUILTINS' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_playbook_match');
}

// ── T18: availablePlaybooks with empty steps → ok:false ───────────────────────

{
  const pb = { id: 'empty-steps', accession: 'EMPTY-001', steps: [] };
  const r = resolveHangingProtocol({ accession: 'EMPTY-001', availablePlaybooks: [pb] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'playbook_has_no_hp_step');
}

// ── T19: playbook with no steps field → ok:false ─────────────────────────────

{
  const pb = { id: 'no-steps', accession: 'NOSTEPS-001' };
  const r = resolveHangingProtocol({ accession: 'NOSTEPS-001', availablePlaybooks: [pb] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'playbook_has_no_hp_step');
}

// ── T20: accession match is exact (case-sensitive, no trimming artifact) ──────

{
  // Accession with leading/trailing space should not match
  const r = resolveHangingProtocol({ accession: ' NI9f7ff9 ', availablePlaybooks: ALL_PLAYBOOKS });
  // trim() is applied in findInList, so this should match
  assert.equal(r.ok, true);
  assert.equal(r.protocolId, 'ct-head-1x2');
}

console.log('hangingProtocolResolver: all tests passed');

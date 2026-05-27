// Pure HP selection resolver — centralizes hanging protocol choice logic
// before the runtime applies it.
//
// Current behavior: accession → built-in playbook → first applyHangingProtocol step.
// Future: extend with finding-aware, modality-aware, and study-description rules
// without touching commandBus.
//
// No DOM, no viewer calls, no side effects.

import { findPlaybookForAccession } from './playbooks.mjs';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extract the protocolId from the first applyHangingProtocol step in a playbook.
 * Mirrors the inline logic previously in commandBus.mjs.
 */
function extractProtocolId(playbook) {
  const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
  for (const step of steps) {
    if (step?.type === 'command' && step.command?.type === 'applyHangingProtocol') {
      return String(step.command.payload?.protocolId || '') || null;
    }
  }
  return null;
}

/**
 * Find a playbook by accession from an explicit list of full playbook objects.
 */
function findInList(accession, playbooks) {
  const acc = String(accession || '').trim();
  if (!acc) return null;
  return playbooks.find((p) => p.accession === acc) ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the best hanging protocol for a study/finding context.
 *
 * Resolution priority (current implementation):
 *   1. Accession → built-in playbook → first applyHangingProtocol step
 *
 * All other inputs (modality, finding, seriesCatalog, etc.) are accepted for
 * future extension but not yet used.
 *
 * @param {object} params
 * @param {string}   [params.accession]
 * @param {string}   [params.studyInstanceUID]   - reserved for future use
 * @param {string}   [params.modality]           - reserved for future use
 * @param {string}   [params.studyDescription]   - reserved for future use
 * @param {object}   [params.finding]            - reserved for future use
 * @param {object}   [params.report]             - reserved for future use
 * @param {object[]} [params.seriesCatalog]      - reserved for future use
 * @param {object[]} [params.availablePlaybooks] - full playbook objects (with steps);
 *                                                 if omitted uses built-in playbooks
 *
 * @returns {{ ok: true,  protocolId: string, playbookId: string, confidence: 'exact', reason: string }
 *          |{ ok: false, reason: string }}
 */
export function resolveHangingProtocol({
  accession,
  availablePlaybooks,
  // eslint-disable-next-line no-unused-vars
  studyInstanceUID, modality, studyDescription, finding, report, seriesCatalog
} = {}) {
  // ── Step 1: accession → playbook lookup ────────────────────────────────────
  const playbook = Array.isArray(availablePlaybooks)
    ? findInList(accession, availablePlaybooks)
    : findPlaybookForAccession(accession);

  if (!playbook) {
    return { ok: false, reason: 'no_playbook_match' };
  }

  // ── Step 2: extract HP step ────────────────────────────────────────────────
  const protocolId = extractProtocolId(playbook);
  if (!protocolId) {
    return { ok: false, reason: 'playbook_has_no_hp_step' };
  }

  return {
    ok: true,
    protocolId,
    playbookId: String(playbook.id || ''),
    confidence: 'exact',
    reason: 'playbook_accession_match'
  };
}

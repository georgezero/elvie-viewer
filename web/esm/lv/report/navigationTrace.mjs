// Navigation trace — structured record of what happened during a semantic navigation command.
//
// Produced by executeOpenFinding and executeOpenStudyThenFinding in commandBus.mjs.
// Agents and debug UIs consume the trace to explain navigation outcomes without
// needing to parse command history or infer state from return codes.

/**
 * Create a frozen navigation trace object.
 *
 * @param {object} fields
 * @param {string}        fields.commandType      - 'openFinding' | 'openStudyThenFinding'
 * @param {string|null}   [fields.accession]
 * @param {string|null}   [fields.findingId]
 * @param {boolean}       [fields.studyResolved]  - Whether study resolution was attempted and succeeded
 * @param {boolean}       [fields.studyOpened]    - Whether a new study was opened (openStudyThenFinding path)
 * @param {boolean}       [fields.playbookApplied]  - Whether a hanging protocol was applied
 * @param {boolean}       [fields.viewPresetApplied] - Whether a WL preset was applied
 * @param {number|null}   [fields.targetPaneId]
 * @param {number|null}   [fields.seriesNumber]
 * @param {number|null}   [fields.imageNumber]
 * @param {string}        [fields.confidence]     - 'exact'|'high'|'medium'|'low' from studyResolver
 * @param {string}        [fields.resolverReason] - reason from studyResolver
 * @param {object[]}      [fields.operations]     - Low-level ops from executeOpenFinding
 * @param {boolean}       fields.ok
 * @param {string}        [fields.reason]         - Failure reason when ok:false
 * @returns {Readonly<object>}
 */
export function createNavigationTrace(fields = {}) {
  return Object.freeze({
    commandType:     String(fields.commandType || 'openFinding'),
    accession:       fields.accession       ?? null,
    findingId:       fields.findingId       ?? null,
    studyResolved:     !!fields.studyResolved,
    studyOpened:       !!fields.studyOpened,
    playbookApplied:   !!fields.playbookApplied,
    viewPresetApplied: !!fields.viewPresetApplied,
    targetPaneId:      fields.targetPaneId    ?? null,
    seriesNumber:    fields.seriesNumber    ?? null,
    imageNumber:     fields.imageNumber     ?? null,
    confidence:      fields.confidence      ?? null,
    resolverReason:  fields.resolverReason  ?? null,
    operations:      Array.isArray(fields.operations) ? fields.operations.slice() : [],
    ok:              !!fields.ok,
    reason:          fields.reason          ?? null
  });
}

/**
 * Compact one-line summary of a navigation trace for status display.
 *
 * @param {ReturnType<createNavigationTrace>} trace
 * @returns {string}
 */
export function summarizeNavigationTrace(trace) {
  if (!trace) return 'no trace';
  if (!trace.ok) {
    return `Navigation failed: ${trace.reason || 'unknown'}`;
  }

  const parts = [];

  if (trace.commandType === 'openStudyThenFinding' && trace.studyOpened) {
    parts.push('study opened');
  }

  if (trace.playbookApplied) {
    parts.push(`HP pane ${trace.targetPaneId ?? '?'}`);
  } else {
    parts.push(`active pane`);
  }

  if (trace.seriesNumber != null) {
    parts.push(`series ${trace.seriesNumber}`);
  }
  if (trace.imageNumber != null) {
    parts.push(`image ${trace.imageNumber}`);
  }

  if (trace.confidence && trace.confidence !== 'exact') {
    parts.push(`[${trace.confidence}]`);
  }

  return parts.join(' · ');
}

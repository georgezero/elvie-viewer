// Semantic command shapes for agent → viewer navigation.
//
// Agents and report UI express intent ("open this finding") without knowing
// viewer mechanics (series/image layout, SOPInstanceUID, frame coordinates).
// Viewer adapters receive these commands and translate to their own APIs.

import { normalizeFindingImageReference } from './imageLinkProvider.mjs';

export const COMMAND_VERSION = 'agent-viewer-command-v1';

/**
 * @param {object} args
 * @param {string|null} args.accession
 * @param {string} args.findingId
 * @param {number|null} [args.seriesNumber]   - Legacy flat field; ignored when imageReference provided
 * @param {number|null} [args.imageNumber]    - Legacy flat field; ignored when imageReference provided
 * @param {object}      [args.imageReference] - Structured ref; takes precedence over flat fields
 * @param {object}      [args.viewPreset]     - Optional WL preset, e.g. { type:'ct-window', preset:'brain_stroke' }
 * @returns {Readonly<object>}
 */
export function createOpenFindingCommand({ accession, findingId, seriesNumber, imageNumber, imageReference, viewPreset }) {
  if (findingId == null || String(findingId).trim() === '') {
    throw new TypeError('createOpenFindingCommand: findingId is required');
  }
  const ref = normalizeFindingImageReference({ seriesNumber, imageNumber, imageReference });
  return Object.freeze({
    type: 'openFinding',
    accession: accession ?? null,
    findingId: String(findingId),
    imageReference: Object.freeze(ref),
    viewPreset: viewPreset ?? null
  });
}

/**
 * @param {object} args
 * @param {string|null} args.accession
 * @param {string|undefined} args.studyInstanceUID
 * @returns {Readonly<object>}
 */
export function createOpenStudyCommand({ accession, studyInstanceUID } = {}) {
  return Object.freeze({
    type: 'openStudy',
    accession: accession ?? null,
    studyInstanceUID: studyInstanceUID ?? null
  });
}

/**
 * Orchestration command: open/load a study (if not already loaded), apply the
 * hanging protocol if one is registered for the accession, then navigate to the
 * specified finding.
 *
 * @param {object} args
 * @param {string|null} args.accession
 * @param {string|undefined} args.studyInstanceUID
 * @param {string} args.findingId
 * @param {number|null} [args.seriesNumber]
 * @param {number|null} [args.imageNumber]
 * @param {object}      [args.imageReference]
 * @param {object}      [args.viewPreset]     - Optional WL preset, e.g. { type:'ct-window', preset:'brain_stroke' }
 * @returns {Readonly<object>}
 */
export function createOpenStudyThenFindingCommand({ accession, studyInstanceUID, findingId, seriesNumber, imageNumber, imageReference, viewPreset } = {}) {
  if (findingId == null || String(findingId).trim() === '') {
    throw new TypeError('createOpenStudyThenFindingCommand: findingId is required');
  }
  const ref = normalizeFindingImageReference({ seriesNumber, imageNumber, imageReference });
  return Object.freeze({
    type: 'openStudyThenFinding',
    accession: accession ?? null,
    studyInstanceUID: studyInstanceUID ?? null,
    findingId: String(findingId),
    imageReference: Object.freeze(ref),
    viewPreset: viewPreset ?? null
  });
}

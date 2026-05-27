// LV embedded ImageLinkProvider adapter.
//
// Connects the report viewer's finding model to the LV viewer via a
// deps-injected command dispatcher. Does not import or modify the viewer,
// the ingestion pipeline, or the finding model.
//
// Usage:
//   import { createLvImageLinkProvider } from './lvImageLinkProvider.mjs';
//   const provider = createLvImageLinkProvider({
//     dispatchViewerCommand: (cmd) => commandBus.dispatch(cmd),
//     getViewerState: () => viewerStore.getState(),         // optional
//     getImageAvailability: async (acc) => { ... }          // optional
//   });

import { INTERFACE_VERSION, normalizeFindingImageReference } from './imageLinkProvider.mjs';
import { createOpenFindingCommand, createOpenStudyThenFindingCommand } from './agentViewerCommand.mjs';
import { inferViewPreset } from './viewPresetInference.mjs';

const NAV_STATUSES_BLOCKED = new Set(['negative', 'non_navigable']);

/**
 * Classify why a finding cannot be navigated to, or null if it can.
 *
 * @param {import('./imageLinkProvider.mjs').FindingRef} finding
 * @returns {{ canNavigate: false, reason: string } | null}
 */
function whyNotNavigable(finding) {
  const status = String(finding?.navigationStatus || '').toLowerCase();
  if (NAV_STATUSES_BLOCKED.has(status)) {
    return { canNavigate: false, reason: `finding is ${status}` };
  }
  const ref = normalizeFindingImageReference(finding);
  if (ref.seriesNumber == null) {
    return { canNavigate: false, reason: 'finding has no series number' };
  }
  if (ref.imageNumber == null) {
    return { canNavigate: false, reason: 'finding has no image number' };
  }
  return null;
}

/**
 * Create an LV-embedded ImageLinkProvider.
 *
 * @param {object} deps
 * @param {((cmd: object) => void) | undefined} deps.dispatchViewerCommand  - Primary dispatch path
 * @param {((cmd: object) => void) | undefined} deps.sendViewerCommand      - Alternate dispatch path
 * @param {(() => object) | undefined}           deps.getViewerState         - Optional; for future use
 * @param {((accession: string) => Promise<import('./imageLinkProvider.mjs').ImageAvailabilityResult>) | undefined} deps.getImageAvailability - Optional delegate
 * @returns {import('./imageLinkProvider.mjs').ImageLinkProvider & { interfaceVersion: string }}
 */
export function createLvImageLinkProvider(deps = {}) {
  const dispatch = deps.dispatchViewerCommand ?? deps.sendViewerCommand ?? null;
  if (dispatch !== null && typeof dispatch !== 'function') {
    throw new TypeError(
      'createLvImageLinkProvider: deps.dispatchViewerCommand / deps.sendViewerCommand must be a function'
    );
  }
  if (deps.getViewerState !== undefined && typeof deps.getViewerState !== 'function') {
    throw new TypeError('createLvImageLinkProvider: deps.getViewerState must be a function');
  }
  if (deps.getImageAvailability !== undefined && typeof deps.getImageAvailability !== 'function') {
    throw new TypeError('createLvImageLinkProvider: deps.getImageAvailability must be a function');
  }

  return Object.freeze({
    interfaceVersion: INTERFACE_VERSION,

    async canNavigateFinding(finding) {
      const block = whyNotNavigable(finding);
      if (block) return block;
      return { canNavigate: true };
    },

    async navigateToFinding(finding, options) {
      const block = whyNotNavigable(finding);
      if (block) return { ok: false, reason: block.reason };

      if (!dispatch) {
        return { ok: false, reason: 'no viewer command dispatcher configured' };
      }

      const accession = finding.accession ?? options?.accession ?? null;
      const studyInstanceUID = finding.studyInstanceUID ?? options?.studyInstanceUID ?? null;
      const ref = normalizeFindingImageReference(finding);

      // Infer WL preset for CT findings. Non-fatal — any error leaves viewPreset null.
      let viewPreset = null;
      try {
        // Pass options.modality as a synthetic seriesEntry so inferViewPreset can
        // detect modality when it's not on the finding itself.
        const seriesEntry = options?.modality ? { modality: options.modality } : undefined;
        const inferred = inferViewPreset({ finding, seriesEntry, report: options?.report });
        if (inferred.type === 'ct-window') viewPreset = inferred;
      } catch {
        // Preset inference is best-effort; navigation proceeds without it.
      }

      const command = accession != null
        ? createOpenStudyThenFindingCommand({ accession, studyInstanceUID, findingId: finding.id, seriesNumber: ref.seriesNumber, imageNumber: ref.imageNumber, viewPreset })
        : createOpenFindingCommand({ accession: null, findingId: finding.id, seriesNumber: ref.seriesNumber, imageNumber: ref.imageNumber, viewPreset });

      const result = await dispatch(command);
      return result ?? { ok: true };
    },

    async getImageAvailability(accession) {
      if (typeof deps.getImageAvailability === 'function') {
        return deps.getImageAvailability(accession);
      }
      return { available: true };
    },

    async getSeriesCatalog(accession) {
      if (typeof deps.getSeriesCatalog === 'function') {
        return deps.getSeriesCatalog(accession);
      }
      return { accession, series: [] };
    }
  });
}

// Semantic report-tour commands for agent-driven finding review.
//
// Wraps findingNavigationSession with stable command names that map directly
// to agent intent ("start tour", "next finding", "open it") without exposing
// session cursor mechanics.
//
// Usage:
//   import { createReportTour } from './reportTourCommands.mjs';
//   const tour = createReportTour({
//     getFindings: () => currentFindings,
//     getProvider: () => imageLinkProvider
//   });
//   tour.startReportTour();
//   tour.nextReportFinding();
//   await tour.openCurrentReportFinding();

import { createFindingNavigationSession, navigateCurrentFinding } from './findingNavigationSession.mjs';

const INACTIVE_STATUS = Object.freeze({
  active: false,
  index: -1,
  total: 0,
  currentFindingId: null,
  hasNext: false,
  hasPrevious: false
});

/**
 * Create a report tour command object.
 *
 * @param {object} deps
 * @param {() => object[]}                       deps.getFindings - Returns current findings array
 * @param {() => import('./imageLinkProvider.mjs').ImageLinkProvider} deps.getProvider - Returns active provider
 * @returns {object} Tour command handle
 */
export function createReportTour(deps = {}) {
  let session = null;
  let active  = false;

  function statusOf() {
    if (!active || !session) return { ...INACTIVE_STATUS };
    const p = session.getProgress();
    const f = session.currentFinding();
    return {
      active:          true,
      index:           p.index,
      total:           p.total,
      currentFindingId: f?.id ?? null,
      currentFinding:  f ?? null,
      hasNext:         p.hasNext,
      hasPrevious:     p.hasPrevious
    };
  }

  return {
    /**
     * Start (or restart) a tour over the current findings.
     *
     * @param {object} [options] - Passed through to createFindingNavigationSession
     * @returns {object} Tour status
     */
    startReportTour(options = {}) {
      const findings = typeof deps.getFindings === 'function' ? deps.getFindings() : [];
      session = createFindingNavigationSession(findings, { navigableOnly: true, ...options });
      active  = true;
      return statusOf();
    },

    /**
     * Advance to the next finding and return it, or null at the end.
     * @returns {object|null}
     */
    nextReportFinding() {
      if (!session || !active) return null;
      return session.nextFinding();
    },

    /**
     * Retreat to the previous finding and return it, or null before the start.
     * @returns {object|null}
     */
    previousReportFinding() {
      if (!session || !active) return null;
      return session.previousFinding();
    },

    /**
     * Navigate the viewer to the current finding via the injected provider.
     * Does not advance the cursor.
     *
     * @returns {Promise<{ ok: boolean, reason?: string, trace?: object }>}
     */
    async openCurrentReportFinding() {
      if (!session || !active) return { ok: false, reason: 'no_active_tour' };
      const provider = typeof deps.getProvider === 'function' ? deps.getProvider() : null;
      return navigateCurrentFinding(session, provider);
    },

    /**
     * Return the current tour status snapshot.
     *
     * @returns {{ active, index, total, currentFindingId, hasNext, hasPrevious }}
     */
    getReportTourStatus() {
      return statusOf();
    },

    /**
     * End the tour and release the session.
     * @returns {{ active: false }}
     */
    endReportTour() {
      session = null;
      active  = false;
      return { active: false };
    }
  };
}

// Sequential finding navigation session.
//
// Wraps a filtered, ordered list of findings and tracks a cursor so agents or
// UI can step through them one at a time without knowing viewer internals.
//
// Usage:
//   const session = createFindingNavigationSession(findings, { navigableOnly: true });
//   session.nextFinding();               // advance and return finding
//   await navigateCurrentFinding(session, provider);  // delegate to provider

import { normalizeFindingImageReference } from './imageLinkProvider.mjs';

/**
 * Return true when a finding has enough coordinates for the viewer to navigate
 * to a specific image (series + image number both present, status not blocked).
 *
 * Mirrors the guard in reportViewer.mjs without importing the full UI module.
 */
function isNavigable(finding) {
  const status = String(finding?.navigationStatus || '').toLowerCase();
  if (status === 'negative' || status === 'non_navigable') return false;
  const ref = normalizeFindingImageReference(finding);
  return ref.seriesNumber != null && ref.imageNumber != null;
}

function isNegative(finding) {
  const nav = String(finding?.navigationStatus || '').toLowerCase();
  const sev = String(finding?.severity || '').toLowerCase();
  return nav === 'negative' || sev === 'negative';
}

/**
 * Build the filtered queue of findings for a session.
 *
 * @param {object[]} findings - Source findings in report order
 * @param {object}   options
 * @param {boolean}  [options.navigableOnly=true]   - Include only findings with image coords
 * @param {boolean}  [options.excludeNegative=false] - Exclude negative/normal findings
 * @param {boolean}  [options.positiveOnly=false]    - Alias for excludeNegative
 * @param {number}   [options.minConfidence]         - Minimum confidence score (0–1)
 * @param {string[]} [options.tags]                  - Require at least one tag match (future field)
 * @returns {object[]}
 */
function buildQueue(findings, options) {
  const navigableOnly  = options.navigableOnly !== false;
  const excludeNeg     = !!(options.excludeNegative || options.positiveOnly);
  const minConf        = (typeof options.minConfidence === 'number' && options.minConfidence > 0)
                           ? options.minConfidence : null;
  const filterTags     = Array.isArray(options.tags) && options.tags.length > 0
                           ? options.tags : null;

  return (Array.isArray(findings) ? findings : []).filter((f) => {
    if (navigableOnly && !isNavigable(f)) return false;
    if (excludeNeg && isNegative(f)) return false;
    if (minConf !== null) {
      const c = Number(f?.confidence);
      if (!Number.isFinite(c) || c < minConf) return false;
    }
    if (filterTags !== null) {
      const fTags = Array.isArray(f?.tags) ? f.tags : [];
      if (!filterTags.some((t) => fTags.includes(t))) return false;
    }
    return true;
  });
}

/**
 * Create a stateful finding navigation session.
 *
 * The session holds a filtered, stable-ordered queue and a cursor.
 * Cursor starts at -1 (before the first finding). Call nextFinding() to advance.
 *
 * @param {object[]} findings - Findings in report order (not mutated)
 * @param {object}   [options] - Filter options (see buildQueue)
 * @returns {object} Session handle
 */
export function createFindingNavigationSession(findings, options = {}) {
  const queue = buildQueue(findings, options);
  let cursor = -1;

  return {
    /** Advance cursor and return the next finding, or null when already at the end. */
    nextFinding() {
      if (cursor >= queue.length - 1) return null;
      cursor++;
      return queue[cursor];
    },

    /** Retreat cursor and return the previous finding, or null before the start. */
    previousFinding() {
      if (cursor <= 0) return null;
      cursor--;
      return queue[cursor];
    },

    /** Return the finding at the current cursor without moving it. */
    currentFinding() {
      return cursor >= 0 && cursor < queue.length ? queue[cursor] : null;
    },

    /** Reset cursor to before the first finding (cursor = -1). */
    reset() {
      cursor = -1;
    },

    /**
     * Return progress state.
     * @returns {{ index: number, total: number, hasPrevious: boolean, hasNext: boolean }}
     */
    getProgress() {
      return {
        index:       cursor,
        total:       queue.length,
        hasPrevious: cursor > 0,
        hasNext:     cursor < queue.length - 1
      };
    }
  };
}

/**
 * Navigate to the session's current finding using an ImageLinkProvider.
 *
 * Does not advance the cursor — call nextFinding() / previousFinding() first,
 * then call navigateCurrentFinding() to dispatch to the viewer.
 *
 * @param {ReturnType<createFindingNavigationSession>} session
 * @param {import('./imageLinkProvider.mjs').ImageLinkProvider} provider
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function navigateCurrentFinding(session, provider) {
  const finding = session.currentFinding();
  if (!finding) {
    return { ok: false, reason: 'no_current_finding' };
  }
  if (!provider || typeof provider.navigateToFinding !== 'function') {
    return { ok: false, reason: 'no_provider' };
  }
  return provider.navigateToFinding(finding);
}

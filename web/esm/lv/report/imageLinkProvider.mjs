// ImageLinkProvider — interface definition only.
//
// Abstraction layer between Finding → Image Intent → Viewer Action.
// No viewer logic is implemented here. Callers inject a concrete provider.
//
// Abstraction path:
//   Finding (report layer)
//     → canNavigateFinding / navigateToFinding (this interface)
//       → concrete provider (native viewer, OHIF, stub, null)
//
// All methods are async so implementations can query remote state without
// forcing callers to handle sync/async divergence.

export const INTERFACE_VERSION = 'image-link-provider-v1';

/**
 * Minimal finding shape consumed by this interface.
 * Does not couple to the full internal finding model —
 * only the fields needed to resolve an image navigation intent.
 *
 * @typedef {Object} FindingRef
 * @property {string}      id               - Stable finding ID
 * @property {string}      navigationStatus - 'navigable' | 'series_only' | 'non_navigable' | 'negative'
 * @property {number|null} seriesNumber     - Series number (null if not cited)
 * @property {number|null} imageNumber      - Image/instance number (null if not cited)
 */

/**
 * One entry in a series catalog.
 *
 * @typedef {Object} SeriesEntry
 * @property {number}      seriesNumber      - DICOM series number
 * @property {string}      seriesInstanceUID - DICOM Series Instance UID
 * @property {string}      modality          - CT | MR | CR | ...
 * @property {number}      imageCount        - Number of images in the series
 */

/**
 * Catalog of series available for an accession.
 * Placeholder — expand when real catalog queries are available.
 *
 * @typedef {Object} SeriesCatalog
 * @property {string}        accession - Accession number
 * @property {SeriesEntry[]} series    - Series in acquisition order
 */

/**
 * Options passed to navigateToFinding.
 * All fields are optional and may be ignored by implementations
 * that do not yet support them.
 *
 * @typedef {Object} NavigateOptions
 * @property {boolean} [focus]     - Bring the viewer window/pane to front
 * @property {boolean} [highlight] - Overlay a visual marker on the target image
 */

/**
 * Result of canNavigateFinding.
 *
 * @typedef {Object} CanNavigateResult
 * @property {boolean} canNavigate - Whether navigation is possible right now
 * @property {string}  [reason]    - Human-readable explanation when canNavigate is false
 */

/**
 * Result of getImageAvailability.
 *
 * @typedef {Object} ImageAvailabilityResult
 * @property {boolean} available - Whether images are accessible
 * @property {string}  [reason]  - Human-readable explanation when available is false
 */

/**
 * ImageLinkProvider — the core contract for Finding → Viewer navigation.
 *
 * Implement this interface to connect a viewer (native, OHIF, remote, stub)
 * to the report viewer without touching the ingestion pipeline or data model.
 *
 * All methods are async. canNavigateFinding may be called frequently
 * (once per rendered finding card), so implementations should keep it cheap —
 * return synchronously-resolved promises where possible and avoid I/O.
 *
 * @typedef {Object} ImageLinkProvider
 *
 * @property {(finding: FindingRef) => Promise<CanNavigateResult>} canNavigateFinding
 *   Returns whether the provider can navigate to this specific finding right now.
 *   Called per finding card. Must not throw — return { canNavigate: false, reason } on error.
 *
 * @property {(finding: FindingRef, options?: NavigateOptions) => Promise<void>} navigateToFinding
 *   Instruct the viewer to navigate to the finding's image location.
 *   Should resolve once the navigation intent has been dispatched (not necessarily
 *   once the viewer has finished scrolling). May throw on unrecoverable error.
 *
 * @property {(accession: string) => Promise<ImageAvailabilityResult>} getImageAvailability
 *   Return whether images for this accession are currently accessible.
 *   Used by the report viewer to set imageAvailability status on the document.
 *   Must not throw — return { available: false, reason } on error.
 *
 * @property {((accession: string) => Promise<SeriesCatalog>) | undefined} getSeriesCatalog
 *   Optional. Return the series catalog for an accession.
 *   Used for multi-series matching and approximate navigation.
 *   Omit if the provider does not support catalog queries.
 */

/**
 * Normalize a finding's image location into a canonical imageReference shape.
 *
 * Accepts legacy flat fields (seriesNumber, imageNumber) or a structured
 * imageReference object. imageReference takes precedence when both are present.
 * Non-object or array imageReference values fall back to flat fields.
 *
 * @param {object} finding
 * @returns {Readonly<{ type: string, seriesNumber: number|null, imageNumber: number|null }>}
 */
export function normalizeFindingImageReference(finding) {
  const ref = finding?.imageReference;
  if (ref != null && typeof ref === 'object' && !Array.isArray(ref)) {
    return Object.freeze({
      type: String(ref.type ?? 'series-image'),
      seriesNumber: ref.seriesNumber ?? null,
      imageNumber: ref.imageNumber ?? null
    });
  }
  return Object.freeze({
    type: 'series-image',
    seriesNumber: finding?.seriesNumber ?? null,
    imageNumber: finding?.imageNumber ?? null
  });
}

/**
 * Null provider — safe default when no viewer is connected.
 *
 * Always returns canNavigate: false and available: false.
 * Lets call sites skip null checks without branching on provider presence.
 *
 * @type {ImageLinkProvider}
 */
export const nullImageLinkProvider = Object.freeze({
  async canNavigateFinding(_finding) {
    return { canNavigate: false, reason: 'no viewer connected' };
  },
  async navigateToFinding(_finding, _options) {
    // no-op
  },
  async getImageAvailability(_accession) {
    return { available: false, reason: 'no viewer connected' };
  }
  // getSeriesCatalog intentionally absent — optional on the interface
});

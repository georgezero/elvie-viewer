// Hyperframes launch adapter.
//
// This is the ONLY presentation module that is Hyperframes-aware. It consumes a
// generic PresentationManifest (see presentationManifest.mjs), publishes it to a
// stable URL, and constructs a launch URL pointing at HYPERFRAMES_BASE_URL.
//
// ⚠ INTEGRATION STATUS — UNVERIFIED (as of 2026-06-26):
//
// hyperframes.heygen.com is the documentation/marketing site for HyperFrames,
// an open-source HTML-to-MP4 video composition CLI framework.  It is NOT a
// slide deck web application and does NOT accept a ?manifest=<url> parameter.
// When opened with the current launch URL, the site shows its own homepage and
// ignores all query parameters.
//
// Blocked on:
//   1. A confirmed API endpoint or slide-rendering route on hyperframes.heygen.com
//   2. A Hyperframes-compatible manifest format (they use HTML compositions, not JSON)
//   3. A public https:// manifest URL (localhost manifests are unreachable externally)
//
// The PresentationManifest format (presentation-manifest-v1 JSON) is intentionally
// generic — it is not tied to HyperFrames specifically. The local Preview Deck in
// presentationPreview.mjs provides a functional local rendering path regardless of
// external integration status.
//
// Transport model: a stable manifest URL, not a large inline query payload.
// All external dependencies (manifest builder, publisher, window opener) are injectable
// so the adapter remains deterministic and testable.

import {
  buildPresentationManifest,
  assessPresentationReadiness
} from './presentationManifest.mjs';

export const HYPERFRAMES_BASE_URL = 'https://hyperframes.heygen.com';

// Default publisher: serialize the manifest to a blob and return a stable
// object URL. This satisfies the "stable URL, not inline payload" transport
// contract for v1 and is session-derived / non-permanent.
//
// Known v1 limitation: a blob: URL is scoped to the creating origin, so a
// cross-origin consumer cannot fetch it directly. Swap this publisher for an
// upload-to-storage step (returning an https URL) to enable real cross-origin
// resolution — the rest of the adapter is unchanged.
function defaultPublishManifest(manifest, env) {
  const BlobCtor = env.Blob || (typeof Blob !== 'undefined' ? Blob : null);
  const urlApi = env.URL || (typeof URL !== 'undefined' ? URL : null);
  if (!BlobCtor || !urlApi || typeof urlApi.createObjectURL !== 'function') {
    throw new Error('manifest_publish_unavailable');
  }
  const json = JSON.stringify(manifest);
  const blob = new BlobCtor([json], { type: 'application/json' });
  return urlApi.createObjectURL(blob);
}

/**
 * Compose the Hyperframes launch URL that references a published manifest.
 *
 * @param {string} manifestUrl - Stable URL to the published manifest
 * @param {object} [options]
 * @param {string} [options.baseUrl=HYPERFRAMES_BASE_URL]
 * @returns {string}
 */
export function buildHyperframesLaunchUrl(manifestUrl, options = {}) {
  const base = options.baseUrl || HYPERFRAMES_BASE_URL;
  const url = new URL(base);
  url.searchParams.set('manifest', String(manifestUrl));
  url.searchParams.set('source', 'elvie-viewer');
  return url.toString();
}

/**
 * Build a presentation manifest from the active report context and launch
 * Hyperframes against it.
 *
 * @param {object} params
 * @param {object} params.context - PresentationContext (active report context)
 * @param {string} [params.source]
 * @param {boolean} [params.debug=false]
 * @param {boolean} [params.includeTrace=false]
 * @param {string} [params.generatedAt] - injectable ISO timestamp for tests
 * @param {string} [params.baseUrl]
 * @param {Map}    [params.evidenceMap] - Map<findingId, EvidenceResult[]> from evidenceCollector
 * @param {(manifest: object, env: object) => string} [params.publishManifest]
 * @param {(url: string) => any} [params.openWindow] - defaults to window.open
 * @param {object} [params.env] - { Blob, URL } overrides for tests
 * @returns {{ ok: boolean, reason?: string, message: string, blocked?: boolean,
 *            mode?: string, manifest?: object, manifestUrl?: string, launchUrl?: string }}
 */
export function launchHyperframesPresentation(params = {}) {
  const {
    context,
    source,
    debug = false,
    includeTrace = false,
    generatedAt,
    baseUrl,
    evidenceMap,
    publishManifest = defaultPublishManifest,
    openWindow,
    env = {}
  } = params;

  const readiness = assessPresentationReadiness(context);
  if (!readiness.ok) {
    // Guardrail: no active report -> block launch with a clear message.
    return {
      ok: false,
      blocked: true,
      reason: readiness.reason,
      message: readiness.message
    };
  }

  const manifest = buildPresentationManifest(context, {
    source,
    debug,
    includeTrace,
    generatedAt,
    evidenceMap: evidenceMap instanceof Map ? evidenceMap : undefined
  });

  let manifestUrl;
  try {
    manifestUrl = publishManifest(manifest, env);
  } catch (err) {
    return {
      ok: false,
      reason: 'manifest_publish_failed',
      message: `Could not publish presentation manifest: ${err?.message || err}`,
      manifest
    };
  }

  const launchUrl = buildHyperframesLaunchUrl(manifestUrl, { baseUrl });

  const opener =
    openWindow ||
    ((url) => (typeof window !== 'undefined' && window.open ? window.open(url, '_blank', 'noopener') : null));
  let opened = null;
  try {
    opened = opener(launchUrl);
  } catch (err) {
    return {
      ok: false,
      reason: 'launch_failed',
      message: `Could not open Hyperframes: ${err?.message || err}`,
      manifest,
      manifestUrl,
      launchUrl
    };
  }

  return {
    ok: true,
    mode: readiness.mode,
    message:
      readiness.mode === 'non_navigable'
        ? 'Launched Hyperframes with a non-navigable presentation deck.'
        : 'Launched Hyperframes presentation.',
    manifest,
    manifestUrl,
    launchUrl,
    window: opened
  };
}

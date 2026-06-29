// Manifest publisher.
//
// Primary: posts the manifest to the service worker at
//   /lv-manifest-worker.js, which serves it at
//   GET /lv-manifest/{id}.json with CORS.
//   These URLs are fetchable by any http client on the same machine.
//
// Fallback: session-scoped blob: URL (same-origin, non-fetchable cross-origin).
//   Used when the SW has not yet taken control (first load before claim).
//
// Known transport gap — localhost URLs are not reachable from remote servers
// such as hyperframes.heygen.com.  Resolve by replacing publishManifest with
// a cloud-storage upload step that returns an https:// URL.

const SW_SCRIPT = '/lv-manifest-worker.js';
const MANIFEST_PREFIX = '/lv-manifest/';

let _registered = false;

function genId() {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Register the manifest service worker.  Safe to call multiple times;
 * subsequent calls are no-ops once the registration succeeds.
 * @returns {Promise<void>}
 */
export async function registerManifestWorker() {
  if (_registered || !navigator?.serviceWorker) return;
  try {
    await navigator.serviceWorker.register(SW_SCRIPT);
    _registered = true;
  } catch { /* fallback to blob: if SW registration fails */ }
}

/**
 * Publish a presentation manifest and return a fetchable URL.
 *
 * When the service worker is active, returns http://localhost:{port}/lv-manifest/{id}.json.
 * Falls back to a blob: URL when the SW is not yet controlling the page.
 *
 * @param {object} manifest - PresentationManifest from buildPresentationManifest
 * @returns {string}
 */
export function publishManifest(manifest) {
  const id = genId();
  const sw = navigator?.serviceWorker?.controller;
  if (sw) {
    sw.postMessage({ type: 'store-manifest', id, manifest });
    return `${location.origin}${MANIFEST_PREFIX}${id}.json`;
  }
  // Blob fallback
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  return URL.createObjectURL(blob);
}

/**
 * Trigger a browser file download of the full manifest as formatted JSON.
 * The downloaded file includes all sections, speaker notes, and any embedded
 * image evidence (base64 data URLs) — a complete human-inspectable package.
 *
 * @param {object} manifest
 * @param {string} [filename]
 */
export function downloadManifest(manifest, filename) {
  const acc = String(manifest?.accession || 'export').replace(/[^a-z0-9_-]/gi, '_');
  const name = filename || `lv-presentation-${acc}.json`;
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Describe the transport status of a manifest URL for display in the UI.
 * @param {string|null} manifestUrl
 * @returns {string}
 */
export function transportStatus(manifestUrl) {
  if (!manifestUrl) return '';
  if (/^blob:/.test(manifestUrl)) {
    return 'Transport: session-scoped blob URL — not fetchable cross-origin.';
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(manifestUrl)) {
    return 'Hyperframes export prepared. External rendering requires fetchable hosted assets.';
  }
  if (/^https:/.test(manifestUrl)) {
    return 'Manifest published at a publicly fetchable HTTPS URL.';
  }
  return '';
}

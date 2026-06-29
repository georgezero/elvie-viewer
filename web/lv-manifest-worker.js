// Presentation manifest service worker.
//
// Serves published presentation manifests at GET /lv-manifest/{id}.json
// from an in-memory store with permissive CORS.  Manifests are stored via
// postMessage and live for the lifetime of this worker instance.
//
// This makes local manifest URLs fetchable by browser tests and by any
// http client on the same machine (localhost).  Remote servers such as
// hyperframes.heygen.com cannot reach localhost URLs — that requires
// a cloud-storage publish step.

const store = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  if (e.data?.type === 'store-manifest' && e.data.id && e.data.manifest) {
    store.set(String(e.data.id), e.data.manifest);
  }
});

self.addEventListener('fetch', e => {
  const path = new URL(e.request.url).pathname;
  const m = /^\/lv-manifest\/([a-z0-9]+)\.json$/.exec(path);
  if (!m) return;
  const manifest = store.get(m[1]);
  if (!manifest) return;
  e.respondWith(new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  }));
});

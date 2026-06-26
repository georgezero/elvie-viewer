# elvie-viewer

Browser-based AI-assisted medical imaging viewer. No build step. No server required for basic use.

## Quick start

```bash
cd web
python3 -m http.server 4173
```

Open: http://localhost:4173/index.html

## Configuring endpoints

Open the config panel (gear icon). All settings are saved to localStorage and used directly from the browser.

| Endpoint | Notes |
|----------|-------|
| DICOMweb Base URL | Default: `/orthanc/dicom-web` (same-origin via elvie-server nginx) |
| LLM | Presets: LM Studio, Ollama, vLLM, OpenAI |
| OCR | Preset: same as LLM, or Custom |
| Whisper (STT) | Preset: Elvie Server built-in `/whisper`, or Custom |
| TTS | Enable toggle + endpoint |
| Case API | Optional: pre-parsed case JSON server URL |

Any DICOMweb-compatible PACS works: Orthanc, dcm4chee, enterprise PACS, cloud.

## Case API (optional)

The viewer can load a pre-parsed case on startup via URL params:

```
index.html?caseId=my-case-id
index.html?accession=ACC123456
```

Set `Case API base URL` in Settings → Case API before use.

## Files

- `web/index.html` — viewer (canonical entry point)
- `web/esm/` — ES module tree
- `web/vendor/` — Cornerstone.js, pdf.js, WASM codecs

## Agent control

The viewer exposes `window.dispatchViewerCommand` for programmatic control from AI agents (OpenClaw, Hermes, Codex, Claude, custom). See [AGENT.md](AGENT.md) for the full command reference, inline playbook schema, and integration notes.

## Tests

**Unit tests** (Node test runner, no server needed):

```bash
node --test 'web/esm/**/*.test.mjs'
```

**Browser tests** (Playwright, Chromium):

```bash
npm install          # first time only
npx playwright test
```

Screenshots are written to `test-artifacts/hyperframes/` and are not committed.

Playwright starts `python3 -m http.server 4173` from the `web/` directory automatically. If a server is already running on that port, it is reused.

Limitations:
- No DICOM or DICOMweb server is required for browser tests — they use injected mock report contexts or the seeded demo reports.
- Image evidence (`imageEvidence` in each manifest section) is collected by navigating to each positive finding and capturing the active Cornerstone canvas via `canvas.toDataURL()`. Without a DICOMweb server, canvases are blank and evidence records carry an explicit status (`no_viewer`, `no_canvas`, or `skipped_non_navigable`) rather than a data URL. The manifest is still valid and Hyperframes-launchable; the status fields let the consumer decide how to handle missing visuals.

## Hyperframes presentation export

Clicking **PRESENT** on a loaded report:
1. Collects image evidence from the viewer (Cornerstone canvas capture per positive finding)
2. Builds a `presentation-manifest-v1` JSON object with sections, speaker notes, and evidence
3. Publishes the manifest to a fetchable local URL via the service worker at `/lv-manifest-worker.js`
4. Opens the **Preview Deck** — an Elvie-local slide view of the prepared manifest
5. **"Open in Hyperframes ↗"** inside the Preview Deck triggers the actual external Hyperframes launch

### What works locally

- Preview Deck shows all positive findings with text, speaker notes, and any captured images
- Manifest is served at `http://localhost:4173/lv-manifest/{id}.json` with permissive CORS
- The manifest URL is fetchable by any http client on the same machine (browser tests, curl)
- **"Export JSON ↓"** downloads the full manifest as `lv-presentation-{accession}.json` — includes all sections, speaker notes, and base64-encoded image evidence

### What is still blocked

- `localhost` URLs are not reachable from `hyperframes.heygen.com` servers
- The "Open in Hyperframes" button passes a `manifest=http://localhost:...` query param that Hyperframes cannot fetch from the public internet
- Resolution: replace `publishManifest` in `manifestPublisher.mjs` with a cloud-storage upload step (S3 pre-signed URL, GCS, etc.) that returns an `https://` URL

### How to inspect a manifest manually

```bash
# After clicking PRESENT, the manifest URL appears in the browser console or
# can be captured by clicking "Export JSON" in the Preview Deck.

# Or fetch it directly (while the tab is still open):
curl http://localhost:4173/lv-manifest/<id>.json | python3 -m json.tool
```

### How to test external launch manually

1. Click **PRESENT** in the viewer
2. In the Preview Deck, right-click **"Open in Hyperframes ↗"** → Copy Link
3. Replace `http://localhost:4173/lv-manifest/...` in the `manifest=` query param with an `https://` URL hosting the exported JSON
4. Open the modified URL in a browser

## Related

- [elvie-server](../elvie-server) — Orthanc/DICOMweb + Whisper + OHIF via Docker Compose
- [elvie-case-api](../elvie-case-api) — pre-parsed case JSON server

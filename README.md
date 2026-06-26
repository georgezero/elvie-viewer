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
- Image evidence (`imageEvidence` in each manifest section) is collected by navigating to each positive finding and capturing the active Cornerstone canvas via `canvas.toDataURL()`. Without a DICOMweb server, canvases are blank and evidence records carry an explicit status (`no_viewer`, `no_canvas`, or `skipped_non_navigable`) rather than a data URL. The manifest is still valid and exportable; the status fields let the consumer decide how to handle missing visuals.

## Presentation export (Preview Deck)

Clicking **PRESENT** on a loaded report:
1. Collects image evidence from the viewer (Cornerstone canvas capture per positive finding)
2. Builds a `presentation-manifest-v1` JSON object with sections, speaker notes, and evidence
3. Publishes the manifest to a local URL via the service worker at `/lv-manifest-worker.js`
4. Opens the **Preview Deck** — an Elvie-local slide view of the prepared manifest
5. **"Open external Hyperframes ↗"** inside the Preview Deck constructs a launch URL — see status below

### What works locally

- Preview Deck shows all positive findings with text, speaker notes, and any captured images
- Manifest is served at `http://localhost:4173/lv-manifest/{id}.json` with permissive CORS
- The manifest URL is fetchable by any http client on the same machine (browser tests, curl)
- **"Export JSON ↓"** downloads the full manifest as `lv-presentation-{accession}.json` — includes all sections, speaker notes, and base64-encoded image evidence

### External HyperFrames integration — status: unverified / product mismatch

Manual verification (2026-06-26) shows that **HyperFrames** (`hyperframes.heygen.com`) is an
open-source **HTML-to-MP4 video composition CLI** framework, not a slide deck web application:

- `hyperframes.heygen.com` shows its own marketing page and ignores all query parameters
- There is no `/present` route or `manifest=` JSON URL parameter support
- HyperFrames renders HTML compositions to video via `npx hyperframes render`
  and is designed for AI agents writing HTML/CSS/JS, not for consuming JSON manifests
- The `presentation-manifest-v1` JSON format used here is not compatible with
  HyperFrames' native HTML composition format

**The "Open external Hyperframes" button is therefore non-functional at this stage.**
It opens `hyperframes.heygen.com` with a `manifest=` parameter that is silently ignored.

What would be needed to resolve this:
1. Identify whether HyperFrames has (or will have) a slide-rendering web endpoint that accepts JSON
2. OR: generate a HyperFrames HTML composition from the manifest and run `npx hyperframes render`
   to produce an MP4 video of the presentation
3. OR: replace HyperFrames with a different external presentation target that accepts the manifest format
4. In any case: replace the localhost manifest URL with a cloud-hosted `https://` URL

The local Preview Deck is fully functional and is the primary output of the PRESENT flow.

### How to inspect the exported manifest

```bash
# Click "Export JSON" in the Preview Deck, or fetch directly while the tab is open:
curl http://localhost:4173/lv-manifest/<id>.json | python3 -m json.tool
```

### Manual external verification

```bash
# Run the external verification test (requires HYPERFRAMES_EXTERNAL=1):
HYPERFRAMES_EXTERNAL=1 npx playwright test tests/manual/ --config=playwright.manual.config.js
# Screenshots are written to test-artifacts/hyperframes/external/
```

## Related

- [elvie-server](../elvie-server) — Orthanc/DICOMweb + Whisper + OHIF via Docker Compose
- [elvie-case-api](../elvie-case-api) — pre-parsed case JSON server

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
- Image evidence (`imageEvidence` in each manifest section) is collected by navigating to each positive finding, applying its window/level preset, and capturing the active Cornerstone canvas via `canvas.toDataURL()` (see [Evidence appearance matches the live viewer](#evidence-appearance-matches-the-live-viewer)). Without a DICOMweb server, canvases are blank and evidence records carry an explicit status (`no_viewer`, `canvas_empty`, or `skipped_non_navigable`) rather than a data URL. The manifest is still valid and exportable; the status fields let the consumer decide how to handle missing visuals.

## Presentation export (Preview Deck → MP4)

Clicking **PRESENT** on a loaded report:
1. Collects image evidence from the viewer (Cornerstone canvas capture per positive finding)
2. Builds a `presentation-manifest-v1` JSON object with sections, speaker notes, and evidence
3. Publishes the manifest to a local URL via the service worker at `/lv-manifest-worker.js`
4. Opens the **Preview Deck** — an Elvie-local slide view of the prepared manifest
5. Offers two actions: **"Watch rendered MP4"** (if one has been built) and **"Export package ↓"**

There is **no external launch**. The deck becomes a video through the HyperFrames CLI
(`npx hyperframes render`) — HyperFrames is an HTML-to-MP4 renderer, not a hosted deck
app. It does not accept a `manifest=` JSON URL.

### What works locally

- Preview Deck shows all positive findings with text, speaker notes, and any captured images
- Manifest is served at `http://localhost:4173/lv-manifest/{id}.json` with permissive CORS,
  fetchable by any http client on the same machine (browser tests, curl)
- **"Export package ↓"** downloads the full manifest (all sections, speaker notes, base64 image evidence)
- If a rendered MP4 exists for the accession, the deck links to it (**"Watch rendered MP4"**)

## HyperFrames MP4 render

The true flow is entirely local:

```
Elvie viewer  →  browser evidence export  →  HTML composition  →  npx hyperframes render  →  MP4  →  link in Preview Deck
```

### Build the CT Head video

```bash
# Dev server must be running (serves the viewer the export script drives):
cd web && python3 -m http.server 4173 &

npm run build:hyperframes:ct-head     # export evidence, then render MP4
# or run the steps separately:
npm run export:hyperframes:ct-head    # browser-assisted evidence capture
npm run render:hyperframes:ct-head    # build HTML + render MP4 + verify
```

`export:` launches headless Chromium (Playwright), points DICOMweb at
`https://elvie-server.ggg.ad/dicom-web`, loads the demo report, runs the normal PRESENT
evidence-capture path, and writes the captured CT images plus a manifest.

`render:` reads that manifest, **embeds each PNG as an inline `data:` URL** inside the
generated HTML (the most reliable path for the CLI renderer — no file-server/cwd/relative-path
dependency), screenshots the exact HTML that will be rendered, runs `npx hyperframes render`,
then extracts a frame from the MP4 and verifies it contains the CT image (not the placeholder).

### Output paths (per accession, `NI9f7ff9` = CT Head)

```
web/generated/hyperframes/NI9f7ff9/
  presentation.json                 manifest with assets/finding-N.png references
  assets/finding-1.png, finding-2.png   captured CT evidence (PNG)
  index.html                        HyperFrames composition (PNGs embedded as data URLs)
  renders/NI9f7ff9.mp4              rendered video
  render.json                       render metadata + verification flags
  debug/render-input-slide-1.png    screenshot of the exact HTML passed to the renderer
  debug/rendered-frame-1.png        frame extracted from the MP4 (proves image is present)
```

`web/generated/` is gitignored — none of these are committed.

### Inspect the exported manifest

```bash
# "Export package" in the Preview Deck, or fetch directly while the tab is open:
curl http://localhost:4173/lv-manifest/<id>.json | python3 -m json.tool
```

### Evidence appearance matches the live viewer

Evidence is captured from Elvie's **rendered Cornerstone viewport canvas**, not
reconstructed from DICOMweb. For each positive finding the export step:

1. navigates the viewer to the finding's series/image
2. applies the finding's window/level preset (e.g. `brain`, `bone`) so the
   capture matches what a reader sees — the calvarial-fracture slide is captured
   in **bone window**, the infarct slide in **brain window**
3. reads the live viewport VOI/camera back into the evidence metadata
4. captures the canvas

Captured `imageEvidence` records carry, for audit/debug:

- `captureSource` (`viewport-canvas`)
- `appliedPreset` and `windowPreset` (the W/L preset applied for the capture)
- `viewportState`: `windowCenter`, `windowWidth`, `voiRange`, `zoom`, `pan`,
  `canvasWidth`/`canvasHeight`, `seriesNumber`/`imageNumber`
- `diagnostics`: canvas count, viewport dimensions, blank-canvas check

PHI overlays are **not** included: patient banners are HTML siblings of the
canvas, so `canvas.toDataURL()` captures only the rendered image pixels.

Validation artifacts written under `web/generated/hyperframes/<accession>/debug/`:

```
debug/live-viewer-before-capture-finding-1.png   on-screen viewer at capture time
debug/live-viewer-before-capture-finding-2.png
debug/capture-comparison-finding-1.png           side-by-side: live viewer | exported asset
debug/capture-comparison-finding-2.png
debug/render-input-slide-1.png                   exact HTML passed to the renderer
debug/rendered-frame-1.png                       frame extracted from the MP4
```

### Limitations

- Real evidence requires the **browser/DICOM viewer path**. Running the render
  script alone (without a prior export) falls back to a registry-only manifest
  with placeholder panels instead of CT images.
- Window/level preservation depends on the finding carrying a `windowPreset` and
  on the live Cornerstone viewport exposing VOI/camera state. When neither is
  available the capture uses whatever the viewer currently shows, and the
  `viewportState`/`appliedPreset` metadata fields are omitted.
- Zoom/pan are recorded for audit but the composition presents the captured frame
  as-is; it does not re-apply camera transforms.

## Related

- [elvie-server](../elvie-server) — Orthanc/DICOMweb + Whisper + OHIF via Docker Compose
- [elvie-case-api](../elvie-case-api) — pre-parsed case JSON server

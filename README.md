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

### Cinematic storyboard

The MP4 is a narrated case presentation built from reusable scene builders in
`htmlPresentationExporter.mjs`, each emitting one GSAP timeline segment. The
builders are a small **presentation engine** (data-driven scene selection,
isolated segments) rather than a slideshow renderer, so future capabilities
(cine scrolling, camera paths, viewport replay, narrated playback) can be added
as new segment types without redesign.

| Scene | ~Duration | Content |
|-------|-----------|---------|
| `brandLayer`   | persistent | ELVIE wordmark (viewer styling: Bebas Neue, cyan `#00d4e8`, 0.12em), upper-left, ~45% opacity, never animated |
| `TitleScene`   | 3s | exam name, accession, study date, indication over a blurred/darkened CT backdrop with a slow push-in |
| `SummaryScene` | 4s | one-line AI study summary, animated in with an accent rule |
| `FindingScene` × N | 9s each | **beat A**: report sentence with a reading-sweep highlight on the key phrase, which lifts and hands off into the image; **beat B**: cross-dissolve to the captured image with viewer-style framing (faint border, vignette, gentle shadow, optional orientation label), a finding-appropriate camera move, a pointer that appears → pulses twice → fades, and a minimal metadata card. Image fills ~75% of the frame. |
| `ClosingScene` | 5s | impression bullets animated individually, gentle fade to black |

Brief pauses sit between scenes so future narration has room. Transitions are
fades / cross-dissolves — no hard cuts. CT Head (2 image scenes) ≈ 34s.

**Camera move** is derived from the finding (focal lesion → slow zoom toward the
lesion; fracture → upward pan; diffuse process → almost still). **Pointer**
positions come from `finding.localization` when available, else hand-placed
`DEMO_POINTERS` — future AI localization drops in unchanged.

The storyboard text (summary, impression, per-finding highlight phrase, pointer,
orientation, camera kind, narration) is generated deterministically in
`presentationStoryboard.mjs` and stored on the manifest.

**Narration (no TTS yet):** every scene gets a plain-text `narration` segment in
`manifest.narrationScript`. The renderer is independent of narration; a later
pass can feed these to browser TTS, OpenAI, ElevenLabs, Cartesia, etc.

### Build a video for any study

The pipeline is generic and entirely manifest-driven — there is no per-study or
per-modality export code. It works for CT, MR, PET, NM, XR, US, etc., provided
the manifest carries image evidence.

```bash
# Dev server must be running (serves the viewer the export script drives):
cd web && python3 -m http.server 4173 &

# Generic build (export evidence, then render MP4) for any accession:
npm run build:hyperframes -- --accession <accession>

# Convenience aliases for the demo studies:
npm run build:hyperframes:ct-head     # --accession NI9f7ff9
npm run build:hyperframes:mr-knee     # --accession 3852755662087132
```

**Data-driven scene selection.** Each positive finding becomes an image scene
only when it has captured image evidence. Findings without localization (no
series/image — e.g. *chondromalacia patella*) are **not** dropped: they still
appear in the opening summary, the closing impression, and the narration script;
they simply get no image scene. If localization becomes available later they
automatically become normal image scenes — no code change.

The build prints a storyboard plan so it is obvious why each finding did or did
not get an image scene:

```
Presentation Storyboard
  Opening title
  Summary
  Finding 1: Medial meniscus tear
    ✓ Image scene  (Series 6, Image 23)
  Finding 2: Joint effusion
    ✓ Image scene  (Series 3, Image 14)
  Finding 3: Chondromalacia patella
    • Summary + closing impression only
    • No image localization available
  Closing impression
```

### Create Video (MP4) in the Preview Deck

The Preview Deck exposes a generic, data-driven MP4 control (no study-specific
logic). It determines capability from the manifest (any captured image evidence)
and reads `render.json` `status`:

- capable, no render yet → **▶ Create Video (MP4)**
- render in progress → **Rendering video…** (disabled)
- render complete → **▶ Watch rendered MP4** (cache-busted `?v=<hash>` link)
- render failed → **↻ Retry rendering**
- no image evidence → an explanatory note (no button)

"Create"/"Retry" call an optional pluggable hook (`window.elvieCreateVideo`); with
no backend wired they surface the generic build command.

`export:` launches headless Chromium (Playwright), points DICOMweb at
`https://elvie-server.ggg.ad/dicom-web`, loads the report, runs the normal PRESENT
evidence-capture path, and writes the captured images plus a manifest.

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

### The Preview Deck is the single source of truth

The image the **Preview Deck displays is the exact image embedded into the MP4**.
There is one capture only, and it happens once, on the way into the Preview Deck:

```
Viewer → navigate + apply W/L → capture canvas → imageEvidence.dataUrl
       → Preview Deck shows that dataUrl
       → export decodes that exact dataUrl → assets/finding-N.png
       → HTML exporter embeds those exact bytes → HyperFrames MP4
```

The HTML exporter only consumes the manifest — it never queries DICOMweb and
never re-renders the viewport. Window/level is applied **before** the Preview
Deck exists (so the calvarial-fracture slide is captured in **bone window**, the
infarct slide in **brain window**); nothing is reconstructed afterwards.

This identity is proven by SHA256: the export hashes the image the Preview Deck
DOM actually shows and the decoded asset; the render hashes the image embedded in
the generated HTML. All three hashes are identical per finding and recorded in
`render.json` under `evidenceProvenance` (and printed during the build):

```
Finding:        healed-left-vertex-fracture
  Preview source: preview-deck:imageEvidence.dataUrl
  HTML source:    assets/finding-2.png
  Preview SHA256: c0bea3aa…
  HTML SHA256:    c0bea3aa…
  Match:          YES
```

Captured `imageEvidence` records carry, for audit/debug: `captureSource`
(`viewport-canvas`), `sha256`, `previewSource`, `appliedPreset`/`windowPreset`,
`viewportState` (`windowCenter`, `windowWidth`, `voiRange`, `zoom`, `pan`,
canvas dims, series/image), and `diagnostics` (canvas count, dims, blank check).

PHI overlays are **not** included: patient banners are HTML siblings of the
canvas, so `canvas.toDataURL()` captures only the rendered image pixels.

Validation artifacts under `web/generated/hyperframes/<accession>/debug/`:

```
debug/preview-deck-finding-1.png    the Preview Deck slide (source of truth)
debug/preview-deck-finding-2.png
debug/render-input-slide-1.png      exact HTML passed to the renderer
debug/rendered-frame-1.png          frame extracted from the MP4
```

### Limitations

- Real evidence requires the **browser/DICOM viewer path**. Running the render
  script alone (without a prior export) falls back to a registry-only manifest
  with placeholder panels instead of CT images.
- Window/level preservation depends on the finding carrying a `windowPreset` and
  on the live Cornerstone viewport exposing VOI/camera state. When neither is
  available the capture uses whatever the viewer currently shows.
- If hashes match but the MP4 still looks wrong, the cause is in the HTML/CSS or
  HyperFrames rendering — not the evidence pipeline, which is hash-proven.

## Related

- [elvie-server](../elvie-server) — Orthanc/DICOMweb + Whisper + OHIF via Docker Compose
- [elvie-case-api](../elvie-case-api) — pre-parsed case JSON server

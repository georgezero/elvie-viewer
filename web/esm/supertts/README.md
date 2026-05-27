# supertts — Browser TTS modules for ELVIE SUPER

ES modules powering `web/elviesuper.html`, a Phase 1 feasibility prototype for
browser-only TTS (no Docker, no Python, no server inference).

## Modules

### `modelLoader.mjs`
Wraps [kokoro-js](https://www.npmjs.com/package/kokoro-js) CDN import and
`KokoroTTS.from_pretrained()`. Supports four quantisation variants of
`onnx-community/Kokoro-82M-v1.0-ONNX`:

| Key | dtype | Size |
|-----|-------|------|
| `kokoro-82m-fp32` | fp32 | ~324 MB |
| `kokoro-82m-fp16` | fp16 | ~162 MB |
| `kokoro-82m-q8`  | q8   | ~82 MB |
| `kokoro-82m-q4`  | q4   | ~41 MB |

### `supertonicBrowser.mjs`
Thin `ModelLoader` + `AudioPlayer` wrapper exposing `synthesize()` / `speak()`.
Handles three return shapes from `generate()` (bare `Float32Array`, `{audio,
sampling_rate}`, and doubly-wrapped). 28 voices available at runtime; 11
hardcoded as fallback.

### `supertonicProvider.mjs`
Wraps [Supertonic](https://github.com/supertone-inc/supertonic). The upstream
`helper.js` is vendored locally as `supertonic-helper.mjs`; an importmap in
`elviesuper.html` resolves its bare `onnxruntime-web` / `fft.js` specifiers.

**ORT CDN:** `esm.sh/onnxruntime-web` wraps the package in a lazy-getter format
that breaks `InferenceSession.create`. The official ESM dist from jsdelivr works.
Note: from 1.21.0 onwards the path moved — no `esm/` subdir and `.mjs` extension:

```
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.webgpu.min.mjs
```

`ort.env.wasm.wasmPaths` is set at module init so ORT finds `.wasm` files at the
`dist/` root. `numThreads = 1` avoids the SharedArrayBuffer/COOP requirement.

**Model quality:** v2 drops words on long sentences due to its smaller text encoder
(27 MB vs 36 MB). v3 is required and handles long texts via the helper's internal
`chunkText(maxLen=300)`.

Two models available:

| Key | HF repo | Size | Notes |
|-----|---------|------|-------|
| `v3` | `Supertone/supertonic-3` | ~398 MB | **Required** — v2 drops words |
| `v2` | `Supertone/supertonic` | ~263 MB | Not usable on long sentences |

No quantized variants exist for either. Browser-cached after first load.

**Memory management:** `unload()` calls `session.release()` on all four ONNX
sessions (dpOrt, textEncOrt, vectorEstOrt, vocoderOrt) to return WASM linear
memory immediately. The benchmark suite calls this between configs to prevent OOM.

### `audioPlayer.mjs`
`AudioContext`-based `Float32Array` playback. Context is created at the audio's
native sample rate (44100 Hz for Supertonic, 24000 Hz for Kokoro) to avoid
Safari's implicit resampling, which caused choppy playback.

### `webgpuDetect.mjs`
Probes `navigator.gpu` / `requestAdapter()` and returns adapter info.

---

## Benchmark results (Apple M-series, Safari, 3 runs each)

Test text (170 chars): *"There is a 1.2 centimeter hyperdense lesion in the right hepatic lobe,
segment 6, consistent with a benign hemangioma. No suspicious enhancement pattern identified."*

### Round 2 — ORT 1.21.0 (current)

| Config | Size | SR | Load | RTF avg | RTF range | Synth avg | Audio dur |
|--------|------|----|------|---------|-----------|-----------|-----------|
| **ST v3 + WebGPU** | 398 MB | 44100 Hz | 35.3 s | **0.055** | 0.052–0.058 | 0.69 s | 12.68 s |
| Kokoro q4 + WebGPU | 41 MB | 24000 Hz | 29.8 s | 0.117 | 0.076–0.192 | 1.50 s | 12.82 s |
| ST v3 + WASM | 398 MB | 44100 Hz | 35.1 s | 1.757 | 1.749–1.761 | 22.27 s | 12.68 s |

### Round 1 — ORT 1.17.3 (historical, ST WebGPU not yet working)

| Config | Size | SR | Load | RTF avg | RTF range | Synth avg | Audio dur |
|--------|------|----|------|---------|-----------|-----------|-----------|
| Kokoro q4 + WebGPU | 41 MB | 24000 Hz | 20.1 s | 0.477 | 0.473–0.482 | 6.11 s | 12.82 s |
| Kokoro q8 + WebGPU | 82 MB | 24000 Hz | 3.2 s | 1.742 | 1.728–1.768 | 24.26 s | 13.93 s |
| ST v3 + WASM | 398 MB | 44100 Hz | 31.2 s | 1.926 | 1.919–1.941 | 25.81 s | 13.40 s |

RTF < 1.0 = faster than real-time.

### Analysis

**ST v3 + WebGPU is the clear winner on both speed and quality.**
At RTF 0.055, a 12.68-second audio clip synthesises in 0.69 seconds — 18× faster
than real-time. This required upgrading from ORT 1.17.3 to 1.21.0, which fixed
WebGPU op coverage for the Supertonic v3 diffusion pipeline (1.17.3 produced
garbled output due to incorrect fp16 shader execution of the vocoder).

**ST v3 WebGPU is 8.5× faster than Kokoro q4 WebGPU** and produces noticeably
more natural speech. The 398 MB model size is a tradeoff versus Kokoro's 41 MB,
but both are browser-cached after first load.

**ST v3 WASM improved slightly with ORT 1.21.0** (RTF 1.757 vs 1.926), but remains
slower than real-time and is not viable for interactive use.

### Recommendation

| Deployment | Provider | Reason |
|------------|----------|--------|
| Browser (primary) | **ST v3 + WebGPU** | RTF 0.055; best voice quality; 18× real-time |
| Browser (fallback / no WebGPU) | Kokoro q4 + WebGPU | 41 MB; RTF 0.117; good quality |
| No GPU available | — | Neither ST v3 WASM (RTF 1.76) nor Kokoro WASM is viable for real-time |

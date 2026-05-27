// kokoro-js CDN URL — imported dynamically in the HTML so it stays lazy
export const KOKORO_JS_CDN = 'https://esm.sh/kokoro-js';

// Model IDs for Kokoro ONNX on HuggingFace (kokoro-js format)
export const MODELS = {
  'kokoro-82m-fp32': {
    id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype: 'fp32',
    label: 'Kokoro 82M fp32 (~324 MB)',
    approxMB: 324,
  },
  'kokoro-82m-fp16': {
    id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype: 'fp16',
    label: 'Kokoro 82M fp16 (~162 MB)',
    approxMB: 162,
  },
  'kokoro-82m-q8': {
    id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype: 'q8',
    label: 'Kokoro 82M q8 (~82 MB) — recommended',
    approxMB: 82,
  },
  'kokoro-82m-q4': {
    id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype: 'q4',
    label: 'Kokoro 82M q4 (~41 MB) — smallest',
    approxMB: 41,
  },
};

export const DEFAULT_MODEL_KEY = 'kokoro-82m-q8';

export class ModelLoader {
  constructor({ onProgress, onLog } = {}) {
    this._onProgress = onProgress ?? (() => {});
    this._onLog = onLog ?? (() => {});
    this._tts = null;
    this._modelKey = null;
    this._device = null;
  }

  get isLoaded() {
    return this._tts !== null;
  }

  get loadedModelKey() {
    return this._modelKey;
  }

  get loadedDevice() {
    return this._device;
  }

  async load(modelKey, device, { KokoroTTS }) {
    const spec = MODELS[modelKey];
    if (!spec) throw new Error(`Unknown model key: ${modelKey}`);

    this._onLog(`Loading model: ${spec.label}`);
    this._onLog(`model_id=${spec.id} | dtype=${spec.dtype} | device=${device}`);
    this._onLog(`Estimated download: ~${spec.approxMB} MB (cached by browser after first load)`);

    const t0 = performance.now();

    this._tts = await KokoroTTS.from_pretrained(spec.id, {
      dtype: spec.dtype,
      device,
      progress_callback: (progress) => {
        this._onProgress(progress);
        if (progress.status === 'downloading') {
          const pct = progress.total > 0
            ? ((progress.loaded / progress.total) * 100).toFixed(1)
            : '?';
          this._onLog(`Downloading ${progress.file ?? 'model'}: ${pct}%`);
        } else if (progress.status === 'loaded') {
          this._onLog(`Loaded: ${progress.file ?? 'model'}`);
        } else if (progress.status) {
          this._onLog(`Status: ${progress.status}`);
        }
      },
    });

    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    this._modelKey = modelKey;
    this._device = device;
    this._onLog(`Model ready in ${elapsed}s`);
    return this._tts;
  }

  get tts() {
    return this._tts;
  }

  unload() {
    // KokoroTTS wraps ONNX sessions — call dispose/release if exposed.
    try { this._tts?.dispose?.(); } catch {}
    try { this._tts?.release?.(); } catch {}
    this._tts = null;
    this._modelKey = null;
    this._device = null;
  }
}

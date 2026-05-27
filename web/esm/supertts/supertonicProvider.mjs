// Supertonic browser TTS — https://github.com/supertone-inc/supertonic
// helper.js vendored locally; bare specifiers resolved via importmap in elviesuper.html.

import * as ort from 'onnxruntime-web';

// WASM backend config — must be set before any InferenceSession is created.
// ort.webgpu.min.js lives in dist/esm/ but .wasm files are one level up in dist/.
const ORT_WASM_DIR = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
ort.env.wasm.wasmPaths = ORT_WASM_DIR;
ort.env.wasm.numThreads = 1;   // avoids SharedArrayBuffer/COOP requirement
// Diffusion denoising is precision-sensitive: fp16 WebGPU shaders compound rounding
// errors over 20 steps → unintelligible output. fp32 fixes it at ~10% perf cost.
ort.env.webgpu.forceFp16 = false;

// Safari WebGPU compat: GPUAdapter.requestAdapterInfo() is missing on Safari ≤17.
// ORT 1.17.3 calls it during WebGPU backend init; stubbing it returns empty info
// which is safe — ORT uses it only for diagnostic logging, not feature detection.
if (typeof navigator !== 'undefined' && navigator.gpu) {
  const _origReqAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = async (...args) => {
    const adapter = await _origReqAdapter(...args);
    if (adapter && typeof adapter.requestAdapterInfo !== 'function') {
      adapter.requestAdapterInfo = async () => ({});
    }
    return adapter;
  };
}

export const ST_MODELS = {
  v2: {
    label:  'Supertonic 2 (~263 MB)',
    hfRepo: 'Supertone/supertonic',
    sizes:  { duration_predictor: 1.5, text_encoder: 27.3, vector_estimator: 132, vocoder: 101 },
    totalMB: 263,
    tag: 'st2',
  },
  v3: {
    label:  'Supertonic 3 (~398 MB)',
    hfRepo: 'Supertone/supertonic-3',
    sizes:  { duration_predictor: 3.7, text_encoder: 36.4, vector_estimator: 257, vocoder: 101 },
    totalMB: 398,
    tag: 'st3',
  },
};

export const VOICE_STYLES = [
  { id: 'M1', label: 'Male 1 (M1)' },
  { id: 'M2', label: 'Male 2 (M2)' },
  { id: 'M3', label: 'Male 3 (M3)' },
  { id: 'M4', label: 'Male 4 (M4)' },
  { id: 'M5', label: 'Male 5 (M5)' },
  { id: 'F1', label: 'Female 1 (F1)' },
  { id: 'F2', label: 'Female 2 (F2)' },
  { id: 'F3', label: 'Female 3 (F3)' },
  { id: 'F4', label: 'Female 4 (F4)' },
  { id: 'F5', label: 'Female 5 (F5)' },
];

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어 (ko)' },
  { code: 'ja', label: '日本語 (ja)' },
  { code: 'de', label: 'Deutsch (de)' },
  { code: 'es', label: 'Español (es)' },
  { code: 'fr', label: 'Français (fr)' },
  { code: 'it', label: 'Italian (it)' },
  { code: 'pt', label: 'Português (pt)' },
  { code: 'ru', label: 'Russian (ru)' },
  { code: 'zh', label: 'Chinese (zh)' },
  { code: 'ar', label: 'Arabic (ar)' },
  { code: 'hi', label: 'Hindi (hi)' },
  { code: 'tr', label: 'Turkish (tr)' },
  { code: 'nl', label: 'Dutch (nl)' },
  { code: 'pl', label: 'Polish (pl)' },
  { code: 'sv', label: 'Swedish (sv)' },
  { code: 'uk', label: 'Ukrainian (uk)' },
  { code: 'vi', label: 'Vietnamese (vi)' },
];

let _helper = null;
async function getHelper(onLog) {
  if (_helper) return _helper;
  onLog('Loading Supertonic helper…');
  _helper = await import('./supertonic-helper.mjs');
  onLog(`Helper loaded. Exports: ${Object.keys(_helper).join(', ')}`);
  return _helper;
}


export class SupertonicProvider {
  constructor({ onLog, onProgress, onStatus } = {}) {
    this._onLog      = onLog      ?? (() => {});
    this._onProgress = onProgress ?? (() => {});
    this._onStatus   = onStatus   ?? (() => {});
    this._tts        = null;
    this._cfgs       = null;
    this._style      = null;
    this._styleKey   = null;
    this._device     = null;
    this._modelVer   = null;
    this._sampleRate = 24000;
    this._lastResult = null;
  }

  get isLoaded()    { return this._tts !== null; }
  get loadedDevice(){ return this._device; }
  get modelVersion(){ return this._modelVer; }
  get sampleRate()  { return this._sampleRate; }
  get lastResult()  { return this._lastResult; }

  unload() {
    if (this._tts) {
      // Release each ONNX InferenceSession to free WASM linear memory immediately.
      for (const sess of [this._tts.dpOrt, this._tts.textEncOrt, this._tts.vectorEstOrt, this._tts.vocoderOrt]) {
        try { sess?.release?.(); } catch {}
      }
      this._tts = null;
    }
    this._cfgs     = null;
    this._style    = null;
    this._styleKey = null;
    this._device   = null;
    this._modelVer = null;
    this._onLog('Supertonic unloaded');
  }

  async load(device = 'wasm', modelVer = 'v2') {
    const spec    = ST_MODELS[modelVer] ?? ST_MODELS.v2;
    const onnxDir = `https://huggingface.co/${spec.hfRepo}/resolve/main/onnx`;

    const helper = await getHelper(this._onLog);

    this._onLog(`Loading ${spec.label} on ${device}…`);
    this._onLog(`ONNX dir: ${onnxDir}`);
    const sizeList = Object.entries(spec.sizes)
      .map(([k, v]) => `${k.replace('_', ' ')} ${v}MB`).join(' · ');
    this._onLog(sizeList);
    this._onLog(`Total ~${spec.totalMB} MB — browser-cached after first load`);

    const actualDevice = await this._tryLoad(helper, onnxDir, device);

    this._device     = actualDevice;
    this._modelVer   = modelVer;
    this._sampleRate = this._cfgs?.ae?.sample_rate ?? 24000;
    this._onLog(`Supertonic ready. device=${actualDevice} sr=${this._sampleRate} Hz`, 'ok');
  }

  async _tryLoad(helper, onnxDir, device) {
    const tryDevice = async (ep) => {
      this._onLog(`Trying execution provider: ${ep}`);
      const opts = { executionProviders: [ep], graphOptimizationLevel: 'all' };
      const { textToSpeech, cfgs } = await helper.loadTextToSpeech(
        onnxDir, opts,
        (modelName, current, total) => {
          this._onLog(`ONNX ${current}/${total}: ${modelName}`);
          this._onProgress({ loaded: current, total, file: modelName });
        }
      );
      this._tts  = textToSpeech;
      this._cfgs = cfgs;
    };

    if (device === 'webgpu') {
      try {
        await tryDevice('webgpu');
        return 'webgpu';
      } catch (e) {
        if (/backend|webgpu/i.test(e.message)) {
          this._onLog(`WebGPU backend unavailable (${e.message}) — falling back to WASM`, 'warn');
          await tryDevice('wasm');
          return 'wasm';
        }
        throw e;
      }
    } else {
      await tryDevice('wasm');
      return 'wasm';
    }
  }

  async _loadStyle(styleKey, modelVer) {
    const cacheKey = `${modelVer}:${styleKey}`;
    if (this._styleKey === cacheKey && this._style) return this._style;

    const spec   = ST_MODELS[modelVer ?? this._modelVer] ?? ST_MODELS.v2;
    const url    = `https://huggingface.co/${spec.hfRepo}/resolve/main/voice_styles/${styleKey}.json`;
    const helper = await getHelper(this._onLog);
    this._onLog(`Loading style: ${styleKey} (${spec.tag})`);
    this._style    = await helper.loadVoiceStyle([url]);
    this._styleKey = cacheKey;
    this._onLog(`Style ${styleKey} loaded`);
    return this._style;
  }

  async synthesize(text, { voice = 'M1', lang = 'en', steps = 8, speed = 1.05, temp = 0.3 } = {}) {
    if (!this.isLoaded) throw new Error('Supertonic not loaded — call load() first');
    if (!text?.trim()) throw new Error('Empty text');

    const style = await this._loadStyle(voice, this._modelVer);

    this._onLog(`Synthesizing: voice=${voice} lang=${lang} steps=${steps} speed=${speed} temp=${temp}`);
    this._onLog(`device=${this._device} model=${this._modelVer} sr=${this._sampleRate}`);
    this._onStatus('synthesizing');

    const t0 = performance.now();
    const { wav } = await this._tts.call(
      text.trim(), lang, style, steps, speed, 0,
      (step, total) => {
        this._onLog(`Denoising ${step}/${total}`);
        this._onProgress({ loaded: step, total, file: `denoise ${step}/${total}` });
      }
    );
    const audio = wav instanceof Float32Array ? wav : new Float32Array(wav);

    const synthMs   = performance.now() - t0;
    const durationS = audio.length / this._sampleRate;
    const rtf       = (synthMs / 1000) / durationS;

    this._onLog(`samples=${audio.length}  sr=${this._sampleRate}  dur=${durationS.toFixed(2)}s  RTF=${rtf.toFixed(3)}`);
    this._onStatus('done');

    const spec = ST_MODELS[this._modelVer] ?? ST_MODELS.v2;
    this._lastResult = {
      audio, sampleRate: this._sampleRate,
      synthMs, durationS, rtf,
      voice, lang, steps, speed,
      device:   this._device,
      modelKey: `${spec.tag}-${voice}`,
      provider: 'supertonic',
    };
    return this._lastResult;
  }
}

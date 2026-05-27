// Supertonic browser TTS — wraps KokoroTTS (kokoro-js)
// No server calls. No Docker. Browser-only ONNX/WebGPU.

export const VOICES = [
  { id: 'af_bella',    label: 'Bella (US F)' },
  { id: 'af',          label: 'Default (US F)' },
  { id: 'af_nicole',   label: 'Nicole (US F)' },
  { id: 'af_sarah',    label: 'Sarah (US F)' },
  { id: 'af_sky',      label: 'Sky (US F)' },
  { id: 'am_adam',     label: 'Adam (US M)' },
  { id: 'am_michael',  label: 'Michael (US M)' },
  { id: 'bf_emma',     label: 'Emma (UK F)' },
  { id: 'bf_isabella', label: 'Isabella (UK F)' },
  { id: 'bm_george',   label: 'George (UK M)' },
  { id: 'bm_lewis',    label: 'Lewis (UK M)' },
];

export const DEFAULT_VOICE = 'af_bella';
export const KOKORO_NATIVE_SR = 24000;

function normaliseAudio(raw, onLog) {
  // kokoro-js generate() may return:
  //   a) { audio: Float32Array, sampling_rate: number }   ← expected RawAudio
  //   b) bare Float32Array
  //   c) { audio: { audio: Float32Array, sampling_rate } } ← doubly-wrapped
  // Log every layer so we can diagnose surprises.

  onLog(`raw type=${typeof raw}  constructor=${raw?.constructor?.name}`);
  if (raw && typeof raw === 'object' && !(raw instanceof Float32Array)) {
    onLog(`raw keys: ${Object.keys(raw).join(', ')}`);
  }
  onLog(`raw.audio type=${typeof raw?.audio}  isF32=${raw?.audio instanceof Float32Array}`);
  onLog(`raw.sampling_rate=${raw?.sampling_rate}`);

  let audio, sampleRate;

  if (raw instanceof Float32Array) {
    audio = raw;
    sampleRate = KOKORO_NATIVE_SR;
    onLog('Shape: bare Float32Array → assuming 24000 Hz');

  } else if (raw?.audio instanceof Float32Array) {
    audio = raw.audio;
    sampleRate = raw.sampling_rate ?? KOKORO_NATIVE_SR;
    onLog(`Shape: {audio:F32, sampling_rate:${sampleRate}}`);

  } else if (raw?.audio?.audio instanceof Float32Array) {
    audio = raw.audio.audio;
    sampleRate = raw.audio.sampling_rate ?? raw.sampling_rate ?? KOKORO_NATIVE_SR;
    onLog(`Shape: doubly-wrapped, sr=${sampleRate}`);

  } else {
    // Last resort
    audio = raw?.audio ?? raw;
    sampleRate = raw?.sampling_rate ?? KOKORO_NATIVE_SR;
    onLog(`Shape: unknown — using raw.audio or raw, sr=${sampleRate}`, 'warn');
  }

  if (!sampleRate || isNaN(sampleRate) || sampleRate <= 0) {
    onLog('sample_rate invalid — forcing 24000', 'warn');
    sampleRate = KOKORO_NATIVE_SR;
  }

  return { audio, sampleRate };
}

export class SupertonicBrowser {
  constructor({ loader, player, onLog, onStatus } = {}) {
    this._loader = loader;
    this._player = player;
    this._onLog = onLog ?? (() => {});
    this._onStatus = onStatus ?? (() => {});
    this._lastResult = null;
  }

  get isReady() {
    return this._loader.isLoaded;
  }

  // Try to read voice list from loaded model. Returns string[] or null.
  listVoices() {
    const m = this._loader.tts;
    if (!m) return null;
    for (const key of ['voices', '_voices', 'voice_names', 'VOICES']) {
      const v = m[key];
      if (v && typeof v === 'object') {
        return Array.isArray(v) ? v : Object.keys(v);
      }
    }
    return null;
  }

  async synthesize(text, { voice = DEFAULT_VOICE, speed = 1.0 } = {}) {
    if (!this.isReady) throw new Error('Model not loaded');
    if (!text?.trim()) throw new Error('Empty text');

    const chars = text.trim().length;
    this._onLog(`Synthesize: voice=${voice} speed=${speed} chars=${chars}`);
    this._onLog(`model=${this._loader.loadedModelKey} device=${this._loader.loadedDevice}`);
    this._onStatus('synthesizing');

    const t0 = performance.now();
    const raw = await this._loader.tts.generate(text.trim(), { voice, speed });
    const synthMs = performance.now() - t0;

    const { audio, sampleRate } = normaliseAudio(raw, this._onLog);

    const durationS = audio.length / sampleRate;
    const rtf = (synthMs / 1000) / durationS;

    this._onLog(`samples=${audio.length}  sr=${sampleRate} Hz  dur=${durationS.toFixed(3)}s  RTF=${rtf.toFixed(3)}`);
    this._onStatus('done');

    this._lastResult = {
      audio, sampleRate, synthMs, durationS, rtf,
      voice, speed, text,
      modelKey: this._loader.loadedModelKey,
      device: this._loader.loadedDevice,
    };
    return this._lastResult;
  }

  async speak(text, { voice = DEFAULT_VOICE, speed = 1.0, srOverride = null } = {}) {
    const result = await this.synthesize(text, { voice, speed });
    const effectiveSR = srOverride ?? result.sampleRate;
    if (srOverride && srOverride !== result.sampleRate) {
      this._onLog(`SR override: ${srOverride} Hz (model returned ${result.sampleRate} Hz)`, 'warn');
    }
    this._onLog(`Playing: ${result.audio.length} samples @ ${effectiveSR} Hz`);
    const t0 = performance.now();
    this._onStatus('playing');
    await this._player.play(result.audio, effectiveSR);
    const playMs = performance.now() - t0;
    this._onLog(`Playback done: ${(playMs / 1000).toFixed(2)}s`);
    this._onStatus('idle');
    return { ...result, effectiveSR };
  }

  stop() {
    this._player.stop();
    this._onStatus('idle');
  }

  get lastResult() {
    return this._lastResult;
  }
}

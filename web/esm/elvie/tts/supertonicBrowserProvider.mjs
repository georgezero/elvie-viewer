// Supertonic v3 + WebGPU browser TTS provider.
// Lazily imports SupertonicProvider and AudioPlayer from supertts/.
// Singleton model — repeated calls reuse the loaded ONNX sessions.
//
// Safari WebGPU compat patch (requestAdapterInfo stub) and ORT config
// (forceFp16=false, wasmPaths) live in supertonicProvider.mjs and run
// at import time, before any InferenceSession is created.

import { TtsProvider } from './ttsProvider.mjs';

const WARMUP_TEXT = 'Ready.';
const DEFAULT_VOICE = 'F1';

let _instance = null;

export class SupertonicBrowserProvider extends TtsProvider {
  // Callbacks and getVoice are updated on the existing singleton if it already exists.
  static getInstance({ onLog, onStatus, getVoice } = {}) {
    if (!_instance) {
      _instance = new SupertonicBrowserProvider({ onLog, onStatus, getVoice });
    } else {
      if (onLog)    _instance._onLog    = onLog;
      if (onStatus) _instance._onStatus = onStatus;
      if (getVoice) _instance._getVoice = getVoice;
    }
    return _instance;
  }

  constructor({ onLog, onStatus, getVoice } = {}) {
    super();
    this._onLog     = onLog    ?? (() => {});
    this._onStatus  = onStatus ?? (() => {});
    this._getVoice  = getVoice ?? (() => DEFAULT_VOICE);
    this._provider  = null;   // SupertonicProvider instance
    this._player    = null;   // AudioPlayer instance
    this._state     = 'idle'; // idle | loading | warming | ready | error
    this._stateDetail = '';
    this._loadPromise = null;
    this._instrumentation = {};
  }

  get id() { return 'supertonic-v3-webgpu'; }
  get isLoaded() { return this._state === 'ready'; }

  _setState(s, detail = '') {
    this._state = s;
    this._stateDetail = detail;
    this._onStatus(s, detail);
  }

  async preload() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._doLoad();
    return this._loadPromise;
  }

  async _doLoad() {
    if (this._state === 'ready') return;
    this._setState('loading');
    try {
      const t0 = performance.now();
      const [{ SupertonicProvider }, { AudioPlayer }] = await Promise.all([
        import('../../supertts/supertonicProvider.mjs'),
        import('../../supertts/audioPlayer.mjs'),
      ]);
      this._player = new AudioPlayer();
      this._provider = new SupertonicProvider({
        onLog:      (msg) => this._onLog(`[st-browser] ${msg}`),
        onProgress: () => {},
        onStatus:   () => {},
      });
      await this._provider.load('webgpu', 'v3');
      const loadMs = performance.now() - t0;
      this._instrumentation.loadMs = loadMs;
      this._onLog(`[st-browser] model loaded in ${(loadMs / 1000).toFixed(1)}s`);

      this._setState('warming');
      await this._warmup();

      this._setState('ready');
    } catch (e) {
      this._setState('error', String(e?.message || e));
      this._loadPromise = null;
      throw e;
    }
  }

  async _warmup() {
    const t0 = performance.now();
    const voice = this._getVoice() ?? DEFAULT_VOICE;
    try {
      await this._provider.synthesize(WARMUP_TEXT, { steps: 4, voice });
      this._instrumentation.warmupMs = performance.now() - t0;
      this._onLog(`[st-browser] warmup done in ${(this._instrumentation.warmupMs / 1000).toFixed(2)}s voice=${voice}`);
    } catch (e) {
      this._onLog(`[st-browser] warmup failed (non-fatal): ${e?.message}`);
    }
  }

  async synthesize(text, options = {}) {
    if (!this.isLoaded) await this.preload();

    const voice = options.voice ?? this._getVoice() ?? DEFAULT_VOICE;
    let result;
    try {
      result = await this._provider.synthesize(text, { ...options, voice });
    } catch (e) {
      // ORT/WebGPU runtime crash (e.g. device lost, null session). Reset so the
      // next call can reload the model cleanly rather than hitting the same crash.
      this._onLog(`[st-browser] synthesize error — resetting provider: ${e?.message}`);
      this._provider = null;
      this._player   = null;
      this._loadPromise = null;
      this._setState('error', String(e?.message || e));
      throw e;
    }
    const audioUrl = await this._player.toWavBlobUrl(result.audio, result.sampleRate);

    this._instrumentation = {
      ...this._instrumentation,
      lastSynthMs:   result.synthMs,
      lastDurationS: result.durationS,
      lastRtf:       result.rtf,
      lastVoice:     voice,
    };

    this._onLog(
      `[st-browser] dur=${result.durationS.toFixed(2)}s ` +
      `synth=${(result.synthMs / 1000).toFixed(2)}s RTF=${result.rtf.toFixed(3)} voice=${voice}`
    );

    return {
      audioUrl,
      audio:      result.audio,
      sampleRate: result.sampleRate,
      durationS:  result.durationS,
      synthMs:    result.synthMs,
      rtf:        result.rtf,
      provider:   this.id,
      voice,
    };
  }

  unload() {
    this._provider?.unload?.();
    this._provider  = null;
    this._player    = null;
    this._loadPromise = null;
    this._setState('idle');
    _instance = null;
  }

  getStatus() {
    return {
      state:       this._state,
      detail:      this._stateDetail,
      ...this._instrumentation,
      activeVoice: this._instrumentation.lastVoice ?? this._getVoice(),
    };
  }
}

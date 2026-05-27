// Kokoro q4 + WebGPU browser TTS provider.
// Fallback when Supertonic fails or is unavailable.
// kokoro-js is loaded dynamically from CDN; model is cached by the browser.

import { TtsProvider } from './ttsProvider.mjs';

const KOKORO_CDN   = 'https://esm.sh/kokoro-js';
const MODEL_KEY    = 'kokoro-82m-q4';
const WARMUP_TEXT  = 'Ready.';
const DEFAULT_VOICE = 'af_bella';

let _instance = null;

export class KokoroBrowserProvider extends TtsProvider {
  // Callbacks and getVoice are updated on the existing singleton if it already exists.
  static getInstance({ onLog, onStatus, getVoice } = {}) {
    if (!_instance) {
      _instance = new KokoroBrowserProvider({ onLog, onStatus, getVoice });
    } else {
      if (onLog)    _instance._onLog    = onLog;
      if (onStatus) _instance._onStatus = onStatus;
      if (getVoice) _instance._getVoice = getVoice;
    }
    return _instance;
  }

  constructor({ onLog, onStatus, getVoice } = {}) {
    super();
    this._onLog    = onLog    ?? (() => {});
    this._onStatus = onStatus ?? (() => {});
    this._getVoice = getVoice ?? (() => DEFAULT_VOICE);
    this._loader   = null;
    this._player   = null;
    this._browser  = null;
    this._state    = 'idle';
    this._stateDetail = '';
    this._loadPromise = null;
    this._instrumentation = {};
  }

  get id() { return 'kokoro-q4-webgpu'; }
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
      const [{ ModelLoader }, { SupertonicBrowser }, { AudioPlayer }, kokoroMod] = await Promise.all([
        import('../../supertts/modelLoader.mjs'),
        import('../../supertts/supertonicBrowser.mjs'),
        import('../../supertts/audioPlayer.mjs'),
        import(/* @vite-ignore */ KOKORO_CDN),
      ]);

      this._player = new AudioPlayer();
      this._loader = new ModelLoader({
        onLog:      (msg) => this._onLog(`[kokoro] ${msg}`),
        onProgress: () => {},
      });

      await this._loader.load(MODEL_KEY, 'webgpu', kokoroMod);
      const loadMs = performance.now() - t0;
      this._instrumentation.loadMs = loadMs;
      this._onLog(`[kokoro] model loaded in ${(loadMs / 1000).toFixed(1)}s`);

      this._browser = new SupertonicBrowser({
        loader: this._loader,
        player: this._player,
        onLog:    (msg) => this._onLog(`[kokoro] ${msg}`),
        onStatus: () => {},
      });

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
    try {
      await this._browser.synthesize(WARMUP_TEXT);
      this._instrumentation.warmupMs = performance.now() - t0;
      this._onLog(`[kokoro] warmup done in ${(this._instrumentation.warmupMs / 1000).toFixed(2)}s`);
    } catch (e) {
      this._onLog(`[kokoro] warmup failed (non-fatal): ${e?.message}`);
    }
  }

  async synthesize(text, options = {}) {
    if (!this.isLoaded) await this.preload();

    const voice = options.voice ?? this._getVoice() ?? DEFAULT_VOICE;
    const result = await this._browser.synthesize(text, { ...options, voice });
    const audioUrl = await this._player.toWavBlobUrl(result.audio, result.sampleRate);

    this._instrumentation = {
      ...this._instrumentation,
      lastSynthMs:   result.synthMs,
      lastDurationS: result.durationS,
      lastRtf:       result.rtf,
      lastVoice:     voice,
    };

    this._onLog(
      `[kokoro] dur=${result.durationS.toFixed(2)}s ` +
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
    this._loader?.unload?.();
    this._loader  = null;
    this._player  = null;
    this._browser = null;
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

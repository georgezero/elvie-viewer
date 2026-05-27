// TTS Manager — selects and orchestrates TTS providers.
//
// Config shape:
//   mode              — 'auto' | 'browser' | 'server'
//   browserEngine     — 'supertonic-v3-webgpu' | 'kokoro-q4-webgpu'
//   getVoiceSt        — () => string  (Supertonic voice id, e.g. 'F1')
//   getVoiceKokoro    — () => string  (Kokoro voice id, e.g. 'af_bella')
//   getServerUrl      — () => string
//   getVoiceRef       — () => { data, url, text } | null
//   onSetVoiceRef     — (ref) => void
//   getMobileOverride — () => boolean  (allow browser TTS on phone; default false)
//   onStatusChange    — (status) => void
//   onLog             — (msg) => void
//
// ttsManager.synthesize(text, options) always returns { audioUrl, provider, voice, ... }
// and throws if synthesis is impossible.
//
// Status events emitted via onStatusChange:
//   detecting-webgpu   — before navigator.gpu.requestAdapter
//   webgpu-detected    — WebGPU adapter found; detail = adapter name
//   webgpu-unavailable — WebGPU not available; detail = 'phone' | '' | ...
//   mode-selected      — provider picked; detail = 'mode → providerId voice=X'
//   loading            — browser model downloading/initializing
//   warming            — running warmup synthesis
//   ready              — provider loaded and warmed
//   synthesizing       — synthesis in progress; detail = 'voice=X'
//   fallback           — browser failed, switched to server; detail = reason
//   unavailable        — no provider available; detail = reason

import { ServerTtsProvider }         from './serverTtsProvider.mjs';
import { SupertonicBrowserProvider } from './supertonicBrowserProvider.mjs';
import { KokoroBrowserProvider }     from './kokoroBrowserProvider.mjs';

export class TtsManager {
  constructor(config = {}) {
    this._mode              = config.mode              ?? 'auto';
    this._browserEngine     = config.browserEngine     ?? 'supertonic-v3-webgpu';
    this._getVoiceSt        = config.getVoiceSt        ?? (() => 'F1');
    this._getVoiceKokoro    = config.getVoiceKokoro    ?? (() => 'af_bella');
    this._getServerUrl      = config.getServerUrl      ?? (() => '');
    this._getVoiceRef       = config.getVoiceRef       ?? (() => null);
    this._onSetVoiceRef     = config.onSetVoiceRef     ?? (() => {});
    this._getMobileOverride = config.getMobileOverride ?? (() => false);
    this._onStatusChange    = config.onStatusChange    ?? (() => {});
    this._onLog             = config.onLog             ?? (() => {});

    this._webgpuAvailable   = false;
    this._webgpuAdapter     = '';
    this._mobileClass       = 'desktop'; // 'desktop' | 'tablet' | 'phone'
    this._mobileGatingReason = '';
    this._activeProvider    = null;
    this._fallbackReason    = '';
    this._status            = 'idle';
    this._statusDetail      = '';

    this._serverProvider = new ServerTtsProvider({
      getBaseUrl:    this._getServerUrl,
      getVoiceRef:   this._getVoiceRef,
      onSetVoiceRef: this._onSetVoiceRef,
      onLog:         this._onLog,
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  updateConfig({ mode, browserEngine, voiceSt, voiceKokoro, mobileOverride } = {}) {
    if (mode           != null) this._mode           = mode;
    if (browserEngine  != null) this._browserEngine  = browserEngine;
    if (voiceSt        != null) { const v = voiceSt;       this._getVoiceSt        = () => v; }
    if (voiceKokoro    != null) { const v = voiceKokoro;   this._getVoiceKokoro    = () => v; }
    if (mobileOverride != null) { const v = mobileOverride; this._getMobileOverride = () => v; }
  }

  // Detect WebGPU + device class, select provider, start background preload.
  async initTts() {
    await this._detectWebGpu();
    this._activeProvider = this._selectProvider();
    const voice = this._getActiveVoice();
    const provId = this._activeProvider?.id ?? 'none';
    this._setStatus('mode-selected', `${this._mode} → ${provId}${voice ? ' voice=' + voice : ''}`);
    this._onLog(`[tts] mode=${this._mode} engine=${this._browserEngine} webgpu=${this._webgpuAvailable} mobile=${this._mobileClass} provider=${provId} voice=${voice}`);

    if (this._isBrowserProvider(this._activeProvider)) {
      this._activeProvider.preload().catch(e => {
        this._onLog(`[tts] preload failed: ${e?.message} — falling back to server`);
        this._fallbackReason = `browser TTS failed to load: ${e?.message}`;
        this._activeProvider = this._serverProvider;
        this._setStatus('fallback', this._fallbackReason);
      });
    }
  }

  async synthesize(text, options = {}) {
    if (!this._activeProvider) {
      this._activeProvider = this._selectProvider();
    }
    if (!this._activeProvider) {
      this._setStatus('unavailable', 'no provider available');
      throw new Error('TTS unavailable — no provider selected (WebGPU unavailable and no server URL configured)');
    }

    const provider = this._activeProvider;
    const voice = this._getActiveVoice();
    try {
      this._setStatus('synthesizing', voice ? `voice=${voice}` : provider.id);
      const result = await provider.synthesize(text, voice ? { ...options, voice } : options);
      this._setStatus('ready', provider.id);
      return result;
    } catch (e) {
      this._onLog(`[tts] ${provider.id} failed: ${e?.message}`);
      if (this._isBrowserProvider(provider)) {
        const serverUrl = (this._getServerUrl() || '').trim();
        if (serverUrl) {
          this._onLog('[tts] falling back to server TTS');
          this._fallbackReason = `${provider.id}: ${e?.message}`;
          this._activeProvider = this._serverProvider;
          this._setStatus('fallback', this._fallbackReason);
          return await this._serverProvider.synthesize(text, options);
        }
      }
      this._setStatus('unavailable', e?.message);
      throw e;
    }
  }

  getTtsStatus() {
    const providerStatus = this._activeProvider?.getStatus?.() ?? {};
    const activeVoice = providerStatus.activeVoice ?? this._getActiveVoice();
    const voiceSource = this._activeProvider?.id === 'server'
      ? (this._getVoiceRef?.() ? 'server-cloned' : 'server-random')
      : (activeVoice ? 'user-selected' : 'unavailable');
    return {
      status:             this._status,
      detail:             this._statusDetail,
      provider:           this._activeProvider?.id ?? 'none',
      webgpuAvailable:    this._webgpuAvailable,
      webgpuAdapter:      this._webgpuAdapter,
      mobileClass:        this._mobileClass,
      mobileGatingReason: this._mobileGatingReason,
      isExperimental:     this._mobileClass !== 'desktop' && this._isBrowserProvider(this._activeProvider),
      fallbackReason:     this._fallbackReason,
      providerStatus,
      lastRtf:            providerStatus.lastRtf      ?? null,
      lastSynthMs:        providerStatus.lastSynthMs  ?? null,
      lastDurationS:      providerStatus.lastDurationS ?? null,
      serverUrl:          this._activeProvider?.id === 'server' ? (this._getServerUrl() || '') : null,
      activeVoice,
      voiceSource,
    };
  }

  // Bypasses auto-selection and fallback. Used by debug test buttons.
  async synthesizeForced(text, providerId) {
    let provider;
    if (providerId === 'server') {
      provider = this._serverProvider;
    } else {
      provider = this._makeBrowserProvider(providerId);
    }
    this._onLog(`[tts] forced provider: ${providerId}`);
    this._setStatus('synthesizing', providerId);
    try {
      const voice = providerId === 'server' ? null : this._getVoiceForEngine(providerId);
      const result = await provider.synthesize(text, voice ? { voice } : {});
      this._setStatus('ready', providerId);
      return { ...result, forced: true };
    } catch (e) {
      this._setStatus('unavailable', `forced ${providerId}: ${e?.message}`);
      throw e;
    }
  }

  // ── Provider selection ───────────────────────────────────────────────────────

  _selectProvider() {
    if (this._mode === 'server') {
      return this._serverProvider;
    }

    const override = this._getMobileOverride?.() ?? false;
    const mobileBlocked = this._mobileClass !== 'desktop' && !override;

    if (this._mode === 'browser') {
      if (mobileBlocked) {
        this._mobileGatingReason = this._mobileGatingReason ||
          'Browser TTS disabled on mobile (Phase 1). Enable mobile override in Settings.';
        this._onLog(`[tts] ${this._mobileClass}: browser mode blocked — no mobile override`);
        return null;
      }
      return this._makeBrowserProvider(this._browserEngine);
    }

    // 'auto': prefer browser if WebGPU available and not mobile-blocked
    if (this._webgpuAvailable && !mobileBlocked) {
      return this._makeBrowserProvider(this._browserEngine);
    }

    const serverUrl = (this._getServerUrl() || '').trim();
    if (serverUrl) {
      if (mobileBlocked && !this._mobileGatingReason) {
        this._mobileGatingReason = 'Browser TTS disabled on mobile (Phase 1)';
      }
      if (!this._fallbackReason) {
        this._fallbackReason = this._mobileGatingReason || 'WebGPU not available';
      }
      this._onLog(`[tts] auto: ${this._fallbackReason} — using server TTS`);
      return this._serverProvider;
    }

    if (mobileBlocked) {
      if (!this._mobileGatingReason) {
        this._mobileGatingReason = 'Browser TTS disabled on mobile (Phase 1). Configure a server TTS endpoint or enable mobile override.';
      }
    }
    this._onLog('[tts] auto: no available TTS provider');
    return null;
  }

  _makeBrowserProvider(engine) {
    const onLog    = this._onLog;
    const onStatus = (s, d) => this._setStatus(s, d);
    if (engine === 'kokoro-q4-webgpu') {
      return KokoroBrowserProvider.getInstance({ onLog, onStatus, getVoice: this._getVoiceKokoro });
    }
    return SupertonicBrowserProvider.getInstance({ onLog, onStatus, getVoice: this._getVoiceSt });
  }

  _isBrowserProvider(p) {
    return p?.id === 'supertonic-v3-webgpu' || p?.id === 'kokoro-q4-webgpu';
  }

  _getActiveVoice() {
    return this._getVoiceForEngine(this._activeProvider?.id);
  }

  _getVoiceForEngine(engineId) {
    if (engineId === 'supertonic-v3-webgpu') return this._getVoiceSt?.()     ?? 'F1';
    if (engineId === 'kokoro-q4-webgpu')     return this._getVoiceKokoro?.() ?? 'af_bella';
    return null;
  }

  // ── Device + WebGPU detection ────────────────────────────────────────────────

  // Classify device using UA, pointer capability, viewport, and memory hints.
  // Returns 'phone' | 'tablet' | 'desktop'.
  _classifyDevice() {
    if (typeof navigator === 'undefined') return 'desktop';
    const ua = navigator.userAgent || '';

    // Explicit phone signals
    if (/iP(hone|od)/i.test(ua)) return 'phone';
    if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'phone' : 'tablet';

    // iPad / iPadOS (reports MacIntel platform)
    if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return 'tablet';
    }

    // Capability-based: coarse pointer (touch/stylus) + screen width
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse) {
      const w = (typeof screen !== 'undefined' ? screen.width : null)
             ?? (typeof window !== 'undefined' ? window.innerWidth : null)
             ?? 1920;
      return w < 768 ? 'phone' : 'tablet';
    }

    return 'desktop';
  }

  async _detectWebGpu() {
    this._setStatus('detecting-webgpu');
    this._mobileClass = this._classifyDevice();
    const override = this._getMobileOverride?.() ?? false;

    // Block browser TTS on all mobile devices unless the user has explicitly enabled the override.
    // The ~400 MB ST v3 model crashes mobile browsers (confirmed on iPad).
    if (this._mobileClass !== 'desktop' && !override) {
      this._webgpuAvailable    = false;
      this._webgpuAdapter      = '';
      this._mobileGatingReason = 'Browser TTS disabled on mobile (Phase 1)';
      this._onLog(`[tts] ${this._mobileClass}: browser TTS blocked — enable mobile override in Settings`);
      this._setStatus('webgpu-unavailable', 'mobile');
      return;
    }

    try {
      if (!navigator?.gpu) {
        this._webgpuAvailable = false;
        this._setStatus('webgpu-unavailable');
        return;
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        this._webgpuAvailable = false;
        this._setStatus('webgpu-unavailable');
        return;
      }
      this._webgpuAvailable = true;
      try {
        const info = await adapter.requestAdapterInfo?.();
        this._webgpuAdapter = [info?.vendor, info?.device].filter(Boolean).join('/') || 'available';
      } catch {
        this._webgpuAdapter = 'available';
      }
      if (this._mobileClass === 'tablet') {
        this._onLog('[tts] tablet: browser TTS will run as experimental');
      }
      this._setStatus('webgpu-detected', this._webgpuAdapter);
    } catch {
      this._webgpuAvailable = false;
      this._setStatus('webgpu-unavailable');
    }
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  _setStatus(status, detail = '') {
    this._status      = status;
    this._statusDetail = detail;
    this._onStatusChange({
      status,
      detail,
      provider: this._activeProvider?.id,
      voice:    this._getActiveVoice(),
      mode:     this._mode,
    });
  }
}

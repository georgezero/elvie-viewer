import assert from 'node:assert/strict';
import { TtsManager } from '../ttsManager.mjs';
import { TtsProvider } from '../ttsProvider.mjs';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

class OkProvider extends TtsProvider {
  constructor(id, audioUrl = 'blob:ok') { super(); this._id = id; this._audioUrl = audioUrl; }
  get id() { return this._id; }
  get isLoaded() { return true; }
  async preload() {}
  async synthesize(text) { return { audioUrl: this._audioUrl, durationS: 1, synthMs: 50, rtf: 0.05, provider: this._id }; }
  getStatus() { return { state: 'ready', detail: '' }; }
}

class FailProvider extends TtsProvider {
  constructor(id) { super(); this._id = id; }
  get id() { return this._id; }
  get isLoaded() { return false; }
  async preload() { throw new Error(`${this._id}: load failed`); }
  async synthesize() { throw new Error(`${this._id}: synthesis failed`); }
  getStatus() { return { state: 'error', detail: 'forced failure' }; }
}

// Helper: build a TtsManager with injected providers (bypasses dynamic imports)
function makeManager(opts = {}) {
  const mgr = new TtsManager({
    mode:              opts.mode           ?? 'auto',
    browserEngine:     opts.browserEngine  ?? 'supertonic-v3-webgpu',
    getServerUrl:      opts.getServerUrl   ?? (() => opts.serverUrl ?? ''),
    getVoiceSt:        opts.getVoiceSt     ?? (() => opts.voiceSt ?? 'F1'),
    getVoiceKokoro:    opts.getVoiceKokoro ?? (() => opts.voiceKokoro ?? 'af_bella'),
    getMobileOverride: opts.getMobileOverride ?? (() => opts.mobileOverride ?? false),
    getVoiceRef:       () => null,
    onSetVoiceRef:     () => {},
    onLog:             () => {},
  });
  mgr._webgpuAvailable = opts.webgpuAvailable ?? false;
  mgr._mobileClass     = opts.mobileClass     ?? 'desktop';
  if (opts.serverProvider)  mgr._serverProvider  = opts.serverProvider;
  if (opts.browserProvider) mgr._browserProvider = opts.browserProvider;
  return mgr;
}

// ── T1: mode=server always picks server provider ──────────────────────────────
{
  const server = new OkProvider('server', 'https://example.com/audio.wav');
  const mgr = makeManager({ mode: 'server', serverUrl: 'https://example.com', serverProvider: server });
  mgr._activeProvider = mgr._serverProvider;
  const result = await mgr.synthesize('hello');
  assert.equal(result.audioUrl, 'https://example.com/audio.wav');
  assert.equal(result.provider, 'server');
}

// ── T2: mode=auto, no WebGPU, server URL present → uses server ────────────────
{
  const server = new OkProvider('server', 'blob:server');
  const mgr = makeManager({ mode: 'auto', webgpuAvailable: false, serverUrl: 'http://tts.local', serverProvider: server });
  await mgr.initTts();
  assert.equal(mgr._activeProvider?.id, 'server');
  assert.ok(mgr._fallbackReason.includes('WebGPU'));
}

// ── T3: mode=auto, no WebGPU, no server URL → provider is null ───────────────
{
  const mgr = makeManager({ mode: 'auto', webgpuAvailable: false, serverUrl: '' });
  await mgr.initTts();
  assert.equal(mgr._activeProvider, null);
}

// ── T4: synthesize with null provider throws ──────────────────────────────────
{
  const mgr = makeManager({ mode: 'auto', webgpuAvailable: false, serverUrl: '' });
  await mgr.initTts();
  await assert.rejects(() => mgr.synthesize('hello'), /unavailable/i);
}

// ── T5: browser provider failure falls back to server ─────────────────────────
{
  const server  = new OkProvider('server', 'blob:server');
  const browser = new FailProvider('supertonic-v3-webgpu');
  const mgr = makeManager({ mode: 'auto', webgpuAvailable: true, serverUrl: 'http://tts.local', serverProvider: server });
  mgr._activeProvider = browser; // inject failing browser provider as active
  const result = await mgr.synthesize('hello');
  assert.equal(result.provider, 'server');
  assert.ok(mgr._fallbackReason.length > 0);
}

// ── T6: browser provider failure, no server URL → throws ─────────────────────
{
  const browser = new FailProvider('supertonic-v3-webgpu');
  const mgr = makeManager({ mode: 'auto', webgpuAvailable: true, serverUrl: '' });
  mgr._activeProvider = browser;
  await assert.rejects(() => mgr.synthesize('hello'));
}

// ── T7: getTtsStatus returns expected shape ───────────────────────────────────
{
  const server = new OkProvider('server', 'blob:s');
  const mgr = makeManager({ mode: 'server', serverUrl: 'http://tts', serverProvider: server });
  mgr._activeProvider = server;
  const s = mgr.getTtsStatus();
  assert.ok('status' in s);
  assert.ok('provider' in s);
  assert.ok('webgpuAvailable' in s);
  assert.ok('fallbackReason' in s);
}

// ── T8: updateConfig changes mode + browserEngine ────────────────────────────
{
  const mgr = makeManager({ mode: 'auto' });
  assert.equal(mgr._mode, 'auto');
  mgr.updateConfig({ mode: 'server', browserEngine: 'kokoro-q4-webgpu' });
  assert.equal(mgr._mode, 'server');
  assert.equal(mgr._browserEngine, 'kokoro-q4-webgpu');
}

// ── T9: repeated synthesize calls reuse activeProvider (no re-init) ───────────
{
  let initCount = 0;
  const server = new OkProvider('server', 'blob:s');
  server.preload = async () => { initCount++; };
  const mgr = makeManager({ mode: 'server', serverUrl: 'http://tts', serverProvider: server });
  mgr._activeProvider = server;
  await mgr.synthesize('first');
  await mgr.synthesize('second');
  assert.equal(initCount, 0, 'preload should not be called for server provider');
}

// ── T10: status events are emitted ───────────────────────────────────────────
{
  const events = [];
  const server = new OkProvider('server', 'blob:s');
  const mgr = makeManager({ mode: 'server', serverUrl: 'http://tts', serverProvider: server });
  mgr._activeProvider = server;
  mgr._onStatusChange = (e) => events.push(e.status);
  await mgr.synthesize('hello');
  assert.ok(events.includes('synthesizing'), `expected synthesizing in ${JSON.stringify(events)}`);
  assert.ok(events.includes('ready'), `expected ready in ${JSON.stringify(events)}`);
}

// ── T11: synthesizeForced(server) bypasses auto-selection ────────────────────
{
  const server = new OkProvider('server', 'blob:forced-server');
  const mgr = makeManager({ mode: 'auto', webgpuAvailable: false, serverUrl: 'http://tts', serverProvider: server });
  // Do NOT init — forced bypasses everything
  const result = await mgr.synthesizeForced('hello', 'server');
  assert.equal(result.provider, 'server');
  assert.equal(result.forced, true);
}

// ── T12: synthesizeForced(browser) does NOT fall back to server on failure ────
{
  const server = new OkProvider('server', 'blob:fallback-server');
  const mgr = makeManager({ mode: 'auto', webgpuAvailable: false, serverUrl: 'http://tts', serverProvider: server });
  // Inject a failing browser provider via _makeBrowserProvider override
  mgr._makeBrowserProvider = (_engine) => new FailProvider('supertonic-v3-webgpu');
  await assert.rejects(
    () => mgr.synthesizeForced('hello', 'supertonic-v3-webgpu'),
    /synthesis failed/i,
    'synthesizeForced must throw, not fall back to server'
  );
}

// ── T13: getTtsStatus includes lastRtf / lastSynthMs / lastDurationS ──────────
{
  class InstrumentedProvider extends OkProvider {
    getStatus() { return { state: 'ready', detail: '', lastRtf: 0.05, lastSynthMs: 100, lastDurationS: 2 }; }
  }
  const server = new InstrumentedProvider('server', 'blob:s');
  const mgr = makeManager({ mode: 'server', serverUrl: 'http://tts', serverProvider: server });
  mgr._activeProvider = server;
  const s = mgr.getTtsStatus();
  assert.equal(s.lastRtf, 0.05);
  assert.equal(s.lastSynthMs, 100);
  assert.equal(s.lastDurationS, 2);
}

// ── T14: synthesizeForced emits synthesizing + ready/unavailable events ───────
{
  const events = [];
  const server = new OkProvider('server', 'blob:s');
  const mgr = makeManager({ mode: 'server', serverUrl: 'http://tts', serverProvider: server });
  mgr._onStatusChange = (e) => events.push(e.status);
  await mgr.synthesizeForced('hello', 'server');
  assert.ok(events.includes('synthesizing'), `expected synthesizing in ${JSON.stringify(events)}`);
  assert.ok(events.includes('ready'), `expected ready in ${JSON.stringify(events)}`);
}

// ── T15: WebGPU lifecycle events fire in initTts ─────────────────────────────
{
  const events = [];
  const server = new OkProvider('server', 'blob:s');
  // webgpuAvailable=false simulates no WebGPU — triggers webgpu-unavailable
  const mgr = makeManager({ mode: 'auto', webgpuAvailable: false, serverUrl: 'http://tts', serverProvider: server });
  mgr._onStatusChange = (e) => events.push(e.status);
  // Override _detectWebGpu to emit the right events without touching navigator.gpu
  mgr._detectWebGpu = async function() {
    this._webgpuAvailable = false;
    this._setStatus('detecting-webgpu');
    this._setStatus('webgpu-unavailable');
  };
  await mgr.initTts();
  assert.ok(events.includes('detecting-webgpu'),  `expected detecting-webgpu in ${JSON.stringify(events)}`);
  assert.ok(events.includes('webgpu-unavailable'), `expected webgpu-unavailable in ${JSON.stringify(events)}`);
  assert.ok(events.includes('mode-selected'),      `expected mode-selected in ${JSON.stringify(events)}`);
}

// ── T16: mode-selected detail includes provider and voice ─────────────────────
{
  const details = [];
  const server = new OkProvider('server', 'blob:s');
  const mgr = makeManager({ mode: 'server', serverUrl: 'http://tts', serverProvider: server, voiceSt: 'F3' });
  mgr._onStatusChange = (e) => { if (e.status === 'mode-selected') details.push(e.detail); };
  mgr._detectWebGpu = async function() { this._webgpuAvailable = false; };
  await mgr.initTts();
  assert.ok(details.length > 0, 'expected mode-selected event');
  assert.ok(details[0].includes('server'), `expected "server" in detail: ${details[0]}`);
}

// ── T17: getTtsStatus returns activeVoice and voiceSource ─────────────────────
{
  const server = new OkProvider('server', 'blob:s');
  const mgr = makeManager({ mode: 'server', serverUrl: 'http://tts', serverProvider: server });
  mgr._activeProvider = server;
  const s = mgr.getTtsStatus();
  assert.ok('activeVoice' in s,  'expected activeVoice in getTtsStatus');
  assert.ok('voiceSource' in s,  'expected voiceSource in getTtsStatus');
  assert.equal(s.voiceSource, 'server-random'); // no voice ref set
}

// ── T18: synthesizeForced passes voice to provider via options ────────────────
{
  let capturedOptions;
  const server = new OkProvider('server', 'blob:s');
  const mgr = makeManager({ mode: 'server', serverUrl: 'http://tts', serverProvider: server, voiceSt: 'F2' });
  mgr._makeBrowserProvider = (engine) => {
    return {
      id: engine,
      isLoaded: true,
      preload: async () => {},
      synthesize: async (text, opts) => { capturedOptions = opts; return { audioUrl: 'blob:test', provider: engine, voice: opts?.voice, durationS: 1, synthMs: 50, rtf: 0.05 }; },
      getStatus: () => ({ state: 'ready', detail: '' }),
    };
  };
  await mgr.synthesizeForced('hello', 'supertonic-v3-webgpu');
  assert.equal(capturedOptions?.voice, 'F2', `expected voice=F2, got ${capturedOptions?.voice}`);
}

// ── T19: phone + auto + server → falls back to server (mobile-gated) ─────────
{
  const server = new OkProvider('server', 'blob:server');
  const mgr = makeManager({ mode: 'auto', mobileClass: 'phone', webgpuAvailable: true, serverUrl: 'http://tts.local', serverProvider: server });
  const provider = mgr._selectProvider();
  assert.equal(provider?.id, 'server', 'phone should fall back to server in auto mode');
  assert.ok(mgr._mobileGatingReason.length > 0, 'expected non-empty mobile gating reason');
}

// ── T20: phone + auto + no server → null (unavailable) ───────────────────────
{
  const mgr = makeManager({ mode: 'auto', mobileClass: 'phone', webgpuAvailable: true, serverUrl: '' });
  const provider = mgr._selectProvider();
  assert.equal(provider, null, 'phone with no server should return null provider');
}

// ── T21: phone + override + auto + webgpu → browser allowed ──────────────────
{
  const mgr = makeManager({ mode: 'auto', mobileClass: 'phone', mobileOverride: true, webgpuAvailable: true });
  mgr._makeBrowserProvider = (engine) => new OkProvider(engine);
  const provider = mgr._selectProvider();
  assert.ok(mgr._isBrowserProvider(provider), 'phone with override should use browser provider');
}

// ── T22: tablet + auto + no server → null (blocked, all mobile Phase 1) ──────
{
  const mgr = makeManager({ mode: 'auto', mobileClass: 'tablet', webgpuAvailable: true, serverUrl: '' });
  const provider = mgr._selectProvider();
  assert.equal(provider, null, 'tablet should be blocked (no browser TTS on any mobile, Phase 1)');
  assert.ok(mgr._mobileGatingReason.length > 0, 'expected non-empty gating reason for tablet');
}

// ── T23: tablet + auto + server → falls back to server TTS ───────────────────
{
  const server = new OkProvider('server', 'blob:server');
  const mgr = makeManager({ mode: 'auto', mobileClass: 'tablet', webgpuAvailable: true, serverUrl: 'http://tts.local', serverProvider: server });
  const provider = mgr._selectProvider();
  assert.equal(provider?.id, 'server', 'tablet in auto mode should use server TTS when configured');
}

console.log('ttsManager: all tests passed');

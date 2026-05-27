// Server-side OmniVoice TTS provider.
// Wraps the Gradio _design_fn / _clone_fn HTTP API used by the main viewer.
// getBaseUrl()     — returns the configured OmniVoice endpoint (no trailing slash)
// getVoiceRef()    — returns { data, url, text } for voice-clone continuity, or null

import { TtsProvider } from './ttsProvider.mjs';

export class ServerTtsProvider extends TtsProvider {
  constructor({ getBaseUrl, getVoiceRef, onSetVoiceRef, onLog } = {}) {
    super();
    this._getBaseUrl   = getBaseUrl   ?? (() => '');
    this._getVoiceRef  = getVoiceRef  ?? (() => null);
    this._onSetVoiceRef = onSetVoiceRef ?? (() => {});
    this._onLog        = onLog        ?? (() => {});
  }

  get id() { return 'server'; }
  get isLoaded() { return true; }

  async synthesize(text, {
    language = 'English',
    speed = 1.0,
    guidance = 2.0,
    seed = 24,
  } = {}) {
    const base = (this._getBaseUrl() || '').trim();
    if (!base) throw new Error('Server TTS URL not configured');

    const ref = this._getVoiceRef();
    const refAudio = ref?.data || ref?.url || null;
    const refText  = ref?.text || '';

    const makePayload = () => ({
      data: [text, language, seed, guidance, true, speed,
        null, true, true, 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto']
    });
    const makeClonePayload = () => ({
      data: [text, language, refAudio, refText || text, '', 32,
        guidance, true, speed, null, true, true]
    });

    const endpointPath = refAudio ? '/gradio_api/run/_clone_fn' : '/gradio_api/run/_design_fn';
    const endpoint = `${base}${endpointPath}`;
    const t0 = performance.now();

    let res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refAudio ? makeClonePayload() : makePayload()),
    });
    if (!res.ok && refAudio) {
      res = await fetch(`${base}/gradio_api/run/_design_fn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makePayload()),
      });
    }
    if (!res.ok) throw new Error(`Server TTS request failed (${res.status})`);

    const json = await res.json();
    const audioObj = json?.data?.[0];
    const rawUrl = audioObj?.url || null;
    if (!rawUrl) throw new Error('Server TTS: no audio URL returned');

    const audioUrl = _rewriteGradioUrl(rawUrl, base);
    const synthMs = performance.now() - t0;

    // Store first response as voice reference for clone continuity
    if (!refAudio) {
      const refPath = audioObj?.path || null;
      this._onSetVoiceRef({
        url: audioUrl,
        data: refPath ? {
          path: refPath, url: audioUrl,
          orig_name: audioObj?.orig_name || 'audio.wav',
          meta: { _type: 'gradio.FileData' },
        } : null,
        text,
      });
    }

    this._onLog(`[server-tts] synthMs=${synthMs.toFixed(0)} endpoint=${endpoint} url=${audioUrl.slice(0, 80)}`);
    return { audioUrl, synthMs, provider: this.id, endpoint };
  }

  getStatus() {
    const base = (this._getBaseUrl() || '').trim();
    return base
      ? { state: 'ready', detail: base }
      : { state: 'unavailable', detail: 'no server URL configured' };
  }
}

function _rewriteGradioUrl(rawUrl, base) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl, base);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      const b = new URL(base);
      u.hostname = b.hostname;
      u.port     = b.port;
      u.protocol = b.protocol;
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

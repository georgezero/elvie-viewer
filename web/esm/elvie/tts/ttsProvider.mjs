// Abstract TTS provider interface.
// All concrete providers must implement synthesize().
// synthesize() must return { audioUrl, durationS?, synthMs?, rtf?, provider }.
// audioUrl is always a string the caller can drop into <audio>.src or cache.
// Browser providers produce blob URLs (via AudioPlayer.toWavBlobUrl).
// Server providers return the remote URL directly.

export class TtsProvider {
  get id() { return 'base'; }
  get isLoaded() { return false; }

  // Optional: preload model before first use.
  async preload() {}

  // Synthesize text. Returns { audioUrl, durationS, synthMs, rtf, provider }.
  async synthesize(_text, _options = {}) {
    throw new Error(`${this.id}.synthesize() not implemented`);
  }

  // Free loaded model / sessions.
  unload() {}

  // { state: string, detail: string }
  getStatus() { return { state: 'unknown', detail: '' }; }
}

export class AudioPlayer {
  constructor() {
    this._ctx = null;
    this._source = null;
    this._playing = false;
  }

  // Creates (or reuses) an AudioContext whose sample rate matches the audio.
  // Mismatched rates cause choppy playback in Safari — avoid browser resampling entirely.
  _ctx_(sampleRate) {
    if (!this._ctx || this._ctx.state === 'closed' || this._ctx.sampleRate !== sampleRate) {
      if (this._ctx && this._ctx.state !== 'closed') {
        this._ctx.close();
      }
      this._ctx = new AudioContext({ sampleRate });
    }
    return this._ctx;
  }

  async play(float32Array, sampleRate) {
    this.stop();
    const ctx = this._ctx_(sampleRate);
    if (ctx.state === 'suspended') await ctx.resume();

    const buffer = ctx.createBuffer(1, float32Array.length, sampleRate);
    buffer.copyToChannel(float32Array, 0);

    this._source = ctx.createBufferSource();
    this._source.buffer = buffer;
    this._source.connect(ctx.destination);
    this._playing = true;

    return new Promise((resolve) => {
      this._source.onended = () => {
        this._playing = false;
        resolve();
      };
      this._source.start();
    });
  }

  stop() {
    this._playing = false;
    if (this._source) {
      try { this._source.stop(); } catch {}
      this._source.disconnect();
      this._source = null;
    }
  }

  get isPlaying() {
    return this._playing;
  }

  get duration() {
    return this._source?.buffer?.duration ?? 0;
  }

  // Returns a Blob URL for the audio so it can be downloaded/replayed
  async toWavBlobUrl(float32Array, sampleRate) {
    const numSamples = float32Array.length;
    const bytesPerSample = 2;
    const numChannels = 1;
    const byteRate = sampleRate * numChannels * bytesPerSample;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numSamples * bytesPerSample;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);

    const writeStr = (off, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(offset, clamp16(float32Array[i]), true);
      offset += 2;
    }

    const blob = new Blob([buf], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }
}

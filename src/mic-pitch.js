import { detectPitchYIN, medianOfThree } from './pitch-judge.js';

export class MicPitchTracker {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.sampleBuf = null;
    this.active = false;
    this.mode = 'headphone'; // 'headphone' | 'speaker'
    this.history = [];
  }

  async start(mode = this.mode) {
    this.mode = mode;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('請改用 Chrome 開啟以啟用麥克風');
    }

    const isSpeaker = mode === 'speaker';
    try {
      const micPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: isSpeaker,
          noiseSuppression: isSpeaker,
          autoGainControl: false,
        },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MicTimeout')), 5000)
      );
      this.stream = await Promise.race([micPromise, timeoutPromise]);
    } catch (err) {
      if (err?.message === 'MicTimeout') {
        throw new Error('麥克風無回應，請改用 Chrome 開啟');
      }
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        throw new Error('請允許麥克風權限');
      }
      throw new Error('無法開啟麥克風，請改用 Chrome 開啟');
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
    this.sampleBuf = new Float32Array(this.analyser.fftSize);
    this.history = [];
    this.active = true;
  }

  stop() {
    this.active = false;
    this.history = [];
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {}
      this.source = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
    this.sampleBuf = null;
  }

  samplePitch() {
    if (!this.active || !this.analyser || !this.sampleBuf || !this.ctx) {
      return null;
    }
    this.analyser.getFloatTimeDomainData(this.sampleBuf);
    const res = detectPitchYIN(this.sampleBuf, this.ctx.sampleRate);
    if (!res) {
      this.history = [];
      return null;
    }

    this.history.push(res.freq);
    if (this.history.length > 3) this.history.shift();

    const smoothedFreq =
      this.history.length === 3
        ? medianOfThree(this.history[0], this.history[1], this.history[2])
        : res.freq;

    return {
      freq: smoothedFreq,
      clarity: res.clarity,
      rms: res.rms,
    };
  }
}

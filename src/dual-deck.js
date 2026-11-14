import { clampGain, clampSemitones } from './audio-math.js';

export class DualDeckEngine {
  constructor() {
    this.ctx = null;
    this.workletNode = null;
    this.analyser = null;
    this.instBuffer = null;
    this.vocalBuffer = null;
    this.instSource = null;
    this.vocalSource = null;

    this.isPlaying = false;
    this.durationSec = 0;
    this.startCtxTime = 0;
    this.pauseOffsetSec = 0;

    this.semitones = 0;
    this.vocalGain = 1;
    this.instGain = 1;
    this.onEnded = null;
  }

  async ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(new URL('./pitch-worklet.js', import.meta.url));
      this.workletNode = new AudioWorkletNode(this.ctx, 'dual-stem-pitch-processor', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.workletNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.syncWorkletParams();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  loadBuffers(instBuffer, vocalBuffer) {
    this.stopSources();
    this.isPlaying = false;
    this.pauseOffsetSec = 0;
    this.instBuffer = instBuffer;
    this.vocalBuffer = vocalBuffer;
    this.durationSec = Math.max(instBuffer?.duration || 0, vocalBuffer?.duration || 0);
  }

  syncWorkletParams() {
    if (!this.workletNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.workletNode.parameters.get('semitones').setValueAtTime(this.semitones, now);
    this.workletNode.parameters.get('vocalGain').setValueAtTime(this.vocalGain, now);
    this.workletNode.parameters.get('instGain').setValueAtTime(this.instGain, now);
  }

  setSemitones(val) {
    this.semitones = clampSemitones(val);
    this.syncWorkletParams();
    return this.semitones;
  }

  setVocalGain(val) {
    this.vocalGain = clampGain(val);
    this.syncWorkletParams();
    return this.vocalGain;
  }

  stopSources() {
    if (this.instSource) {
      try {
        this.instSource.onended = null;
        this.instSource.stop();
        this.instSource.disconnect();
      } catch {}
      this.instSource = null;
    }
    if (this.vocalSource) {
      try {
        this.vocalSource.onended = null;
        this.vocalSource.stop();
        this.vocalSource.disconnect();
      } catch {}
      this.vocalSource = null;
    }
  }

  async play() {
    if (!this.instBuffer || !this.vocalBuffer) return false;
    await this.ensureContext();
    this.stopSources();

    const offset = Math.min(this.pauseOffsetSec, Math.max(0, this.durationSec - 0.02));
    const when = this.ctx.currentTime + 0.03;

    const instSrc = this.ctx.createBufferSource();
    instSrc.buffer = this.instBuffer;
    instSrc.connect(this.workletNode, 0, 0);

    const vocSrc = this.ctx.createBufferSource();
    vocSrc.buffer = this.vocalBuffer;
    vocSrc.connect(this.workletNode, 0, 1);

    instSrc.onended = () => {
      if (this.isPlaying && this.getCurrentTime() >= this.durationSec - 0.08) {
        this.isPlaying = false;
        this.pauseOffsetSec = 0;
        if (this.onEnded) this.onEnded();
      }
    };

    instSrc.start(when, offset);
    vocSrc.start(when, offset);

    this.instSource = instSrc;
    this.vocalSource = vocSrc;
    this.startCtxTime = when - offset;
    this.isPlaying = true;
    return true;
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffsetSec = this.getCurrentTime();
    this.stopSources();
    this.isPlaying = false;
  }

  seek(sec) {
    const clamped = Math.max(0, Math.min(this.durationSec, sec));
    this.pauseOffsetSec = clamped;
    if (this.isPlaying) {
      this.play();
    }
  }

  getCurrentTime() {
    if (!this.isPlaying || !this.ctx) return this.pauseOffsetSec;
    return Math.max(0, Math.min(this.durationSec, this.ctx.currentTime - this.startCtxTime));
  }

  getFrequencyData(targetArray) {
    if (!this.analyser) return false;
    this.analyser.getByteFrequencyData(targetArray);
    return true;
  }
}

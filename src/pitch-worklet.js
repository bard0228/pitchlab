const RING_SIZE = 16384;
const RING_MASK = RING_SIZE - 1;
const WINDOW_SIZE = 2048;
const MIN_DELAY = 64;

class DualStemPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'semitones',
        defaultValue: 0,
        minValue: -12,
        maxValue: 12,
        automationRate: 'k-rate',
      },
      {
        name: 'vocalGain',
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
      {
        name: 'instGain',
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this.ringL = new Float32Array(RING_SIZE);
    this.ringR = new Float32Array(RING_SIZE);
    this.writeIdx = 0;
    this.phasor = 0;
    this.smoothedSemitones = 0;
    this.smoothedVocalGain = 1;
    this.smoothedInstGain = 1;
  }

  readInterpolated(ring, delaySamples) {
    let readPos = this.writeIdx - delaySamples;
    if (readPos < 0) readPos += RING_SIZE;
    const i0 = Math.floor(readPos) & RING_MASK;
    const i1 = (i0 + 1) & RING_MASK;
    const frac = readPos - Math.floor(readPos);
    return ring[i0] + frac * (ring[i1] - ring[i0]);
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    const outL = out[0];
    const outR = out[1] || out[0];
    const frames = outL.length;

    const instIn = inputs[0] || [];
    const vocalIn = inputs[1] || [];
    const instL = instIn[0] || null;
    const instR = instIn[1] || instL;
    const vocalL = vocalIn[0] || null;
    const vocalR = vocalIn[1] || vocalL;

    const targetSemi = parameters.semitones[0];
    const targetVocalGain = parameters.vocalGain[0];
    const targetInstGain = parameters.instGain[0];

    for (let i = 0; i < frames; i++) {
      this.smoothedSemitones += (targetSemi - this.smoothedSemitones) * 0.005;
      this.smoothedVocalGain += (targetVocalGain - this.smoothedVocalGain) * 0.01;
      this.smoothedInstGain += (targetInstGain - this.smoothedInstGain) * 0.01;

      const sInstL = instL ? instL[i] : 0;
      const sInstR = instR ? instR[i] : 0;
      const sVocL = vocalL ? vocalL[i] : 0;
      const sVocR = vocalR ? vocalR[i] : 0;

      const mixL = sInstL * this.smoothedInstGain + sVocL * this.smoothedVocalGain;
      const mixR = sInstR * this.smoothedInstGain + sVocR * this.smoothedVocalGain;

      this.ringL[this.writeIdx] = mixL;
      this.ringR[this.writeIdx] = mixR;

      if (Math.abs(this.smoothedSemitones) < 0.005) {
        outL[i] = mixL;
        if (out[1]) outR[i] = mixR;
      } else {
        const ratio = Math.pow(2, this.smoothedSemitones / 12);
        const delta = (1 - ratio) / WINDOW_SIZE;
        this.phasor = (this.phasor + delta) % 1;
        if (this.phasor < 0) this.phasor += 1;

        const p1 = this.phasor;
        const p2 = (p1 + 0.5) % 1;
        const d1 = p1 * WINDOW_SIZE + MIN_DELAY;
        const d2 = p2 * WINDOW_SIZE + MIN_DELAY;

        const s1 = Math.sin(Math.PI * p1);
        const w1 = s1 * s1;
        const w2 = 1 - w1;

        const yL =
          this.readInterpolated(this.ringL, d1) * w1 +
          this.readInterpolated(this.ringL, d2) * w2;
        const yR =
          this.readInterpolated(this.ringR, d1) * w1 +
          this.readInterpolated(this.ringR, d2) * w2;

        outL[i] = yL;
        if (out[1]) outR[i] = yR;
      }

      this.writeIdx = (this.writeIdx + 1) & RING_MASK;
    }

    return true;
  }
}

registerProcessor('dual-stem-pitch-processor', DualStemPitchProcessor);

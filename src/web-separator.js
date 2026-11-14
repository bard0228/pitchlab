import { detectPitchYIN } from './pitch-judge.js';

export function separateStereoChannelsPure(left, right, sampleRate = 48000) {
  const n = left.length;
  const instL = new Float32Array(n);
  const instR = new Float32Array(n);
  const vocL = new Float32Array(n);
  const vocR = new Float32Array(n);

  // 1st-order IIR coefficients for vocal band [180 Hz, 4200 Hz]
  const dt = 1 / sampleRate;
  const rcHp = 1 / (2 * Math.PI * 180);
  const alphaHp = rcHp / (rcHp + dt);

  const rcLp = 1 / (2 * Math.PI * 4200);
  const alphaLp = dt / (rcLp + dt);

  let prevIn = 0;
  let hpOut = 0;
  let lpOut = 0;

  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right ? right[i] : l;
    const mid = 0.5 * (l + r);
    const side = 0.5 * (l - r);

    hpOut = alphaHp * (hpOut + mid - prevIn);
    prevIn = mid;
    lpOut = lpOut + alphaLp * (hpOut - lpOut);

    const vocalBand = lpOut;
    const nonVocalMid = mid - vocalBand;

    vocL[i] = vocalBand;
    vocR[i] = vocalBand;
    instL[i] = nonVocalMid + side;
    instR[i] = nonVocalMid - side;
  }

  return { instL, instR, vocL, vocR };
}

export function extractPitchCurveFromMono(mono, sampleRate = 48000, hopMs = 20) {
  const hopSamples = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const winLen = 2048;
  const totalFrames = Math.max(1, Math.ceil(mono.length / hopSamples));
  const f0Hz = new Array(totalFrames).fill(null);

  for (let idx = 0; idx < totalFrames; idx++) {
    const start = idx * hopSamples;
    if (start + winLen > mono.length) break;
    const slice = mono.subarray(start, start + winLen);
    const res = detectPitchYIN(slice, sampleRate);
    if (res) {
      f0Hz[idx] = Math.round(res.freq * 100) / 100;
    }
  }

  return { hopMs, f0Hz };
}

export function separateAudioBufferInBrowser(audioCtx, srcBuffer) {
  const sr = srcBuffer.sampleRate;
  const n = srcBuffer.length;
  const left = srcBuffer.getChannelData(0);
  const right = srcBuffer.numberOfChannels > 1 ? srcBuffer.getChannelData(1) : left;

  const { instL, instR, vocL, vocR } = separateStereoChannelsPure(left, right, sr);

  const instBuffer = audioCtx.createBuffer(2, n, sr);
  instBuffer.getChannelData(0).set(instL);
  instBuffer.getChannelData(1).set(instR);

  const vocalBuffer = audioCtx.createBuffer(2, n, sr);
  vocalBuffer.getChannelData(0).set(vocL);
  vocalBuffer.getChannelData(1).set(vocR);

  const pitchCurve = extractPitchCurveFromMono(vocL, sr, 20);
  return { instBuffer, vocalBuffer, pitchCurve };
}

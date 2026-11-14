import { midiToFreq, semitonesToRatio } from './audio-math.js';

export function computePitchDeviationCents(
  liveHz,
  targetHz,
  transposeSemitones = 0,
  octaveAgnostic = true
) {
  if (!liveHz || !targetHz || liveHz <= 0 || targetHz <= 0) {
    return null;
  }
  const shiftedTarget = targetHz * semitonesToRatio(transposeSemitones);
  const rawCents = 1200 * Math.log2(liveHz / shiftedTarget);

  let cents = rawCents;
  let octaveShift = 0;

  if (octaveAgnostic) {
    cents = ((((rawCents % 1200) + 1800) % 1200) - 600);
    octaveShift = Math.round((rawCents - cents) / 1200);
  }

  const roundedCents = Math.round(cents);
  const absCents = Math.abs(roundedCents);
  let grade = 'red';
  if (absCents <= 45) grade = 'green';
  else if (absCents <= 80) grade = 'amber';

  return {
    cents: roundedCents,
    rawCents: Math.round(rawCents),
    octaveShift,
    grade,
  };
}

export function lookupTargetPitchAtTime(pitchCurve, timeSec, latencyOffsetMs = 0) {
  if (!pitchCurve || !Array.isArray(pitchCurve.f0Hz) || !pitchCurve.hopMs) {
    return null;
  }
  const adjustedMs = timeSec * 1000 + latencyOffsetMs;
  if (adjustedMs < 0) return null;
  const idx = Math.floor(adjustedMs / pitchCurve.hopMs);
  if (idx < 0 || idx >= pitchCurve.f0Hz.length) return null;
  const val = pitchCurve.f0Hz[idx];
  return typeof val === 'number' && val > 0 ? val : null;
}

export function detectPitchYIN(
  samples,
  sampleRate,
  {
    minFreq = 70,
    maxFreq = 1000,
    clarityThreshold = 0.85,
    rmsThreshold = 0.012,
  } = {}
) {
  const n = samples.length;
  if (n < 512 || !sampleRate) return null;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms < rmsThreshold) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxTau = Math.min(Math.floor(n / 2) - 1, Math.ceil(sampleRate / minFreq));
  if (maxTau <= minTau + 2) return null;

  const half = Math.floor(n / 2);
  const yin = new Float32Array(maxTau + 1);
  yin[0] = 1;

  let runningSum = 0;
  const yinThreshold = 1 - clarityThreshold;

  for (let tau = 1; tau <= maxTau; tau++) {
    let diff = 0;
    for (let i = 0; i < half; i++) {
      const d = samples[i] - samples[i + tau];
      diff += d * d;
    }
    runningSum += diff;
    yin[tau] = runningSum > 0 ? (diff * tau) / runningSum : 1;
  }

  let bestTau = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (yin[tau] < yinThreshold) {
      while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null;

  // Parabolic interpolation around bestTau
  let refinedTau = bestTau;
  if (bestTau > minTau && bestTau < maxTau) {
    const s0 = yin[bestTau - 1];
    const s1 = yin[bestTau];
    const s2 = yin[bestTau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-12) {
      refinedTau += (s2 - s0) / denom;
    }
  }

  const freq = sampleRate / refinedTau;
  if (!Number.isFinite(freq) || freq < minFreq || freq > maxFreq) return null;

  return {
    freq,
    clarity: Math.max(0, Math.min(1, 1 - yin[bestTau])),
    rms,
  };
}

export function melodyToPitchCurve(melody, durationSec, hopMs = 10) {
  const totalFrames = Math.ceil((durationSec * 1000) / hopMs);
  const f0Hz = new Array(totalFrames).fill(null);

  for (const note of melody) {
    const startIdx = Math.max(0, Math.floor((note.start * 1000) / hopMs));
    const endIdx = Math.min(totalFrames, Math.ceil((note.end * 1000) / hopMs));
    const hz = midiToFreq(note.midi);
    for (let i = startIdx; i < endIdx; i++) {
      f0Hz[i] = hz;
    }
  }

  return { hopMs, f0Hz };
}

export function medianOfThree(a, b, c) {
  if (a > b) {
    if (b > c) return b;
    return a > c ? c : a;
  }
  if (a > c) return a;
  return b > c ? c : b;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePitchDeviationCents,
  lookupTargetPitchAtTime,
  detectPitchYIN,
  melodyToPitchCurve,
} from '../src/pitch-judge.js';

test('computePitchDeviationCents handles exact pitch, sharp/flat, transpose, and octave-agnostic folding', () => {
  // Exact A4 = 440Hz
  const exact = computePitchDeviationCents(440, 440, 0, true);
  assert.equal(exact.cents, 0);
  assert.equal(exact.grade, 'green');
  assert.equal(exact.octaveShift, 0);

  // Transpose target A4 down by 2 semitones (G4 = 391.9954Hz), user sings G4 -> 0 cents
  const transposed = computePitchDeviationCents(391.9954, 440, -2, true);
  assert.ok(Math.abs(transposed.cents) <= 1, `expected ~0 cents, got ${transposed.cents}`);
  assert.equal(transposed.grade, 'green');

  // Octave-agnostic: user sings A3 (220Hz) against A4 (440Hz) -> 0 cents, octaveShift = -1
  const lowOct = computePitchDeviationCents(220, 440, 0, true);
  assert.equal(lowOct.cents, 0);
  assert.equal(lowOct.grade, 'green');
  assert.equal(lowOct.octaveShift, -1);

  // Strict mode: A3 (220Hz) against A4 (440Hz) -> -1200 cents, red
  const strictOct = computePitchDeviationCents(220, 440, 0, false);
  assert.equal(strictOct.cents, -1200);
  assert.equal(strictOct.grade, 'red');
});

test('lookupTargetPitchAtTime applies latency offset and returns null on silent segments', () => {
  const curve = {
    hopMs: 100,
    f0Hz: [null, 261.63, 293.66, 329.63, null],
  };
  assert.equal(lookupTargetPitchAtTime(curve, 0.05, 0), null);
  assert.equal(lookupTargetPitchAtTime(curve, 0.15, 0), 261.63);
  // Latency offset +100ms shifts lookup earlier/later consistently
  assert.equal(lookupTargetPitchAtTime(curve, 0.25, -100), 261.63);
  assert.equal(lookupTargetPitchAtTime(curve, 10, 0), null);
});

test('detectPitchYIN detects pure sine waves within 5 cents and rejects low-RMS noise', () => {
  const sr = 48000;
  const n = 2048;
  const buf = new Float32Array(n);
  const targetHz = 329.63; // E4
  for (let i = 0; i < n; i++) {
    buf[i] = 0.3 * Math.sin((2 * Math.PI * targetHz * i) / sr);
  }
  const detected = detectPitchYIN(buf, sr);
  assert.ok(detected !== null, 'Expected valid pitch for E4 sine wave');
  const centsErr = 1200 * Math.log2(detected.freq / targetHz);
  assert.ok(Math.abs(centsErr) < 5, `Expected <5 cents error, got ${centsErr}`);
  assert.ok(detected.clarity >= 0.85);

  // Low-RMS silence/breath noise should be rejected as null
  const quietNoise = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    quietNoise[i] = ((i % 17) / 17 - 0.5) * 0.004;
  }
  assert.equal(detectPitchYIN(quietNoise, sr), null);
});

test('melodyToPitchCurve converts note segments to 10ms hop curve', () => {
  const curve = melodyToPitchCurve([{ start: 0.1, end: 0.2, midi: 60 }], 0.3, 10);
  assert.equal(curve.hopMs, 10);
  assert.equal(curve.f0Hz[5], null);
  assert.ok(Math.abs(curve.f0Hz[15] - 261.625565) < 0.01);
  assert.equal(curve.f0Hz[25], null);
});

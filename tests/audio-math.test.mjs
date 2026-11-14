import test from 'node:test';
import assert from 'node:assert/strict';
import {
  semitonesToRatio,
  clampSemitones,
  clampGain,
  formatSemitoneLabel,
  formatTime,
  computeHannDualTapWeights,
  midiToFreq,
  freqToMidi,
} from '../src/audio-math.js';

test('semitonesToRatio computes exact equal-temperament pitch ratios', () => {
  assert.equal(semitonesToRatio(0), 1);
  assert.ok(Math.abs(semitonesToRatio(12) - 2) < 1e-12);
  assert.ok(Math.abs(semitonesToRatio(-12) - 0.5) < 1e-12);
  assert.ok(Math.abs(semitonesToRatio(7) - Math.pow(2, 7 / 12)) < 1e-12);
});

test('clampSemitones constrains transpose to [-12, +12]', () => {
  assert.equal(clampSemitones(-20), -12);
  assert.equal(clampSemitones(20), 12);
  assert.equal(clampSemitones(-3.4), -3);
  assert.equal(clampSemitones(0), 0);
});

test('clampGain constrains gain to [0, 1]', () => {
  assert.equal(clampGain(-0.5), 0);
  assert.equal(clampGain(1.5), 1);
  assert.equal(clampGain(0.65), 0.65);
});

test('formatSemitoneLabel formats signed semitones', () => {
  assert.equal(formatSemitoneLabel(0), '0 半音');
  assert.equal(formatSemitoneLabel(-3), '-3 半音');
  assert.equal(formatSemitoneLabel(4), '+4 半音');
});

test('formatTime formats mm:ss', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(15), '00:15');
  assert.equal(formatTime(65.9), '01:05');
});

test('computeHannDualTapWeights sums to 1.0 across all phases', () => {
  for (let i = 0; i < 100; i++) {
    const phase = i / 100;
    const [w1, w2] = computeHannDualTapWeights(phase);
    assert.ok(w1 >= 0 && w1 <= 1);
    assert.ok(w2 >= 0 && w2 <= 1);
    assert.ok(Math.abs(w1 + w2 - 1) < 1e-12, `phase=${phase} sum=${w1 + w2}`);
  }
});

test('midiToFreq and freqToMidi round-trip A4=440Hz', () => {
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-12);
  assert.ok(Math.abs(freqToMidi(440) - 69) < 1e-12);
  assert.ok(Math.abs(midiToFreq(60) - 261.6255653) < 1e-5);
});

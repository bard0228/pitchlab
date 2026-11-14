import test from 'node:test';
import assert from 'node:assert/strict';
import {
  separateStereoChannelsPure,
  extractPitchCurveFromMono,
} from '../src/web-separator.js';

test('separateStereoChannelsPure isolates center vocal and preserves side instrumental', () => {
  const sr = 48000;
  const n = 4800; // 0.1s
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const centerVocal = 0.5 * Math.sin(2 * Math.PI * 440 * t); // Center (L=R)
    const sideGuitar = 0.4 * Math.sin(2 * Math.PI * 100 * t);  // Hard panned (L=-R)
    left[i] = centerVocal + sideGuitar;
    right[i] = centerVocal - sideGuitar;
  }

  const { instL, instR, vocL, vocR } = separateStereoChannelsPure(left, right, sr);
  assert.equal(instL.length, n);
  assert.equal(vocL.length, n);

  // Side component must remain strong in instrumental and absent in center vocal
  const instEnergy = instL.reduce((s, v) => s + v * v, 0) / n;
  const vocEnergy = vocL.reduce((s, v) => s + v * v, 0) / n;
  assert.ok(instEnergy > 0.05, `Expected side instrumental energy, got ${instEnergy}`);
  assert.ok(vocEnergy > 0.05, `Expected center vocal energy, got ${vocEnergy}`);
  assert.ok(Math.abs(vocL[100] - vocR[100]) < 1e-6, 'Center vocal should be mono-centered');
});

test('extractPitchCurveFromMono extracts C4 frequency with < 10 cents error', () => {
  const sr = 48000;
  const n = sr; // 1.0s
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mono[i] = 0.4 * Math.sin((2 * Math.PI * 261.6256 * i) / sr);
  }
  const curve = extractPitchCurveFromMono(mono, sr, 20);
  assert.equal(curve.hopMs, 20);
  const valid = curve.f0Hz.filter((v) => v !== null);
  assert.ok(valid.length > 30);
  const med = valid[Math.floor(valid.length / 2)];
  const centsErr = Math.abs(1200 * Math.log2(med / 261.6256));
  assert.ok(centsErr < 10, `Expected < 10 cents error, got ${centsErr}`);
});

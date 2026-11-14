export function semitonesToRatio(semitones) {
  return Math.pow(2, semitones / 12);
}

export function clampSemitones(semitones) {
  const rounded = Math.round(Number(semitones) || 0);
  return Math.max(-12, Math.min(12, rounded));
}

export function clampGain(gain) {
  const val = Number(gain);
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(1, val));
}

export function formatSemitoneLabel(semitones) {
  const s = clampSemitones(semitones);
  if (s > 0) return `+${s} st`;
  return `${s} st`;
}

export function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function computeHannDualTapWeights(phase) {
  const p = ((phase % 1) + 1) % 1;
  const s = Math.sin(Math.PI * p);
  const w1 = s * s;
  const w2 = 1 - w1;
  return [w1, w2];
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

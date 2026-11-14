import { midiToFreq } from './audio-math.js';

export const FIXTURE_DURATION_SEC = 15;

export const FIXTURE_MELODY = [
  { start: 0.5, end: 1.5, midi: 60, name: 'C4' },
  { start: 1.5, end: 2.5, midi: 62, name: 'D4' },
  { start: 2.5, end: 3.5, midi: 64, name: 'E4' },
  { start: 3.5, end: 4.5, midi: 67, name: 'G4' },
  { start: 4.5, end: 5.5, midi: 64, name: 'E4' },
  { start: 5.5, end: 6.5, midi: 62, name: 'D4' },
  { start: 6.5, end: 7.5, midi: 60, name: 'C4' },
  { start: 8.0, end: 9.0, midi: 64, name: 'E4' },
  { start: 9.0, end: 10.0, midi: 65, name: 'F4' },
  { start: 10.0, end: 11.0, midi: 67, name: 'G4' },
  { start: 11.0, end: 12.0, midi: 69, name: 'A4' },
  { start: 12.0, end: 13.0, midi: 67, name: 'G4' },
  { start: 13.0, end: 14.5, midi: 60, name: 'C4' },
];

const CHORDS = [
  { start: 0, end: 3.75, notes: [48, 55, 59, 64] },
  { start: 3.75, end: 7.5, notes: [45, 52, 55, 60] },
  { start: 7.5, end: 11.25, notes: [41, 48, 52, 57] },
  { start: 11.25, end: 15.0, notes: [43, 50, 53, 59] },
];

export function generateDualStemFixture(audioCtx) {
  const sr = audioCtx.sampleRate;
  const length = Math.floor(sr * FIXTURE_DURATION_SEC);

  const instBuffer = audioCtx.createBuffer(2, length, sr);
  const vocalBuffer = audioCtx.createBuffer(2, length, sr);

  const instL = instBuffer.getChannelData(0);
  const instR = instBuffer.getChannelData(1);
  const vocL = vocalBuffer.getChannelData(0);
  const vocR = vocalBuffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / sr;

    // 1. Instrumental Stem: warm chord pad + 120 BPM subtle pulse
    let pad = 0;
    for (const ch of CHORDS) {
      if (t >= ch.start && t < ch.end) {
        const localT = t - ch.start;
        const dur = ch.end - ch.start;
        const env = Math.min(1, localT / 0.08) * Math.min(1, (dur - localT) / 0.12);
        for (const m of ch.notes) {
          const f = midiToFreq(m);
          pad += Math.sin(2 * Math.PI * f * t) * 0.06 * env;
        }
        break;
      }
    }
    const beatPhase = (t * 2) % 1;
    const kick = beatPhase < 0.08 ? Math.sin(2 * Math.PI * (90 - beatPhase * 450) * beatPhase) * Math.exp(-beatPhase * 35) * 0.18 : 0;
    const instSample = Math.tanh(pad + kick);
    instL[i] = instSample;
    instR[i] = instSample * 0.96;

    // 2. Original Vocal Stem: expressive Do Re Mi melody with soft vibrato
    let voc = 0;
    for (const note of FIXTURE_MELODY) {
      if (t >= note.start && t < note.end) {
        const localT = t - note.start;
        const dur = note.end - note.start;
        const env = Math.min(1, localT / 0.04) * Math.min(1, (dur - localT) / 0.06);
        const vib = Math.sin(2 * Math.PI * 5.2 * t) * 0.004;
        const f = midiToFreq(note.midi) * (1 + vib);
        voc =
          (Math.sin(2 * Math.PI * f * t) * 0.24 +
            Math.sin(4 * Math.PI * f * t) * 0.08 +
            Math.sin(6 * Math.PI * f * t) * 0.03) *
          env;
        break;
      }
    }
    vocL[i] = voc;
    vocR[i] = voc;
  }

  return {
    title: 'Do Re Mi 練習曲 (15s Fixture)',
    durationSec: FIXTURE_DURATION_SEC,
    instBuffer,
    vocalBuffer,
    melody: FIXTURE_MELODY,
  };
}

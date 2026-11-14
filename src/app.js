import {
  clampSemitones,
  formatSemitoneLabel,
  formatTime,
} from './audio-math.js';
import { DualDeckEngine } from './dual-deck.js';
import { FIXTURE_MELODY, generateDualStemFixture } from './fixture-gen.js';
import { attachAndroidEdgeStretch } from './android-overscroll.js';

const engine = new DualDeckEngine();

const elPlay = document.getElementById('btn-play');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const elScrub = document.getElementById('scrub-bar');
const elTimeCur = document.getElementById('time-current');
const elTimeTot = document.getElementById('time-total');
const elVocalGain = document.getElementById('vocal-gain');
const elVocalGainVal = document.getElementById('vocal-gain-value');
const elKeyDown = document.getElementById('btn-key-down');
const elKeyUp = document.getElementById('btn-key-up');
const elKeyReset = document.getElementById('btn-key-reset');
const elKeyVal = document.getElementById('key-value');
const elHudKey = document.getElementById('hud-key');
const elHudNote = document.getElementById('hud-note');
const elFileInst = document.getElementById('file-inst');
const elFileVocal = document.getElementById('file-vocal');
const elLabelInst = document.getElementById('label-inst');
const elLabelVocal = document.getElementById('label-vocal');
const canvas = document.getElementById('pitch-canvas');
const ctx2d = canvas.getContext('2d');

let fixtureLoaded = false;
let currentMelody = FIXTURE_MELODY;
let customInstFile = null;
let customVocalFile = null;
let isScrubbing = false;
const freqBins = new Uint8Array(128);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi) {
  const m = Math.round(midi);
  const name = NOTE_NAMES[((m % 12) + 12) % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${name}${octave}`;
}

function setPlayUI(playing) {
  elPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
  iconPlay.hidden = playing;
  iconPlay.style.display = playing ? 'none' : 'block';
  iconPause.hidden = !playing;
  iconPause.style.display = playing ? 'block' : 'none';
}

function updateKeyUI(semi) {
  const label = formatSemitoneLabel(semi);
  elKeyVal.textContent = label;
  elHudKey.textContent = `調性 ${label}`;
}

async function ensureFixtureLoaded() {
  if (fixtureLoaded) return;
  await engine.ensureContext();
  const fixture = generateDualStemFixture(engine.ctx);
  engine.loadBuffers(fixture.instBuffer, fixture.vocalBuffer);
  elScrub.max = String(fixture.durationSec);
  elTimeTot.textContent = formatTime(fixture.durationSec);
  fixtureLoaded = true;
}

elPlay.addEventListener('click', async () => {
  if (engine.isPlaying) {
    engine.pause();
    setPlayUI(false);
    return;
  }
  await ensureFixtureLoaded();
  const ok = await engine.play();
  setPlayUI(ok);
});

engine.onEnded = () => {
  setPlayUI(false);
  elScrub.value = '0';
  elTimeCur.textContent = '00:00';
};

elVocalGain.addEventListener('input', () => {
  const pct = Number(elVocalGain.value);
  elVocalGainVal.textContent = `${pct}%`;
  engine.setVocalGain(pct / 100);
});

function changeKey(nextSemi) {
  const clamped = clampSemitones(nextSemi);
  engine.setSemitones(clamped);
  updateKeyUI(clamped);
}

elKeyDown.addEventListener('click', () => changeKey(engine.semitones - 1));
elKeyUp.addEventListener('click', () => changeKey(engine.semitones + 1));
elKeyReset.addEventListener('click', () => changeKey(0));

elScrub.addEventListener('pointerdown', () => {
  isScrubbing = true;
});
elScrub.addEventListener('input', () => {
  elTimeCur.textContent = formatTime(Number(elScrub.value));
});
elScrub.addEventListener('change', () => {
  isScrubbing = false;
  engine.seek(Number(elScrub.value));
});

async function tryLoadCustomStems() {
  if (!customInstFile || !customVocalFile) return;
  await engine.ensureContext();
  const [instBuf, vocBuf] = await Promise.all([
    customInstFile.arrayBuffer().then((b) => engine.ctx.decodeAudioData(b)),
    customVocalFile.arrayBuffer().then((b) => engine.ctx.decodeAudioData(b)),
  ]);
  engine.loadBuffers(instBuf, vocBuf);
  fixtureLoaded = true;
  currentMelody = [];
  elScrub.max = String(engine.durationSec);
  elScrub.value = '0';
  elTimeCur.textContent = '00:00';
  elTimeTot.textContent = formatTime(engine.durationSec);
  setPlayUI(false);
}

elFileInst.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  customInstFile = file;
  elLabelInst.textContent = '伴奏已選';
  tryLoadCustomStems();
});

elFileVocal.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  customVocalFile = file;
  elLabelVocal.textContent = '人聲已選';
  tryLoadCustomStems();
});

function drawStage() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 380;
  const h = canvas.clientHeight || 256;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, w, h);

  // Pitch grid lines (C3=48 to C5=72)
  const minMidi = 48;
  const maxMidi = 76;
  const midiToY = (m) => h - 24 - ((m - minMidi) / (maxMidi - minMidi)) * (h - 60);

  ctx2d.lineWidth = 1;
  for (let m = minMidi; m <= maxMidi; m += 2) {
    const y = midiToY(m);
    ctx2d.strokeStyle = m % 12 === 0 ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.08)';
    ctx2d.beginPath();
    ctx2d.moveTo(0, y);
    ctx2d.lineTo(w, y);
    ctx2d.stroke();
  }

  const nowSec = engine.getCurrentTime();
  if (!isScrubbing && engine.durationSec > 0) {
    elScrub.value = String(nowSec);
    elTimeCur.textContent = formatTime(nowSec);
  }

  // Spectrum bars along bottom
  if (engine.isPlaying && engine.getFrequencyData(freqBins)) {
    const barCount = 32;
    const barW = w / barCount;
    ctx2d.fillStyle = 'rgba(91, 130, 112, 0.28)';
    for (let i = 0; i < barCount; i++) {
      const val = freqBins[i] / 255;
      const bh = val * 44;
      ctx2d.fillRect(i * barW + 2, h - bh, Math.max(2, barW - 4), bh);
    }
  }

  // Scrolling target pitch bars shifted by current Pitch Transpose
  const playheadX = w * 0.28;
  const pxPerSec = 72;
  let activeNoteText = '--';

  for (const note of currentMelody) {
    const shiftedMidi = note.midi + engine.semitones;
    const x1 = playheadX + (note.start - nowSec) * pxPerSec;
    const x2 = playheadX + (note.end - nowSec) * pxPerSec;
    if (x2 < -10 || x1 > w + 10) continue;

    const y = midiToY(shiftedMidi);
    const active = nowSec >= note.start && nowSec < note.end;
    if (active) {
      activeNoteText = midiToNoteName(shiftedMidi);
    }

    ctx2d.fillStyle = active ? '#4ade80' : 'rgba(96, 165, 250, 0.55)';
    ctx2d.beginPath();
    ctx2d.roundRect(x1, y - 6, Math.max(6, x2 - x1 - 2), 12, 6);
    ctx2d.fill();
  }

  elHudNote.textContent = activeNoteText;

  // Playhead line
  ctx2d.strokeStyle = 'rgba(248, 250, 252, 0.65)';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  ctx2d.moveTo(playheadX, 34);
  ctx2d.lineTo(playheadX, h - 10);
  ctx2d.stroke();

  requestAnimationFrame(drawStage);
}

attachAndroidEdgeStretch(
  document.scrollingElement || document.documentElement,
  document.getElementById('app-shell')
);
requestAnimationFrame(drawStage);

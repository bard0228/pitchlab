import {
  clampSemitones,
  formatSemitoneLabel,
  formatTime,
  freqToMidi,
} from './audio-math.js';
import { DualDeckEngine } from './dual-deck.js';
import { FIXTURE_DURATION_SEC, FIXTURE_MELODY, generateDualStemFixture } from './fixture-gen.js';
import { attachAndroidEdgeStretch } from './android-overscroll.js';
import {
  computePitchDeviationCents,
  lookupTargetPitchAtTime,
  melodyToPitchCurve,
} from './pitch-judge.js';
import { MicPitchTracker } from './mic-pitch.js';

const engine = new DualDeckEngine();
const micTracker = new MicPitchTracker();

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
const elBtnMic = document.getElementById('btn-mic');
const elLabelMic = document.getElementById('label-mic');
const elBtnMode = document.getElementById('btn-mode');
const elLabelMode = document.getElementById('label-mode');
const elBtnOctave = document.getElementById('btn-octave');
const elLabelOctave = document.getElementById('label-octave');
const elLatency = document.getElementById('latency-offset');
const elLatencyVal = document.getElementById('latency-value');
const elMicError = document.getElementById('mic-error');
const elHudLive = document.getElementById('hud-live');
const elHudCents = document.getElementById('hud-cents');
const elHudAccuracy = document.getElementById('hud-accuracy');
const elFileInst = document.getElementById('file-inst');
const elFileVocal = document.getElementById('file-vocal');
const elLabelInst = document.getElementById('label-inst');
const elLabelVocal = document.getElementById('label-vocal');
const canvas = document.getElementById('pitch-canvas');
const ctx2d = canvas.getContext('2d');

let fixtureLoaded = false;
let currentMelody = FIXTURE_MELODY;
let currentPitchCurve = melodyToPitchCurve(FIXTURE_MELODY, FIXTURE_DURATION_SEC, 10);
let customInstFile = null;
let customVocalFile = null;
let isScrubbing = false;
let octaveAgnostic = true;
let audioMode = 'headphone';
let latencyOffsetMs = Number(localStorage.getItem('pitchlab_latency_ms') || 0);
let injectedTestFreq = null;

// Live pitch trail points: { timeSec, midi, grade }
const liveTrail = [];
let totalJudgedFrames = 0;
let greenJudgedFrames = 0;
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
  elKeyVal.textContent = formatSemitoneLabel(semi);
}

function showMicError(msg) {
  if (!msg) {
    elMicError.hidden = true;
    elMicError.style.display = 'none';
    elMicError.textContent = '';
    return;
  }
  elMicError.textContent = msg;
  elMicError.hidden = false;
  elMicError.style.display = 'block';
}

function updateLatencyUI(ms) {
  latencyOffsetMs = Math.max(-300, Math.min(300, Math.round(ms)));
  elLatency.value = String(latencyOffsetMs);
  elLatencyVal.textContent = `${latencyOffsetMs} 毫秒`;
  localStorage.setItem('pitchlab_latency_ms', String(latencyOffsetMs));
}

updateLatencyUI(latencyOffsetMs);

async function ensureFixtureLoaded() {
  if (fixtureLoaded) return;
  await engine.ensureContext();
  const fixture = generateDualStemFixture(engine.ctx);
  engine.loadBuffers(fixture.instBuffer, fixture.vocalBuffer);
  currentMelody = fixture.melody;
  currentPitchCurve = melodyToPitchCurve(fixture.melody, fixture.durationSec, 10);
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

elLatency.addEventListener('input', () => {
  updateLatencyUI(Number(elLatency.value));
});

elBtnOctave.addEventListener('click', () => {
  octaveAgnostic = !octaveAgnostic;
  elBtnOctave.setAttribute('aria-pressed', octaveAgnostic ? 'true' : 'false');
  elBtnOctave.classList.toggle('is-active', octaveAgnostic);
  elLabelOctave.textContent = octaveAgnostic ? '八度寬容：開' : '八度寬容：關';
});

elBtnMode.addEventListener('click', async () => {
  audioMode = audioMode === 'headphone' ? 'speaker' : 'headphone';
  const isSpeaker = audioMode === 'speaker';
  elBtnMode.setAttribute('aria-pressed', isSpeaker ? 'true' : 'false');
  elBtnMode.classList.toggle('is-active', isSpeaker);
  elLabelMode.textContent = isSpeaker ? '外放模式' : '耳機模式';

  if (micTracker.active) {
    micTracker.stop();
    try {
      await micTracker.start(audioMode);
      showMicError('');
    } catch (err) {
      elBtnMic.setAttribute('aria-pressed', 'false');
      elLabelMic.textContent = '開啟麥克風';
      showMicError(err.message);
    }
  }
});

elBtnMic.addEventListener('click', async () => {
  if (micTracker.active) {
    micTracker.stop();
    elBtnMic.setAttribute('aria-pressed', 'false');
    elLabelMic.textContent = '開啟麥克風';
    showMicError('');
    return;
  }
  elLabelMic.textContent = '啟動麥克風中...';
  showMicError('');
  try {
    await micTracker.start(audioMode);
    elBtnMic.setAttribute('aria-pressed', 'true');
    elLabelMic.textContent = '麥克風收音中';
    showMicError('');
  } catch (err) {
    elBtnMic.setAttribute('aria-pressed', 'false');
    elLabelMic.textContent = '開啟麥克風';
    showMicError(err.message);
  }
});

elScrub.addEventListener('pointerdown', () => {
  isScrubbing = true;
});
elScrub.addEventListener('input', () => {
  elTimeCur.textContent = formatTime(Number(elScrub.value));
});
elScrub.addEventListener('change', async () => {
  isScrubbing = false;
  const targetSec = Number(elScrub.value);
  await ensureFixtureLoaded();
  engine.seek(targetSec);
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
  currentPitchCurve = null;
  liveTrail.length = 0;
  totalJudgedFrames = 0;
  greenJudgedFrames = 0;
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

// Testing hook for deterministic E2E pitch rendering verification
window.__pitchLabInjectSample = (freqHz) => {
  injectedTestFreq = freqHz;
};

function updateHudGrade(grade) {
  elHudCents.classList.remove('grade-green', 'grade-amber', 'grade-red');
  if (grade) {
    elHudCents.classList.add(`grade-${grade}`);
  }
}

function fillRoundedBar(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
  ctx.fill();
}

function drawStage() {
  requestAnimationFrame(drawStage);
  try {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 380;
    const h = canvas.clientHeight || 256;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);

    const minMidi = 45;
    const maxMidi = 78;
    const midiToY = (m) => h - 22 - ((m - minMidi) / (maxMidi - minMidi)) * (h - 62);

    ctx2d.font = '600 10px "Plus Jakarta Sans", sans-serif';
    ctx2d.textBaseline = 'middle';
    for (let m = minMidi; m <= maxMidi; m += 2) {
      const y = midiToY(m);
      const isOctaveC = m % 12 === 0;
      ctx2d.lineWidth = 1;
      ctx2d.strokeStyle = isOctaveC ? 'rgba(148, 163, 184, 0.24)' : 'rgba(148, 163, 184, 0.08)';
      ctx2d.beginPath();
      ctx2d.moveTo(28, y);
      ctx2d.lineTo(w, y);
      ctx2d.stroke();

      if (isOctaveC) {
        ctx2d.fillStyle = 'rgba(148, 163, 184, 0.65)';
        ctx2d.fillText(midiToNoteName(m), 6, y);
      }
    }

    const nowSec = engine.getCurrentTime();
    if (!isScrubbing && engine.durationSec > 0) {
      elScrub.value = String(nowSec);
      elTimeCur.textContent = formatTime(nowSec);
    }

    if (engine.isPlaying && engine.getFrequencyData(freqBins)) {
      const barCount = 32;
      const barW = (w - 30) / barCount;
      ctx2d.fillStyle = 'rgba(91, 130, 112, 0.22)';
      for (let i = 0; i < barCount; i++) {
        const val = freqBins[i] / 255;
        const bh = val * 36;
        ctx2d.fillRect(30 + i * barW + 2, h - bh, Math.max(2, barW - 4), bh);
      }
    }

    const playheadX = w * 0.3;
    const pxPerSec = 72;

    for (const note of currentMelody) {
      const shiftedMidi = note.midi + engine.semitones;
      const visualOffsetSec = latencyOffsetMs / 1000;
      const x1 = playheadX + (note.start - visualOffsetSec - nowSec) * pxPerSec;
      const x2 = playheadX + (note.end - visualOffsetSec - nowSec) * pxPerSec;
      if (x2 < 28 || x1 > w + 10) continue;

      const y = midiToY(shiftedMidi);
      const active = nowSec + visualOffsetSec >= note.start && nowSec + visualOffsetSec < note.end;
      ctx2d.fillStyle = active ? 'rgba(96, 165, 250, 0.92)' : 'rgba(96, 165, 250, 0.42)';
      fillRoundedBar(ctx2d, Math.max(28, x1), y - 6, Math.max(6, x2 - Math.max(28, x1) - 2), 12, 6);
    }

  // Live microphone pitch detection & deviation calculation
  const liveSample = injectedTestFreq
    ? { freq: injectedTestFreq, clarity: 0.99 }
    : micTracker.samplePitch();

  if (liveSample) {
    const liveMidi = freqToMidi(liveSample.freq);
    elHudLive.textContent = `目前 ${midiToNoteName(liveMidi)}`;

    const targetHz = lookupTargetPitchAtTime(currentPitchCurve, nowSec, latencyOffsetMs);
    let grade = 'neutral';
    if (targetHz) {
      const dev = computePitchDeviationCents(
        liveSample.freq,
        targetHz,
        engine.semitones,
        octaveAgnostic
      );
      if (dev) {
        grade = dev.grade;
        const sign = dev.cents > 0 ? '+' : '';
        elHudCents.textContent = `偏差 ${sign}${dev.cents} 音分`;
        updateHudGrade(dev.grade);

        totalJudgedFrames++;
        if (dev.grade === 'green') greenJudgedFrames++;
        const acc = Math.round((greenJudgedFrames / totalJudgedFrames) * 100);
        elHudAccuracy.textContent = `準確率 ${acc}%`;
      }
    } else {
      elHudCents.textContent = '偏差 --';
      updateHudGrade(null);
    }

    const displayMidi = Math.max(minMidi, Math.min(maxMidi, liveMidi));
    liveTrail.push({ timeSec: nowSec, midi: displayMidi, grade });
    if (liveTrail.length > 240) liveTrail.shift();
  } else {
    elHudLive.textContent = '目前 --';
    elHudCents.textContent = '偏差 --';
    updateHudGrade(null);
    if (liveTrail.length > 0 && liveTrail[liveTrail.length - 1] !== null) {
      liveTrail.push(null);
    }
  }

  // Render glowing live singing trail
  const colorMap = {
    green: '#4ade80',
    amber: '#fbbf24',
    red: '#f87171',
    neutral: '#93c5fd',
  };
  ctx2d.lineWidth = 3;
  ctx2d.lineCap = 'round';
  ctx2d.lineJoin = 'round';

  for (let i = 1; i < liveTrail.length; i++) {
    const prev = liveTrail[i - 1];
    const curr = liveTrail[i];
    if (!prev || !curr) continue;
    const x1 = playheadX + (prev.timeSec - nowSec) * pxPerSec;
    const x2 = playheadX + (curr.timeSec - nowSec) * pxPerSec;
    if (x2 < 28 || x1 > w) continue;
    if (Math.abs(x2 - x1) > 25) continue;

    ctx2d.strokeStyle = colorMap[curr.grade] || colorMap.neutral;
    ctx2d.beginPath();
    ctx2d.moveTo(x1, midiToY(prev.midi));
    ctx2d.lineTo(x2, midiToY(curr.midi));
    ctx2d.stroke();
  }

    // Playhead line
    ctx2d.strokeStyle = 'rgba(248, 250, 252, 0.65)';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(playheadX, 38);
    ctx2d.lineTo(playheadX, h - 8);
    ctx2d.stroke();
  } catch (err) {
    console.error('drawStage error:', err);
  }
}

attachAndroidEdgeStretch(
  document.scrollingElement || document.documentElement,
  document.getElementById('app-shell')
);
requestAnimationFrame(drawStage);

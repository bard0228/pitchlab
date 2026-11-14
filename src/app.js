import {
  clampSemitones,
  formatSemitoneLabel,
  formatTime,
  freqToMidi,
} from './audio-math.js';
import { DualDeckEngine } from './dual-deck.js';
import { attachAndroidEdgeStretch } from './android-overscroll.js';
import {
  computePitchDeviationCents,
  lookupTargetPitchAtTime,
  quantizePitchCurveToNotes,
} from './pitch-judge.js';
import { MicPitchTracker } from './mic-pitch.js';
import {
  decodeSongPackageZip,
  deleteSongRecord,
  getSongRecord,
  listSongRecords,
  saveSongRecord,
} from './song-library.js';
import { findActiveLyricIndex, parseLrc } from './lyrics.js';
import { syncCloudLibrary } from './cloud-sync.js';
import { separateAudioBufferInBrowser } from './web-separator.js';

const engine = new DualDeckEngine();
const micTracker = new MicPitchTracker();

const elPlay = document.getElementById('btn-play');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const elScrub = document.getElementById('scrub-bar');
const elTimeCur = document.getElementById('time-current');
const elTimeTot = document.getElementById('time-total');
const elSeekBack = document.getElementById('btn-seek-back');
const elSeekFwd = document.getElementById('btn-seek-fwd');
const elLoopSong = document.getElementById('btn-loop-song');
const elAbA = document.getElementById('btn-ab-a');
const elAbB = document.getElementById('btn-ab-b');
const elAbClear = document.getElementById('btn-ab-clear');
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
const elLyricOverlay = document.getElementById('lyric-overlay');
const elLyricPrev = document.getElementById('lyric-prev');
const elLyricCurrent = document.getElementById('lyric-current');
const elLyricNext = document.getElementById('lyric-next');
const elHudLive = document.getElementById('hud-live');
const elHudCents = document.getElementById('hud-cents');
const elHudAccuracy = document.getElementById('hud-accuracy');
const elFileSong = document.getElementById('file-song');
const elLabelUploadSong = document.getElementById('label-upload-song');
const elFileLrc = document.getElementById('file-lrc');
const elLabelUploadLrc = document.getElementById('label-upload-lrc');
const elBtnLibrary = document.getElementById('btn-library');
const elLibraryPortal = document.getElementById('library-portal');
const elLibraryFrame = document.getElementById('library-frame');
const elBtnLibraryClose = document.getElementById('btn-library-close');
const elFileZip = document.getElementById('file-zip');
const elSyncUrlInput = document.getElementById('sync-url-input');
const elBtnCloudSync = document.getElementById('btn-cloud-sync');
const elLibraryStatus = document.getElementById('library-status');
const elSongSearch = document.getElementById('song-search');
const elSongList = document.getElementById('song-list');
const canvas = document.getElementById('pitch-canvas');
const ctx2d = canvas.getContext('2d');

let currentSongId = null;
let currentMelody = [];
let currentPitchCurve = null;
let currentLyrics = [];
let isScrubbing = false;
let octaveAgnostic = true;
let audioMode = 'headphone';
let loopSong = false;
let abStartSec = null;
let abEndSec = null;
let latencyOffsetMs = Number(localStorage.getItem('pitchlab_latency_ms') || 0);
let injectedTestFreq = null;

const liveTrail = [];
let totalJudgedFrames = 0;
let greenJudgedFrames = 0;
const freqBins = new Uint8Array(128);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

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

function showLibraryStatus(msg) {
  if (!msg) {
    elLibraryStatus.hidden = true;
    elLibraryStatus.style.display = 'none';
    elLibraryStatus.textContent = '';
    return;
  }
  elLibraryStatus.textContent = msg;
  elLibraryStatus.hidden = false;
  elLibraryStatus.style.display = 'block';
}

function updateLatencyUI(ms) {
  latencyOffsetMs = Math.max(-300, Math.min(300, Math.round(ms)));
  elLatency.value = String(latencyOffsetMs);
  elLatencyVal.textContent = `${latencyOffsetMs} 毫秒`;
  localStorage.setItem('pitchlab_latency_ms', String(latencyOffsetMs));
}

updateLatencyUI(latencyOffsetMs);

function resetStatsAndTrail() {
  liveTrail.length = 0;
  totalJudgedFrames = 0;
  greenJudgedFrames = 0;
  elHudAccuracy.textContent = '準確率 --%';
}

function updateAbUI() {
  const hasA = abStartSec !== null;
  const hasB = abEndSec !== null && hasA && abEndSec > abStartSec + 0.3;
  elAbA.textContent = hasA ? `A ${formatTime(abStartSec)}` : '設 A';
  elAbA.setAttribute('aria-pressed', hasA ? 'true' : 'false');
  elAbA.classList.toggle('is-active', hasA);

  elAbB.textContent = hasB ? `B ${formatTime(abEndSec)}` : '設 B';
  elAbB.setAttribute('aria-pressed', hasB ? 'true' : 'false');
  elAbB.classList.toggle('is-active', hasB);
}

function clearAbLoop() {
  abStartSec = null;
  abEndSec = null;
  updateAbUI();
}

function updateLyricDisplay(nowSec) {
  if (!currentLyrics || currentLyrics.length === 0) {
    elLyricOverlay.hidden = true;
    elLyricOverlay.style.display = 'none';
    elLyricPrev.textContent = '';
    elLyricCurrent.textContent = '';
    elLyricNext.textContent = '';
    return;
  }
  elLyricOverlay.hidden = false;
  elLyricOverlay.style.display = 'flex';
  const idx = findActiveLyricIndex(currentLyrics, nowSec);
  if (idx === -1) {
    elLyricPrev.textContent = '';
    elLyricCurrent.textContent = '♪ 準備演唱';
    elLyricNext.textContent = currentLyrics[0]?.text || '';
  } else {
    elLyricPrev.textContent = currentLyrics[idx - 1]?.text || '';
    elLyricCurrent.textContent = currentLyrics[idx].text;
    elLyricNext.textContent = currentLyrics[idx + 1]?.text || '';
  }
}

async function loadSavedSong(record) {
  await engine.ensureContext();
  const [instBuf, vocBuf] = await Promise.all([
    engine.ctx.decodeAudioData(record.instBytes.slice(0)),
    engine.ctx.decodeAudioData(record.vocalBytes.slice(0)),
  ]);
  engine.loadBuffers(instBuf, vocBuf);
  currentSongId = record.id;
  currentPitchCurve = record.pitchCurve || null;
  currentMelody = quantizePitchCurveToNotes(currentPitchCurve);
  currentLyrics = parseLrc(record.lyricsText || '');
  elLabelUploadLrc.textContent = currentLyrics.length > 0 ? '已載入歌詞' : '匯入歌詞 (.lrc)';
  clearAbLoop();
  resetStatsAndTrail();
  updateLyricDisplay(0);
  elScrub.max = String(engine.durationSec);
  elScrub.value = '0';
  elTimeCur.textContent = '00:00';
  elTimeTot.textContent = formatTime(engine.durationSec);
  setPlayUI(false);
  localStorage.setItem('pitchlab_last_song_id', record.id);
}

let builtinSeedPromise = null;
let userHasLoadedOrStartedLoad = false;
async function ensureBuiltinSongSeeded() {
  if (localStorage.getItem('pitchlab_builtin_seeded_v1') === '1') return;
  if (builtinSeedPromise) return builtinSeedPromise;
  builtinSeedPromise = (async () => {
    try {
      const res = await fetch('./assets/builtin_geqian.zip');
      if (!res.ok) return;
      const ab = await res.arrayBuffer();
      const record = await decodeSongPackageZip(ab);
      await saveSongRecord(record);
      localStorage.setItem('pitchlab_builtin_seeded_v1', '1');
      if (!engine.instBuffer && currentSongId === null && !userHasLoadedOrStartedLoad) {
        await loadSavedSong(record);
      }
    } catch {}
  })();
  return builtinSeedPromise;
}

async function restoreLastSavedSongIfAny() {
  if (engine.instBuffer || userHasLoadedOrStartedLoad) return true;
  await ensureBuiltinSongSeeded();
  if (engine.instBuffer || userHasLoadedOrStartedLoad) return true;
  const lastId = localStorage.getItem('pitchlab_last_song_id');
  if (lastId) {
    try {
      const rec = await getSongRecord(lastId);
      if (rec && !userHasLoadedOrStartedLoad) {
        await loadSavedSong(rec);
        return true;
      }
    } catch {}
  }
  return false;
}

async function renderSongList() {
  let songs = [];
  try {
    songs = await listSongRecords();
  } catch {
    songs = [];
  }

  const query = (elSongSearch?.value || '').trim().toLowerCase();
  const filtered = query
    ? songs.filter((s) =>
        `${s.title || ''} ${s.artist || ''}`.toLowerCase().includes(query)
      )
    : songs;

  elSongList.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'library-empty';
    empty.textContent = query ? '找不到符合的歌曲' : '尚無已儲存歌曲，請匯入歌包或於主頁上傳歌曲';
    elSongList.appendChild(empty);
    return;
  }

  for (const song of filtered) {
    const row = document.createElement('div');
    row.className = 'song-row';

    const selBtn = document.createElement('button');
    selBtn.type = 'button';
    selBtn.className = `lg-btn song-select-btn${currentSongId === song.id ? ' is-current' : ''}`;
    selBtn.dataset.songId = song.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'song-name';
    nameSpan.textContent = song.title;

    const durSpan = document.createElement('span');
    durSpan.className = 'song-dur tabular-nums';
    durSpan.textContent = formatTime((song.durationMs || 0) / 1000);

    selBtn.appendChild(nameSpan);
    selBtn.appendChild(durSpan);

    selBtn.addEventListener('click', async () => {
      try {
        showLibraryStatus('');
        const rec = await getSongRecord(song.id);
        if (rec) await loadSavedSong(rec);
        closeLibraryModal();
      } catch (err) {
        showLibraryStatus(err.message || '載入歌曲失敗');
      }
    });

    row.appendChild(selBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'lg-btn song-del-btn';
    delBtn.setAttribute('aria-label', `刪除 ${song.title}`);
    delBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    delBtn.addEventListener('click', async () => {
      await deleteSongRecord(song.id);
      if (currentSongId === song.id) {
        localStorage.removeItem('pitchlab_last_song_id');
        currentSongId = null;
      }
      await renderSongList();
    });
    row.appendChild(delBtn);

    elSongList.appendChild(row);
  }
}

async function openLibraryModal() {
  showLibraryStatus('');
  await renderSongList();
  elLibraryPortal.hidden = false;
  elLibraryPortal.style.display = 'flex';
  elLibraryFrame.classList.remove('lg-pop-exit');
  elLibraryFrame.classList.add('lg-pop-enter');
}

function closeLibraryModal() {
  elLibraryFrame.classList.remove('lg-pop-enter');
  elLibraryFrame.classList.add('lg-pop-exit');
  setTimeout(() => {
    elLibraryPortal.hidden = true;
    elLibraryPortal.style.display = 'none';
    elLibraryFrame.classList.remove('lg-pop-exit');
  }, 190);
}

const CLOUD_SYNC_KEY = 'pitchlab_cloud_sync_url';
elSyncUrlInput.value = localStorage.getItem(CLOUD_SYNC_KEY) || '';

let cloudSyncPromise = null;
let cloudSyncStatusMsg = '';
let lastSyncSummary = '';

function setCloudSyncLoading(isLoading) {
  elBtnCloudSync.disabled = isLoading;
  elBtnCloudSync.classList.toggle('is-syncing', isLoading);
  elBtnCloudSync.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  elBtnCloudSync.setAttribute('aria-label', isLoading ? '正在同步雲端歌庫' : '同步雲端歌庫');
  elBtnCloudSync.innerHTML = isLoading
    ? '<span class="sync-spinner" aria-hidden="true"></span>'
    : '同步';
}

async function runCloudSync(showFeedback = false) {
  if (cloudSyncPromise) {
    if (showFeedback) {
      setCloudSyncLoading(true);
      showLibraryStatus(cloudSyncStatusMsg || '正在檢查雲端硬碟新歌...');
      await cloudSyncPromise;
      setCloudSyncLoading(false);
      if (lastSyncSummary) showLibraryStatus(lastSyncSummary);
    }
    return cloudSyncPromise;
  }

  const syncUrl = (elSyncUrlInput.value || localStorage.getItem(CLOUD_SYNC_KEY) || '').trim();
  if (!syncUrl) {
    if (showFeedback) showLibraryStatus('請先貼上 Google Apps Script 雲端同步網址');
    return;
  }
  localStorage.setItem(CLOUD_SYNC_KEY, syncUrl);
  cloudSyncStatusMsg = '正在檢查雲端硬碟新歌...';
  lastSyncSummary = '';
  setCloudSyncLoading(true);
  if (showFeedback || !elLibraryPortal.hidden) {
    showLibraryStatus(cloudSyncStatusMsg);
  }

  cloudSyncPromise = (async () => {
    try {
      const existing = await listSongRecords();
      const downloaded = await syncCloudLibrary({
        syncUrl,
        existingRecords: existing,
        onProgress: (idx, total, name) => {
          cloudSyncStatusMsg = `正在匯入 (${idx}/${total})：${name}`;
          if (!elLibraryPortal.hidden) showLibraryStatus(cloudSyncStatusMsg);
        },
      });
      let added = 0;
      for (const item of downloaded) {
        const record = await decodeSongPackageZip(item.arrayBuffer, {
          driveFileId: item.file.id,
          sourceFileName: item.file.name,
        });
        await saveSongRecord(record);
        added++;
        if (!engine.instBuffer && currentSongId === null) {
          await loadSavedSong(record);
        }
      }
      await renderSongList();
      lastSyncSummary = added > 0 ? `已自動匯入 ${added} 首雲端新歌` : '雲端歌庫已是最新';
      if (showFeedback || !elLibraryPortal.hidden) {
        showLibraryStatus(lastSyncSummary);
      }
    } catch (err) {
      lastSyncSummary = err?.message || '雲端同步失敗';
      if (showFeedback || !elLibraryPortal.hidden) {
        showLibraryStatus(lastSyncSummary);
      }
    } finally {
      cloudSyncStatusMsg = '';
      cloudSyncPromise = null;
      setCloudSyncLoading(false);
    }
  })();

  return cloudSyncPromise;
}

elBtnLibrary.addEventListener('click', openLibraryModal);
elBtnLibraryClose.addEventListener('click', closeLibraryModal);
elSongSearch.addEventListener('input', () => {
  renderSongList().catch(() => {});
});
elSyncUrlInput.addEventListener('change', () => {
  localStorage.setItem(CLOUD_SYNC_KEY, elSyncUrlInput.value.trim());
});
elBtnCloudSync.addEventListener('click', () => {
  runCloudSync(true).catch(() => {});
});
elLibraryPortal.addEventListener('click', (e) => {
  if (e.target === elLibraryPortal) closeLibraryModal();
});

elFileZip.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  showLibraryStatus('');
  try {
    const ab = await file.arrayBuffer();
    const record = await decodeSongPackageZip(ab);
    await saveSongRecord(record);
    await loadSavedSong(record);
    await renderSongList();
    closeLibraryModal();
  } catch (err) {
    showLibraryStatus(err.message || '歌包匯入失敗');
  } finally {
    elFileZip.value = '';
  }
});

elPlay.addEventListener('click', async () => {
  if (engine.isPlaying) {
    engine.pause();
    setPlayUI(false);
    return;
  }
  const hasSong = await restoreLastSavedSongIfAny();
  if (!hasSong) {
    showMicError('請先上傳歌曲或從歌庫選擇歌包');
    return;
  }
  showMicError('');
  const ok = await engine.play();
  setPlayUI(ok);
});

engine.onEnded = async () => {
  if (abStartSec !== null && abEndSec !== null && abEndSec > abStartSec + 0.3) {
    engine.seek(abStartSec);
    const ok = await engine.play();
    setPlayUI(ok);
    return;
  }
  if (loopSong) {
    engine.seek(0);
    const ok = await engine.play();
    setPlayUI(ok);
    return;
  }
  setPlayUI(false);
  elScrub.value = '0';
  elTimeCur.textContent = '00:00';
  updateLyricDisplay(0);
};

async function seekByDelta(deltaSec) {
  const hasSong = await restoreLastSavedSongIfAny();
  if (!hasSong || engine.durationSec <= 0) return;
  const target = Math.max(0, Math.min(engine.durationSec, engine.getCurrentTime() + deltaSec));
  engine.seek(target);
  elScrub.value = String(target);
  elTimeCur.textContent = formatTime(target);
  updateLyricDisplay(target);
}

elSeekBack.addEventListener('click', () => seekByDelta(-10));
elSeekFwd.addEventListener('click', () => seekByDelta(10));

elLoopSong.addEventListener('click', () => {
  loopSong = !loopSong;
  elLoopSong.setAttribute('aria-pressed', loopSong ? 'true' : 'false');
  elLoopSong.classList.toggle('is-active', loopSong);
});

elAbA.addEventListener('click', async () => {
  const hasSong = await restoreLastSavedSongIfAny();
  if (!hasSong || engine.durationSec <= 0) return;
  const now = engine.getCurrentTime();
  abStartSec = now;
  if (abEndSec !== null && abEndSec <= abStartSec + 0.3) {
    abEndSec = null;
  }
  updateAbUI();
});

elAbB.addEventListener('click', async () => {
  const hasSong = await restoreLastSavedSongIfAny();
  if (!hasSong || engine.durationSec <= 0) return;
  const now = engine.getCurrentTime();
  if (abStartSec === null) {
    abStartSec = 0;
  }
  if (now <= abStartSec + 0.3) {
    abEndSec = Math.min(engine.durationSec, abStartSec + 2.0);
  } else {
    abEndSec = now;
  }
  updateAbUI();
});

elAbClear.addEventListener('click', clearAbLoop);

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
  const hasSong = await restoreLastSavedSongIfAny();
  if (hasSong) {
    engine.seek(targetSec);
  }
});

elFileSong.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  userHasLoadedOrStartedLoad = true;
  elLabelUploadSong.textContent = '分離人聲與音高中...';
  try {
    await engine.ensureContext();
    const rawBuf = await file.arrayBuffer();
    const srcBuffer = await engine.ctx.decodeAudioData(rawBuf);
    const { instBuffer, vocalBuffer, pitchCurve } = separateAudioBufferInBrowser(
      engine.ctx,
      srcBuffer
    );

    engine.loadBuffers(instBuffer, vocalBuffer);
    currentSongId = 'instant-web';
    currentPitchCurve = pitchCurve;
    currentMelody = quantizePitchCurveToNotes(pitchCurve);
    currentLyrics = [];
    elLabelUploadLrc.textContent = '匯入歌詞 (.lrc)';
    clearAbLoop();
    resetStatsAndTrail();
    updateLyricDisplay(0);
    elScrub.max = String(engine.durationSec);
    elScrub.value = '0';
    elTimeCur.textContent = '00:00';
    elTimeTot.textContent = formatTime(engine.durationSec);
    setPlayUI(false);

    const shortTitle = file.name.replace(/\.[^.]+$/, '');
    elLabelUploadSong.textContent = `已載入：${shortTitle}`;
  } catch (err) {
    elLabelUploadSong.textContent = '上傳歌曲分離';
    showMicError(err?.message || '音檔解碼失敗');
  } finally {
    elFileSong.value = '';
  }
});

elFileLrc.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const lrcText = await file.text();
    const parsed = parseLrc(lrcText);
    if (parsed.length === 0) {
      showMicError('歌詞檔格式不符或無有效時間軸');
      return;
    }
    showMicError('');
    currentLyrics = parsed;
    elLabelUploadLrc.textContent = `歌詞：${file.name.replace(/\.[^.]+$/, '')}`;
    updateLyricDisplay(engine.getCurrentTime());

    if (currentSongId && currentSongId !== 'instant-web') {
      const rec = await getSongRecord(currentSongId);
      if (rec) {
        rec.lyricsText = lrcText;
        await saveSongRecord(rec);
      }
    }
  } catch (err) {
    showMicError(err?.message || '讀取歌詞失敗');
  } finally {
    elFileLrc.value = '';
  }
});

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

    let nowSec = engine.getCurrentTime();
    if (
      engine.isPlaying &&
      abStartSec !== null &&
      abEndSec !== null &&
      abEndSec > abStartSec + 0.3 &&
      nowSec >= abEndSec
    ) {
      engine.seek(abStartSec);
      nowSec = abStartSec;
    }
    if (!isScrubbing && engine.durationSec > 0) {
      elScrub.value = String(nowSec);
      elTimeCur.textContent = formatTime(nowSec);
    }
    updateLyricDisplay(nowSec);

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
    const visualOffsetSec = latencyOffsetMs / 1000;

    if (currentMelody.length > 0) {
      for (const note of currentMelody) {
        const shiftedMidi = note.midi + engine.semitones;
        const x1 = playheadX + (note.start - visualOffsetSec - nowSec) * pxPerSec;
        const x2 = playheadX + (note.end - visualOffsetSec - nowSec) * pxPerSec;
        if (x2 < 28 || x1 > w + 10) continue;

        const y = midiToY(shiftedMidi);
        const active = nowSec + visualOffsetSec >= note.start && nowSec + visualOffsetSec < note.end;
        ctx2d.fillStyle = active ? 'rgba(96, 165, 250, 0.92)' : 'rgba(96, 165, 250, 0.42)';
        fillRoundedBar(ctx2d, Math.max(28, x1), y - 6, Math.max(6, x2 - Math.max(28, x1) - 2), 12, 6);
      }
    } else if (currentPitchCurve && Array.isArray(currentPitchCurve.f0Hz)) {
      const hopSec = currentPitchCurve.hopMs / 1000;
      const startTime = nowSec + visualOffsetSec - (playheadX - 28) / pxPerSec;
      const endTime = nowSec + visualOffsetSec + (w - playheadX) / pxPerSec;
      const startIdx = Math.max(0, Math.floor(startTime / hopSec));
      const endIdx = Math.min(currentPitchCurve.f0Hz.length - 1, Math.ceil(endTime / hopSec));

      ctx2d.strokeStyle = 'rgba(96, 165, 250, 0.72)';
      ctx2d.lineWidth = 6;
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      ctx2d.beginPath();
      let drawing = false;
      let prevMidi = null;

      for (let i = startIdx; i <= endIdx; i += 2) {
        const hz = currentPitchCurve.f0Hz[i];
        if (!hz || hz <= 0) {
          drawing = false;
          prevMidi = null;
          continue;
        }
        const shiftedMidi = Math.max(minMidi, Math.min(maxMidi, freqToMidi(hz) + engine.semitones));
        const tSec = i * hopSec;
        const x = playheadX + (tSec - visualOffsetSec - nowSec) * pxPerSec;
        const y = midiToY(shiftedMidi);
        if (!drawing || (prevMidi !== null && Math.abs(shiftedMidi - prevMidi) > 4)) {
          ctx2d.moveTo(x, y);
          drawing = true;
        } else {
          ctx2d.lineTo(x, y);
        }
        prevMidi = shiftedMidi;
      }
      ctx2d.stroke();
    }

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
restoreLastSavedSongIfAny()
  .then(() => runCloudSync(false))
  .catch(() => {});
requestAnimationFrame(drawStage);

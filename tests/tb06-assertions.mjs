import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createTestWav(filePath, durationSec = 25.0, freqHz = 261.6256) {
  const sr = 48000;
  const n = Math.floor(sr * durationSec);
  const dataBytes = n * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const sample = Math.round(0.35 * Math.sin(2 * Math.PI * freqHz * t) * 32767);
    buf.writeInt16LE(sample, 44 + i * 4);
    buf.writeInt16LE(sample, 44 + i * 4 + 2);
  }
  fs.writeFileSync(filePath, buf);
}

export default async function ({ page, assert }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitchlab-tb06-'));
  const wavPath = path.join(tmpDir, 'tb06_song.wav');
  const lrcPath = path.join(tmpDir, 'tb06_lyrics.lrc');
  createTestWav(wavPath, 25.0, 261.6256);
  fs.writeFileSync(
    lrcPath,
    [
      '[00:02.00]第一句歌詞測試',
      '[00:10.00]第二句副歌開始',
      '[00:18.00]第三句結尾測試',
      '[00:19.50]第四句後續預覽',
      '[00:21.00]第五句手動點擊測試',
      '[00:22.50]第六句延續歌詞',
      '[00:24.00]第七句最後結尾',
    ].join('\n'),
    'utf-8'
  );

  try {
    await page.waitForSelector('#btn-seek-back');
    await page.waitForSelector('#btn-seek-fwd');
    await page.waitForSelector('#btn-loop-song');
    await page.waitForSelector('#btn-ab-a');
    await page.waitForSelector('#btn-ab-b');
    await page.waitForSelector('#btn-ab-clear');
    await page.waitForSelector('#file-lrc');

    const touchAudit = await page.evaluate(() => {
      const ids = [
        '#btn-seek-back',
        '#btn-seek-fwd',
        '#btn-loop-song',
        '#btn-ab-a',
        '#btn-ab-b',
        '#btn-ab-clear',
      ];
      return ids.map((id) => {
        const r = document.querySelector(id).getBoundingClientRect();
        return { id, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
      });
    });
    for (const item of touchAudit) {
      assert(item.h >= 48, `Button ${item.id} height < 48px: ${item.h}`);
    }

    const rowCheck = await page.evaluate(() => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const brandTitleStyle = getComputedStyle(document.querySelector('.brand-title'));
      return {
        brandMark: box(document.querySelector('.brand-mark')),
        brandFontSize: parseFloat(brandTitleStyle.fontSize),
        logo: box(document.querySelector('.brand-logo')),
        sBack: box(document.getElementById('btn-seek-back')),
        sFwd: box(document.getElementById('btn-seek-fwd')),
        sLoop: box(document.getElementById('btn-loop-song')),
        abA: box(document.getElementById('btn-ab-a')),
        abB: box(document.getElementById('btn-ab-b')),
        abC: box(document.getElementById('btn-ab-clear')),
        upSong: box(document.querySelector('.upload-song-btn')),
        upLrc: box(document.querySelector('.upload-lrc-btn')),
      };
    });
    assert(rowCheck.brandMark.width >= 46 && rowCheck.brandMark.height >= 46, `Brand mark size unexpected: ${rowCheck.brandMark.width}x${rowCheck.brandMark.height}`);
    assert(rowCheck.brandFontSize >= 19, `Brand title font-size unexpected: ${rowCheck.brandFontSize}`);
    assert(rowCheck.logo.width <= 52 && rowCheck.logo.height <= 52, `Logo too large: ${rowCheck.logo.width}x${rowCheck.logo.height}`);

    const libStyle = await page.evaluate(() => ({
      hasSearch: Boolean(document.getElementById('song-search')),
      hasSyncUrl: Boolean(document.getElementById('sync-url-input')),
      hasSyncBtn: Boolean(document.getElementById('btn-cloud-sync')),
      listMaxH: getComputedStyle(document.getElementById('song-list')).maxHeight,
    }));
    assert(libStyle.hasSearch, 'Expected #song-search input inside library modal');
    assert(libStyle.hasSyncUrl, 'Expected #sync-url-input inside library modal');
    assert(libStyle.hasSyncBtn, 'Expected #btn-cloud-sync inside library modal');
    assert(libStyle.listMaxH === '292px', `Expected #song-list maxHeight 292px (5 songs), got ${libStyle.listMaxH}`);
    assert(Math.abs(rowCheck.sBack.top - rowCheck.sFwd.top) < 4 && Math.abs(rowCheck.sBack.top - rowCheck.sLoop.top) < 4, 'Transport extras must be in 1 horizontal row');
    assert(Math.abs(rowCheck.abA.top - rowCheck.abB.top) < 4 && Math.abs(rowCheck.abA.top - rowCheck.abC.top) < 4, 'AB buttons must be in 1 horizontal row');
    assert(Math.abs(rowCheck.upSong.top - rowCheck.upLrc.top) < 4 && rowCheck.upSong.right <= rowCheck.upLrc.left, 'Upload buttons must be side-by-side without overlap');

    const songInput = await page.$('#file-song');
    await songInput.uploadFile(wavPath);
    await new Promise((r) => setTimeout(r, 600));

    // Test +10s and -10s seek
    await page.click('#btn-seek-fwd');
    await new Promise((r) => setTimeout(r, 80));
    const afterFwd = await page.$eval('#time-current', (el) => el.textContent.trim());
    assert(afterFwd === '00:10', `Expected time-current 00:10 after +10s, got "${afterFwd}"`);

    await page.click('#btn-seek-fwd');
    await new Promise((r) => setTimeout(r, 80));
    const afterFwd2 = await page.$eval('#time-current', (el) => el.textContent.trim());
    assert(afterFwd2 === '00:20', `Expected time-current 00:20 after second +10s, got "${afterFwd2}"`);

    await page.click('#btn-seek-back');
    await new Promise((r) => setTimeout(r, 80));
    const afterBack = await page.$eval('#time-current', (el) => el.textContent.trim());
    assert(afterBack === '00:10', `Expected time-current 00:10 after -10s, got "${afterBack}"`);

    // Test full song loop toggle
    await page.click('#btn-loop-song');
    const loopPressed = await page.$eval('#btn-loop-song', (el) => el.getAttribute('aria-pressed'));
    assert(loopPressed === 'true', `Expected #btn-loop-song aria-pressed="true", got "${loopPressed}"`);

    // Test AB loop set A -> set B -> clear AB
    await page.$eval('#scrub-bar', (el) => {
      el.value = '4';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#btn-ab-a');
    const aText = await page.$eval('#btn-ab-a', (el) => el.textContent.trim());
    assert(aText.includes('00:04'), `Expected #btn-ab-a to show 00:04, got "${aText}"`);

    await page.$eval('#scrub-bar', (el) => {
      el.value = '12';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#btn-ab-b');
    const bPressed = await page.$eval('#btn-ab-b', (el) => el.getAttribute('aria-pressed'));
    assert(bPressed === 'true', `Expected #btn-ab-b aria-pressed="true", got "${bPressed}"`);

    await page.click('#btn-ab-clear');
    const bCleared = await page.$eval('#btn-ab-b', (el) => el.getAttribute('aria-pressed'));
    assert(bCleared === 'false', `Expected #btn-ab-b aria-pressed="false" after clear, got "${bCleared}"`);

    // Test LRC import and 3-line synced display between stage and control card
    const lrcInput = await page.$('#file-lrc');
    await lrcInput.uploadFile(lrcPath);
    await new Promise((r) => setTimeout(r, 120));

    await page.$eval('#scrub-bar', (el) => {
      el.value = '11';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 150));

    const lyricState = await page.evaluate(() => {
      const stage = document.querySelector('.pitch-stage-wrap').getBoundingClientRect();
      const card = document.getElementById('lyric-overlay').getBoundingClientRect();
      const ctrl = document.querySelector('.control-card').getBoundingClientRect();
      return {
        stageBottom: stage.bottom,
        cardTop: card.top,
        cardBottom: card.bottom,
        ctrlTop: ctrl.top,
        prev: document.getElementById('lyric-prev').textContent.trim(),
        cur: document.getElementById('lyric-current').textContent.trim(),
        next: document.getElementById('lyric-next').textContent.trim(),
      };
    });
    assert(
      lyricState.cardTop >= lyricState.stageBottom - 1 && lyricState.cardBottom <= lyricState.ctrlTop + 1,
      `Lyric card must be between stage and control card (stageBottom=${lyricState.stageBottom}, cardTop=${lyricState.cardTop}, cardBottom=${lyricState.cardBottom}, ctrlTop=${lyricState.ctrlTop})`
    );
    assert(
      lyricState.prev === '第一句歌詞測試',
      `Expected #lyric-prev to be "第一句歌詞測試", got "${lyricState.prev}"`
    );
    assert(
      lyricState.cur === '第二句副歌開始',
      `Expected #lyric-current to be "第二句副歌開始", got "${lyricState.cur}"`
    );
    assert(
      lyricState.next === '第三句結尾測試',
      `Expected #lyric-next to be "第三句結尾測試", got "${lyricState.next}"`
    );

    // Test scrollable #lyric-list & tap-to-sync
    const lyricScrollCheck = await page.evaluate(() => {
      const list = document.getElementById('lyric-list');
      list.scrollTop = list.scrollHeight;
      return {
        overflowY: getComputedStyle(list).overflowY,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        scrollTop: list.scrollTop,
        btnCount: list.querySelectorAll('.lyric-line-btn').length,
      };
    });
    assert(
      lyricScrollCheck.overflowY === 'auto' && lyricScrollCheck.scrollHeight > lyricScrollCheck.clientHeight,
      `Expected #lyric-list to be scrollable (overflowY=${lyricScrollCheck.overflowY}, scrollH=${lyricScrollCheck.scrollHeight}, clientH=${lyricScrollCheck.clientHeight})`
    );
    assert(lyricScrollCheck.scrollTop > 0, `Expected #lyric-list scrollTop > 0, got ${lyricScrollCheck.scrollTop}`);
    assert(lyricScrollCheck.btnCount === 8, `Expected 8 lyric buttons (prep + 7 lines), got ${lyricScrollCheck.btnCount}`);

    await page.click('.lyric-line-btn[data-lyric-idx="4"]');
    await new Promise((r) => setTimeout(r, 80));
    const tapSyncResult = await page.evaluate(() => ({
      cur: document.getElementById('lyric-current')?.textContent.trim(),
      offsetVal: document.getElementById('lyric-offset-value')?.textContent.trim(),
    }));
    assert(
      tapSyncResult.cur === '第五句手動點擊測試',
      `Expected tapped line to become #lyric-current ("第五句手動點擊測試"), got "${tapSyncResult.cur}"`
    );
    assert(
      tapSyncResult.offsetVal === '-10.0 秒',
      `Expected lyric offset to become "-10.0 秒", got "${tapSyncResult.offsetVal}"`
    );

    // Test frozen dock pinning while scrolling #control-card
    const dockBefore = await page.evaluate(() => {
      const dock = document.getElementById('frozen-dock').getBoundingClientRect();
      const ctrl = document.getElementById('control-card');
      const seekRect = document.getElementById('btn-seek-back').getBoundingClientRect();
      return {
        dockTop: dock.top,
        dockBottom: dock.bottom,
        ctrlOverflowY: getComputedStyle(ctrl).overflowY,
        ctrlScrollH: ctrl.scrollHeight,
        ctrlClientH: ctrl.clientHeight,
        seekTop: seekRect.top,
      };
    });
    assert(
      dockBefore.ctrlOverflowY === 'auto' && dockBefore.ctrlScrollH > dockBefore.ctrlClientH,
      `Expected #control-card to scroll independently (overflowY=${dockBefore.ctrlOverflowY}, scrollH=${dockBefore.ctrlScrollH}, clientH=${dockBefore.ctrlClientH})`
    );
    await page.evaluate(() => {
      document.getElementById('control-card').scrollTop = 180;
    });
    await new Promise((r) => setTimeout(r, 60));
    const dockAfter = await page.evaluate(() => {
      const dock = document.getElementById('frozen-dock').getBoundingClientRect();
      const seekRect = document.getElementById('btn-seek-back').getBoundingClientRect();
      return {
        dockTop: dock.top,
        dockBottom: dock.bottom,
        ctrlScrollTop: document.getElementById('control-card').scrollTop,
        seekTop: seekRect.top,
      };
    });
    assert(dockAfter.ctrlScrollTop > 0, `Expected #control-card scrollTop > 0, got ${dockAfter.ctrlScrollTop}`);
    assert(
      Math.abs(dockAfter.dockTop - dockBefore.dockTop) < 1 &&
        Math.abs(dockAfter.dockBottom - dockBefore.dockBottom) < 1,
      `Frozen dock moved on scroll! before=(${dockBefore.dockTop},${dockBefore.dockBottom}) after=(${dockAfter.dockTop},${dockAfter.dockBottom})`
    );
    assert(
      dockAfter.seekTop < dockBefore.seekTop - 50,
      `Expected controls inside #control-card to scroll upward (before=${dockBefore.seekTop}, after=${dockAfter.seekTop})`
    );

    // Simulate Android safe-area padding on body and scroll #control-card to the very bottom
    const bottomButtonsVisible = await page.evaluate(() => {
      document.body.style.paddingTop = '48px';
      document.body.style.paddingBottom = '24px';
      const ctrl = document.getElementById('control-card');
      ctrl.scrollTop = ctrl.scrollHeight;
      const ctrlRect = ctrl.getBoundingClientRect();
      const upSong = document.querySelector('.upload-song-btn').getBoundingClientRect();
      const upLrc = document.querySelector('.upload-lrc-btn').getBoundingClientRect();
      return {
        innerH: window.innerHeight,
        ctrlBottom: Math.round(ctrlRect.bottom),
        songBottom: Math.round(upSong.bottom),
        lrcBottom: Math.round(upLrc.bottom),
        songHeight: Math.round(upSong.height),
        lrcHeight: Math.round(upLrc.height),
      };
    });
    assert(
      bottomButtonsVisible.ctrlBottom <= bottomButtonsVisible.innerH - 24,
      `Expected #control-card bottom <= innerHeight - 24px, got ctrlBottom=${bottomButtonsVisible.ctrlBottom}, innerH=${bottomButtonsVisible.innerH}`
    );
    assert(
      bottomButtonsVisible.songBottom <= bottomButtonsVisible.ctrlBottom &&
        bottomButtonsVisible.lrcBottom <= bottomButtonsVisible.ctrlBottom &&
        bottomButtonsVisible.songHeight >= 48 &&
        bottomButtonsVisible.lrcHeight >= 48,
      `Expected bottom upload buttons fully visible and >= 48px tall: ${JSON.stringify(bottomButtonsVisible)}`
    );

    // Test slider insets to avoid accidental edge touches
    const insetCheck = await page.evaluate(() => {
      const scrubCol = document.querySelector('.scrub-col').getBoundingClientRect();
      const scrubBar = document.getElementById('scrub-bar').getBoundingClientRect();
      const vocalSlider = document.getElementById('vocal-gain').getBoundingClientRect();
      const vocalBlock = document.getElementById('vocal-gain').closest('.slider-block').getBoundingClientRect();
      const latSlider = document.getElementById('latency-offset').getBoundingClientRect();
      const latBlock = document.getElementById('latency-offset').closest('.slider-block').getBoundingClientRect();
      return {
        scrubRightInset: Math.round(scrubCol.right - scrubBar.right),
        vocalLeftInset: Math.round(vocalSlider.left - vocalBlock.left),
        vocalRightInset: Math.round(vocalBlock.right - vocalSlider.right),
        latLeftInset: Math.round(latSlider.left - latBlock.left),
        latRightInset: Math.round(latBlock.right - latSlider.right),
      };
    });
    assert(
      insetCheck.scrubRightInset >= 24,
      `Expected #scrub-bar right inset >= 24px, got ${insetCheck.scrubRightInset}px`
    );
    assert(
      insetCheck.vocalLeftInset >= 24 && insetCheck.vocalRightInset >= 24,
      `Expected #vocal-gain left/right insets >= 24px, got L=${insetCheck.vocalLeftInset}px R=${insetCheck.vocalRightInset}px`
    );
    assert(
      insetCheck.latLeftInset >= 24 && insetCheck.latRightInset >= 24,
      `Expected #latency-offset left/right insets >= 24px, got L=${insetCheck.latLeftInset}px R=${insetCheck.latRightInset}px`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

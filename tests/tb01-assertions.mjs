import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createTestWav(filePath, durationSec = 3.2, freqHz = 261.6256) {
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
    const sample = Math.round(0.4 * Math.sin(2 * Math.PI * freqHz * t) * 32767);
    buf.writeInt16LE(sample, 44 + i * 4);
    buf.writeInt16LE(sample, 44 + i * 4 + 2);
  }
  fs.writeFileSync(filePath, buf);
}

export default async function ({ page, assert }) {
  const trackBadge = await page.$('#track-title');
  assert(trackBadge === null, 'Top-right #track-title badge must be removed');

  const keyText = await page.$eval('#key-value', (el) => el.textContent.trim());
  assert(keyText === '-1 半音', `Expected #key-value to be "-1 半音", got "${keyText}"`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitchlab-tb01-'));
  const wavPath = path.join(tmpDir, 'tb01_test.wav');
  createTestWav(wavPath, 3.2, 261.6256);

  try {
    const input = await page.$('#file-song');
    await input.uploadFile(wavPath);
    await new Promise((r) => setTimeout(r, 500));

    await page.click('#btn-play');
    await new Promise((r) => setTimeout(r, 150));

    const isPlaying = await page.$eval('#btn-play', (el) => el.getAttribute('aria-pressed'));
    assert(isPlaying === 'true', `Expected #btn-play aria-pressed="true", got "${isPlaying}"`);

    const playingIcons = await page.evaluate(() => ({
      playDisplay: getComputedStyle(document.getElementById('icon-play')).display,
      pauseDisplay: getComputedStyle(document.getElementById('icon-pause')).display,
    }));
    assert(playingIcons.playDisplay === 'none', `Expected #icon-play hidden while playing, got ${playingIcons.playDisplay}`);
    assert(playingIcons.pauseDisplay !== 'none', `Expected #icon-pause visible while playing, got ${playingIcons.pauseDisplay}`);

    await page.$eval('#vocal-gain', (el) => {
      el.value = '35';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const gainText = await page.$eval('#vocal-gain-value', (el) => el.textContent.trim());
    assert(gainText === '35%', `Expected #vocal-gain-value to be "35%", got "${gainText}"`);

    const touchAudit = await page.evaluate(() => {
      const ids = ['#btn-play', '#btn-key-down', '#btn-key-up', '#btn-key-reset'];
      return ids.map((id) => {
        const r = document.querySelector(id).getBoundingClientRect();
        return { id, w: Math.round(r.width), h: Math.round(r.height) };
      });
    });
    for (const item of touchAudit) {
      assert(item.w >= 48 && item.h >= 48, `Touch target ${item.id} too small: ${item.w}x${item.h}`);
    }

    await page.click('#btn-play');
    const pausedIcons = await page.evaluate(() => ({
      playDisplay: getComputedStyle(document.getElementById('icon-play')).display,
      pauseDisplay: getComputedStyle(document.getElementById('icon-pause')).display,
    }));
    assert(pausedIcons.playDisplay !== 'none', `Expected #icon-play visible when paused, got ${pausedIcons.playDisplay}`);
    assert(pausedIcons.pauseDisplay === 'none', `Expected #icon-pause hidden when paused, got ${pausedIcons.pauseDisplay}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

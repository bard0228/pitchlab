import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createC4Wav(filePath, durationSec = 3.2) {
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
    const sample = Math.round(0.4 * Math.sin(2 * Math.PI * 261.6256 * t) * 32767);
    buf.writeInt16LE(sample, 44 + i * 4);
    buf.writeInt16LE(sample, 44 + i * 4 + 2);
  }
  fs.writeFileSync(filePath, buf);
}

export default async function ({ page, assert }) {
  const touchAudit = await page.evaluate(() => {
    const ids = [
      '#btn-play',
      '#btn-mic',
      '#btn-mode',
      '#btn-octave',
      '#btn-key-down',
      '#btn-key-up',
      '#btn-key-reset',
    ];
    return ids.map((id) => {
      const r = document.querySelector(id).getBoundingClientRect();
      return { id, w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  for (const item of touchAudit) {
    assert(item.w >= 48 && item.h >= 48, `Touch target ${item.id} too small: ${item.w}x${item.h}`);
  }

  await page.click('#btn-mode');
  const modeText = await page.$eval('#btn-mode', (el) => el.textContent.trim());
  assert(modeText === '外放模式', `Expected 外放模式, got "${modeText}"`);

  await page.click('#btn-octave');
  const octOff = await page.$eval('#btn-octave', (el) => el.textContent.trim());
  assert(octOff === '八度寬容：關', `Expected 八度寬容：關, got "${octOff}"`);
  await page.click('#btn-octave');
  const octOn = await page.$eval('#btn-octave', (el) => el.textContent.trim());
  assert(octOn === '八度寬容：開', `Expected 八度寬容：開, got "${octOn}"`);

  await page.$eval('#latency-offset', (el) => {
    el.value = '-40';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const latText = await page.$eval('#latency-value', (el) => el.textContent.trim());
  assert(latText === '-40 毫秒', `Expected -40 毫秒, got "${latText}"`);

  await page.$eval('#latency-offset', (el) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Upload a C4 test WAV so target curve exists after removing built-in fixture
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitchlab-tb03-'));
  const wavPath = path.join(tmpDir, 'c4_test.wav');
  createC4Wav(wavPath, 3.2);

  try {
    const input = await page.$('#file-song');
    await input.uploadFile(wavPath);
    await new Promise((r) => setTimeout(r, 500));

    await page.$eval('#scrub-bar', (el) => {
      el.value = '0.8';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(() => window.__pitchLabInjectSample(261.6256));
    await new Promise((r) => setTimeout(r, 200));

    const hudLive = await page.$eval('#hud-live', (el) => el.textContent.trim());
    const hudCents = await page.$eval('#hud-cents', (el) => el.textContent.trim());
    const hasGreen = await page.$eval('#hud-cents', (el) => el.classList.contains('grade-green'));
    assert(hudLive === '目前 C4', `Expected #hud-live "目前 C4", got "${hudLive}"`);
    assert(hudCents === '偏差 0 音分', `Expected #hud-cents "偏差 0 音分", got "${hudCents}"`);
    assert(hasGreen, 'Expected #hud-cents to have grade-green class');

    await page.evaluate(() => window.__pitchLabInjectSample(null));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

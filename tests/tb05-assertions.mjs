import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default async function ({ page, assert }) {
  // 1. Confirm legacy dual-file buttons are gone and single instant upload + Colab link exist
  assert((await page.$('#file-inst')) === null, '#file-inst should be removed');
  assert((await page.$('#file-vocal')) === null, '#file-vocal should be removed');
  assert((await page.$('#file-song')) !== null, '#file-song must exist');
  assert((await page.$('#link-colab')) !== null, '#link-colab must exist inside library');

  // 2. Upload a real 4s stereo WAV song directly into #file-song
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitchlab-websep-'));
  const wavPath = path.join(tmpDir, '我的最愛.wav');

  const sr = 48000;
  const n = Math.floor(sr * 4.2);
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
    const sample = Math.round((0.4 * Math.sin(2 * Math.PI * 261.63 * t)) * 32767);
    buf.writeInt16LE(sample, 44 + i * 4);
    buf.writeInt16LE(sample, 44 + i * 4 + 2);
  }
  fs.writeFileSync(wavPath, buf);

  try {
    const input = await page.$('#file-song');
    await input.uploadFile(wavPath);
    await new Promise((r) => setTimeout(r, 600));

    const labelText = await page.$eval('#label-upload-song', (el) => el.textContent.trim());
    assert(labelText === '已載入：我的最愛', `Expected "已載入：我的最愛", got "${labelText}"`);

    const totTime = await page.$eval('#time-total', (el) => el.textContent.trim());
    assert(totTime === '00:04', `Expected 00:04 duration, got "${totTime}"`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

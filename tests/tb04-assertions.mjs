import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default async function ({ page, assert }) {
  // Generate a real 5s Song Package .zip via TB-02 Python pipeline
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitchlab-tb04-'));
  const wavPath = path.join(tmpDir, 'test_song.wav');
  const zipPath = path.join(tmpDir, 'test_song.zip');

  execFileSync('python3', [
    '-c',
    `
import wave, numpy as np
from pathlib import Path
from pipeline.process_song import process_audio_to_package
sr = 48000
t = np.arange(int(sr * 5.2), dtype=np.float64) / sr
sig = 0.4 * np.sin(2 * np.pi * 261.63 * t)
pcm = (np.stack([sig, sig], axis=1) * 32767).astype(np.int16)
with wave.open(${JSON.stringify(wavPath)}, 'wb') as wf:
    wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(sr); wf.writeframes(pcm.tobytes())
process_audio_to_package(source_path=Path(${JSON.stringify(wavPath)}), out_zip=Path(${JSON.stringify(zipPath)}), title="測試匯入曲", separator="spectral")
`,
  ]);

  try {
    // 1. Open Library modal
    await page.click('#btn-library');
    await new Promise((r) => setTimeout(r, 250));
    const isModalOpen = await page.$eval('#library-portal', (el) => !el.hidden && getComputedStyle(el).display !== 'none');
    assert(isModalOpen, 'Expected #library-portal to be visible');

    // Verify portal is direct child of document.body (Rule 4)
    const parentTag = await page.$eval('#library-portal', (el) => el.parentElement.tagName.toLowerCase());
    assert(parentTag === 'body', `Expected #library-portal parent to be body, got ${parentTag}`);

    // 2. Upload real .zip Song Package
    const fileInput = await page.$('#file-zip');
    await fileInput.uploadFile(zipPath);
    await new Promise((r) => setTimeout(r, 600));

    const totTime = await page.$eval('#time-total', (el) => el.textContent.trim());
    assert(totTime === '00:05', `Expected imported song duration 00:05, got "${totTime}"`);

    // 3. Reload page and confirm IndexedDB persistence
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 300));
    await page.click('#btn-library');
    await new Promise((r) => setTimeout(r, 250));

    const songNames = await page.$$eval('.song-name', (els) => els.map((e) => e.textContent.trim()));
    assert(songNames.includes('測試匯入曲'), `Expected persisted song "測試匯入曲" in IndexedDB list, got ${JSON.stringify(songNames)}`);

    // 4. Clean up via delete button
    await page.click('.song-del-btn');
    await new Promise((r) => setTimeout(r, 200));
    const remainingNames = await page.$$eval('.song-name', (els) => els.map((e) => e.textContent.trim()));
    assert(!remainingNames.includes('測試匯入曲'), 'Expected deleted song to be removed from list');

    await page.click('#btn-library-close');
    await new Promise((r) => setTimeout(r, 250));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

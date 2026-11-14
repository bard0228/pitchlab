export default async function ({ page, assert }) {
  // 1. Check new TB-03 controls & touch targets
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

  // 2. Toggle mode (耳機模式 -> 外放模式)
  await page.click('#btn-mode');
  const modeText = await page.$eval('#btn-mode', (el) => el.textContent.trim());
  assert(modeText === '外放模式', `Expected 外放模式, got "${modeText}"`);

  // 3. Toggle octave-agnostic (開 -> 關 -> 開)
  await page.click('#btn-octave');
  const octOff = await page.$eval('#btn-octave', (el) => el.textContent.trim());
  assert(octOff === '八度寬容：關', `Expected 八度寬容：關, got "${octOff}"`);
  await page.click('#btn-octave');
  const octOn = await page.$eval('#btn-octave', (el) => el.textContent.trim());
  assert(octOn === '八度寬容：開', `Expected 八度寬容：開, got "${octOn}"`);

  // 4. Latency offset slider updates label and localStorage
  await page.$eval('#latency-offset', (el) => {
    el.value = '-40';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const latText = await page.$eval('#latency-value', (el) => el.textContent.trim());
  assert(latText === '-40 毫秒', `Expected -40 毫秒, got "${latText}"`);

  // Reset latency back to 0 for deterministic pitch injection test
  await page.$eval('#latency-offset', (el) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // 5. Seek to 0.8s (inside C4 note window 0.5s - 1.5s) and inject 261.6256 Hz (C4)
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
}

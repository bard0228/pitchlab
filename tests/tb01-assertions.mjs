export default async function ({ page, assert }) {
  const trackBadge = await page.$('#track-title');
  assert(trackBadge === null, 'Top-right #track-title badge must be removed');

  const keyText = await page.$eval('#key-value', (el) => el.textContent.trim());
  assert(keyText === '-1 半音', `Expected #key-value to be "-1 半音", got "${keyText}"`);

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
}

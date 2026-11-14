export default async function ({ page, assert }) {
  const keyText = await page.$eval('#key-value', (el) => el.textContent.trim());
  assert(keyText === '-1 st', `Expected #key-value to be "-1 st", got "${keyText}"`);

  const isPlaying = await page.$eval('#btn-play', (el) => el.getAttribute('aria-pressed'));
  assert(isPlaying === 'true', `Expected #btn-play aria-pressed="true", got "${isPlaying}"`);

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
}

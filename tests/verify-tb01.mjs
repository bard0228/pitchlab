import { runVerification } from './verify-runner.mjs';

const res = await runVerification({
  file: new URL('../index.html', import.meta.url).pathname,
  width: 412,
  height: 915,
  isMobile: true,
  checkOverflow: true,
  checkTouchTargets: true,
  minTouchPx: 48,
  clicks: ['#btn-key-down', '#btn-key-down', '#btn-key-up'],
  expectSelectors: ['#btn-play', '#vocal-gain', '#btn-key-down', '#btn-key-up', '#key-value', '#vocal-gain-value'],
  customScript: new URL('./tb01-assertions.mjs', import.meta.url).pathname,
});

console.log(`PASS TB-01 E2E (${res.viewport}, clicks=${res.clicks}, consoleErrors=0, overflow=0)`);

import { runVerification } from './verify-runner.mjs';

const res = await runVerification({
  file: new URL('../index.html', import.meta.url).pathname,
  width: 412,
  height: 915,
  isMobile: true,
  checkOverflow: true,
  checkTouchTargets: true,
  minTouchPx: 48,
  expectSelectors: ['#btn-mic', '#btn-mode', '#btn-octave', '#latency-offset', '#hud-live', '#hud-cents', '#hud-accuracy'],
  customScript: new URL('./tb03-assertions.mjs', import.meta.url).pathname,
});

console.log(`PASS TB-03 E2E (${res.viewport}, consoleErrors=0, overflow=0)`);

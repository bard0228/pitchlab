import { runVerification } from './verify-runner.mjs';

const res = await runVerification({
  file: new URL('../index.html', import.meta.url).pathname,
  width: 412,
  height: 915,
  isMobile: true,
  checkOverflow: true,
  checkTouchTargets: true,
  minTouchPx: 48,
  expectSelectors: ['#label-upload-song', '#btn-library'],
  customScript: new URL('./tb05-assertions.mjs', import.meta.url).pathname,
});

console.log(`PASS Web-Separator E2E (${res.viewport}, consoleErrors=0, overflow=0)`);

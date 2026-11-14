import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, findActiveLyricIndex, formatLrcTimestamp } from '../src/lyrics.js';

test('parseLrc parses standard and multi-timestamp LRC lines in sorted order', () => {
  const sample = [
    '[ti:測試歌曲]',
    '[ar:測試歌手]',
    '[00:10.50]第二句歌詞',
    '[00:02.00][00:25.250]第一句與副歌',
    '[00:15]第三句無毫秒',
    '[00:18.00]   ',
  ].join('\n');

  const lines = parseLrc(sample);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0], { timeSec: 2, text: '第一句與副歌' });
  assert.deepEqual(lines[1], { timeSec: 10.5, text: '第二句歌詞' });
  assert.deepEqual(lines[2], { timeSec: 15, text: '第三句無毫秒' });
  assert.deepEqual(lines[3], { timeSec: 25.25, text: '第一句與副歌' });
});

test('findActiveLyricIndex returns active line index or -1 before first line', () => {
  const lines = [
    { timeSec: 5.0, text: 'A' },
    { timeSec: 12.0, text: 'B' },
    { timeSec: 20.0, text: 'C' },
  ];
  assert.equal(findActiveLyricIndex(lines, 1.0), -1);
  assert.equal(findActiveLyricIndex(lines, 5.0), 0);
  assert.equal(findActiveLyricIndex(lines, 11.9), 0);
  assert.equal(findActiveLyricIndex(lines, 12.0), 1);
  assert.equal(findActiveLyricIndex(lines, 25.0), 2);
});

test('formatLrcTimestamp formats seconds to [mm:ss.xx]', () => {
  assert.equal(formatLrcTimestamp(0), '[00:00.00]');
  assert.equal(formatLrcTimestamp(65.5), '[01:05.50]');
});

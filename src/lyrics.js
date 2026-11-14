export function formatLrcTimestamp(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  const wholeSec = Math.floor(rem);
  const centi = Math.floor((rem - wholeSec) * 100 + 1e-6);
  return `[${String(mins).padStart(2, '0')}:${String(wholeSec).padStart(2, '0')}.${String(centi).padStart(2, '0')}]`;
}

export function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const timeTagRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const offsetRe = /^\[offset:\s*([+-]?\d+)\s*\]$/i;

  let offsetSec = 0;
  const entries = [];

  for (const rawLine of lrcText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const offsetMatch = line.match(offsetRe);
    if (offsetMatch) {
      offsetSec = Number(offsetMatch[1]) / 1000;
      continue;
    }

    const timestamps = [];
    let match;
    timeTagRe.lastIndex = 0;
    while ((match = timeTagRe.exec(line)) !== null) {
      const mins = Number(match[1]);
      const secs = Number(match[2]);
      const fracRaw = match[3] || '';
      const frac = fracRaw
        ? Number(fracRaw) / (fracRaw.length === 3 ? 1000 : fracRaw.length === 2 ? 100 : 10)
        : 0;
      timestamps.push(mins * 60 + secs + frac);
    }

    if (timestamps.length === 0) continue;

    const text = line.replace(timeTagRe, '').trim();
    if (!text) continue;

    for (const ts of timestamps) {
      entries.push({
        timeSec: Math.max(0, Math.round((ts + offsetSec) * 1000) / 1000),
        text,
      });
    }
  }

  entries.sort((a, b) => a.timeSec - b.timeSec);
  return entries;
}

export function findActiveLyricIndex(lines, currentTimeSec) {
  if (!Array.isArray(lines) || lines.length === 0) return -1;
  const t = Number(currentTimeSec) || 0;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeSec <= t + 0.05) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return ans;
}

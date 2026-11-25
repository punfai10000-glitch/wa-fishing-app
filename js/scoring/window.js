// Best time window in the next 24 h (spec: stage-6 §5.5).
// hours: [{ t, score, blocked }]  (score null when unknown)
export function bestWindow(hours, { minLen = 2, horizonMs = 24 * 3600 * 1000, now = Date.now() } = {}) {
  const usable = hours.filter(h => h.t >= now - 3600 * 1000 && h.t < now + horizonMs);
  let best = null;
  for (let i = 0; i < usable.length; i++) {
    for (let len = minLen; i + len <= usable.length && len <= 6; len++) {
      const seg = usable.slice(i, i + len);
      if (seg.some(h => h.blocked || h.score == null)) break;
      // contiguous in time
      if (seg.some((h, k) => k > 0 && h.t - seg[k - 1].t > 3600 * 1000 + 1000)) break;
      const avg = seg.reduce((a, h) => a + h.score, 0) / len;
      // prefer higher average; near-ties keep the earlier window (or extend it if same start)
      const better = !best || avg > best.avg + 0.5 ||
        (seg[0].t === best.start && avg >= best.avg - 0.5 && len > best.len);
      if (better) {
        best = { start: seg[0].t, end: seg[len - 1].t + 3600 * 1000, avg, len };
      }
    }
  }
  return best ? { start: best.start, end: best.end, score: Math.round(best.avg) } : null;
}

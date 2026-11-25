// Ties data + scoring together for a location/activity.
import { scoreHour, band, explain } from './scoring/score.js';
import { checkBlocks } from './scoring/blocks.js';
import { computeConfidence } from './scoring/confidence.js';
import { bestWindow } from './scoring/window.js';
import { dayKey } from './units.js';

const HOUR = 3600 * 1000;

function sunFor(loc, t, sunFn) {
  if (!sunFn) return null;
  const [lng, lat] = loc.geometry.coordinates;
  // Use local (Perth) noon of that day so results don't depend on the device's time zone.
  const times = sunFn(new Date(`${dayKey(t)}T12:00:00+08:00`), lat, lng);
  return { sunrise: +times.sunrise, sunset: +times.sunset };
}

/**
 * ctx: { thresholds, rules, zones, staleSources, sunFn, now, species }
 */
export function evaluate(loc, hours, activity, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (!loc.activities.includes(activity)) return { applicable: false };
  if (!hours || !hours.length) {
    return { applicable: true, noData: true, band: 'unknown', score: null, confidence: { level: 'low', reasons: ['No forecast data loaded'] } };
  }
  const legalUnchecked = !ctx.zones?.loaded;
  const sunCache = new Map();
  const hourly = hours.map(h => {
    const dk = dayKey(h.t);
    if (!sunCache.has(dk)) sunCache.set(dk, sunFor(loc, h.t, ctx.sunFn));
    const result = scoreHour(loc, h, activity, { species: ctx.species });
    const blocks = checkBlocks(loc, h, activity, { thresholds: ctx.thresholds, rules: ctx.rules, sun: sunCache.get(dk), zoneHits: ctx.zoneHits?.(loc) ?? [] });
    return { t: h.t, hour: h, result, score: result.score, blocks, blocked: blocks.length > 0 };
  });

  const window24 = hourly.filter(h => h.t >= now - HOUR && h.t < now + 24 * HOUR);
  const current = window24.find(h => h.t <= now && h.t + HOUR > now) ?? window24[0] ?? null;
  const best = bestWindow(hourly, { now });
  const usable = window24.filter(h => !h.blocked && h.score != null);
  const allBlocked = window24.length > 0 && window24.every(h => h.blocked);
  const topHour = usable.sort((a, b) => b.score - a.score)[0] ?? null;

  const conf = computeConfidence((topHour ?? current)?.result ?? { missing: [] }, activity, loc, { staleSources: ctx.staleSources ?? 0, legalUnchecked });

  // 7-day outlook: best non-blocked daylight-ish score per day
  const days = new Map();
  for (const h of hourly) {
    if (h.t < now - HOUR) continue;
    const k = dayKey(h.t);
    const d = days.get(k) ?? { day: k, t: h.t, best: null, blockedHours: 0, hours: 0, bestHour: null };
    d.hours++;
    if (h.blocked) d.blockedHours++;
    else if (h.score != null && (d.best == null || h.score > d.best)) { d.best = h.score; d.bestHour = h.t; }
    days.set(k, d);
  }

  const headline = allBlocked ? 'blocked' : best ? band(best.score) : topHour ? band(topHour.score) : 'unknown';
  return {
    applicable: true,
    hourly, current, best,
    score: allBlocked ? null : best?.score ?? topHour?.score ?? null,
    band: headline,
    blocked: allBlocked,
    // Most informative reasons first: the generic night-time spear rule goes last.
    blockReasons: allBlocked ? [...new Set(window24.flatMap(h => h.blocks.map(b => b.reason)))]
      .sort((a, b) => /daylight/.test(a) - /daylight/.test(b)) : [],
    currentBlocks: current?.blocks ?? [],
    confidence: conf,
    explanation: (topHour ?? current) ? explain((topHour ?? current).result, activity) : '',
    daily: [...days.values()].slice(0, 7),
    legalUnchecked
  };
}

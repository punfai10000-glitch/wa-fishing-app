// Ties data + scoring together for a location/activity.
import { scoreHour, band, explain } from './scoring/score.js';
import { checkBlocks } from './scoring/blocks.js';
import { computeConfidence } from './scoring/confidence.js';
import { bestWindow } from './scoring/window.js';
import { dayKey } from './units.js';
import { exposureOf } from './scoring/geo.js';

const HOUR = 3600 * 1000;

function sunFor(loc, t, sunFn) {
  if (!sunFn) return null;
  const [lng, lat] = loc.geometry.coordinates;
  // Use local (Perth) noon of that day so results don't depend on the device's time zone.
  const times = sunFn(new Date(`${dayKey(t)}T12:00:00+08:00`), lat, lng);
  return { sunrise: +times.sunrise, sunset: +times.sunset };
}


// Prior-hours context for the visibility estimate (swell over last 24 h, rain over 48 h, onshore wind 12 h).
function addVisibilityContext(hours, loc) {
  if (hours.__visFor === loc.id) return;
  hours.forEach((h, i) => {
    const prior = (n) => hours.slice(Math.max(0, i - n), i + 1);
    const w24 = prior(24).map(x => x.wave_height ?? x.swell_height).filter(v => v != null);
    const dirs = prior(24).map(x => x.wave_direction ?? x.swell_direction).filter(v => v != null);
    const onshore = dirs.filter(d => exposureOf(d, loc.exposure) === 'onshore').length;
    const rain = prior(48).map(x => x.precipitation).filter(v => v != null);
    const wind12 = prior(12).filter(x => x.wind_speed != null && exposureOf(x.wind_direction, loc.exposure) === 'onshore').map(x => x.wind_speed);
    h.vis_ctx = {
      maxWave24: w24.length >= 6 ? Math.max(...w24) : null,
      onshoreShare: dirs.length ? onshore / dirs.length : 0,
      rain48: rain.length >= 12 ? rain.reduce((a, b) => a + b, 0) : null,
      onshoreWind12: wind12.length ? wind12.reduce((a, b) => a + b, 0) / wind12.length : 0
    };
  });
  hours.__visFor = loc.id;
}

/**
 * ctx: { thresholds, rules, zones, staleSources, sunFn, now, species }
 */
// Why something is blocked, most serious first: 'legal' (not allowed), 'safety' (not safe), 'dark' (night, spear)
export function blockKindOf(blocks) {
  if (!blocks?.length) return null;
  if (blocks.some(b => b.kind === 'legal')) return 'legal';
  if (blocks.some(b => b.kind === 'safety')) return 'safety';
  return 'dark';
}

export function evaluate(loc, hours, activity, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (!loc.activities.includes(activity)) return { applicable: false, activity };
  if (!hours || !hours.length) {
    return { applicable: true, noData: true, band: 'unknown', score: null, confidence: { level: 'low', reasons: ['No forecast data loaded'] } };
  }
  if (loc.estuary) hours = hours.map(h => ({ ...h, wave_height: null, swell_height: null, wave_period: null, swell_period: null, wind_wave_height: null, sheltered: true }));
  const legalUnchecked = !ctx.zones?.loaded;
  if (activity === 'spear') addVisibilityContext(hours, loc);
  const sunCache = new Map();
  const hourly = hours.map(h => {
    const dk = dayKey(h.t);
    if (!sunCache.has(dk)) sunCache.set(dk, sunFor(loc, h.t, ctx.sunFn));
    const sun = sunCache.get(dk);
    if (sun) h.light = (Math.abs(h.t + 1800e3 - sun.sunrise) <= 5400e3 || Math.abs(h.t + 1800e3 - sun.sunset) <= 5400e3) ? 'twilight' : (h.t > sun.sunrise && h.t < sun.sunset ? 'day' : 'night');
    const result = scoreHour(loc, h, activity, { species: ctx.species });
    const blocks = checkBlocks(loc, h, activity, { thresholds: ctx.thresholds, rules: ctx.rules, sun: sunCache.get(dk), zoneHits: ctx.zoneHits?.(loc) ?? [] });
    return { t: h.t, hour: h, result, score: result.score, blocks, blocked: blocks.length > 0, blockKind: blockKindOf(blocks) };
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
    blockKind: allBlocked ? blockKindOf(window24.flatMap(h => h.blocks)) : null,
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

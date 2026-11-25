// Hard safety and legal blocks (spec: stage-6 §5.4). Any block overrides the score.
import { effectiveWave } from './score.js';

const THUNDER_CODES = new Set([95, 96, 99]);

function metricValue(metric, hour, loc) {
  switch (metric) {
    case 'wind_gust_kmh': return hour.wind_gust;
    case 'wind_speed_kmh': return hour.wind_speed;
    case 'onshore_wave_m': {
      const ew = effectiveWave(hour, loc);
      return ew ? ew.height : null;
    }
    default: return null;
  }
}

function thresholdApplies(th, loc, activity) {
  if (th.applies_to.activity !== activity) return false;
  const types = th.applies_to.types;
  return types === '*' || (Array.isArray(types) && types.includes(loc.type));
}

/**
 * ctx: { thresholds, rules, zones, sun: {sunrise, sunset} (ms), warnings: [] }
 * returns [{ kind: 'safety'|'legal', reason }]
 */
export function checkBlocks(loc, hour, activity, ctx = {}) {
  const out = [];

  // Legal: sanctuary/prohibited zones (only when zone data is loaded)
  for (const z of (ctx.zoneHits || [])) {
    if (z.prohibits?.includes(activity) || z.zone_type === 'sanctuary') {
      out.push({ kind: 'legal', reason: `Inside ${z.name} — ${activity === 'spear' ? 'spearfishing' : 'fishing'} not permitted.` });
    }
  }

  // Legal: active closures from rules
  const now = hour.t;
  for (const r of (ctx.rules || [])) {
    if (!r.blocks) continue;
    if (!(loc.restrictions || []).includes(r.id)) continue;
    const from = r.effective_from ? Date.parse(r.effective_from) : -Infinity;
    const to = r.effective_to ? Date.parse(r.effective_to) : Infinity;
    if (now >= from && now <= to) out.push({ kind: 'legal', reason: r.summary });
  }

  // Safety thresholds (location type + activity specific; strictest wins)
  for (const th of (ctx.thresholds || [])) {
    if (!thresholdApplies(th, loc, activity)) continue;
    const v = metricValue(th.metric, hour, loc);
    if (v != null && v > th.max) {
      const unit = th.metric.endsWith('_m') ? 'm' : 'km/h';
      out.push({ kind: 'safety', reason: `${th.rationale} (${v.toFixed(1)} ${unit} > limit ${th.max} ${unit}${th.status === 'draft' ? ', draft limit' : ''}).` });
    }
  }

  // Thunderstorms forecast
  if (hour.weather_code != null && THUNDER_CODES.has(hour.weather_code)) {
    out.push({ kind: 'safety', reason: 'Thunderstorm forecast in this hour.' });
  }

  // Official warnings covering the location
  for (const w of (ctx.warnings || [])) out.push({ kind: 'safety', reason: w.title });

  // Spearfishing only in daylight
  if (activity === 'spear' && ctx.sun && ctx.sun.sunrise && ctx.sun.sunset) {
    if (hour.t < ctx.sun.sunrise || hour.t >= ctx.sun.sunset) {
      out.push({ kind: 'safety', reason: 'Spearfishing is only rated in daylight.' });
    }
  }

  // Dedupe identical reasons
  const seen = new Set();
  return out.filter(b => !seen.has(b.reason) && seen.add(b.reason));
}

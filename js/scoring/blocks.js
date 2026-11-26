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
    // Rocks & long-period checks: full height, NOT reduced for side-on/sheltered direction (waves wrap around)
    case 'wave_m_any_dir': {
      const h = hour.wave_height ?? hour.swell_height;
      return h == null ? null : h;
    }
    // 1 when the wave forecast is missing for an ocean spot (unknown = unsafe on rocks / for diving)
    case 'current_kmh': return hour.current_speed ?? null;
    case 'wave_missing':
      return loc.estuary || hour.sheltered ? null : ((hour.wave_height ?? hour.swell_height) == null ? 1 : 0);
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
  const hits = ctx.zoneHits || [];
  const permitted = hits.some(z => (z.permits || []).includes(activity));
  for (const z of hits) {
    if (z.zone_type === 'sanctuary' || (z.prohibits?.includes(activity) && !permitted)) {
      out.push({ kind: 'legal', reason: `${z.name} — ${z.note || (activity === 'spear' ? 'spearfishing' : 'fishing') + ' not permitted.'}` });
    }
  }

  // Legal: spearfishing is prohibited in all inland waters, creeks, estuaries and rivers (DPIRD)
  if (loc.estuary && activity === 'spear') out.push({ kind: 'legal', reason: 'Spearfishing is banned in WA rivers, estuaries, creeks and inland waters.' });

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
    if (th.min_period_s != null) {
      const per = hour.wave_period ?? hour.swell_period;
      if (per == null || per < th.min_period_s) continue;
    }
    if (loc.estuary && th.metric !== 'wind_gust_kmh' && th.metric !== 'wind_speed_kmh') continue;
    const v = metricValue(th.metric, hour, loc);
    if (v != null && v > th.max) {
      if (th.metric === 'wave_missing') { out.push({ kind: 'safety', reason: `${th.rationale}.` }); continue; }
      const unit = th.metric.includes('_m') && !th.metric.includes('kmh') ? 'm' : 'km/h';
      const per = th.min_period_s != null ? ` at ${Math.round(hour.wave_period ?? hour.swell_period)} s` : '';
      out.push({ kind: 'safety', reason: `${th.rationale} (${v.toFixed(1)} ${unit}${per}; limit ${th.max} ${unit}).` });
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
      out.push({ kind: 'dark', reason: 'Too dark — spearfishing is only rated in daylight.' });
    }
  }

  // Dedupe identical reasons
  const seen = new Set();
  return out.filter(b => !seen.has(b.reason) && seen.add(b.reason));
}

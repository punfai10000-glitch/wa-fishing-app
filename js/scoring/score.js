// Environmental suitability scoring (spec: stage-6 §5). Pure functions — no DOM.
import { exposureOf, degToCompass } from './geo.js';

// v0.3: scores rate CONDITIONS only. Terrain and access are fixed per spot, so they are shown
// separately instead of lifting every score (they made almost everything look 90+).
export const WEIGHTS = {
  // tide weight lowered (15→10): Open-Meteo tides are an ~8 km model with limited coastal accuracy
  shore: { wind: 30, waves: 30, tide: 10, light: 15, season: 10 },
  spear: { wind: 20, waves: 30, visibility: 25, tide: 10, sst: 10, season: 5 }
};

// Without these an hour can't be called safe or good: the score is Unknown instead of a guess
export const CRITICAL = { shore: ['wind', 'waves'], spear: ['wind', 'waves'] };
// A missing non-critical factor counts as this (middle of the scale) at its FULL weight, so unknowns pull a
// score towards 'fair' instead of being dropped (dropping them let two good factors make a 90+ score)
export const NEUTRAL = 50;

export const IMPORTANT = {
  shore: ['wind', 'waves', 'tide'],
  spear: ['wind', 'waves', 'tide', 'visibility']
};

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const lerpScore = (x, good, bad) => {
  // 100 at <= good, 0 at >= bad, linear between
  if (x <= good) return 100;
  if (x >= bad) return 0;
  return 100 * (1 - (x - good) / (bad - good));
};

// Wave height that actually reaches the spot, adjusted for direction and period.
export function effectiveWave(hour, loc) {
  const h = hour.wave_height ?? hour.swell_height;
  if (h == null) return null;
  const dir = hour.wave_direction ?? hour.swell_direction;
  const exp = exposureOf(dir, loc.exposure);
  const dirFactor = exp === 'onshore' ? 1 : exp === 'sheltered' ? 0.3 : exp === 'cross' ? 0.6 : 1;
  const period = hour.wave_period ?? hour.swell_period;
  const periodFactor = period != null && period >= 12 ? 1.2 : 1;
  return { height: h * dirFactor * periodFactor, raw: h, exposure: exp, dir, period };
}

function windFactor(hour, loc, activity) {
  const s = hour.wind_speed, g = hour.wind_gust;
  if (s == null) return null;
  const exp = exposureOf(hour.wind_direction, loc.exposure);
  // comfortable speed (km/h) before penalties start, and speed where score hits 0
  const table = activity === 'spear'
    ? { onshore: [6, 25], cross: [10, 30], sheltered: [15, 35], null: [8, 28] }
    : { onshore: [10, 35], cross: [14, 40], sheltered: [20, 50], null: [12, 40] };
  const [good, bad] = table[exp ?? 'null'];
  let score = lerpScore(s, good, bad);
  if (g != null && g > s * 1.6 && g > 30) score -= 10; // gusty
  const dirTxt = degToCompass(hour.wind_direction);
  const label = exp === 'onshore' ? 'onshore' : exp === 'sheltered' ? 'offshore/sheltered' : exp === 'cross' ? 'cross-shore' : '';
  return { score: clamp(score), detail: `${dirTxt ?? ''} ${Math.round(s)} km/h${g != null ? ` (gusts ${Math.round(g)})` : ''}${label ? `, ${label}` : ''}`.trim() };
}

function wavesFactor(hour, loc, activity) {
  const ew = effectiveWave(hour, loc);
  if (!ew) return null;
  const rock = loc.type === 'rock_platform';
  const [good, bad] = activity === 'spear' ? [0.3, 1.3] : rock ? [0.5, 1.8] : [0.8, 3.0];
  const score = lerpScore(ew.height, good, bad);
  const dirTxt = degToCompass(ew.dir);
  return { score: clamp(score), detail: `${ew.raw.toFixed(1)} m${ew.period != null ? ` @ ${Math.round(ew.period)} s` : ''}${dirTxt ? ` from ${dirTxt}` : ''}${ew.exposure ? `, ${ew.exposure}` : ''}` };
}

function tideFactor(hour) {
  // rate of change of sea level, m per hour (modelled or measured)
  const r = hour.tide_rate;
  if (r == null) return null;
  const a = Math.abs(r);
  const score = a <= 0.01 ? 40 : a >= 0.05 ? 90 : 40 + (a - 0.01) / 0.04 * 50;
  const trend = r > 0.005 ? 'rising' : r < -0.005 ? 'falling' : 'slack';
  return { score: clamp(score), detail: `${trend} (${(r * 100).toFixed(1)} cm/h, ~8 km model — approximate near shore)` };
}

// Low light (around sunrise/sunset) is a widely used rule of thumb for feeding activity.
function lightFactor(hour) {
  if (!hour.light) return null;
  const map = { twilight: [100, 'dawn/dusk'], night: [70, 'night'], day: [60, 'daytime'] };
  const [score, label] = map[hour.light];
  return { score, detail: label };
}

function seasonFactor(loc, month, species, seasonFn) {
  // 1) curated per-spot evidence (best), 2) the regional seasonal guide (data/targets.json), else Unknown
  const ev = (loc.species_evidence || []).filter(e => !species || e.species === species);
  if (ev.length) {
    const inSeason = ev.some(e => (e.months || []).includes(month));
    return { score: inSeason ? 100 : 50, detail: inSeason ? 'in season (curated evidence)' : 'outside recorded season', type: 'curated' };
  }
  const g = seasonFn ? seasonFn(loc, month, species) : null;
  return g ? { ...g, type: 'guide' } : null;
}

const TERRAIN_FIT = {
  shore: { jetty: 85, groyne: 85, rock_wall: 80, channel: 80, surf_gutter: 80, sand: 70, reef: 70, rock_platform: 70, granite: 65, limestone: 65, seagrass: 75 },
  spear: { reef: 95, limestone: 90, granite: 85, rock_platform: 70, seagrass: 60, jetty: 50, sand: 30, channel: 40, rock_wall: 50, surf_gutter: 30, groyne: 50 }
};

function terrainFactor(loc, activity) {
  const t = loc.terrain || [];
  if (!t.length) return null;
  const best = Math.max(...t.map(x => TERRAIN_FIT[activity][x] ?? 50));
  return { score: best, detail: t.join(', ').replaceAll('_', ' ') };
}

function accessFactor(loc) {
  const a = loc.access;
  if (!a) return null;
  let s = 100;
  if (a.vehicle === '4wd') s -= 25;
  if (a.walk_minutes != null) s -= Math.min(40, Math.max(0, a.walk_minutes - 10) * 1.5);
  if (a.parking === false) s -= 10;
  return { score: clamp(s), detail: `${a.vehicle?.toUpperCase() ?? '?'}${a.walk_minutes != null ? `, ~${a.walk_minutes} min walk` : ''}` };
}

function visFactor(hour, loc) {
  const v = visibilityEstimate(hour, loc);
  return v ? { score: v.score, detail: `${v.label} (estimate from swell, wind & rain — not measured)` } : null;
}

function sstFactor(hour) {
  const t = hour.sst;
  if (t == null) return null;
  const s = t >= 18 && t <= 24 ? 100 : t < 18 ? clamp(100 - (18 - t) * 15) : clamp(100 - (t - 24) * 15);
  return { score: s, detail: `${t.toFixed(1)} °C` };
}

// Visibility ESTIMATE (not a measurement): clear water usually follows a run of small swell,
// light or offshore wind and no rain. Inputs are prepared by engine.js (prior-hours context).
export function visibilityEstimate(hour, loc) {
  const c = hour.vis_ctx;
  const sat = loc.sat && loc.sat.ageDays != null && loc.sat.ageDays < 31 ? loc.sat : null;
  if ((!c || c.maxWave24 == null) && !sat) return null;
  // satellite clarity (Kd490) is the starting point; the older the pass, the more it leans back to the forecast-only
  // guess (85), and swell, wind and rain since then still count
  const satScore = sat ? ({ vclear: 92, clear: 80, ok: 62, murky: 40, vmurky: 20 }[sat.band.key]) : null;
  const fresh = sat ? Math.max(0, 1 - Math.max(0, sat.ageDays - 3) / 20) : 0;   // 1 up to 3 days old -> ~0 at 23 days
  let s = sat ? Math.round(satScore * (0.4 + 0.6 * fresh) + 85 * (0.6 - 0.6 * fresh)) : 85;
  const k = sat ? 1 - 0.5 * fresh : 1;
  if (!c || c.maxWave24 == null) return { score: s, label: `${sat.band.label.toLowerCase()} (satellite)`, sat };
  const s0 = s;
  const exposed = c.maxWave24 * (c.onshoreShare >= 0.5 ? 1 : 0.6);
  if (exposed > 0.8) s -= Math.min(45, (exposed - 0.8) * 40);
  if (hour.wind_wave_height != null && hour.wind_wave_height > 0.4) s -= Math.min(15, (hour.wind_wave_height - 0.4) * 30);
  if (c.onshoreWind12 != null && c.onshoreWind12 > 18) s -= Math.min(15, (c.onshoreWind12 - 18));
  if (c.rain48 != null && c.rain48 > 3) s -= Math.min(25, c.rain48 * (['estuary', 'bay'].includes(loc.type) ? 3 : 1.5));
  if (sat) s = s0 - (s0 - s) * k;
  s = clamp(s);
  const label = sat ? `likely ${s >= 70 ? 'clear' : s >= 45 ? 'average' : 'murky'} — satellite ${sat.ageDays < 1.5 ? 'yesterday' : Math.round(sat.ageDays) + ' days ago'}: ${sat.band.label.toLowerCase()} (~${sat.band.vis})` : s >= 70 ? 'likely clear' : s >= 45 ? 'likely average' : 'likely murky';
  return { score: s, label, sat };
}

const LABELS = { light: 'Light (sun)', wind: 'Wind', waves: 'Waves & swell', tide: 'Tide', season: 'Season', terrain: 'Terrain', access: 'Access', sst: 'Sea temperature', visibility: 'Underwater visibility' };

// hour: normalised hourly record; types: { field: 'forecast'|'modelled'|... }
export function scoreHour(loc, hour, activity, { species = null, seasonFn = null } = {}) {
  const month = new Date(hour.t).getMonth() + 1;
  const raw = {
    wind: windFactor(hour, loc, activity),
    // estuaries and rivers: ocean wave forecasts don't apply there (not 'unknown')
    waves: loc.estuary ? undefined : wavesFactor(hour, loc, activity),
    tide: tideFactor(hour),
    season: species ? seasonFactor(loc, month, species, seasonFn) : undefined,
    light: activity === 'shore' ? lightFactor(hour) : undefined,
    sst: activity === 'spear' ? sstFactor(hour) : undefined,
    visibility: activity === 'spear' && !loc.estuary ? visFactor(hour, loc) : undefined
  };
  const types = hour.types || {};
  const typeOf = { light: 'calculated', wind: types.wind_speed, waves: types.wave_height ?? types.swell_height, tide: types.tide_rate, sst: types.sst, season: 'curated', terrain: 'curated', access: 'curated', visibility: 'estimated' };

  const weights = WEIGHTS[activity];
  const factors = [];
  const missing = [];
  let sum = 0, wsum = 0;
  for (const [id, w] of Object.entries(weights)) {
    if (raw[id] === undefined) continue; // factor not used for this request (e.g. season without a target species)
    const f = raw[id];
    if (f == null) {
      missing.push(id);
      sum += NEUTRAL * w; wsum += w;
      factors.push({ id, label: LABELS[id], score: null, weight: w, detail: `Unknown — counted as ${NEUTRAL}`, type: 'unknown' });
      continue;
    }
    sum += f.score * w; wsum += w;
    factors.push({ id, label: LABELS[id], score: Math.round(f.score), weight: w, detail: f.detail, type: f.type || typeOf[id] || 'forecast' });
  }
  // No wind or wave forecast: safety can't be judged, so no score at all (shown as Unknown, never as Good)
  const critMissing = CRITICAL[activity].filter(id => missing.includes(id));
  const score = critMissing.length || wsum === 0 ? null : Math.round(sum / wsum);
  if (critMissing.length) return { score, factors, missing, unknownReason: `No ${critMissing.join(' or ')} forecast for this hour — can't check it's safe` };
  return { score, factors, missing };
}

export { terrainFactor, accessFactor };

export function band(score) {
  if (score == null) return 'unknown';
  if (score >= 70) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

export const BAND_LABEL = { good: 'Good', fair: 'Fair', poor: 'Poor', unknown: 'Unknown', blocked: 'Blocked' };

export function explain(result, activity) {
  const known = result.factors.filter(f => f.score != null && !['season'].includes(f.id));
  const pos = [...known].sort((a, b) => b.score - a.score).slice(0, 2).filter(f => f.score >= 60);
  const neg = [...known].sort((a, b) => a.score - b.score).slice(0, 2).filter(f => f.score < 60);
  const plain = { modelled: 'forecast', calculated: 'sun times', estimated: 'estimate', curated: 'checked info', guide: 'seasonal guide, not catch data' };
  const tag = f => `${f.label.toLowerCase()} ${f.detail} (${plain[f.type] || f.type})`;
  const parts = [];
  if (pos.length) parts.push('Helping: ' + pos.map(tag).join('; '));
  if (neg.length) parts.push('Holding back: ' + neg.map(tag).join('; '));
  const season = result.factors.find(f => f.id === 'season' && f.score != null);
  if (season) parts.push(`Target species: ${season.detail}`);
  const unknown = result.factors.filter(f => f.score == null).map(f => f.label.toLowerCase());
  if (unknown.length) parts.push('Unknown (counted as middling): ' + unknown.join(', '));
  if (result.unknownReason) parts.unshift(result.unknownReason);
  return parts.join('. ') + '.';
}

// Environmental suitability scoring (spec: stage-6 §5). Pure functions — no DOM.
import { exposureOf, degToCompass } from './geo.js';

export const WEIGHTS = {
  shore: { wind: 25, waves: 25, tide: 15, season: 15, terrain: 10, access: 10 },
  spear: { wind: 20, waves: 25, visibility: 20, tide: 10, season: 5, terrain: 10, access: 5, sst: 5 }
};

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
    ? { onshore: [8, 30], cross: [12, 35], sheltered: [18, 40], null: [10, 32] }
    : { onshore: [12, 45], cross: [16, 50], sheltered: [22, 55], null: [14, 48] };
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
  const [good, bad] = activity === 'spear' ? [0.5, 1.6] : rock ? [0.8, 2.2] : [1.2, 3.5];
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
  return { score: clamp(score), detail: `${trend} (${(r * 100).toFixed(1)} cm/h)` };
}

function seasonFactor(loc, month, species) {
  const ev = (loc.species_evidence || []).filter(e => !species || e.species === species);
  if (!ev.length) return null;
  const inSeason = ev.some(e => (e.months || []).includes(month));
  return { score: inSeason ? 100 : 50, detail: inSeason ? 'in season (curated evidence)' : 'outside recorded season' };
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

function sstFactor(hour) {
  const t = hour.sst;
  if (t == null) return null;
  const s = t >= 18 && t <= 24 ? 100 : t < 18 ? clamp(100 - (18 - t) * 15) : clamp(100 - (t - 24) * 15);
  return { score: s, detail: `${t.toFixed(1)} °C` };
}

const LABELS = { wind: 'Wind', waves: 'Waves & swell', tide: 'Tide', season: 'Season', terrain: 'Terrain', access: 'Access', sst: 'Sea temperature', visibility: 'Underwater visibility' };

// hour: normalised hourly record; types: { field: 'forecast'|'modelled'|... }
export function scoreHour(loc, hour, activity, { species = null } = {}) {
  const month = new Date(hour.t).getMonth() + 1;
  const raw = {
    wind: windFactor(hour, loc, activity),
    waves: wavesFactor(hour, loc, activity),
    tide: tideFactor(hour),
    season: seasonFactor(loc, month, species),
    terrain: terrainFactor(loc, activity),
    access: accessFactor(loc),
    sst: activity === 'spear' ? sstFactor(hour) : undefined,
    visibility: activity === 'spear' ? null : undefined // no reliable source in v1.0
  };
  const types = hour.types || {};
  const typeOf = { wind: types.wind_speed, waves: types.wave_height ?? types.swell_height, tide: types.tide_rate, sst: types.sst, season: 'curated', terrain: 'curated', access: 'curated', visibility: 'unknown' };

  const weights = WEIGHTS[activity];
  const factors = [];
  const missing = [];
  let sum = 0, wsum = 0;
  for (const [id, w] of Object.entries(weights)) {
    const f = raw[id];
    if (f == null) {
      missing.push(id);
      factors.push({ id, label: LABELS[id], score: null, weight: w, detail: 'Unknown', type: 'unknown' });
      continue;
    }
    sum += f.score * w; wsum += w;
    factors.push({ id, label: LABELS[id], score: Math.round(f.score), weight: w, detail: f.detail, type: typeOf[id] || 'forecast' });
  }
  // Neutral missing-data treatment: weighted mean of known factors only.
  const score = wsum > 0 ? Math.round(sum / wsum) : null;
  return { score, factors, missing };
}

export function band(score) {
  if (score == null) return 'unknown';
  if (score >= 70) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

export const BAND_LABEL = { good: 'Good', fair: 'Fair', poor: 'Poor', unknown: 'Unknown', blocked: 'Blocked' };

export function explain(result, activity) {
  const known = result.factors.filter(f => f.score != null && !['terrain', 'access'].includes(f.id));
  const pos = [...known].sort((a, b) => b.score - a.score).slice(0, 2).filter(f => f.score >= 60);
  const neg = [...known].sort((a, b) => a.score - b.score).slice(0, 2).filter(f => f.score < 60);
  const tag = f => `${f.label.toLowerCase()} ${f.detail} (${f.type})`;
  const parts = [];
  if (pos.length) parts.push('Helping: ' + pos.map(tag).join('; '));
  if (neg.length) parts.push('Holding back: ' + neg.map(tag).join('; '));
  const unknown = result.factors.filter(f => f.score == null).map(f => f.label.toLowerCase());
  if (unknown.length) parts.push('Unknown: ' + unknown.join(', '));
  return parts.join('. ') + '.';
}

// Measured tides (tide gauges) and satellite water clarity, from the hourly "live-data" branch.
import { CONFIG } from './config.js';

const live = async name => {
  if (!CONFIG.GITHUB_REPO) return null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${CONFIG.GITHUB_REPO}/live-data/${name}?t=${Math.floor(Date.now() / 600000)}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
};
export const loadTides = () => live('tides.json');
export const loadClarity = () => live('clarity.json');
const km = (a, b, c, d) => Math.hypot((d - b) * Math.cos(a * Math.PI / 180), c - a) * 111;

// ---- Measured tide ----------------------------------------------------------------------------------------
// How far the real tide is from the forecast right now: (measured - forecast) at the latest hour, minus the
// average difference over the last day (that removes the gauge's datum, which isn't mean sea level).
// modelHours: normalised forecast hours (with sea_level) for the coast point nearest the gauge.
export function tideCheck(tides, lat, lng, modelHoursFor) {
  if (!tides?.stations?.length) return null;
  const st = tides.stations.map(s => ({ s, d: km(lat, lng, s.lat, s.lng) })).sort((a, b) => a.d - b.d)[0];
  if (!st || st.d > 120) return null;   // further away the surge and tide timing differ too much to be useful
  const s = st.s, model = modelHoursFor(s.lat, s.lng);
  if (!model?.length) return null;
  const byT = new Map(model.filter(h => h.sea_level != null).map(h => [h.t, h.sea_level]));
  const pairs = s.hourly.filter(([t]) => byT.has(t)).map(([t, v]) => [t, v - byT.get(t), v]);
  if (pairs.length < 8) return null;
  const mean = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
  const last = pairs[pairs.length - 1], prev = s.hourly[s.hourly.length - 2];
  const offset = last[1] - mean;
  const trend = prev ? s.hourly[s.hourly.length - 1][1] - prev[1] : 0;
  const rms = Math.sqrt(pairs.reduce((a, p) => a + (p[1] - mean) ** 2, 0) / pairs.length);
  // a gauge inside a harbour can differ from the open-coast forecast in shape, not just height: only trust a steady match
  const usable = rms < 0.25 && Math.abs(offset) < 0.5;
  return { station: s.name, km: st.d, at: last[0], ageH: (Date.now() - last[0]) / 3600e3, offset: usable ? offset : 0, rawOffset: offset, trend, rms, usable };
}
export function tideCheckText(tc) {
  if (!tc || tc.ageH > 6) return '';
  const dir = tc.trend > 0.015 ? 'rising' : tc.trend < -0.015 ? 'falling' : 'about steady';
  if (!tc.usable) return `Measured tide (${tc.station} gauge, ${Math.round(tc.km)} km): ${dir}. (It doesn't line up well with the forecast model today, so depths use the forecast.)`;
  const off = Math.abs(tc.offset) < 0.05 ? 'matching the forecast' : `${Math.round(Math.abs(tc.offset) * 100)} cm ${tc.offset > 0 ? 'higher' : 'lower'} than forecast`;
  return `Measured tide (${tc.station} gauge, ${Math.round(tc.km)} km): ${dir}, ${off}${Math.abs(tc.offset) >= 0.05 ? ' — the depths below include this' : ''}.`;
}

// ---- Satellite water clarity -------------------------------------------------------------------------------
// Kd490 (light attenuation, 1/m): lower = clearer. Rough diver visibility bands for WA coastal water.
export const CLARITY_BANDS = [
  { max: 0.05, key: 'vclear', label: 'Very clear', vis: '15 m+', color: '#2ee6ff', alpha: 0.55 },
  { max: 0.08, key: 'clear', label: 'Clear', vis: '10–15 m', color: '#3df5a6', alpha: 0.6 },
  { max: 0.15, key: 'ok', label: 'OK', vis: '5–10 m', color: '#f2f25a', alpha: 0.7 },
  { max: 0.3, key: 'murky', label: 'Murky', vis: '2–5 m', color: '#ff9a3c', alpha: 0.8 },
  { max: Infinity, key: 'vmurky', label: 'Very murky', vis: 'under 2 m', color: '#e0442e', alpha: 0.85 }
];
export const clarityBand = kd => CLARITY_BANDS.find(b => kd < b.max);

// nearest valid satellite cell: the ~1 km near-coast grid first (within ~2 km), then the 4 km map (within ~6 km)
function fineIndex(f) {
  if (!f._map) { f._map = new Map(); f.idx.forEach((k, n) => f._map.set(k, n)); }
  return f._map;
}
export function clarityAt(c, lat, lng) {
  if (!c?.kd490) return null;
  const f = c.fine;
  if (f?.idx?.length) {
    const m = fineIndex(f), i0 = Math.floor((lat - f.lat0) / f.d), j0 = Math.floor((lng - f.lon0) / f.d);
    for (let r = 0; r <= 2; r++) {
      let hit = null;
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const n = m.get((i0 + di) * f.nx + (j0 + dj));
        if (n != null && (hit == null || f.age_h[n] < f.age_h[hit])) hit = n;
      }
      if (hit != null) {
        const date = new Date(Date.parse(f.newest) - f.age_h[hit] * 3600e3);
        return { kd: f.kd[hit], band: clarityBand(f.kd[hit]), date, ageDays: (Date.now() - date) / 864e5, fine: true };
      }
    }
  }
  const i0 = Math.round((lat - c.lat0) / c.dlat), j0 = Math.round((lng - c.lon0) / c.dlon);
  let best = null;
  for (let r = 0; r <= 2 && !best; r++)
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= c.ny || j >= c.nx) continue;
      const v = c.kd490[i * c.nx + j];
      if (v != null && (!best || r === 0)) best = v;
    }
  if (best == null) return null;
  const date = c.date ? new Date(c.date) : null;
  return { kd: best, band: clarityBand(best), date, ageDays: date ? (Date.now() - date) / 864e5 : null };
}

// a picture of the grid for the map (one pixel per cell; the map scales it up smoothly)
// Picture of the satellite cells near the coast only (offshore water isn't useful for shore fishing or diving and
// just hides the map). Crisp squares, one colour per band — clear water is see-through, murky water stands out.
export function clarityImage(c, coastPts = [], maxKm = 12) {
  if (c.fine?.idx?.length && c.fine.q) return clarityImageFine(c);
  const S = 6;   // screen pixels per satellite cell in the picture (kept crisp)
  const cv = document.createElement('canvas'); cv.width = c.nx * S; cv.height = c.ny * S;
  const ctx = cv.getContext('2d');
  const grid = new Map(), cell = 0.1, key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const p of coastPts) { const [x, y] = p.geometry ? p.geometry.coordinates : p; const k = key(x, y); (grid.get(k) || grid.set(k, []).get(k)).push([x, y]); }
  const r = Math.ceil(maxKm / 111 / cell) + 1;
  const nearCoast = (x, y) => {
    if (!grid.size) return true;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), k = Math.cos(y * Math.PI / 180);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const [px, py] of grid.get(`${cx + a},${cy + b}`) || [])
      if (Math.hypot((px - x) * k, py - y) * 111 <= maxKm) return true;
    return false;
  };
  for (let i = 0; i < c.ny; i++) for (let j = 0; j < c.nx; j++) {
    const v = c.kd490[i * c.nx + j]; if (v == null) continue;
    if (!nearCoast(c.lon0 + j * c.dlon, c.lat0 + i * c.dlat)) continue;
    const row = c.dlat > 0 ? c.ny - 1 - i : i;   // image rows run north -> south
    const band = clarityBand(v);
    ctx.globalAlpha = band.alpha; ctx.fillStyle = band.color;
    ctx.fillRect(j * S, row * S, S - 1, S - 1);   // 1px gap so neighbouring cells read as separate squares
  }
  const lats = [c.lat0, c.lat0 + c.dlat * (c.ny - 1)], lons = [c.lon0, c.lon0 + c.dlon * (c.nx - 1)];
  const hl = Math.abs(c.dlat) / 2, hw = Math.abs(c.dlon) / 2;
  return { url: cv.toDataURL(), bounds: [[Math.min(...lats) - hl, Math.min(...lons) - hw], [Math.max(...lats) + hl, Math.max(...lons) + hw]] };
}

// ~1 km picture: one pixel per near-coast SEA cell (drawn crisp, see .clarity-img CSS). The pipeline already filled
// cloud gaps: q=1 from neighbouring 1 km cells, q=2 from the 4 km map — drawn fainter so they read as less exact.
// Land cells are never in the grid, so nothing is painted over the land.
function clarityImageFine(c) {
  const f = c.fine, cv = document.createElement('canvas'); cv.width = f.nx; cv.height = f.ny;
  const ctx = cv.getContext('2d');
  const fade = [1, 0.8, 0.5];
  f.idx.forEach((k, n) => {
    const i = Math.floor(k / f.nx), j = k % f.nx, b = clarityBand(f.kd[n]);
    ctx.globalAlpha = b.alpha * (fade[f.q?.[n] ?? 0] ?? 1); ctx.fillStyle = b.color; ctx.fillRect(j, f.ny - 1 - i, 1, 1);
  });
  return { url: cv.toDataURL(), bounds: [[f.lat0, f.lon0], [f.lat0 + f.ny * f.d, f.lon0 + f.nx * f.d]], fine: true };
}

function nearCoastFn(coastPts, maxKm) {
  const grid = new Map(), cell = 0.1, key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const p of coastPts) { const [x, y] = p.geometry ? p.geometry.coordinates : p; const k = key(x, y); (grid.get(k) || grid.set(k, []).get(k)).push([x, y]); }
  const r = Math.ceil(maxKm / 111 / cell) + 1;
  return (x, y) => {
    if (!grid.size) return true;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), k = Math.cos(y * Math.PI / 180);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const [px, py] of grid.get(`${cx + a},${cy + b}`) || [])
      if (Math.hypot((px - x) * k, py - y) * 111 <= maxKm) return true;
    return false;
  };
}

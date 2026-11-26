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
  if (!st || st.d > 220) return null;
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
  { max: 0.05, key: 'vclear', label: 'Very clear', vis: '15 m+', color: '#1f4fd1' },
  { max: 0.08, key: 'clear', label: 'Clear', vis: '10–15 m', color: '#21a0e0' },
  { max: 0.15, key: 'ok', label: 'OK', vis: '5–10 m', color: '#3cc48a' },
  { max: 0.3, key: 'murky', label: 'Murky', vis: '2–5 m', color: '#d8b13a' },
  { max: Infinity, key: 'vmurky', label: 'Very murky', vis: 'under 2 m', color: '#9a5b2e' }
];
export const clarityBand = kd => CLARITY_BANDS.find(b => kd < b.max);

// nearest valid satellite cell within ~6 km (the cell right at the shore is often missing)
export function clarityAt(c, lat, lng) {
  if (!c?.kd490) return null;
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
export function clarityImage(c) {
  const cv = document.createElement('canvas'); cv.width = c.nx; cv.height = c.ny;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(c.nx, c.ny);
  const rgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  for (let i = 0; i < c.ny; i++) for (let j = 0; j < c.nx; j++) {
    const v = c.kd490[i * c.nx + j]; if (v == null) continue;
    const row = c.dlat > 0 ? c.ny - 1 - i : i;   // image rows run north -> south
    const [r, g, b] = rgb(clarityBand(v).color), o = (row * c.nx + j) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 200;
  }
  ctx.putImageData(img, 0, 0);
  const lats = [c.lat0, c.lat0 + c.dlat * (c.ny - 1)], lons = [c.lon0, c.lon0 + c.dlon * (c.nx - 1)];
  const hl = Math.abs(c.dlat) / 2, hw = Math.abs(c.dlon) / 2;
  return { url: cv.toDataURL(), bounds: [[Math.min(...lats) - hl, Math.min(...lons) - hw], [Math.max(...lats) + hl, Math.max(...lons) + hw]] };
}

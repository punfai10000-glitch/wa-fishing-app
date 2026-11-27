// Coastline conditions: sample points every ~8 km from Geraldton to Esperance.
// Each point knows which way the coast faces, so onshore/offshore wind and swell are
// worked out automatically. These are CONDITION points, not verified fishing spots.
import { CONFIG, REGIONS } from './config.js';
import { normalise } from './data.js';

const FORECAST_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation', 'weather_code'];
const MARINE_VARS = ['wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'swell_wave_direction', 'swell_wave_period', 'wind_wave_height', 'sea_surface_temperature', 'sea_level_height_msl', 'ocean_current_velocity', 'ocean_current_direction'];
const CHUNK = 60;

let points = null;

export async function loadCoastPoints() {
  if (points) return points;
  try {
    const r = await fetch('data/coast.json', { cache: 'no-cache' });
    const d = await r.json();
    points = d.points.map(p => ({
      id: p.id,
      name: `Coast near ${p.near}`,
      near: p.near, near_km: p.near_km,
      region: nearestRegion(p.near),
      bioregion: p.bioregion,
      type: 'beach',
      activities: ['shore', 'spear'],
      confidence: 'potential',
      status: 'auto',
      virtual: true,
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      sea: p.sea,
      facing: p.facing,
      exposure: { onshore_dirs: p.onshore_dirs, sheltered_dirs: p.sheltered_dirs },
      terrain: [], access: null, species_evidence: [], restrictions: [], sources: ['natural-earth'], safety_notes: []
    }));
  } catch { points = []; }
  return points;
}

const TOWN_REGION = { 'Kalbarri': 'geraldton', 'Horrocks': 'geraldton', 'Geraldton': 'geraldton', 'Dongara': 'geraldton', 'Port Denison': 'geraldton',
  'Leeman': 'jurien', 'Green Head': 'jurien', 'Jurien Bay': 'jurien', 'Cervantes': 'jurien', 'Wedge Island': 'jurien',
  'Lancelin': 'lancelin', 'Ledge Point': 'lancelin', 'Seabird': 'lancelin', 'Guilderton': 'lancelin', 'Two Rocks': 'perth', 'Yanchep': 'perth', 'Cottesloe': 'perth', 'Fremantle': 'perth', 'Coogee': 'rockingham', 'Rockingham': 'rockingham', 'Secret Harbour': 'rockingham',
  'Mandurah': 'mandurah', 'Dawesville': 'mandurah', 'Preston Beach': 'mandurah', 'Myalup': 'bunbury', 'Bunbury': 'bunbury', 'Busselton': 'busselton',
  'Dunsborough': 'busselton', 'Cape Naturaliste': 'busselton', 'Yallingup': 'margaret-river', 'Gracetown': 'margaret-river', 'Prevelly / Gnarabup': 'margaret-river',
  'Hamelin Bay': 'augusta', 'Augusta': 'augusta', 'Black Point': 'augusta', 'Windy Harbour': 'denmark', 'Walpole': 'denmark', 'Peaceful Bay': 'denmark',
  'Denmark': 'denmark', 'Albany': 'albany', 'Two Peoples Bay': 'albany', 'Cheyne Beach': 'albany', 'Bremer Bay': 'esperance', 'Hopetoun': 'esperance',
  'Starvation Boat Harbour': 'esperance', 'Esperance': 'esperance' };

function nearestRegion(near) {
  if (TOWN_REGION[near]) return TOWN_REGION[near];
  const n = near.toLowerCase();
  const hit = Object.entries(REGIONS).find(([, r]) => n.includes(r.name.toLowerCase()));
  return hit ? hit[0] : null;
}

const url = (base, vars, pts, useSea) => {
  const lat = pts.map(p => (useSea ? p.sea[0] : p.geometry.coordinates[1]).toFixed(3)).join(',');
  const lng = pts.map(p => (useSea ? p.sea[1] : p.geometry.coordinates[0]).toFixed(3)).join(',');
  return `${base}?latitude=${lat}&longitude=${lng}&hourly=${vars.join(',')}&forecast_days=3&past_days=2&timeformat=unixtime&timezone=Australia%2FPerth&wind_speed_unit=kmh`;
};

async function getJson(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}

// The hourly GitHub workflow fetches every coast point once and publishes one file (pipeline/fetch_coast_forecast.py),
// so phones don't each send ~700 Open-Meteo calls (that trips Open-Meteo's free limits and the map goes "?").
async function fromLiveFile(pts, allowStale = false) {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${CONFIG.GITHUB_REPO}/live-data/coast_forecast.json?t=${Math.floor(Date.now() / 600000)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const old = Date.now() - Date.parse(d.generated_at) > 4 * 3600e3;   // GitHub often runs the hourly job 1–2 h late
    if (old && !allowStale) return null;   // stale: ask Open-Meteo directly first
    const byId = {};
    const obj = (vars, arrs, [la, ln]) => arrs ? { latitude: la, longitude: ln, hourly: Object.fromEntries([['time', d.time], ...vars.map((v, i) => [v, arrs[i]])]) } : undefined;
    for (const p of pts) {
      const e = d.points[p.id];
      if (!e) continue;
      byId[p.id] = normalise(obj(d.f_vars, e.f, e.ll), obj(d.m_vars, e.m, e.sea));
    }
    if (Object.keys(byId).length < pts.length * 0.8) return null;
    return { byId, fetchedAt: Date.parse(d.generated_at), errors: [], source: 'live' };
  } catch { return null; }
}

let cache = null;
// Returns { byId, fetchedAt, errors }
export async function loadCoastConditions(force = false) {
  const pts = await loadCoastPoints();
  if (cache && !force && Date.now() - (cache.loadedAt || cache.fetchedAt) < CONFIG.REFRESH_MINUTES * 60000) return cache;
  const live = await fromLiveFile(pts);
  if (live) { live.loadedAt = Date.now(); cache = live; return cache; }
  const byId = {};
  const errors = [];
  for (let i = 0; i < pts.length; i += CHUNK) {
    const chunk = pts.slice(i, i + CHUNK);
    const [f, m] = await Promise.allSettled([
      getJson(url(CONFIG.OPEN_METEO_FORECAST, FORECAST_VARS, chunk, false)),
      getJson(url(CONFIG.OPEN_METEO_MARINE, MARINE_VARS, chunk, true))
    ]);
    if (f.status !== 'fulfilled') errors.push('coast weather');
    if (m.status !== 'fulfilled') errors.push('coast marine');
    chunk.forEach((p, k) => {
      byId[p.id] = normalise(f.value?.[k], m.value?.[k]);
    });
  }
  const ok = Object.values(byId).some(h => h.length);
  if (!ok) {   // Open-Meteo unreachable too (offline or limited): an older hourly file still beats nothing
    const stale = await fromLiveFile(pts, true);
    if (stale) { stale.loadedAt = Date.now(); stale.errors = ['coast forecast is from an older update']; cache = stale; return cache; }
  }
  cache = ok ? { byId, fetchedAt: Date.now(), loadedAt: Date.now(), errors: [...new Set(errors)] } : (cache ?? { byId: {}, fetchedAt: null, errors: [errors.length ? 'coast data unavailable — Open-Meteo may be limiting requests from this device; try again in an hour' : 'coast data unavailable'] });
  return cache;
}

export function nearestCoastPoint(lat, lng, maxKm = 15) {
  if (!points) return null;
  let best = null;
  for (const p of points) {
    const [x, y] = p.geometry.coordinates;
    const d = Math.hypot((x - lng) * Math.cos(lat * Math.PI / 180), y - lat) * 111;
    if (!best || d < best.d) best = { d, p };
  }
  return best && best.d <= maxKm ? best : null;
}

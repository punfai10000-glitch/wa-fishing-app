// Loads curated data and live forecasts; normalises everything into hourly records
// where each field carries its data type (forecast / modelled / unknown).
import { CONFIG } from './config.js';
import * as store from './storage.js';

async function json(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

export async function loadStatic() {
  const [loc, species, rules, thresholds, zones, sources] = await Promise.all([
    json('data/locations.json'), json('data/species.json'), json('data/rules.json'),
    json('data/thresholds.json'), json('data/zones/marine-parks.geojson'), json('data/sources.json')
  ]);
  // Official DPIRD fishing orders (sanctuaries, wrecks, closures) on top of the park outlines
  try {
    const cl = await json('data/zones/closures.geojson');
    for (const f of zones?.features || []) if (/rottnest/i.test(f.properties?.name || '') && f.properties.zone_type === 'marine_park')
      Object.assign(f.properties, { prohibits: ['spear'], note: 'Spearfishing is prohibited within the Rottnest Island Marine Reserve (Rottnest Island Authority).', link: 'https://www.ria.wa.gov.au/boating/plan-your-boat-trip/respecting-the-environment' });
    if (cl?.features?.length && zones) { zones.features = [...cl.features, ...(zones.features || [])]; zones.covers_parks = cl.covers_parks || []; zones.closures_generated_at = cl.generated_at; zones.sanctuaries_mapped = true; }
  } catch { /* closures not downloaded yet: park outlines only */ }
  // South Coast Marine Park zones (Mamang Maambakoort, Wudjari) traced from the DBCA zoning maps
  try {
    const sc = await json('data/zones/south-coast.geojson');
    if (sc?.features?.length && zones) { zones.features = [...sc.features, ...(zones.features || [])]; zones.covers_parks = [...(zones.covers_parks || []), ...(sc.covers_parks || [])]; }
  } catch { /* not there: those parks keep the 'check the map' caution */ }
  return { locations: loc.locations, species, rules: rules.rules, ruleGuide: rules.guide, ruleLinks: rules.official_links, thresholds: thresholds.thresholds, thresholdSources: thresholds.sources || [], zones, sources: sources.sources };
}

const FORECAST_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl'];
const MARINE_VARS = ['wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'swell_wave_direction', 'swell_wave_period', 'wind_wave_height', 'sea_surface_temperature', 'sea_level_height_msl', 'ocean_current_velocity', 'ocean_current_direction'];

// Marine models have no data on land cells, and shore pins sit right on the coastline.
// So waves/tide/sea temp are read ~3 km offshore, in front of the spot (fixes "Unknown" waves & tide).
export function seaPointFor(loc, coastPoints = []) {
  if (loc.sea) return loc.sea;
  const [lng, lat] = loc.geometry.coordinates;
  let best = null;
  for (const p of coastPoints) {
    const [x, y] = p.geometry.coordinates;
    const d = Math.hypot((x - lng) * Math.cos(lat * Math.PI / 180), y - lat) * 111;
    if (!best || d < best.d) best = { d, p };
  }
  return best && best.d < 15 ? best.p.sea : [lat, lng];
}

function buildUrl(base, vars, locations, coastPoints = null) {
  const pts = locations.map(l => coastPoints ? seaPointFor(l, coastPoints) : [l.geometry.coordinates[1], l.geometry.coordinates[0]]);
  const lat = pts.map(p => p[0].toFixed(4)).join(',');
  const lng = pts.map(p => p[1].toFixed(4)).join(',');
  return `${base}?latitude=${lat}&longitude=${lng}&hourly=${vars.join(',')}&forecast_days=7&past_days=2&timeformat=unixtime&timezone=Australia%2FPerth&wind_speed_unit=kmh`;
}

const asArray = x => Array.isArray(x) ? x : [x];

/** Forecast for ONE exact point (map taps). Weather at the point itself, marine at loc.sea. Not cached. */
export async function loadPointConditions(loc) {
  const errors = [];
  const [f, m] = await Promise.allSettled([
    json(buildUrl(CONFIG.OPEN_METEO_FORECAST, FORECAST_VARS, [loc])),
    json(buildUrl(CONFIG.OPEN_METEO_MARINE, MARINE_VARS, [loc], []))
  ]);
  if (f.status !== 'fulfilled') errors.push('Weather forecast unavailable');
  if (m.status !== 'fulfilled') errors.push('Marine forecast unavailable');
  if (f.status !== 'fulfilled' && m.status !== 'fulfilled') return null;
  return finish({ fetchedAt: Date.now(), forecast: f.status === 'fulfilled' ? asArray(f.value) : null,
    marine: m.status === 'fulfilled' ? asArray(m.value) : null }, [loc], errors);
}

/**
 * Returns { byId: {locId: hours[]}, fetchedAt, stale, errors[] }
 * Uses cache when fresh; falls back to cache (marked stale) when offline.
 */
export async function loadConditions(locations, { force = false, coastPoints = [] } = {}) {
  const cached = store.get('conditions');
  const ids = 'v3|' + locations.map(l => l.id).join('|');
  const fresh = cached && cached.ids === ids && Date.now() - cached.fetchedAt < CONFIG.REFRESH_MINUTES * 60000;
  if (fresh && !force) return finish(cached, locations, []);

  const errors = [];
  let forecast = null, marine = null;
  const [f, m] = await Promise.allSettled([
    json(buildUrl(CONFIG.OPEN_METEO_FORECAST, FORECAST_VARS, locations)),
    json(buildUrl(CONFIG.OPEN_METEO_MARINE, MARINE_VARS, locations, coastPoints))
  ]);
  if (f.status === 'fulfilled') forecast = asArray(f.value); else errors.push('Weather forecast unavailable');
  if (m.status === 'fulfilled') marine = asArray(m.value); else errors.push('Marine forecast unavailable');

  if (!forecast && !marine) {
    if (cached && cached.ids === ids) return finish(cached, locations, errors, true);
    return { byId: {}, fetchedAt: null, stale: true, errors };
  }
  const payload = {
    ids, fetchedAt: Date.now(),
    forecast: forecast ?? cached?.forecast ?? null,
    marine: marine ?? cached?.marine ?? null,
    partial: errors.length > 0
  };
  store.set('conditions', payload);
  return finish(payload, locations, errors);
}

function finish(payload, locations, errors, forceStale = false) {
  const byId = {};
  locations.forEach((loc, i) => {
    byId[loc.id] = normalise(payload.forecast?.[i], payload.marine?.[i]);
  });
  const ageH = (Date.now() - payload.fetchedAt) / 3600000;
  return { byId, fetchedAt: payload.fetchedAt, stale: forceStale || ageH > CONFIG.STALE_HOURS, errors };
}

const num = v => (v == null || Number.isNaN(v) ? null : v);

// The marine model's tide runs early on this coast: checked against the official AHO predictions for Oct–Dec 2026,
// highs and lows come this many minutes later than the model says (median of ~150 highs/lows per port).
const TIDE_LAG = [
  { lat: -28.78, lng: 114.60, min: 33 },   // Geraldton (also Dongara, Jurien)
  { lat: -32.05, lng: 115.74, min: 49 },   // Fremantle (also Perth metro)
  { lat: -33.32, lng: 115.65, min: 58 },   // Bunbury
  { lat: -35.03, lng: 117.88, min: 34 },   // Albany
  { lat: -33.87, lng: 121.90, min: 28 }    // Esperance
];
export function tideLagMin(lat, lng) {
  if (lat == null || lng == null) return 0;
  let best = null;
  for (const p of TIDE_LAG) { const d = Math.hypot((p.lng - lng) * Math.cos(lat * Math.PI / 180), p.lat - lat); if (!best || d < best.d) best = { d, p }; }
  return best.p.min;
}

export function normalise(fc, mr) {
  const map = new Map();
  const add = (src, fields, type) => {
    if (!src?.hourly?.time) return;
    src.hourly.time.forEach((sec, i) => {
      const t = sec * 1000;
      const rec = map.get(t) ?? { t, types: {} };
      for (const [from, to] of fields) {
        const v = num(src.hourly[from]?.[i]);
        rec[to] = v;
        rec.types[to] = v == null ? 'unknown' : type;
      }
      map.set(t, rec);
    });
  };
  add(fc, [['wind_speed_10m', 'wind_speed'], ['wind_direction_10m', 'wind_direction'], ['wind_gusts_10m', 'wind_gust'], ['precipitation', 'precipitation'], ['weather_code', 'weather_code'], ['cloud_cover', 'cloud_cover'], ['pressure_msl', 'pressure']], 'forecast');
  add(mr, [['wave_height', 'wave_height'], ['wave_direction', 'wave_direction'], ['wave_period', 'wave_period'], ['swell_wave_height', 'swell_height'], ['swell_wave_direction', 'swell_direction'], ['swell_wave_period', 'swell_period'], ['wind_wave_height', 'wind_wave_height']], 'forecast');
  add(mr, [['sea_surface_temperature', 'sst'], ['sea_level_height_msl', 'sea_level'], ['ocean_current_velocity', 'current_speed'], ['ocean_current_direction', 'current_direction']], 'modelled');

  const hours = [...map.values()].sort((a, b) => a.t - b.t);
  // shift the modelled tide later to match the official tide times (see TIDE_LAG)
  const lag = tideLagMin(mr?.latitude ?? fc?.latitude, mr?.longitude ?? fc?.longitude);
  if (lag > 0 && lag < 60) {
    const raw = hours.map(h => h.sea_level), f = lag / 60;
    hours.forEach((h, i) => {
      const a = raw[i - 1], b = raw[i];
      if (a != null && b != null && hours[i].t - hours[i - 1].t === 3600e3) h.sea_level = +(b - (b - a) * f).toFixed(3);
      else if (i === 0 || a == null) { h.sea_level = null; h.types.sea_level = 'unknown'; }
    });
  }
  // Tide trend from modelled sea level (centred difference, m/h)
  hours.forEach((h, i) => {
    const prev = hours[i - 1], next = hours[i + 1];
    if (prev?.sea_level != null && next?.sea_level != null) {
      h.tide_rate = (next.sea_level - prev.sea_level) / 2;
      h.types.tide_rate = 'modelled';
    } else { h.tide_rate = null; h.types.tide_rate = 'unknown'; }
  });
  return hours;
}

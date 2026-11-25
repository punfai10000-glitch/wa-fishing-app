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
  return { locations: loc.locations, species, rules: rules.rules, ruleLinks: rules.official_links, thresholds: thresholds.thresholds, zones, sources: sources.sources };
}

const FORECAST_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl'];
const MARINE_VARS = ['wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'swell_wave_direction', 'swell_wave_period', 'wind_wave_height', 'sea_surface_temperature', 'sea_level_height_msl', 'ocean_current_velocity', 'ocean_current_direction'];

function buildUrl(base, vars, locations) {
  const lat = locations.map(l => l.geometry.coordinates[1].toFixed(4)).join(',');
  const lng = locations.map(l => l.geometry.coordinates[0].toFixed(4)).join(',');
  return `${base}?latitude=${lat}&longitude=${lng}&hourly=${vars.join(',')}&forecast_days=7&past_hours=3&timeformat=unixtime&timezone=Australia%2FPerth&wind_speed_unit=kmh`;
}

const asArray = x => Array.isArray(x) ? x : [x];

/**
 * Returns { byId: {locId: hours[]}, fetchedAt, stale, errors[] }
 * Uses cache when fresh; falls back to cache (marked stale) when offline.
 */
export async function loadConditions(locations, { force = false } = {}) {
  const cached = store.get('conditions');
  const ids = locations.map(l => l.id).join('|');
  const fresh = cached && cached.ids === ids && Date.now() - cached.fetchedAt < CONFIG.REFRESH_MINUTES * 60000;
  if (fresh && !force) return finish(cached, locations, []);

  const errors = [];
  let forecast = null, marine = null;
  const [f, m] = await Promise.allSettled([
    json(buildUrl(CONFIG.OPEN_METEO_FORECAST, FORECAST_VARS, locations)),
    json(buildUrl(CONFIG.OPEN_METEO_MARINE, MARINE_VARS, locations))
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
  add(mr, [['wave_height', 'wave_height'], ['wave_direction', 'wave_direction'], ['wave_period', 'wave_period'], ['swell_wave_height', 'swell_height'], ['swell_wave_direction', 'swell_direction'], ['swell_wave_period', 'swell_period'], ['wind_wave_height', 'wind_wave_height'], ['ocean_current_velocity', 'current_velocity'], ['ocean_current_direction', 'current_direction']], 'forecast');
  add(mr, [['sea_surface_temperature', 'sst'], ['sea_level_height_msl', 'sea_level']], 'modelled');

  const hours = [...map.values()].sort((a, b) => a.t - b.t);
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

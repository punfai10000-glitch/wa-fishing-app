// MEASURED wave buoys (WA Dept of Transport via AODN), produced hourly by the
// "Live data" GitHub Action and published to the repo's `live-data` branch.
import { CONFIG } from './config.js';

let cache = null;
export async function loadBuoys(force = false) {
  if (cache && !force && Date.now() - cache.loadedAt < 15 * 60000) return cache.data;
  const urls = [];
  if (CONFIG.GITHUB_REPO) urls.push(`https://raw.githubusercontent.com/${CONFIG.GITHUB_REPO}/live-data/buoys.json`);
  urls.push('data/buoys.json');
  for (const u of urls) {
    try {
      const r = await fetch(`${u}?t=${Math.floor(Date.now() / 300000)}`);
      if (!r.ok) continue;
      const d = await r.json();
      if (Array.isArray(d.buoys) && d.buoys.length) { cache = { loadedAt: Date.now(), data: d }; return d; }
    } catch { /* try next */ }
  }
  cache = { loadedAt: Date.now(), data: null };
  return null;
}

export function nearestBuoy(data, lat, lng, maxKm = 120) {
  if (!data) return null;
  let best = null;
  for (const b of data.buoys) {
    const d = Math.hypot((b.lon - lng) * Math.cos(lat * Math.PI / 180), b.lat - lat) * 111;
    if (d <= maxKm && (!best || d < best.d)) best = { d, b };
  }
  return best;
}

// MEASURED wind from BOM automatic weather stations (same live-data branch).
let bomCache = null;
export async function loadBomObs(force = false) {
  if (bomCache && !force && Date.now() - bomCache.loadedAt < 15 * 60000) return bomCache.data;
  let data = null;
  if (CONFIG.GITHUB_REPO) {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${CONFIG.GITHUB_REPO}/live-data/bom_obs.json?t=${Math.floor(Date.now() / 300000)}`);
      if (r.ok) { const d = await r.json(); if (d.stations?.length) data = d; }
    } catch { /* offline or not set up */ }
  }
  bomCache = { loadedAt: Date.now(), data };
  return data;
}

export function nearestStation(data, lat, lng, maxKm = 60) {
  if (!data) return null;
  let best = null;
  for (const s of data.stations) {
    const d = Math.hypot((s.lon - lng) * Math.cos(lat * Math.PI / 180), s.lat - lat) * 111;
    if (d <= maxKm && (!best || d < best.d)) best = { d, s };
  }
  return best;
}

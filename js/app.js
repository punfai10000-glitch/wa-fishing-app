import { loadStatic, loadConditions } from './data.js';
import { loadShore, snapPinsToShore } from './shore.js';
import { evaluate } from './engine.js';
import * as store from './storage.js';
import { fmtAge } from './units.js';
import { esc } from './ui.js';
import { initMap, refreshMap, showMap } from './map.js';
import { initSheet, closeSheet } from './sheet.js';
import { renderSpots } from './views/spots.js';
import { renderKey } from './views/key.js';
import { renderLocation } from './views/location.js';
import { renderFish } from './views/fish.js';
import { renderLive } from './views/live.js';
import { renderMore } from './views/more.js';
import { loadCoastPoints, loadCoastConditions } from './coast.js';
import { loadBuoys, loadBomObs } from './buoys.js';
import { loadTargets } from './targets.js';
import { zoneHitsFor } from './zones.js';
import { loadOsmSpots } from './osmspots.js';
import { setCoastPoints } from './amenities.js';

export const state = {
  data: null,
  cond: { byId: {}, fetchedAt: null, stale: true, errors: [] },
  coast: { points: [], byId: {}, fetchedAt: null, errors: [] },
  buoys: null,
  bom: null,
  osmSpots: [],
  tapLoc: null, tapCond: null,
  showOsm: store.get('showOsm', true),
  activity: store.get('activity', 'shore'),
  species: '',
  region: '',
  favOnly: false,
  loading: true,
  evalCache: new Map()
};

const sunFn = (d, lat, lng) => window.SunCalc.getTimes(d, lat, lng);

export function getLoc(id) {
  if (state.tapLoc && state.tapLoc.id === id) return state.tapLoc;
  return state.data.locations.find(l => l.id === id) || state.osmSpots.find(p => p.id === id) || state.coast.points.find(p => p.id === id) || null;
}

export function evalFor(loc, activity = state.activity) {
  const src = loc.tap && state.tapCond ? state.tapCond : loc.virtual || loc.condFrom ? state.coast : state.cond;
  const key = `${loc.id}|${activity}|${state.species}|${src.fetchedAt}`;
  if (!state.evalCache.has(key)) {
    state.evalCache.set(key, evaluate(loc, src.byId[loc.condFrom || loc.id], activity, {
      thresholds: state.data.thresholds, rules: state.data.rules, zones: state.data.zones,
      staleSources: state.cond.stale ? 1 : 0, sunFn, species: state.species || null,
      zoneHits: l => zoneHitsFor(state.data.zones, l)
    }));
  }
  return state.evalCache.get(key);
}

export function visibleLocations() {
  const favs = store.favourites();
  const all = state.showOsm ? [...state.data.locations, ...state.osmSpots] : state.data.locations;
  return all.filter(l =>
    (!state.region || l.region === state.region) &&
    (!state.favOnly || favs.has(l.id)) &&
    (!state.species || (l.species_evidence || []).some(e => e.species === state.species))
  );
}

export function setActivity(a) {
  state.activity = a;
  state.mapView = 'spots';
  store.set('activity', a);
  syncToggles();
  rerender();
}

// Map views: Fishing / Spear show spots & conditions; Weather shows only wind, swell and buoys.
export function syncToggles() {
  document.querySelectorAll('[data-activity-toggle] button').forEach(b => b.setAttribute('aria-pressed',
    String(b.dataset.view ? state.mapView === b.dataset.view : state.mapView !== 'weather' && b.dataset.activity === state.activity)));
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-activity-toggle] button');
  if (!btn) return;
  if (btn.dataset.view) { state.mapView = btn.dataset.view; syncToggles(); rerender(); }
  else setActivity(btn.dataset.activity);
});

function banners() {
  const out = [];
  const d = state.data;
  if (!navigator.onLine) out.push(['warn', 'You are offline. Showing the last data saved on this device.']);
  if (state.cond.fetchedAt && state.cond.stale) out.push(['warn', `Forecast data is out of date (updated ${fmtAge(state.cond.fetchedAt)}). Scores have lower confidence.`]);
  if (!state.loading && !state.cond.fetchedAt) out.push(['danger', 'Forecast data could not be loaded. Conditions and scores are Unknown.', null, 'retry']);
  if (state.cond.fetchedAt) for (const err of state.cond.errors || []) out.push(['warn', `${err}. Affected values show as Unknown.`]);
  if (d && d.locations.some(l => l.status === 'demo')) out.push(['info', 'Early preview: spot details are still being verified. Treat locations as approximate.', 'demo']);
  if (d && d.thresholds.some(t => t.status === 'draft')) out.push(['info', 'Safety limits are drafts pending review. Always judge conditions on site.', 'draft']);
  else if (d && d.thresholds.some(t => t.status === 'researched')) out.push(['info', 'Safety limits follow BOM, Transport WA and Recfishwest guidance, but nobody has checked them on site. Always judge conditions yourself.', 'researched']);
  const dismissed = new Set(store.get('dismissed', []));
  const shown = out.filter(([, , key]) => !key || !dismissed.has(key));
  const urgent = shown.filter(([cls]) => cls !== 'info'), info = shown.filter(([cls]) => cls === 'info');
  document.getElementById('banners').innerHTML =
    urgent.map(([cls, msg, key, act]) => `<div class="banner ${cls}"><span>${esc(msg)}</span>${act === 'retry' ? '<button data-retry class="btn ghost">Retry</button>' : ''}${key ? `<button data-dismiss="${key}" aria-label="Dismiss">✕</button>` : ''}</div>`).join('') +
    (info.length ? `<details class="banner info banner-fold"><summary>ℹ Early version — ${info.length} note${info.length > 1 ? 's' : ''} (tap)</summary>${info.map(([, msg]) => `<p>${esc(msg)}</p>`).join('')}
      <button data-dismiss="${info.map(i => i[2]).join(',')}" class="btn ghost">Got it, hide</button></details>` : '');
}

document.getElementById('banners').addEventListener('click', e => {
  if (e.target.closest('[data-retry]')) { e.target.closest('[data-retry]').textContent = 'Retrying…'; refreshConditions(true); return; }
  const k = e.target.closest('[data-dismiss]')?.dataset.dismiss;
  if (!k) return;
  store.set('dismissed', [...new Set([...store.get('dismissed', []), ...k.split(',')])]);
  banners();
});

const ROUTES = {
  map: () => null,
  spots: renderSpots,
  live: renderLive,
  fish: renderFish,
  fishid: (v) => renderFish(v, 'id'),
  rules: (v) => renderFish(v, 'rules'),
  more: renderMore,
  key: renderKey,
  loc: renderLocation
};

function route() {
  const [, name = 'map', arg] = (location.hash || '#/map').split('/');
  const view = document.getElementById('view');
  // 5 tabs: Map · Forecast (spots, live, spot pages) · Species (fish, ID, rules) · Learn (key) · My Fishing (more)
  const tab = ({ loc: 'spots', live: 'spots', fishid: 'fish', rules: 'fish' }[name] || name);
  if (name !== 'loc') try { sessionStorage.setItem('lastTab', name); } catch { /* ignore */ }
  document.querySelectorAll('#tabbar a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

  if (name === 'map' || !ROUTES[name]) {
    view.hidden = true;
    showMap(true);
    return;
  }
  closeSheet(true);
  showMap(false);
  view.hidden = false;
  if (!state.data) { view.innerHTML = '<p class="muted">Loading…</p>'; return; }
  view.innerHTML = '';
  view.scrollTop = 0;
  ROUTES[name](view, arg);
}

export function rerender() {
  state.evalCache.clear();
  banners();
  if (state.data) refreshMap();
  const [, name = 'map'] = (location.hash || '#/map').split('/');
  if (name !== 'map') route();
}

async function refreshConditions(force = false) {
  state.cond = await loadConditions(state.data.locations, { force, coastPoints: state.coast.points });
  state.loading = false;
  rerender();
  // Coastline + measured buoys load after the main spots so the app is usable sooner
  const [coast, buoys, bom] = await Promise.all([loadCoastConditions(force), loadBuoys(force), loadBomObs(force)]);
  state.coast = { points: state.coast.points, ...coast };
  state.buoys = buoys;
  state.bom = bom;
  rerender();
}

async function boot() {
  const ack = document.getElementById('ack');
  if (!store.get('ack')) {
    ack.showModal?.();
    document.getElementById('ack-ok').addEventListener('click', () => { store.set('ack', Date.now()); ack.close(); });
  }
  syncToggles();
  try {
    state.data = await loadStatic();
    await loadTargets();
    state.coast.points = await loadCoastPoints();
    setCoastPoints(state.coast.points);
    state.osmSpots = await loadOsmSpots(state.coast.points);
    await loadShore();
    snapPinsToShore([...state.data.locations, ...state.osmSpots]);
  } catch (e) {
    document.getElementById('banners').innerHTML = `<div class="banner danger"><span>Could not load app data (${esc(e.message)}). Check your connection.</span><button onclick="location.reload()">Retry</button></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  try { initSheet(); initMap(); }
  catch (e) {
    console.error(e);
    document.getElementById('banners').insertAdjacentHTML('afterbegin', `<div class="banner danger"><span>The map couldn't start (${esc(e.message)}). Pull down to refresh, or close and reopen the app.</span><button onclick="location.reload()">Reload</button></div>`);
  }
  route();
  banners();
  await refreshConditions();
  setInterval(() => refreshConditions(), 15 * 60 * 1000);
  window.addEventListener('online', () => refreshConditions(true));
  window.addEventListener('offline', banners);
}

export const actions = { refresh: () => refreshConditions(true) };

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();

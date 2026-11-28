import { loadStatic, loadConditions } from './data.js';
import { loadShore, snapPinsToShore } from './shore.js';
import { evaluate } from './engine.js';
import * as store from './storage.js';
import { fmtAge } from './units.js';
import { esc } from './ui.js';
import { initMap, refreshMap, showMap } from './map.js';
import { initSheet, closeSheet } from './sheet.js';
import { renderLocation } from './views/location.js';
import { loadCoastPoints, loadCoastConditions, nearestCoastPoint } from './coast.js';
import { loadBuoys, loadBomObs, nearestStation } from './buoys.js';
import { loadBomWarnings, warningsAt, loadLiveStatus } from './bomwarn.js';
import { loadTides, loadClarity, clarityAt } from './ocean.js';
import { loadTargets, seasonGuide, guideCovers } from './targets.js';
import { zoneHitsFor, legalStatus } from './zones.js';
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
  let src = loc.tap && state.tapCond ? state.tapCond : loc.virtual || loc.condFrom ? state.coast : state.cond;
  let id = loc.condFrom || loc.id;
  // a spot's own forecast didn't load (e.g. Open-Meteo limiting this device): use the nearest coast point's hourly file
  if (src === state.cond && !state.cond.byId?.[loc.id]?.length && state.coast?.byId) {
    const n = nearestCoastPoint(loc.geometry.coordinates[1], loc.geometry.coordinates[0], 15);
    if (n && state.coast.byId[n.p.id]?.length) { src = state.coast; id = n.p.id; }
  }
  const key = `${loc.id}|${activity}|${state.species}|${src.fetchedAt}|${id}|${state.bomWarn?.fetched_at || ''}|${state.bom?.generated_at || ''}`;
  if (!state.evalCache.has(key)) {
    // satellite water clarity for this spot (used by the spearfishing visibility estimate)
    if (state.clarity && loc._satFor !== (state.clarity.fine?.newest || state.clarity.date)) {
      const [lng, lat] = loc.geometry.coordinates;
      loc.sat = loc.estuary ? null : clarityAt(state.clarity, loc.sea?.[0] ?? lat, loc.sea?.[1] ?? lng); loc._satFor = state.clarity.fine?.newest || state.clarity.date;
    }
    state.evalCache.set(key, evaluate(loc, src.byId[id], activity, {
      thresholds: state.data.thresholds, rules: state.data.rules, zones: state.data.zones,
      staleSources: ((src === state.cond ? state.cond.stale : !src.fetchedAt || Date.now() - src.fetchedAt > 4 * 3600e3) ? 1 : 0) + (Object.values(state.liveStatus?.sources || {}).some(v => v.critical && v.state !== 'ok') ? 1 : 0), sunFn, species: state.species || null,
      seasonFn: (l, m, sp) => seasonGuide(l, m, sp, activity),
      warningsFn: (l, t) => warningsAt(state.bomWarn, l.geometry.coordinates[1], l.geometry.coordinates[0], t),
      legalFn: (l, a) => legalStatus(state.data.zones, l, a),
      measuredFn: l => measuredWindNear(l),
      zoneHits: l => zoneHitsFor(state.data.zones, l)
    }));
  }
  return state.evalCache.get(key);
}

// BOM station measuring wind within 25 km of the spot, reading less than 90 minutes old
function measuredWindNear(loc) {
  const st = nearestStation(state.bom, loc.geometry.coordinates[1], loc.geometry.coordinates[0], 25);
  if (!st || st.s.wind_kmh == null || !(Date.now() - Date.parse(st.s.time) < 90 * 60000)) return null;
  return { site: st.s.site, km: st.d, wind_kmh: st.s.wind_kmh, gust_kmh: st.s.gust_kmh ?? null, time: st.s.time };
}

export function visibleLocations({ ignoreRegion = false } = {}) {
  const favs = store.favourites();
  const all = state.showOsm ? [...state.data.locations, ...state.osmSpots] : state.data.locations;
  return all.filter(l =>
    (ignoreRegion || !state.region || l.region === state.region) &&
    (!state.favOnly || favs.has(l.id)) &&
    (!state.species || (l.species_evidence || []).some(e => e.species === state.species) || guideCovers(l, state.species, state.activity))
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
  if (!state.loading && !state.cond.fetchedAt && !state.coast?.fetchedAt) out.push(['danger', 'Forecast data could not be loaded. Conditions and scores are Unknown.', null, 'retry']);
  if (state.cond.fetchedAt) for (const err of state.cond.errors || []) out.push(['warn', `${err}. Affected values show as Unknown.`]);
  // hourly live data: per-source age from status.json (the hourly job keeps old files when a source fails)
  const ls = state.liveStatus;
  if (ls) {
    const runAge = (Date.now() - Date.parse(ls.generated_at)) / 3600e3;
    const NAMES = { coast_forecast: 'coast forecast', bom_warnings: 'BOM wind warnings', bom_obs: 'BOM measured wind', buoys: 'wave buoys', tides: 'measured tide', clarity: 'water clarity' };
    if (runAge > 3) out.push(['warn', `Live data hasn't updated for ${Math.round(runAge)} hours (the hourly job may be paused). Measured values and warnings may be out of date.`]);
    else {
      const bad = Object.entries(ls.sources || {}).filter(([, v]) => v.state !== 'ok');
      if (bad.length) out.push(['warn', `Out of date: ${bad.map(([k, v]) => `${NAMES[k] || k} (${v.age_h == null ? 'failed' : Math.round(v.age_h) + ' h old'})`).join(', ')}. Those values may not match conditions now.`]);
    }
  }
  if (d && d.locations.some(l => l.status === 'demo')) out.push(['info', 'Early preview: spot details are still being verified. Treat locations as approximate.', 'demo']);
  if (d && d.thresholds.some(t => t.status === 'draft')) out.push(['info', 'Safety limits are drafts pending review. Always judge conditions on site.', 'draft']);
  else if (d && d.thresholds.some(t => t.status === 'researched')) out.push(['info', 'Safety limits follow BOM, Transport WA and Recfishwest guidance, but nobody has checked them on site. Always judge conditions yourself.', 'researched']);
  const dismissed = new Set(store.get('dismissed', []));
  const shown = out.filter(([, , key]) => !key || !dismissed.has(key));
  const urgent = shown.filter(([cls]) => cls !== 'info'), info = shown.filter(([cls]) => cls === 'info');
  document.getElementById('banners').innerHTML =
    urgent.map(([cls, msg, key, act]) => `<div class="banner ${cls}"><span>${esc(msg)}</span>${act === 'retry' ? '<button data-retry class="btn ghost">Retry</button>' : ''}${key ? `<button data-dismiss="${key}" aria-label="Dismiss">✕</button>` : ''}</div>`).join('');
  // "Early version" notes: a chip under the Fishing/Spear/Weather switch — the very top edge of an iPhone screen is hard to tap
  const slot = document.getElementById('notes-slot');
  if (slot) slot.innerHTML = info.length ? `<details class="notes-chip"><summary>ℹ Early version · ${info.length} note${info.length > 1 ? 's' : ''}</summary>
      <div class="notes-panel">${info.map(([, msg]) => `<p>${esc(msg)}</p>`).join('')}
      <button data-dismiss="${info.map(i => i[2]).join(',')}" class="btn">Got it, hide</button></div></details>` : '';
}

for (const id of ['banners', 'notes-slot']) document.getElementById(id)?.addEventListener('click', e => {
  if (e.target.closest('[data-retry]')) { e.target.closest('[data-retry]').textContent = 'Retrying…'; refreshConditions(true); return; }
  const k = e.target.closest('[data-dismiss]')?.dataset.dismiss;
  if (!k) return;
  store.set('dismissed', [...new Set([...store.get('dismissed', []), ...k.split(',')])]);
  banners();
});

// Pages other than the map load only when first opened (faster start on phones)
const lazy = (file, fn, extra) => async (v, arg) => (await import(`./views/${file}.js`))[fn](v, extra ?? arg);
const ROUTES = {
  map: () => null,
  spots: lazy('spots', 'renderSpots'),
  live: lazy('live', 'renderLive'),
  fish: lazy('fish', 'renderFish'),
  fishid: lazy('fish', 'renderFish', 'id'),
  rules: lazy('fish', 'renderFish', 'rules'),
  more: lazy('more', 'renderMore'),
  measure: lazy('measure', 'renderMeasure'),
  diary: lazy('diary', 'renderDiary'),
  key: lazy('key', 'renderKey'),
  loc: renderLocation
};

function route() {
  const [, name = 'map', arg] = (location.hash || '#/map').split('/');
  const view = document.getElementById('view');
  // 5 tabs: Map · Forecast (spots, live, spot pages) · Species (fish, ID, rules) · Learn (key) · My Fishing (more)
  const tab = ({ loc: 'spots', live: 'spots', fishid: 'fish', rules: 'fish', measure: 'more', diary: 'more' }[name] || name);
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
  Promise.resolve(ROUTES[name](view, arg)).catch(e => { view.innerHTML = `<div class="card">This page couldn't load (${esc(e.message)}). Check your connection and try again.</div>`; });
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
  const [coast, buoys, bom, tides, clarity, bomWarn, liveStatus] = await Promise.all([loadCoastConditions(force), loadBuoys(force), loadBomObs(force), loadTides(), loadClarity(), loadBomWarnings(), loadLiveStatus()]);
  state.coast = { points: state.coast.points, ...coast };
  state.buoys = buoys;
  state.bom = bom;
  state.tides = tides;
  state.clarity = clarity;
  state.bomWarn = bomWarn;
  state.liveStatus = liveStatus;
  banners();
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
    // independent downloads in parallel
    const shoreP = loadShore();
    [state.data, , state.coast.points] = await Promise.all([loadStatic(), loadTargets(), loadCoastPoints()]);
    setCoastPoints(state.coast.points);
    [state.osmSpots] = await Promise.all([loadOsmSpots(state.coast.points), shoreP]);
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

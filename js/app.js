import { loadStatic, loadConditions } from './data.js';
import { evaluate } from './engine.js';
import * as store from './storage.js';
import { fmtAge } from './units.js';
import { esc } from './ui.js';
import { initMap, refreshMap, showMap } from './map.js';
import { renderSpots } from './views/spots.js';
import { renderLocation } from './views/location.js';
import { renderRules } from './views/rules.js';
import { renderFishId } from './views/fishid.js';
import { renderMore } from './views/more.js';

export const state = {
  data: null,
  cond: { byId: {}, fetchedAt: null, stale: true, errors: [] },
  activity: store.get('activity', 'shore'),
  species: '',
  region: '',
  favOnly: false,
  loading: true,
  evalCache: new Map()
};

const sunFn = (d, lat, lng) => window.SunCalc.getTimes(d, lat, lng);

export function evalFor(loc, activity = state.activity) {
  const key = `${loc.id}|${activity}|${state.species}|${state.cond.fetchedAt}`;
  if (!state.evalCache.has(key)) {
    state.evalCache.set(key, evaluate(loc, state.cond.byId[loc.id], activity, {
      thresholds: state.data.thresholds, rules: state.data.rules, zones: state.data.zones,
      staleSources: state.cond.stale ? 1 : 0, sunFn, species: state.species || null
    }));
  }
  return state.evalCache.get(key);
}

export function visibleLocations() {
  const favs = store.favourites();
  return state.data.locations.filter(l =>
    (!state.region || l.region === state.region) &&
    (!state.favOnly || favs.has(l.id)) &&
    (!state.species || (l.species_evidence || []).some(e => e.species === state.species))
  );
}

export function setActivity(a) {
  state.activity = a;
  store.set('activity', a);
  document.querySelectorAll('[data-activity-toggle] button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.activity === a)));
  rerender();
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-activity-toggle] button');
  if (btn) setActivity(btn.dataset.activity);
});

function banners() {
  const out = [];
  const d = state.data;
  if (!navigator.onLine) out.push(['warn', 'You are offline. Showing the last data saved on this device.']);
  if (state.cond.fetchedAt && state.cond.stale) out.push(['warn', `Forecast data is out of date (updated ${fmtAge(state.cond.fetchedAt)}). Scores have lower confidence.`]);
  if (!state.loading && !state.cond.fetchedAt) out.push(['danger', 'Forecast data could not be loaded. Conditions and scores are Unknown.']);
  if (state.cond.fetchedAt) for (const err of state.cond.errors || []) out.push(['warn', `${err}. Affected values show as Unknown.`]);
  if (d && d.locations.some(l => l.status === 'demo')) out.push(['info', 'Early preview: spot details are still being verified. Treat locations as approximate.', 'demo']);
  if (d && d.thresholds.some(t => t.status === 'draft')) out.push(['info', 'Safety limits are drafts pending review. Always judge conditions on site.', 'draft']);
  const dismissed = new Set(store.get('dismissed', []));
  document.getElementById('banners').innerHTML = out
    .filter(([, , key]) => !key || !dismissed.has(key))
    .map(([cls, msg, key]) => `<div class="banner ${cls}"><span>${esc(msg)}</span>${key ? `<button data-dismiss="${key}" aria-label="Dismiss">✕</button>` : ''}</div>`).join('');
}

document.getElementById('banners').addEventListener('click', e => {
  const k = e.target.closest('[data-dismiss]')?.dataset.dismiss;
  if (!k) return;
  store.set('dismissed', [...new Set([...store.get('dismissed', []), k])]);
  banners();
});

const ROUTES = {
  map: () => null,
  spots: renderSpots,
  fishid: renderFishId,
  rules: renderRules,
  more: renderMore,
  loc: renderLocation
};

function route() {
  const [, name = 'map', arg] = (location.hash || '#/map').split('/');
  const view = document.getElementById('view');
  const tab = name === 'loc' ? (sessionStorage.getItem('lastTab') || 'spots') : name;
  if (name !== 'loc') try { sessionStorage.setItem('lastTab', name); } catch { /* ignore */ }
  document.querySelectorAll('#tabbar a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

  if (name === 'map' || !ROUTES[name]) {
    view.hidden = true;
    showMap(true);
    return;
  }
  showMap(false);
  view.hidden = false;
  if (!state.data) { view.innerHTML = '<p class="muted">Loading…</p>'; return; }
  view.innerHTML = '';
  ROUTES[name](view, arg);
  view.scrollTop = 0;
}

export function rerender() {
  state.evalCache.clear();
  banners();
  if (state.data) refreshMap();
  const [, name = 'map'] = (location.hash || '#/map').split('/');
  if (name !== 'map') route();
}

async function refreshConditions(force = false) {
  state.cond = await loadConditions(state.data.locations, { force });
  state.loading = false;
  rerender();
}

async function boot() {
  const ack = document.getElementById('ack');
  if (!store.get('ack')) {
    ack.showModal?.();
    document.getElementById('ack-ok').addEventListener('click', () => { store.set('ack', Date.now()); ack.close(); });
  }
  document.querySelectorAll('[data-activity-toggle] button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.activity === state.activity)));
  try {
    state.data = await loadStatic();
  } catch (e) {
    document.getElementById('banners').innerHTML = `<div class="banner danger">Could not load app data: ${esc(e.message)}</div>`;
    return;
  }
  initMap();
  window.addEventListener('hashchange', route);
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

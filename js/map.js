import { CONFIG, REGIONS, TYPE_LABELS } from './config.js';
import { state, evalFor, visibleLocations } from './app.js';
import * as store from './storage.js';
import { esc, pill, windowText, confText, chanceIcon, blockPill } from './ui.js';
import { band, BAND_LABEL } from './scoring/score.js';
import { fmtDateTime } from './units.js';
import { fmtWind, fmtHeight, fmtTemp } from './units.js';
import { degToCompass } from './scoring/geo.js';
import { AMENITY_TYPES, loadAmenities } from './amenities.js';
import { initCoastMap, refreshCoastMap, selectedTime } from './coastmap.js';
import { loadShore, nearestShore } from './shore.js';
import { fourChecks } from './checks.js';
import { openSheet, closeSheet, setState as setSheetState, sheetState } from './sheet.js';
import { renderLocation } from './views/location.js';
import { likelyTargets, targetsData } from './targets.js';
import { legalStatus } from './zones.js';
import { openWindy } from './coastmap.js';

let map, markerLayer, zoneLayer, amenityLayer;
export const FISH_SVG = '<svg viewBox="0 0 32 20" width="26" height="16"><path d="M2 10c5-7 14-8 20-3l7-5v16l-7-5c-6 5-15 4-20-3z" fill="#56b4e9" stroke="#fff" stroke-width="1.5"/><circle cx="8" cy="9" r="1.6" fill="#04121f"/></svg>';
export const SPEAR_SVG = '<svg viewBox="0 0 32 20" width="26" height="16"><path d="M1 10h24" stroke="#fff" stroke-width="2.2"/><path d="M25 5l6 5-6 5z" fill="#ffd166"/><path d="M3 6l4 4-4 4" stroke="#ffd166" stroke-width="1.6" fill="none"/></svg>';
const baseLayers = {};
const overlays = {};

// ---- Base maps ------------------------------------------------------------
const BASES = [
  { id: 'satellite', label: 'Satellite (Sentinel-2, free)', note: '10 m imagery — reef, weed and sand show in clear shallow water' },
  { id: 'esri', label: 'Satellite HD (Esri)', note: 'Sharper imagery — needs a free Esri key in js/config.js', needsKey: true },
  { id: 'street', label: 'Street map', note: 'Roads, tracks and car parks (OpenStreetMap)' }
];

// ---- Overlays ---------------------------------------------------------------
const LAYERS = [
  { group: 'Fishing', id: 'spots', label: 'Fishing spots & scores', note: 'Checked spots plus OpenStreetMap spots (zoom in for more)' },
  { group: 'Fishing', id: 'coast', label: 'Coast colour (conditions)', note: 'Conditions every ~8 km of coast at the chosen time — tap the coast for details' },
  { group: 'Rules & hazards', id: 'zones', label: 'Marine parks, sanctuaries & closures', note: 'Red = no fishing, orange = special rules (official DPIRD orders). Rules still apply in every spot card when hidden.' },
  { group: 'Rules & hazards', id: 'incidents', label: 'Past shark incidents', note: 'Australian Shark-Incident Database (Taronga). Skull = fatal, ! = injury, grey = no injury.' },
  { group: 'Marine conditions', id: 'buoys', label: 'Wave buoys (measured)', note: 'Transport WA buoys; green < 1 h old, orange 1–3 h, red older' },
  { group: 'Marine conditions', id: 'windFlow', label: 'Wind animation', note: 'Forecast — streaks follow the wind (white light → red strong)' },
  { group: 'Marine conditions', id: 'swellFlow', label: 'Swell lines', note: 'Forecast — lines roll toward the shore (zoom in)' },
  { group: 'Marine conditions', id: 'wind', label: 'Wind speed labels', note: 'Forecast km/h with direction (zoom in)' },
  { group: 'Marine conditions', id: 'waves', label: 'Wave height labels', note: 'Forecast metres with direction (zoom in)' },
  { group: 'Marine conditions', id: 'sst', label: 'Sea temperature', note: 'Modelled, shown under each spot' },
  { group: 'Under the water', id: 'habitat', label: 'Seabed habitat', note: 'Reef, seagrass and sand where mapped (Seamap Australia); patchy near shore' },
  { group: 'Under the water', id: 'depth', label: 'Depth (general)', note: 'GEBCO ~450 m grid — drop-offs only, not for navigation' },
  { group: 'Facilities', id: 'tackle', label: 'Tackle & bait shops', note: '' },
  { group: 'Facilities', id: 'fuel', label: 'Servos', note: 'Bait not confirmed — call ahead' },
  { group: 'Facilities', id: 'toilets', label: 'Public toilets', note: 'Within 10 km of the coast' },
  { group: 'Facilities', id: 'food24', label: '24/7 food', note: 'Within 10 km of the coast' },
  { group: 'Facilities', id: 'parking', label: 'Car parks near the coast', note: '' }
];
const DEFAULTS = { base: 'satellite', spots: true, coast: true, buoys: true, food24: false, parking: false, incidents: false, windFlow: false, swellFlow: false, wind: false, waves: false, sst: false, habitat: false, depth: false, zones: true, tackle: false, fuel: false, toilets: false };
export const layerOn = () => {
  const saved = store.get('layers', {});
  // v2: facilities (bait/tackle, servos, toilets) on by default — switch them on once for people with saved settings
  // v3: facilities are off until the user picks what they want (too many pins otherwise)
  if (!store.get('layersV3')) { store.set('layersV3', 1); Object.assign(saved, { tackle: false, fuel: false, toilets: false, food24: false, parking: false }); store.set('layers', saved); }
  // v4: calmer map — wind/swell animation live in the Weather view; shark history is opt-in
  if (!store.get('layersV4')) { store.set('layersV4', 1); Object.assign(saved, { windFlow: false, swellFlow: false, incidents: false }); store.set('layers', saved); }
  return { ...DEFAULTS, ...saved };
};
// What is actually drawn: the Weather view swaps spots for wind, swell and buoys.
export const isWeatherView = () => state.mapView === 'weather';
const lite = () => !!store.get('lite');
export const viewOn = () => lite() ? { ...viewOnFull(), windFlow: false, swellFlow: false } : viewOnFull();
const viewOnFull = () => isWeatherView()
  ? { ...layerOn(), coast: false, zones: false, incidents: false, tackle: false, fuel: false, toilets: false, food24: false, parking: false,
      windFlow: true, swellFlow: true, wind: true, waves: true, buoys: true }
  : layerOn();
const setLayer = (k, v) => store.set('layers', { ...layerOn(), [k]: v });

export function getMap() { return map; }

export function initMap() {
  const L = window.L;
  // keep popups clear of the search bar/legend at the top and the time bar at the bottom
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 215), autoPanPaddingBottomRight: L.point(70, 160), maxWidth: 300 });
  // Gestures: Leaflet handles pinch, drag and double-tap on the map itself; the overlays get
  // touch-action rules in CSS so a pinch on a button can't zoom the whole web page.
  map = L.map('map', {
    zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 18, zoomSnap: 0.5, zoomDelta: 1,
    bounceAtZoomLimits: false, tapTolerance: 15, wheelPxPerZoomLevel: 90,
    maxBounds: [[-40, 106], [-26, 130]], maxBoundsViscosity: 0.7
  });
  const saved = store.get('mapView');
  if (saved && Number.isFinite(saved.lat)) map.setView([saved.lat, saved.lng], saved.z, { animate: false });
  else map.fitBounds(COAST_BOUNDS, { animate: false });

  baseLayers.satellite = L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg', {
    maxNativeZoom: 14, maxZoom: 18,
    attribution: '<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)'
  });
  if (CONFIG.ESRI_API_KEY) {
    baseLayers.esri = L.tileLayer(`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${CONFIG.ESRI_API_KEY}`, {
      maxZoom: 19, attribution: 'Powered by <a href="https://www.esri.com">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
  }
  baseLayers.street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });

  map.createPane('underwater'); map.getPane('underwater').style.zIndex = 350;
  overlays.depth = L.tileLayer.wms('https://wms.gebco.net/mapserv?', {
    layers: 'GEBCO_LATEST', format: 'image/png', transparent: true, opacity: 0.55, pane: 'underwater',
    attribution: 'Depth: <a href="https://www.gebco.net">GEBCO Compilation Group</a>'
  });
  overlays.habitat = L.tileLayer.wms('https://geoserver.imas.utas.edu.au/geoserver/seamap/wms', {
    layers: 'seamap:SeamapAus_National_Benthic_Habitat_Layer', format: 'image/png', transparent: true, opacity: 0.7, pane: 'underwater',
    attribution: 'Habitat: <a href="https://seamapaustralia.org">Seamap Australia</a> (UTAS)'
  });

  map.attributionControl.addAttribution('Forecasts: <a href="https://open-meteo.com/">Open-Meteo</a>');
  zoneLayer = L.geoJSON(null, { filter: f => !['species', 'gear', 'general_use'].includes(f.properties?.zone_type), style: f => {
    const p = f.properties || {};
    if (p.zone_type === 'sanctuary') return { color: '#e15759', weight: 2, fillOpacity: 0.25 };
    if (p.zone_type === 'restricted') return { color: '#f5a524', weight: 1.5, fillOpacity: 0.12, dashArray: '4 4' };
    if (p.zone_type === 'marine_park') return { color: '#4e79a7', weight: 1, fillOpacity: 0, dashArray: '6 6' };
    return { color: '#4e79a7', weight: 1.5, fillOpacity: 0.1 };
  } }).addTo(map);
  amenityLayer = L.layerGroup().addTo(map);
  initCoastMap(map);
  window.__wafiMap = map; // handy for debugging in the browser console
  markerLayer = L.layerGroup().addTo(map);

  applyLayers();
  buildControls();
  buildSearch();
  buildSpeciesPicker();
  buildLegend();
  refreshMap();
  // One debounced redraw after the map stops moving (was: a full rebuild on every move event)
  let t = null;
  map.on('moveend', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const c = map.getCenter(); store.set('mapView', { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), z: map.getZoom() });
      renderAmenities();
      if (state.osmSpots.length) refreshMap();
    }, 180);
  });
  // the map must re-measure itself whenever its box changes (rotation, address bar, keyboard, tabs)
  if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(document.getElementById('map'));
}

// Perth → Esperance coverage
const COAST_BOUNDS = [[-35.3, 114.5], [-31.4, 122.3]];

// ---- Floating controls: zoom, my location, whole coast, layers, previous view ----------
let prevView = null, meMarker = null, meCircle = null;
function rememberView() {
  const c = map.getCenter(); prevView = { c, z: map.getZoom() };
  const b = document.getElementById('back-view'); b.hidden = false;
  clearTimeout(b._t); b._t = setTimeout(() => { b.hidden = true; }, 15000);
}
export function toast(msg, ms = 3500) {
  const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, ms);
}
function buildControls() {
  const L = window.L;
  document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn(1));
  document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut(1));
  document.getElementById('home-btn').addEventListener('click', () => { rememberView(); map.flyToBounds(COAST_BOUNDS, { duration: 0.8 }); });
  document.getElementById('back-view').addEventListener('click', e => {
    if (!prevView) return;
    const here = { c: map.getCenter(), z: map.getZoom() };
    map.flyTo(prevView.c, prevView.z, { duration: 0.7 }); prevView = here;
  });
  document.getElementById('locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available on this device.');
    toast('Finding your location…', 8000);
    navigator.geolocation.getCurrentPosition(pos => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      rememberView();
      meMarker?.remove(); meCircle?.remove();
      meCircle = L.circle(ll, { radius: pos.coords.accuracy, color: '#4fd1ff', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'me-pin', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
      map.flyTo(ll, Math.max(map.getZoom(), 13), { duration: 0.8 });
      document.getElementById('toast').hidden = true;
    }, err => toast(err.code === 1 ? 'Location permission was declined — you can allow it in your browser settings.' : 'Could not find your location right now.'),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
  document.getElementById('layers-btn').addEventListener('click', openLayersSheet);
}

// ---- Layers & "what to show" — one bottom sheet -------------------------------------
function openLayersSheet() {
  const draw = () => {
    const on = layerOn(), wx = isWeatherView();
    const groups = [...new Set(LAYERS.map(l => l.group))];
    return `<div class="seg seg-compact" role="radiogroup" aria-label="Base map" style="margin-bottom:10px">
        ${BASES.map(b => `<button role="radio" data-base="${b.id}" aria-checked="${on.base === b.id}" aria-pressed="${on.base === b.id}" ${b.needsKey && !CONFIG.ESRI_API_KEY ? 'disabled title="Needs a free Esri key"' : ''}>${{ satellite: 'Satellite', esri: 'Satellite HD', street: 'Street' }[b.id]}</button>`).join('')}
      </div>
      ${wx ? '<p class="small notice">Weather view shows wind, swell and buoys. Tap Fishing or Spear at the top to choose your own layers.</p>' : ''}
      ${groups.map(g => `<h3 class="sheet-h3">${g}</h3>${LAYERS.filter(l => l.group === g).map(l => `
        <label class="tog"><input type="checkbox" data-layer="${l.id}" ${on[l.id] ? 'checked' : ''} ${wx ? 'disabled' : ''}>
          ${AMENITY_TYPES[l.id] ? `<span class="am am-${l.id}" aria-hidden="true">${AMENITY_TYPES[l.id].short}</span>` : ''}
          <span><span class="tog-l">${l.label}</span>${l.note ? `<small>${l.note}</small>` : ''}</span></label>`).join('')}`).join('')}
      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn" data-act="windy">Open animated wind &amp; waves (Windy)</button>
        <button class="btn ghost" data-act="reset">Reset layers</button>
      </div>`;
  };
  const body = openSheet(draw(), { title: 'Map layers', state: 'half' });
  body.onchange = e => {
    if (!e.target.dataset.layer) return;
    store.set('layers', { ...layerOn(), [e.target.dataset.layer]: e.target.checked });
    applyLayers(); refreshMap();
  };
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.base) { store.set('layers', { ...layerOn(), base: b.dataset.base }); applyLayers(); body.innerHTML = draw(); }
    if (b.dataset.act === 'reset') { store.set('layers', {}); applyLayers(); refreshMap(); body.innerHTML = draw(); toast('Layers reset to the defaults.'); }
    if (b.dataset.act === 'windy') { closeSheet(); openWindy(); }
  };
}

// ---- Species picker (top bar) — filters the map without moving it ------------------
const CATS = [['all', 'All'], ['fish', 'Finfish'], ['crab', 'Crabs'], ['squid', 'Squid'], ['spear', 'Spearfishing']];
const catOf = t => t.id === 'blue_swimmer_crab' ? 'crab' : t.id === 'southern_calamari' ? 'squid' : 'fish';
function speciesList() {
  const seen = new Map();
  for (const t of targetsData()?.targets || []) {
    const e = seen.get(t.id) || { id: t.id, name: t.name, acts: new Set(), why: t.why, cat: catOf(t) };
    e.acts.add(t.activity); seen.set(t.id, e);
  }
  return [...seen.values()];
}
function syncSpeciesChip() {
  const id = state.targetSpecies;
  const sp = id && speciesList().find(s => s.id === id);
  document.getElementById('species-label').textContent = sp ? sp.name : 'All species';
  document.getElementById('species-btn').classList.toggle('on', !!sp);
}
export function setTargetSpecies(id) {
  state.targetSpecies = id || null;
  store.set('targetSpecies', state.targetSpecies);
  if (id) store.set('recentSpecies', [id, ...store.get('recentSpecies', []).filter(x => x !== id)].slice(0, 4));
  syncSpeciesChip();
  refreshMap();   // filter only — the map view is left exactly where it is
}
function buildSpeciesPicker() {
  state.targetSpecies = store.get('targetSpecies', null);
  syncSpeciesChip();
  document.getElementById('species-btn').addEventListener('click', () => {
    let cat = 'all', q = '';
    const favs = new Set(store.get('favSpecies', []));
    const list = () => {
      const all = speciesList();
      const rec = store.get('recentSpecies', []).map(id => all.find(s => s.id === id)).filter(Boolean);
      const items = all.filter(s => (cat === 'all' || (cat === 'spear' ? s.acts.has('spear') : s.cat === cat)) && (!q || s.name.toLowerCase().includes(q)))
        .sort((a, b) => (favs.has(b.id) - favs.has(a.id)) || a.name.localeCompare(b.name));
      const row = s => `<li class="sp-row ${state.targetSpecies === s.id ? 'on' : ''}"><button class="sp-pick" data-id="${s.id}"><span class="sp-thumb" data-sci="${s.id}" aria-hidden="true"></span><span><strong>${esc(s.name)}</strong><small>${esc(s.why || '')}</small></span></button>
        <button class="sp-star" data-star="${s.id}" aria-pressed="${favs.has(s.id)}" aria-label="${favs.has(s.id) ? 'Remove from' : 'Add to'} favourite species">${favs.has(s.id) ? '★' : '☆'}</button></li>`;
      return `${rec.length && !q ? `<div class="chips-row">${rec.map(s => `<button class="chip" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>` : ''}
        <ul class="sp-list">${items.map(row).join('') || '<li class="muted small">No match.</li>'}</ul>
        <p class="small muted">Lobster and freshwater species come with the next update. The map filter uses the seasonal guide (season, habitat, time of day) — not catch reports.</p>`;
    };
    const html = `<input id="sp-q" type="search" class="sp-q" placeholder="Search species" aria-label="Search species">
      <div class="chips-row" role="tablist">${CATS.map(([k, l]) => `<button class="chip ${k === cat ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>
      ${state.targetSpecies ? '<button class="btn ghost" data-clear style="margin:6px 0">✕ Show all species</button>' : ''}
      <div id="sp-list">${list()}</div>`;
    const body = openSheet(html, { title: 'Target species', state: 'half' });
    const redraw = () => { body.querySelector('#sp-list').innerHTML = list(); hydrateThumbs(body); };
    hydrateThumbs(body);
    body.querySelector('#sp-q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); redraw(); });
    body.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cat) { cat = b.dataset.cat; body.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === b)); redraw(); return; }
      if (b.dataset.star) { favs.has(b.dataset.star) ? favs.delete(b.dataset.star) : favs.add(b.dataset.star); store.set('favSpecies', [...favs]); redraw(); return; }
      if (b.hasAttribute('data-clear')) { setTargetSpecies(null); closeSheet(); toast('Showing all species.'); return; }
      if (b.dataset.id) {
        setTargetSpecies(b.dataset.id); closeSheet();
        const n = document.querySelectorAll('.leaflet-marker-pane .mk').length;
        toast(`${speciesList().find(s => s.id === b.dataset.id)?.name}: showing ${n} spot${n === 1 ? '' : 's'} where it's likely now. Zoom in for more.`);
      }
    };
  });
}
async function hydrateThumbs(root) {
  const { speciesPhoto, speciesGallery } = await import('./wiki.js');
  const sp = state.data?.species?.species || [];
  for (const el of root.querySelectorAll('.sp-thumb:not([data-done])')) {
    el.dataset.done = '1';
    const s = sp.find(x => x.id === el.dataset.sci); if (!s) continue;
    (async () => {
      const ph = await speciesPhoto(s.wiki).catch(() => null);
      const src = ph?.src || (await speciesGallery(s.scientific, 1, s.name).catch(() => []))[0]?.src;
      if (src) el.style.backgroundImage = `url("${src}")`;
    })();
  }
}

// ---- Spot card (bottom sheet) ------------------------------------------------------
export function openSpotSheet(loc) {
  state.selectedId = loc.id;
  const ev = evalFor(loc), hr = hourRow(ev);
  const ls = legalStatus(state.data.zones, loc, state.activity);
  const tg = ls.state === 'blocked' ? [] : likelyTargets(loc, hr?.hour, state.activity, { max: 3, zones: state.data.zones }).filter(t => t.level === 'good' || t.level === 'possible');
  const fav = store.favourites().has(loc.id);
  const [lng, lat] = loc.geometry.coordinates;
  const html = `
    <div class="spot-sum">
      <div class="small muted">${esc(REGIONS[loc.region]?.name ?? loc.region ?? '')} · ${esc(TYPE_LABELS[loc.type] ?? loc.type)} · ${timeLabel()}</div>
      <div class="row" style="gap:8px;margin:6px 0;align-items:center;flex-wrap:wrap">
        ${ev.applicable === false ? pill(ev) : hr ? (hr.blocked ? blockPill(hr.blockKind) : `<span class="pill ${band(hr.score)}">${BAND_LABEL[band(hr.score)]} ${hr.score ?? '?'}</span>`) : '<span class="pill unknown">Unknown</span>'}
        ${hr ? chanceIcon(hr.score, state.activity, hr.blocked && (hr.blockKind || true)) : ''}
        <span class="small">Best: ${esc(windowText(ev))}</span>
      </div>
      ${tg.length ? `<div class="small">🎯 ${esc(tg.map(t => t.name).join(', '))}</div>` : ''}
      <div class="small ${ls.state === 'blocked' ? 'warn-text' : ''}">${ls.state === 'blocked' ? '⛔' : ls.state === 'caution' ? '⚠' : '✓'} ${esc(ls.text)}</div>
      ${hr?.blocked && hr.blockKind === 'safety' ? `<div class="small warn-text">⚠ ${esc(hr.blocks.find(b => b.kind === 'safety')?.reason ?? '')}</div>` : ''}
      <div class="row sheet-actions">
        <button class="btn" data-act="more">View details</button>
        <a class="btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Directions</a>
        <button class="btn ghost" data-act="fav" aria-pressed="${fav}">${fav ? '★ Saved' : '☆ Save'}</button>
      </div>
    </div>
    <div class="spot-half">${ev.applicable === false ? '' : fourChecks(loc, ev, hr, state.data.zones, state.activity)}</div>
    <div class="spot-full" data-full></div>`;
  const body = openSheet(html, {
    title: loc.name, state: 'peek',
    onClose: () => { state.selectedId = null; markSelected(); },
    onState: (st, b) => {
      const box = b.querySelector('[data-full]');
      if (st === 'full' && box && !box.dataset.done) { box.dataset.done = '1'; renderLocation(box, loc.id); }
    }
  });
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'more') setSheetState('full');
    if (b.dataset.act === 'fav') { const on = store.toggleFavourite(loc.id); b.textContent = on ? '★ Saved' : '☆ Save'; b.setAttribute('aria-pressed', String(on)); }
  };
  markSelected();
  // keep the chosen spot visible above the sheet without changing the zoom
  const pt = map.latLngToContainerPoint([lat, lng]), h = map.getSize().y;
  if (pt.y > h * 0.62) map.panBy([0, pt.y - h * 0.4], { animate: true });
}
function markSelected() {
  document.querySelectorAll('.leaflet-marker-pane .mk-wrap').forEach(w => w.classList.toggle('selected', w.dataset.loc === state.selectedId));
}

function applyLayers() {
  const on = viewOn();
  const base = baseLayers[on.base] ? on.base : 'satellite';
  for (const [id, layer] of Object.entries(baseLayers)) {
    if (id === base) { if (!map.hasLayer(layer)) layer.addTo(map); } else map.removeLayer(layer);
  }
  document.getElementById('map').classList.toggle('osm-dark', base === 'street');
  for (const id of ['depth', 'habitat']) {
    if (on[id]) overlays[id].addTo(map); else map.removeLayer(overlays[id]);
  }
  document.getElementById('habitat-legend').hidden = !on.habitat;
  renderAmenities();
}

export function showMap(show) {
  document.getElementById('map-wrap').hidden = !show;
  if (show && map) setTimeout(() => map.invalidateSize(), 0);
}


function hourRow(ev) {
  if (!ev?.hourly) return null;
  const t = selectedTime();
  return ev.hourly.find(h => h.t === t) ?? null;
}
function timeLabel() {
  const t = selectedTime();
  return t === Math.floor(Date.now() / 3600e3) * 3600e3 ? 'Now' : fmtDateTime(t);
}

function subLabel(loc, ev, on) {
  const h = ev?.current?.hour;
  if (!h) return '';
  const bits = [];
  if (on.sst) bits.push(h.sst != null ? fmtTemp(h.sst) : 'SST ?');
  return bits.length ? `<span class="mk-sub">${esc(bits.join(' · '))}</span>` : '';
}

let lastView = 'spots';
export function refreshMap() {
  if (!map) return;
  const L = window.L;
  const on = viewOn();
  updateLegend(on);
  if (lastView !== (state.mapView || 'spots')) { lastView = state.mapView || 'spots'; renderAmenities(); }
  markerLayer.clearLayers();
  const zoom = map.getZoom();
  const bounds = map.getBounds().pad(0.2);
  // Declutter: checked spots first, then the best-scoring OSM spots; skip a pin that would overlap one
  // already placed (zoom in to see more). Bigger fish = better score, so the best ones win.
  const placed = [];
  const cand = visibleLocations()
    .filter(loc => !loc.osm || (zoom >= (lite() ? 13 : 12) && bounds.contains([loc.geometry.coordinates[1], loc.geometry.coordinates[0]])))
    .map(loc => { const ev = evalFor(loc); return { loc, ev, hr: hourRow(ev) }; })
    .sort((a, b) => (a.loc.osm ? 1 : 0) - (b.loc.osm ? 1 : 0) || (b.hr?.score ?? -1) - (a.hr?.score ?? -1));
  for (const { loc, ev, hr } of cand) {
    if (isWeatherView() || !on.spots) break;   // Weather view or spots switched off: no spot pins
    if (ev.applicable === false) continue;   // e.g. beach spots in Spear mode: don't clutter the map
    if (state.targetSpecies) {   // species filter: only spots where it's likely now (seasonal guide)
      const t = likelyTargets(loc, hr?.hour, state.activity, { max: 20, zones: state.data.zones }).find(x => x.id === state.targetSpecies);
      if (!t || !(t.level === 'good' || t.level === 'possible')) continue;
    }
    const pt = map.latLngToContainerPoint([loc.geometry.coordinates[1], loc.geometry.coordinates[0]]);
    if (loc.osm && zoom < 16 && placed.some(q => Math.abs(q.x - pt.x) < 44 && Math.abs(q.y - pt.y) < 56)) continue;
    placed.push(pt);
    const [lng, lat] = loc.geometry.coordinates;
    // the pin shows the score at the hour on the time slider (so it changes as you scrub / press play)
    const cls = ev.applicable === false ? 'na' : !hr ? 'unknown' : hr.blocked ? `blocked blk-${hr.blockKind || 'safety'}` : hr.score != null ? band(hr.score) : 'unknown';
    const text = ev.applicable === false ? '–' : !hr ? '?' : hr.blocked ? ({ legal: '⛔', safety: '⚠', dark: '🌙' }[hr.blockKind] || '✕') : hr.score ?? '?';
    const icon = L.divIcon({
      className: loc.osm ? 'mk-wrap osm' : 'mk-wrap',
      html: `<div class="mk ${cls} conf-${ev.confidence?.level ?? 'low'}" aria-hidden="true">${text}</div>${subLabel(loc, ev, on)}`,
      iconSize: [38, 38], iconAnchor: [19, 19]
    });
    const m = L.marker([lat, lng], { locId: loc.id, icon, title: `${loc.name}: ${ev.applicable === false ? 'not rated for this activity' : ev.band}`, alt: loc.name, keyboard: true, zIndexOffset: 1000 });
    m.on('click', () => openSpotSheet(loc));
    m.on('add', () => { const el = m.getElement(); if (el) { el.dataset.loc = loc.id; el.classList.toggle('selected', loc.id === state.selectedId); } });
    markerLayer.addLayer(m);
  }
  zoneLayer.clearLayers();
  if (on.zones && state.data?.zones?.features?.length) zoneLayer.addData(state.data.zones);
  refreshCoastMap();
}

// Toilets, servos and 24/7 food only within 10 km of the sea (otherwise far too many inland pins).
// Bait & tackle shops are kept wherever they are; car parks are already limited to ~2.5 km of the shore.
let coastalCache = null;
async function coastalAmenities() {
  if (coastalCache) return coastalCache;
  const [data] = await Promise.all([loadAmenities(), loadShore()]);
  if (!data) return null;
  const near = f => { const [lng, lat] = f.geometry.coordinates; const n = nearestShore(lat, lng, 10); return !!n && (n.km <= 10); };
  coastalCache = { ...data, features: data.features.filter(f => f.properties.kind === 'tackle' || near(f)) };
  return coastalCache;
}

async function renderAmenities() {
  if (!map) return;
  const L = window.L;
  const on = viewOn();
  amenityLayer.clearLayers();
  const wanted = Object.keys(AMENITY_TYPES).filter(k => on[k]);
  const note = document.getElementById('amenity-note');
  if (!wanted.length) { note.hidden = true; return; }
  const data = await coastalAmenities();
  if (!data) { note.textContent = 'Bait shops, servos and toilets are still downloading (weekly update) — check back soon.'; note.hidden = false; return; }
  if (map.getZoom() < 11) { note.textContent = 'Zoom in to see bait shops, servos and toilets.'; note.hidden = false; return; }
  note.hidden = true;
  const b = map.getBounds().pad(0.2);
  for (const f of data.features) {
    const t = f.properties.kind;
    if (!wanted.includes(t)) continue;
    const [lng, lat] = f.geometry.coordinates;
    if (!b.contains([lat, lng])) continue;
    const def = AMENITY_TYPES[t];
    const icon = L.divIcon({ className: 'am-wrap', html: `<div class="am am-${t}" aria-hidden="true">${def.short}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    const p = f.properties;
    L.marker([lat, lng], { icon, title: p.name || def.label, keyboard: true })
      .bindPopup(`<strong>${esc(p.name || def.label)}</strong><br><span class="muted small">${esc(def.label)}</span>
        ${p.opening_hours ? `<div class="small">Hours: ${esc(p.opening_hours)}</div>` : ''}
        ${t === 'fuel' ? '<div class="small muted">Bait availability not confirmed — call ahead.</div>' : ''}
        ${p.access && t === 'toilets' ? `<div class="small">Access: ${esc(p.access)}</div>` : ''}
        <p style="margin:6px 0 0"><a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Directions →</a></p>
        <div class="small muted">Data © OpenStreetMap contributors</div>`)
      .addTo(amenityLayer);
  }
}

// Contextual legend: only what is on the map right now
function updateLegend(on) {
  const parts = [];
  const dot = (c, t) => `<span><i class="dot ${c}"></i>${t}</span>`;
  if (on.spots && !isWeatherView()) parts.push('<div class="lg-h">Spots & coast</div>' + [['good', 'Good 70+'], ['fair', 'Fair 40–69'], ['poor', 'Poor &lt;40'], ['blk-legal', 'Not allowed'], ['blk-safety', 'Not safe'], ['unknown', 'Unknown']].map(([c, t]) => dot(c, t)).join('') + '<span class="muted">dashed pin = lower confidence</span>');
  if (on.zones) parts.push('<div class="lg-h">Rules</div><span><i class="key-zone sanct" style="width:16px;height:10px"></i> No fishing</span><span><i class="key-zone restr" style="width:16px;height:10px"></i> Special rules</span>');
  if (on.buoys) parts.push('<div class="lg-h">Buoys (measured)</div><span style="color:#30d158">■ under 1 h old</span><span style="color:#f5a524">■ 1–3 h</span><span style="color:#e5484d">■ older — not current</span>');
  if (on.windFlow) parts.push('<div class="lg-h">Wind streaks</div><span>white light · blue moderate · yellow fresh · red strong</span>');
  if (state.targetSpecies) parts.push(`<div class="lg-h">Species filter</div><span>Only spots where it's likely now</span>`);
  parts.push('<a href="#/key" class="small">Full key →</a>');
  document.getElementById('legend').innerHTML = parts.join('');
}

function buildLegend() {
  const hl = document.getElementById('habitat-legend');
  hl.innerHTML = `<strong class="small">Seabed habitat</strong>
    <img alt="Habitat colour key from Seamap Australia" loading="lazy" src="https://geoserver.imas.utas.edu.au/geoserver/seamap/wms?REQUEST=GetLegendGraphic&VERSION=1.0.0&FORMAT=image/png&LAYER=seamap:SeamapAus_National_Benthic_Habitat_Layer">
    <span class="small muted">No colour = not mapped, not "no reef".</span>`;
}

function buildSearch() {
  const input = document.getElementById('search');
  const list = document.getElementById('search-results');
  const close = () => { list.hidden = true; list.innerHTML = ''; };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return close();
    const regions = Object.entries(REGIONS).filter(([, r]) => r.name.toLowerCase().includes(q)).map(([id, r]) => ({ kind: 'region', id, name: r.name }));
    const spots = state.data.locations.filter(l => l.name.toLowerCase().includes(q) || (REGIONS[l.region]?.name ?? '').toLowerCase().includes(q))
      .map(l => ({ kind: 'spot', id: l.id, name: l.name, sub: REGIONS[l.region]?.name }));
    const items = [...regions, ...spots].slice(0, 8);
    list.innerHTML = items.length ? items.map(i => `<li><button data-kind="${i.kind}" data-id="${esc(i.id)}">${esc(i.name)}<small>${i.kind === 'region' ? 'Area' : esc(i.sub ?? '')}</small></button></li>`).join('')
      : '<li class="muted small" style="padding:10px">No matching spots yet</li>';
    list.hidden = false;
  });
  list.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.kind === 'spot') {
      const loc = state.data.locations.find(l => l.id === b.dataset.id);
      const [lng, lat] = loc.geometry.coordinates;
      rememberView();
      map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { duration: 0.8 });
      map.once('moveend', () => openSpotSheet(loc));
    } else {
      const locs = state.data.locations.filter(l => l.region === b.dataset.id);
      if (locs.length) { rememberView(); } if (locs.length) map.flyToBounds(locs.map(l => [l.geometry.coordinates[1], l.geometry.coordinates[0]]), { maxZoom: 12, padding: [40, 40] });
    }
    input.value = ''; close(); input.blur();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) close(); });
}

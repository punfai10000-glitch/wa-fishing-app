import { CONFIG, REGIONS, TYPE_LABELS } from './config.js';
import { state, evalFor, visibleLocations } from './app.js';
import * as store from './storage.js';
import { esc, pill, windowText, confText, chanceIcon, blockPill, bestTimeText } from './ui.js';
import { band, BAND_LABEL } from './scoring/score.js';
import { fmtDateTime } from './units.js';
import { fmtWind, fmtHeight, fmtTemp } from './units.js';
import { degToCompass } from './scoring/geo.js';
import { AMENITY_TYPES, loadAmenities } from './amenities.js';
import { initCoastMap, refreshCoastMap, selectedTime, setSelectedTime, waveColor, sstColor, measuredTide } from './coastmap.js';
import { tideCheckText, clarityImage, CLARITY_BANDS } from './ocean.js';
import { verdict, verdictHTML, hourStrip } from './verdict.js';
import { plainify } from './plain.js';
import { setDraft } from './diary.js';
import { currentColor } from './flow.js';
import { CURRENT_BANDS } from './units.js';
import { loadShore, nearestShore } from './shore.js';
import { fourChecks } from './checks.js';
import { openSheet, closeSheet, setState as setSheetState, sheetState } from './sheet.js';
import { renderLocation } from './views/location.js';
import { likelyTargets, targetsData } from './targets.js';
import { legalStatus, legalHTML } from './zones.js';
import { openWindy, placeReport } from './coastmap.js';
import { makeDepthLayer, loadDepthIndex, depthAt, depthText, DEPTH_BANDS } from './depth.js';
import { offshorePoint } from './shore.js';

let map, markerLayer, zoneLayer, zoneLabels, amenityLayer, zonesDrawn = null, sheetRefresher = null, clarityLayer = null;
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
  { group: 'Background', id: 'aerial', label: 'Sharp aerial photos when zoomed in', note: 'WA Government (Landgate) aerial photos from zoom 15 — reefs, rocks and tracks in detail. Photos are at least about a year old. Turn off to save data.' },
  { group: 'Fishing', id: 'spots', label: 'Fishing spots & scores', note: 'Checked spots plus OpenStreetMap spots (zoom in for more)' },
  { group: 'Fishing', id: 'coast', label: 'Coast colour (conditions)', note: 'Conditions every ~8 km of coast at the chosen time — tap the coast for details' },
  { group: 'Rules & hazards', id: 'zones', label: 'Marine parks, sanctuaries & closures', note: 'Red = no fishing, orange = special rules, green = spearfishing area, purple dotted = gear or species rules (official DPIRD orders). Tap inside any zone for exactly what is allowed.' },
  { group: 'Rules & hazards', id: 'incidents', label: 'Past shark incidents', note: 'Australian Shark-Incident Database (Taronga). Skull = fatal, ! = injury, grey = no injury.' },
  { group: 'Marine conditions', id: 'buoys', label: 'Wave buoys (measured)', note: 'Transport WA buoys; green < 1 h old, orange 1–3 h, red older' },
  { group: 'Marine conditions', id: 'windFlow', label: 'Wind animation', note: 'Forecast — streaks follow the wind (white light → red strong)' },
  { group: 'Marine conditions', id: 'swellFlow', label: 'Swell lines', note: 'Forecast — lines roll toward the shore (zoom in)' },
  { group: 'Marine conditions', id: 'currentFlow', label: 'Water movement (currents)', note: 'Forecast — streaks follow the ocean current: green slow, yellow moderate, orange strong, red too strong to dive. On by default in Spear. Offshore drift only — rips near the beach are too small for any forecast.' },
  { group: 'Marine conditions', id: 'wind', label: 'Wind speed labels', note: 'Forecast km/h with direction (zoom in)' },
  { group: 'Marine conditions', id: 'waves', label: 'Wave height labels', note: 'Forecast metres with direction (zoom in)' },
  { group: 'Marine conditions', id: 'sst', label: 'Sea temperature', note: 'Coloured dots with °C all along the coast (blue cold → red warm). Forecast model.' },
  { group: 'Under the water', id: 'clarity', label: 'Water clarity (satellite)', note: 'How clear the water was on the latest satellite pass (NOAA, ~2–4 km squares, cloud gaps filled). Blue = clear, brown = murky. Right at the shore it can differ — swell and rain since then make it murkier.' },
  { group: 'Under the water', id: 'habitat', label: 'Seabed habitat', note: 'Reef, seagrass and sand where mapped (Seamap Australia); patchy near shore' },
  { group: 'Under the water', id: 'depth', label: 'Water depth (colour bands)', note: 'Detailed near shore where Transport WA surveyed (zoom in); general depth when zoomed out. Tap the water for the depth in metres. Not for navigation.' },
  { group: 'Facilities', id: 'tackle', label: 'Tackle & bait shops', note: '' },
  { group: 'Facilities', id: 'fuel', label: 'Servos', note: 'Bait not confirmed — call ahead' },
  { group: 'Facilities', id: 'toilets', label: 'Public toilets', note: 'Within 10 km of the coast' },
  { group: 'Facilities', id: 'food24', label: '24/7 food', note: 'Within 10 km of the coast' },
  { group: 'Facilities', id: 'parking', label: 'Car parks near the coast', note: '' }
];
const DEFAULTS = { base: 'satellite', aerial: true, currentFlow: null, spots: true, coast: true, buoys: true, food24: false, parking: false, incidents: false, windFlow: false, swellFlow: false, wind: false, waves: false, sst: false, clarity: false, habitat: false, depth: false, zones: true, tackle: false, fuel: false, toilets: false };
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
export const viewOn = () => lite() ? { ...viewOnFull(), windFlow: false, swellFlow: false, currentFlow: false } : viewOnFull();
// currents: on in Spear unless the user switched them off (null = not chosen yet)
const viewOnFull = () => { const on = layerOn(); return isWeatherView()
  ? { ...on, coast: false, zones: false, incidents: false, tackle: false, fuel: false, toilets: false, food24: false, parking: false,
      windFlow: true, swellFlow: true, wind: true, waves: true, buoys: true, sst: true, currentFlow: on.currentFlow === true }
  : { ...on, currentFlow: on.currentFlow ?? state.activity === 'spear' }; };
const setLayer = (k, v) => store.set('layers', { ...layerOn(), [k]: v });

export function getMap() { return map; }

export function initMap() {
  const L = window.L;
  // keep popups clear of the search bar/legend at the top and the time bar at the bottom
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 215), autoPanPaddingBottomRight: L.point(70, 160), maxWidth: 300 });
  // Gestures: Leaflet handles pinch, drag and double-tap on the map itself; the overlays get
  // touch-action rules in CSS so a pinch on a button can't zoom the whole web page.
  map = L.map('map', {
    zoomControl: false, attributionControl: true, preferCanvas: true, minZoom: 5, maxZoom: 18, zoomSnap: 0.5, zoomDelta: 1,
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
  // Sharp aerial photos from zoom 15: Landgate's free whole-of-WA imagery (SLIP 'Locate'), drawn as 512 px
  // tiles on top of Sentinel-2 so the 10 m picture shows instantly while the sharp one loads.
  const Aerial = L.TileLayer.extend({
    getTileUrl(c) {
      const nw = this._map.unproject([c.x * 512, c.y * 512], c.z), se = this._map.unproject([(c.x + 1) * 512, (c.y + 1) * 512], c.z);
      const a = L.CRS.EPSG3857.project(nw), b = L.CRS.EPSG3857.project(se);
      return `https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Locate/MapServer/export?bbox=${a.x.toFixed(1)},${b.y.toFixed(1)},${b.x.toFixed(1)},${a.y.toFixed(1)}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&transparent=false&f=image`;
    }
  });
  overlays.aerial = new Aerial('', { tileSize: 512, minZoom: 15, maxZoom: 19, maxNativeZoom: 19, zIndex: 2, keepBuffer: 1, updateWhenZooming: false,
    bounds: [[-35.6, 112.9], [-13.6, 129.1]], attribution: 'Aerial photos © <a href="https://www.landgate.wa.gov.au">Landgate</a> (WA Government, SLIP)' });
  baseLayers.street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });

  map.createPane('underwater'); map.getPane('underwater').style.zIndex = 350;
  map.createPane('depthPane'); map.getPane('depthPane').style.zIndex = 360;   // above seabed habitat
  overlays.depth = L.tileLayer.wms('https://wms.gebco.net/mapserv?', {
    layers: 'GEBCO_LATEST', format: 'image/png', transparent: true, opacity: 0.55, pane: 'underwater', maxZoom: 10,
    attribution: 'Depth: <a href="https://www.gebco.net">GEBCO Compilation Group</a>'
  });
  // detailed nearshore depth (Transport WA surveys) from zoom 11; GEBCO above covers the zoomed-out view
  overlays.depthDetail = makeDepthLayer(L);
  // quick feedback while depth tiles load, and a hint when zoomed out too far for survey detail
  overlays.depthDetail.on('loading', () => { if (map.getZoom() >= 11) toast('Loading water depth…', 4000); });
  overlays.depthDetail.on('load', () => { const t = document.getElementById('toast'); if (t.textContent.startsWith('Loading water depth')) t.hidden = true; });
  loadDepthIndex();
  // Seabed habitat: tiles pre-rendered from Seamap Australia (pipeline/fetch_habitat.py) and served from this site —
  // fast, and only tiles that actually contain mapped habitat are requested.
  let habIdx = null;
  const habReady = fetch('data/habitat/index.json').then(r => r.json()).then(j => { habIdx = new Set(Object.entries(j.tiles).flatMap(([z, v]) => v.map(k => `${z}/${k}`))); }).catch(() => { habIdx = new Set(); });
  const Hab = L.TileLayer.extend({
    createTile(c, done) {
      const img = document.createElement('img');
      img.alt = ''; img.setAttribute('role', 'presentation');
      habReady.then(() => {
        if (!habIdx.has(`${c.z}/${c.x}/${c.y}`)) { done(null, img); return; }
        img.onload = () => done(null, img); img.onerror = () => done(null, img);
        img.src = `data/habitat/${c.z}/${c.x}/${c.y}.png`;
      });
      return img;
    }
  });
  overlays.habitat = new Hab('', { minNativeZoom: 8, maxNativeZoom: 13, minZoom: 7, maxZoom: 19, opacity: 0.7, pane: 'underwater', keepBuffer: 3,
    attribution: 'Habitat: <a href="https://seamapaustralia.org">Seamap Australia</a> (UTAS, CC BY 4.0)' });

  map.attributionControl.addAttribution('Forecasts: <a href="https://open-meteo.com/">Open-Meteo</a>');
  // Every official zone is drawn (tap inside one for its exact rules):
  //  red = no fishing · orange dashed = special rules · green dashed = spearfishing allowed area (Marmion)
  //  blue dashed = marine park edge · purple dotted = gear or species rules (lobster pots, wire trace, closures)
  zoneLayer = L.geoJSON(null, { interactive: false, style: f => {
    const p = f.properties || {};
    if (p.zone_type === 'sanctuary') return { color: '#e15759', weight: 2, fillOpacity: 0.25 };
    if (p.zone_type === 'restricted') return { color: '#f5a524', weight: 2, fillOpacity: 0.14, dashArray: '5 4' };
    if (p.zone_type === 'permit') return { color: '#30d158', weight: 1.5, fillOpacity: 0.06, dashArray: '8 5' };
    if (p.zone_type === 'gear' || p.zone_type === 'species') return { color: '#b37feb', weight: 1.2, fillOpacity: 0, dashArray: '2 5' };
    if (p.zone_type === 'general_use') return { color: '#4e79a7', weight: 1, fillOpacity: 0, dashArray: '6 6' };
    return { color: '#4e79a7', weight: 1, fillOpacity: 0, dashArray: '6 6' };
  } }).addTo(map);
  zoneLabels = L.layerGroup().addTo(map);
  amenityLayer = L.layerGroup().addTo(map);
  initCoastMap(map);
  window.__wafiMap = map; // handy for debugging in the browser console
  markerLayer = L.layerGroup().addTo(map);

  applyLayers();
  buildControls();
  buildSearch(); buildHelp();
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
        <label class="tog"><input type="checkbox" data-layer="${l.id}" ${(l.id === 'currentFlow' ? viewOn()[l.id] : on[l.id]) ? 'checked' : ''} ${wx ? 'disabled' : ''}>
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
  const fav = store.favourites().has(loc.id);
  const [lng, lat] = loc.geometry.coordinates;
  // the parts that change with the time slider
  const parts = () => {
    const ev = evalFor(loc), hr = hourRow(ev), t = selectedTime();
    const ls = legalStatus(state.data.zones, loc, state.activity, { t });
    const tg = ls.state === 'blocked' ? [] : likelyTargets(loc, hr?.hour, state.activity, { max: 3, zones: state.data.zones }).filter(x => x.level === 'good' || x.level === 'possible');
    const v = verdict(ev, hr, ls, state.activity, t);
    const top = `
      <div class="small muted">${esc(REGIONS[loc.region]?.name ?? loc.region ?? '')} · ${esc(TYPE_LABELS[loc.type] ?? loc.type)} · ${state.activity === 'spear' ? 'spearfishing' : 'shore fishing'} · <strong>${timeLabel() === 'Now' ? 'now' : esc(timeLabel())}</strong></div>
      ${verdictHTML(v)}
      <div class="ticks">${tick(ls.state === 'blocked' ? 'no' : ls.state === 'caution' ? 'care' : 'yes', 'Allowed?', ls.state === 'blocked' ? 'No' : ls.state === 'caution' ? 'Yes, extra rules' : 'Yes')}
        ${tick(!hr ? 'unknown' : hr.blockKind === 'safety' ? 'no' : hr.blockKind === 'dark' ? 'no' : hr.cautions?.length ? 'care' : 'yes', 'Safe?', !hr ? '?' : hr.blockKind === 'safety' ? 'No' : hr.blockKind === 'dark' ? 'Dark' : hr.cautions?.length ? 'Take care' : 'Within limits')}
        ${tick(!hr || hr.blocked || hr.score == null ? 'unknown' : band(hr.score) === 'good' ? 'yes' : band(hr.score) === 'fair' ? 'care' : 'no', 'Conditions', !hr || hr.blocked || hr.score == null ? '—' : `${BAND_LABEL[band(hr.score)]} ${hr.score}`)}</div>
      ${ev.applicable === false ? '' : hourStrip(ev, t)}
      ${ev.applicable === false || ls.state === 'blocked' ? '' : `<div class="small">⏱ ${bestTimeText(ev, t)}</div>`}
      ${tg.length ? `<div class="small">🎯 Fish likely around now: ${esc(tg.map(x => x.name).join(', '))}</div>` : ''}`;
    const half = plainify(`${ev.applicable === false ? '' : fourChecks(loc, ev, hr, state.data.zones, state.activity)}
      ${ls.zones?.length || ls.state !== 'ok' ? legalHTML(ls) : ''}`);
    return { top: plainify(top), half, hr };
  };
  const p0 = parts();
  const html = `
    <div class="spot-sum"><div data-top>${p0.top}</div>
      <div class="row sheet-actions">
        <button class="btn" data-act="more">Why? More details</button>
        <a class="btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Directions</a>
        <button class="btn ghost" data-act="fav" aria-pressed="${fav}">${fav ? '★ Saved' : '☆ Save'}</button>
        <a class="btn ghost" href="#/diary" data-act="log">📓 Log a trip</a>
        <a class="btn ghost" href="#/measure">📏 Measure</a>
      </div>
    </div>
    <div class="spot-half"><h3 class="sheet-h3">The details</h3><div data-half>${p0.half}</div>
      <div class="small" id="spot-depth" style="margin-top:6px">Depth: checking…</div></div>
    <div class="spot-full" data-full></div>`;
  const body = openSheet(html, {
    title: loc.name, state: 'peek',
    onClose: () => { state.selectedId = null; sheetRefresher = null; markSelected(); },
    onState: (st, b) => {
      const box = b.querySelector('[data-full]');
      if (st === 'full' && box && !box.dataset.done) { box.dataset.done = '1'; renderLocation(box, loc.id); }
    }
  });
  sheetRefresher = () => {
    const p = parts();
    const a = body.querySelector('[data-top]'), b = body.querySelector('[data-half]');
    if (a) a.innerHTML = p.top; if (b) b.innerHTML = p.half;
  };
  body.onclick = e => {
    const c = e.target.closest('[data-t]');
    if (c) { setSelectedTime(+c.dataset.t); return; }
    if (e.target.closest('[data-act="log"]')) { setDraft({ loc: loc.id, act: state.activity, t: selectedTime() }); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'more') setSheetState('full');
    if (b.dataset.act === 'fav') { const on = store.toggleFavourite(loc.id); b.textContent = on ? '★ Saved' : '☆ Save'; b.setAttribute('aria-pressed', String(on)); }
  };
  // depth ~60 m out from the spot (the pin itself sits on the shoreline)
  const off = loc.estuary ? { lat, lng } : (offshorePoint(lat, lng, 0.06) || { lat, lng });
  depthAt(off.lat, off.lng).then(d => {
    const el = body.querySelector('#spot-depth'); if (!el) return;
    const tc = measuredTide(lat, lng), sl = p0.hr?.hour?.sea_level;
    el.innerHTML = depthText(d, sl != null && tc && tc.ageH < 6 && Math.abs(tc.offset) >= 0.05 ? sl + tc.offset : sl).replace('Depth:', loc.estuary ? 'Depth here:' : 'Depth ~60 m out:')
      + (tc ? `<div class="muted">${esc(tideCheckText(tc))}</div>` : '');
  });
  markSelected();
  // keep the chosen spot visible above the sheet without changing the zoom
  const pt = map.latLngToContainerPoint([lat, lng]), h = map.getSize().y;
  if (pt.y > h * 0.62) map.panBy([0, pt.y - h * 0.4], { animate: true });
}
const tick = (cls, label, val) => `<div class="tick t-${cls}"><span>${label}</span><b>${cls === 'yes' ? '✓' : cls === 'no' ? '✗' : cls === 'care' ? '⚠' : '?'} ${esc(val)}</b></div>`;
export function setSheetRefresher(fn) { sheetRefresher = fn; }
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
  if (base === 'satellite' && on.aerial && !lite()) { if (!map.hasLayer(overlays.aerial)) overlays.aerial.addTo(map); } else map.removeLayer(overlays.aerial);
  syncClarity(on);
  for (const id of ['depth', 'habitat']) {
    if (on[id]) overlays[id].addTo(map); else map.removeLayer(overlays[id]);
  }
  if (on.depth) overlays.depthDetail.addTo(map); else map.removeLayer(overlays.depthDetail);
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
  syncClarity(on);
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
      html: `<div class="mk ${cls}${hr && !hr.blocked && hr.cautions?.length ? ' care' : ''} conf-${ev.confidence?.level ?? 'low'}" aria-hidden="true">${text}</div>${subLabel(loc, ev, on)}`,
      iconSize: [38, 38], iconAnchor: [19, 19]
    });
    const m = L.marker([lat, lng], { locId: loc.id, icon, title: `${loc.name}: ${ev.applicable === false ? 'not rated for this activity' : ev.band}`, alt: loc.name, keyboard: true, zIndexOffset: 1000 });
    m.on('click', () => openSpotSheet(loc));
    m.on('add', () => { const el = m.getElement(); if (el) { el.dataset.loc = loc.id; el.classList.toggle('selected', loc.id === state.selectedId); } });
    markerLayer.addLayer(m);
  }
  zoneLabels.clearLayers();
  const zkey = on.zones && state.data?.zones?.features?.length ? state.data.zones : null;
  if (zkey !== zonesDrawn) { zoneLayer.clearLayers(); if (zkey) zoneLayer.addData(zkey); zonesDrawn = zkey; }   // polygons only redrawn when they change
  if (zkey) {
    // names on the water when zoomed in, so you can see exactly which zone you are looking at
    if (map.getZoom() >= 13) {
      const vb = map.getBounds();
      for (const f of state.data.zones.features) {
        const p = f.properties || {};
        if (!['sanctuary', 'restricted', 'permit'].includes(p.zone_type)) continue;
        const c = labelPoint(f.geometry); if (!c || !vb.contains(c)) continue;
        const ic = p.zone_type === 'sanctuary' ? '⛔' : p.zone_type === 'permit' ? '🔱✓' : '⚠';
        const short = p.name.replace(/\s*\((Ngari Capes|Marmion|Shoalwater Islands) Marine Park\)/, '').replace(/\s*\(Rottnest Island\)/, '');
        L.marker(c, { interactive: false, keyboard: false, icon: L.divIcon({ className: `zone-label zl-${p.zone_type}`, html: `<span>${ic} ${esc(short)}</span>`, iconSize: [160, 20], iconAnchor: [80, 10] }) }).addTo(zoneLabels);
      }
    }
  }
  refreshCoastMap();
  if (sheetRefresher && sheetState()) sheetRefresher();   // the open card follows the time slider / play
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
  if (on.zones) parts.push('<div class="lg-h">Rules (tap inside for the exact rules)</div><span><i class="key-zone sanct" style="width:16px;height:10px"></i> No fishing</span><span><i class="key-zone restr" style="width:16px;height:10px"></i> Special rules</span><span><i class="key-zone permit" style="width:16px;height:10px"></i> Spearfishing area</span><span><i class="key-zone gear" style="width:16px;height:10px"></i> Gear / species rules</span><span><i class="key-zone park" style="width:16px;height:10px"></i> Marine park edge</span>');
  if (on.buoys) parts.push('<div class="lg-h">Buoys (measured)</div><span style="color:#30d158">■ under 1 h old</span><span style="color:#f5a524">■ 1–3 h</span><span style="color:#e5484d">■ older — not current</span>');
  if (on.depth) parts.push('<div class="lg-h">Water depth</div>' + DEPTH_BANDS.map(([max, c], i) => `<span><i class="dot" style="background:rgb(${c.join(',')});border-radius:2px"></i>${i ? DEPTH_BANDS[i - 1][0] : 0}${max === Infinity ? '+' : '–' + max} m</span>`).join('') + '<span class="muted">zoom in for survey detail</span>');
  if (on.waves) parts.push('<div class="lg-h">Wave height (arrows point where waves go)</div>' + [[0.3, 'under 0.5 m calm'], [0.7, '0.5–1 m small'], [1.2, '1–1.5 m moderate'], [2, '1.5–2.5 m big'], [3, '2.5 m+ very big']].map(([v, t]) => `<span><i class="dot" style="background:${waveColor(v)}"></i>${t}</span>`).join(''));
  if (on.clarity) parts.push('<div class="lg-h">Water clarity (satellite' + (state.clarity?.date ? ', ' + new Date(state.clarity.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ' — loading') + ')</div>' + CLARITY_BANDS.map(b => `<span><i class="dot" style="background:${b.color}"></i>${b.label} · ${b.vis}</span>`).join(''));
  if (on.sst) parts.push('<div class="lg-h">Sea temperature</div>' + [14, 17, 19, 21, 24].map(v => `<span><i class="dot" style="background:${sstColor(v)}"></i>${v} °C</span>`).join(''));
  if (on.windFlow) parts.push('<div class="lg-h">Wind streaks</div><span>white light · blue moderate · yellow fresh · red strong</span>');
  if (on.currentFlow) parts.push('<div class="lg-h">Water movement (current)</div>' + CURRENT_BANDS.map(b => `<span><i class="dot" style="background:${currentColor(b.max === Infinity ? 9 : b.max - 0.5)}"></i>${b.label} ${b.max === Infinity ? '3+' : (b.max - 1) + '–' + b.max} km/h</span>`).join('') + '<span class="muted">offshore forecast — not rips</span>');
  if (state.targetSpecies) parts.push(`<div class="lg-h">Species filter</div><span>Only spots where it's likely now</span>`);
  parts.push('<a href="#/key" class="small">Full key →</a>');
  document.getElementById('legend').innerHTML = parts.join('');
}

function buildLegend() {
  const hl = document.getElementById('habitat-legend');
  const k = [['#02DC00', 'Seagrass'], ['#2D9624', 'Seaweed / kelp'], ['#640000', 'Rocky reef'], ['#CC6600', 'Reef + sand'], ['#FFF9A5', 'Sand'], ['#1AA3FF', 'Mixed life'], ['#FF99E6', 'Sponges']];
  hl.innerHTML = `<strong class="small">Seabed habitat</strong><div class="hab-key">${k.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>
    <span class="small muted">No colour = not mapped (not "no reef"). <a href="#/key">All colours →</a></span>`;
}

function buildHelp() {
  document.getElementById('help-btn')?.addEventListener('click', openGuide);
  let seen = null; try { seen = localStorage.getItem('wafi.guide'); } catch {}
  if (!seen) setTimeout(() => { if (!sheetState() && (location.hash || '#/map').startsWith('#/map')) openGuide(); }, 2500);
}

function buildSearch() {
  const input = document.getElementById('search');
  const list = document.getElementById('search-results');
  let timer = null, seq = 0, lastPlaces = [];
  const close = () => { list.hidden = true; list.innerHTML = ''; };
  const row = i => `<li><button data-kind="${i.kind}" data-id="${esc(i.id ?? '')}" data-lat="${i.lat ?? ''}" data-lng="${i.lng ?? ''}" data-name="${esc(i.name)}">${i.kind === 'place' ? '📍 ' : i.kind === 'region' ? '🗺 ' : '🎣 '}${esc(i.name)}<small>${esc(i.sub ?? '')}</small></button></li>`;
  const draw = (q, places, loading) => {
    const regions = Object.entries(REGIONS).filter(([, r]) => r.name.toLowerCase().includes(q)).map(([id, r]) => ({ kind: 'region', id, name: r.name, sub: 'Area' }));
    const all = [...state.data.locations, ...(state.osmSpots || []).filter(l => !/^(Beach|Jetty|Groyne|Reef|Rock|Point)/.test(l.name))];
    const spots = all.filter(l => l.name.toLowerCase().includes(q)).slice(0, 5)
      .map(l => ({ kind: 'spot', id: l.id, name: l.name, sub: `Fishing spot · ${REGIONS[l.region]?.name ?? ''}` }));
    const items = [...regions, ...spots, ...places];
    list.innerHTML = items.map(row).join('') +
      (loading ? '<li class="muted small" style="padding:10px">Searching places…</li>' : !items.length ? '<li class="muted small" style="padding:10px">Nothing found — try a town or beach name.</li>' : '') +
      (places.length ? '<li class="muted small" style="padding:6px 10px">Places from OpenStreetMap (Nominatim)</li>' : '');
    list.hidden = false;
  };
  // Places (campgrounds, towns, beaches, boat ramps…) from OpenStreetMap's free search, limited to WA.
  // Waits until you stop typing (fair use: max ~1 request a second).
  const lookPlaces = async (q, my) => {
    try {
      const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=au&viewbox=112.5,-13.5,129.1,-35.4&bounded=1&accept-language=en&q=${encodeURIComponent(q)}`;
      const res = await fetch(u, { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : []));
      if (my !== seq) return;
      lastPlaces = res.map(r => {
        const parts = String(r.display_name || '').split(',').map(x => x.trim());
        return { kind: 'place', name: r.name || parts[0], sub: parts.slice(1, 3).join(', '), lat: +r.lat, lng: +r.lon };
      }).filter(p => Number.isFinite(p.lat));
      draw(q, lastPlaces, false);
    } catch { if (my === seq) draw(q, [], false); }
  };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clearTimeout(timer); seq++;
    if (q.length < 2) return close();
    draw(q, [], q.length >= 3);
    if (q.length >= 3) { const my = seq; timer = setTimeout(() => lookPlaces(input.value.trim(), my), 600); }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = list.querySelector('button'); first?.click(); } if (e.key === 'Escape') { close(); input.blur(); } });
  list.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    rememberView();
    if (b.dataset.kind === 'spot') {
      const loc = [...state.data.locations, ...(state.osmSpots || [])].find(l => l.id === b.dataset.id);
      const [lng, lat] = loc.geometry.coordinates;
      map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
      map.once('moveend', () => openSpotSheet(loc));
    } else if (b.dataset.kind === 'place') {
      const lat = +b.dataset.lat, lng = +b.dataset.lng, name = b.dataset.name;
      map.flyTo([lat, lng], 14, { duration: 0.9 });
      map.once('moveend', () => placeReport(lat, lng, name));
    } else {
      const locs = state.data.locations.filter(l => l.region === b.dataset.id);
      if (locs.length) map.flyToBounds(locs.map(l => [l.geometry.coordinates[1], l.geometry.coordinates[0]]), { maxZoom: 12, padding: [40, 40] });
    }
    input.value = ''; close(); input.blur();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) close(); });
}

// a point inside a zone polygon for its name label: area centroid, or the middle of the widest inside stretch
// along that latitude when the shape is curved (e.g. Marmion's offshore band)
function labelPoint(g) {
  const rings = g?.type === 'Polygon' ? [g.coordinates[0]] : g?.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [];
  if (!rings.length) return null;
  const big = rings.reduce((a, r) => (r.length > a.length ? r : a));
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, j = big.length - 1; i < big.length; j = i++) {
    const f = big[j][0] * big[i][1] - big[i][0] * big[j][1];
    A += f; cx += (big[j][0] + big[i][0]) * f; cy += (big[j][1] + big[i][1]) * f;
  }
  if (!A) return null;
  cx /= 3 * A; cy /= 3 * A;
  const xs = [];
  for (let i = 0, j = big.length - 1; i < big.length; j = i++) {
    const [x1, y1] = big[j], [x2, y2] = big[i];
    if ((y1 > cy) !== (y2 > cy)) xs.push(x1 + (cy - y1) * (x2 - x1) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
  if (best && !(cx > best[0] && cx < best[1]) && !xs.some((x, k) => k % 2 === 0 && cx > x && cx < xs[k + 1])) cx = (best[0] + best[1]) / 2;
  return [cy, cx];
}

// From other pages (Forecast list): go to the map, fly to the spot and open its card
export function showSpotOnMap(id) {
  const l = [...state.data.locations, ...(state.osmSpots || [])].find(x => x.id === id);
  if (!l) return;
  if (location.hash !== '#/map') location.hash = '#/map';
  setTimeout(() => {
    map.invalidateSize();
    map.setView([l.geometry.coordinates[1], l.geometry.coordinates[0]], Math.max(map.getZoom(), 14), { animate: false });
    openSpotSheet(l);
  }, 120);
}
export function showPlaceOnMap(p) {
  if (location.hash !== '#/map') location.hash = '#/map';
  setTimeout(() => { map.invalidateSize(); map.setView([p.lat, p.lng], 13, { animate: false }); placeReport(p.lat, p.lng, p.name); }, 120);
}

// "How to use" — the whole workflow in 3 plain steps. Shown once on first visit, then from the ? button.
export function openGuide() {
  setSheetRefresher(null);
  const b = openSheet(`
    <ol class="guide">
      <li><b>1 · Where?</b> Type your town, campsite or beach in the search box — or just move the map and tap the water or a numbered pin.
        <span>Pick <b>Fishing</b> (rod and line from shore) or <b>Spear</b> (spearfishing) at the top first.</span></li>
      <li><b>2 · When?</b> Drag the time bar at the bottom (or press ▶) — every pin and the open card change to that hour.
        <span>In a spot card, the coloured bar shows the next 48 hours: green good · orange fair · striped take care · grey not safe · dark = night. Tap an hour to jump there.</span></li>
      <li><b>3 · Go or not?</b> The top of every card gives one answer:
        <span>✅ <b>Good time to go</b> · 👌 OK · ⚠ <b>Take care</b> (allowed, but close to a safety limit — experienced people only) · 🚫 <b>Not safe</b> (with the next safer time) · ⛔ <b>Not allowed</b> (no-fishing area or banned activity).</span>
        <span>Underneath: <b>Allowed?</b> (official rules) · <b>Safe?</b> (waves, wind, current against safety limits) · <b>Conditions</b> (score 0–100 — how good the weather and water are, not a fish count).</span></li>
    </ol>
    <p class="small muted">Always look at the water yourself before you go in — forecasts can be wrong. Signs on site beat the app.</p>
    <div class="row" style="gap:8px"><button class="btn" data-g="ok">Got it</button><a class="btn ghost" href="#/key">More help (Learn)</a></div>`,
    { title: 'How to use — 3 steps', state: 'half' });
  b.onclick = e => { if (e.target.closest('[data-g]')) closeSheet(); };
  try { localStorage.setItem('wafi.guide', '1'); } catch {}
}

function syncClarity(on) {
  // satellite clarity picture (rebuilt when a new satellite day arrives)
  if (on.clarity && state.clarity && !lite()) {
    if (clarityLayer?._date !== state.clarity.date) {
      clarityLayer?.remove();
      const im = clarityImage(state.clarity);
      clarityLayer = window.L.imageOverlay(im.url, im.bounds, { opacity: 0.6, pane: 'underwater', className: 'clarity-img', attribution: 'Water clarity: NOAA CoastWatch (VIIRS/OLCI Kd490)' });
      clarityLayer._date = state.clarity.date;
    }
    if (!map.hasLayer(clarityLayer)) clarityLayer.addTo(map);
  } else if (clarityLayer) map.removeLayer(clarityLayer);
}

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
  { group: 'Conditions', id: 'coast', label: 'Coastline colour', note: 'Conditions every ~8 km of coast at the chosen time. Tap the coast anywhere for details. Not a list of fishing spots.' },
  { group: 'Conditions', id: 'windFlow', label: 'Wind flow (animated)', note: 'Forecast — moving streaks follow the wind. White = light, blue = moderate, yellow = fresh, red = strong.' },
  { group: 'Conditions', id: 'swellFlow', label: 'Swell lines (animated)', note: 'Forecast — blue wave lines roll toward the shore. Bigger/thicker = bigger swell, slower = longer period. Zoom in to see them.' },
  { group: 'Conditions', id: 'wind', label: 'Wind speed labels', note: 'Forecast km/h with a direction arrow (zoom in)' },
  { group: 'Conditions', id: 'waves', label: 'Wave height labels', note: 'Forecast metres with a direction arrow (zoom in)' },
  { group: 'Conditions', id: 'buoys', label: 'Measured wave buoys', note: 'Real readings from WA Dept of Transport buoys (30–60 m deep, not at the beach)' },
  { group: 'Conditions', id: 'sst', label: 'Sea temperature', note: 'Modelled, shown at each spot' },
  { group: 'Under the water', id: 'habitat', label: 'Seabed habitat', note: 'Reef, seagrass (weed) and sand where mapped — Seamap Australia. Coverage is patchy close to shore.' },
  { group: 'Under the water', id: 'depth', label: 'Depth (general)', note: 'GEBCO ~450 m grid — shows the drop-off, not detail. Not for navigation.' },
  { group: 'Legal', id: 'zones', label: 'Marine parks & sanctuary zones', note: 'Marine parks & sanctuary zones' },
  { group: 'Safety', id: 'incidents', label: 'Past shark incidents', note: 'Australian Shark-Incident Database (Taronga), Perth–Esperance. Skull = fatal, ! = injury, grey = no injury.' },
  { group: 'Facilities', id: 'tackle', label: 'Tackle & bait shops', note: 'From OpenStreetMap' },
  { group: 'Facilities', id: 'fuel', label: 'Servos', note: 'Many sell bait, but OpenStreetMap doesn\'t record which — call ahead' },
  { group: 'Facilities', id: 'toilets', label: 'Public toilets', note: 'From OpenStreetMap' },
  { group: 'Facilities', id: 'food24', label: '24/7 food', note: 'Places tagged open 24/7 on OpenStreetMap' },
  { group: 'Facilities', id: 'parking', label: 'Car parks near the coast', note: 'Public car parks within ~2 km of the shore (OpenStreetMap)' }
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
export const viewOn = () => isWeatherView()
  ? { ...layerOn(), coast: false, zones: false, incidents: false, tackle: false, fuel: false, toilets: false, food24: false, parking: false,
      windFlow: true, swellFlow: true, wind: true, waves: true, buoys: true }
  : layerOn();
const setLayer = (k, v) => store.set('layers', { ...layerOn(), [k]: v });

export function getMap() { return map; }

export function initMap() {
  const L = window.L;
  // keep popups clear of the search bar/legend at the top and the time bar at the bottom
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 215), autoPanPaddingBottomRight: L.point(70, 160), maxWidth: 300 });
  map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView([CONFIG.MAP_START.lat, CONFIG.MAP_START.lng], CONFIG.MAP_START.zoom);

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
  zoneLayer = L.geoJSON(null, { style: f => {
    const p = f.properties || {};
    if ((p.prohibits || []).length || p.zone_type === 'sanctuary') return { color: '#e15759', weight: 2, fillOpacity: 0.25 };
    if (p.zone_type === 'marine_park') return { color: '#4e79a7', weight: 1, fillOpacity: 0, dashArray: '6 6' };
    return { color: '#4e79a7', weight: 1.5, fillOpacity: 0.1 };
  } }).addTo(map);
  amenityLayer = L.layerGroup().addTo(map);
  initCoastMap(map);
  window.__wafiMap = map; // handy for debugging in the browser console
  markerLayer = L.layerGroup().addTo(map);

  applyLayers();
  buildLayerPanel();
  buildFacilitiesPicker();
  buildSearch();
  buildLegend();
  refreshMap();
  map.on('moveend', renderAmenities);
  // Don't redraw pins while a spot pop-up is open (the pop-up's own auto-pan would close it); redraw on close.
  const spotPopupOpen = () => !!map._popup && map.hasLayer(map._popup) && !!map._popup._source?.options?.alt;
  map.on('moveend', () => { if (state.osmSpots.length && !spotPopupOpen()) refreshMap(); });
  map.on('popupclose', e => { if (e.popup?._source?.options?.alt && state.osmSpots.length) setTimeout(refreshMap, 0); });
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
  document.getElementById('legend').hidden = isWeatherView();
  if (lastView !== (state.mapView || 'spots')) { lastView = state.mapView || 'spots'; renderAmenities(); }
  const reopen = map._popup && map.hasLayer(map._popup) ? map._popup._source?.options?.locId : null;
  markerLayer.clearLayers();
  const zoom = map.getZoom();
  const bounds = map.getBounds().pad(0.2);
  // Declutter: checked spots first, then the best-scoring OSM spots; skip a pin that would overlap one
  // already placed (zoom in to see more). Bigger fish = better score, so the best ones win.
  const placed = [];
  const cand = visibleLocations()
    .filter(loc => !loc.osm || (zoom >= 12 && bounds.contains([loc.geometry.coordinates[1], loc.geometry.coordinates[0]])))
    .map(loc => { const ev = evalFor(loc); return { loc, ev, hr: hourRow(ev) }; })
    .sort((a, b) => (a.loc.osm ? 1 : 0) - (b.loc.osm ? 1 : 0) || (b.hr?.score ?? -1) - (a.hr?.score ?? -1));
  for (const { loc, ev, hr } of cand) {
    if (isWeatherView() || !on.spots) break;   // Weather view or spots switched off: no spot pins
    if (ev.applicable === false) continue;   // e.g. beach spots in Spear mode: don't clutter the map
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
    m.bindPopup(() => `
      <strong>${esc(loc.name)}</strong><br>
      <span class="muted small">${esc(REGIONS[loc.region]?.name ?? loc.region)} · ${esc(TYPE_LABELS[loc.type] ?? loc.type)}</span>
      ${ev.applicable === false ? `<div style="margin:8px 0">${pill(ev)}</div>` : `
      <div class="small muted" style="margin-top:6px">${timeLabel()}</div>
      <div style="margin:2px 0 6px">${hr ? (hr.blocked ? blockPill(hr.blockKind) : `<span class="pill ${band(hr.score)}">${BAND_LABEL[band(hr.score)]} ${hr.score ?? '?'}</span>`) : '<span class="pill unknown">Unknown</span>'} ${hr ? chanceIcon(hr.score, state.activity, hr.blocked && (hr.blockKind || true)) : ''}</div>
      ${fourChecks(loc, ev, hr, state.data.zones, state.activity)}
      <div class="small" style="margin-top:4px">Next 24 h: ${pill(ev)} ${esc(windowText(ev))}</div>`}
      ${ev.applicable === false ? `<div class="small muted">Not listed for ${state.activity === 'spear' ? 'spearfishing' : 'shore fishing'}.</div>` : ''}
      ${ev.blocked ? `<div class="small">${esc(ev.blockReasons[0] ?? '')}</div>` : ''}
      <p style="margin:8px 0 0"><a href="#/live/${encodeURIComponent(loc.id)}">Live summary →</a> &nbsp; <a href="#/loc/${encodeURIComponent(loc.id)}">Full details →</a></p>`);
    markerLayer.addLayer(m);
    if (reopen && loc.id === reopen) setTimeout(() => m.openPopup(), 0);
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

const SHOW = [
  ['On the map', [['spots', 'Fishing spots & scores'], ['coast', 'Coast colour (conditions)'], ['buoys', 'Wave buoys (measured)'], ['zones', 'Marine parks & sanctuaries']]],
  ['Weather', [['windFlow', 'Wind animation'], ['swellFlow', 'Swell lines'], ['wind', 'Wind speed labels'], ['waves', 'Wave height labels']]],
  ['Safety history', [['incidents', 'Past shark incidents']]],
  ['Facilities', ['tackle', 'fuel', 'toilets', 'food24', 'parking'].map(id => [id, AMENITY_TYPES[id].label, AMENITY_TYPES[id].short])]
];
function buildFacilitiesPicker() {
  const btn = document.getElementById('fac-btn'), panel = document.getElementById('fac-panel');
  if (!btn || !panel) return;
  const draw = () => {
    const on = layerOn();
    const wx = isWeatherView();
    panel.innerHTML = `<h3>Show on the map</h3>${wx ? '<p class="small muted" style="margin:0 0 6px">Weather view shows wind, swell and buoys only. Tap Fishing or Spear to pick your own.</p>' : ''}` +
      SHOW.map(([g, items]) => `<div class="fac-group">${g}</div>` + items.map(([id, label, short]) => `<label><input type="checkbox" data-fac="${id}" ${on[id] ? 'checked' : ''} ${wx ? 'disabled' : ''}>
        ${short ? `<span class="am am-${id}" aria-hidden="true">${short}</span>` : ''}${esc(label)}</label>`).join('')).join('') +
      `<p class="small muted" style="margin:6px 0 0">Toilets, servos and food: within 10 km of the coast, zoom in to see them. More map styles under the layers button.</p>`;
  };
  btn.addEventListener('click', () => { const open = panel.hidden; panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) draw(); });
  panel.addEventListener('change', e => {
    const id = e.target.dataset.fac; if (!id) return;
    store.set('layers', { ...layerOn(), [id]: e.target.checked });
    draw(); applyLayers(); refreshMap();
  });
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
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

function buildLayerPanel() {
  const btn = document.getElementById('layers-btn');
  const panel = document.getElementById('layers-panel');
  const render = () => {
    const on = layerOn();
    const zonesLoaded = state.data?.zones?.loaded;
    const groups = [...new Set(LAYERS.map(l => l.group))];
    panel.innerHTML = `<h3>Base map</h3>
      ${BASES.map(b => `<label><input type="radio" name="base" value="${b.id}" ${on.base === b.id ? 'checked' : ''} ${b.needsKey && !CONFIG.ESRI_API_KEY ? 'disabled' : ''}> ${b.label}</label><small>${b.note}</small>`).join('')}
      ${groups.map(g => `<h3>${g}</h3>${LAYERS.filter(l => l.group === g).map(l => `
        <label><input type="checkbox" data-layer="${l.id}" ${on[l.id] ? 'checked' : ''}> ${l.label}</label>
        <small>${l.id === 'zones' && !zonesLoaded ? 'Zone data not loaded yet — legal status shows "Not yet checked"' : l.note}</small>`).join('')}`).join('')}
      <p class="small muted" style="margin-top:10px">Fishing locations are always shown.</p>`;
  };
  render();
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.addEventListener('change', e => {
    if (e.target.name === 'base') setLayer('base', e.target.value);
    else if (e.target.dataset.layer) setLayer(e.target.dataset.layer, e.target.checked);
    applyLayers();
    refreshMap();
  });
}

function buildLegend() {
  document.getElementById('legend').innerHTML = [
    ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['blk-legal', 'Not allowed'], ['blk-safety', 'Not safe'], ['unknown', 'Unknown']
  ].map(([c, t]) => `<span><i class="dot ${c}"></i>${t}</span>`).join('') +
    '<span>dashed pin = lower confidence</span>';
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
      map.setView([lat, lng], 13);
    } else {
      const locs = state.data.locations.filter(l => l.region === b.dataset.id);
      if (locs.length) map.fitBounds(locs.map(l => [l.geometry.coordinates[1], l.geometry.coordinates[0]]), { maxZoom: 12, padding: [40, 40] });
    }
    input.value = ''; close(); input.blur();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) close(); });
}

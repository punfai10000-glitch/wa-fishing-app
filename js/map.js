import { CONFIG, REGIONS, TYPE_LABELS } from './config.js';
import { state, evalFor, visibleLocations } from './app.js';
import * as store from './storage.js';
import { esc, pill, windowText, confText } from './ui.js';
import { fmtWind, fmtHeight, fmtTemp } from './units.js';
import { degToCompass } from './scoring/geo.js';
import { AMENITY_TYPES, loadAmenities } from './amenities.js';
import { initCoastMap, refreshCoastMap } from './coastmap.js';

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
  { group: 'Conditions', id: 'wind', label: 'Wind arrows (animated)', note: 'Forecast — arrows drift the way the wind blows' },
  { group: 'Conditions', id: 'waves', label: 'Wave & swell arrows (animated)', note: 'Forecast — offshore arrows show where waves travel' },
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
const DEFAULTS = { base: 'satellite', coast: true, buoys: true, food24: false, parking: false, incidents: true, wind: true, waves: false, sst: false, habitat: false, depth: false, zones: true, tackle: false, fuel: false, toilets: false };
export const layerOn = () => ({ ...DEFAULTS, ...store.get('layers', {}) });
const setLayer = (k, v) => store.set('layers', { ...layerOn(), [k]: v });

export function getMap() { return map; }

export function initMap() {
  const L = window.L;
  // keep popups clear of the search bar/legend at the top and the time bar at the bottom
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 150), autoPanPaddingBottomRight: L.point(70, 160), maxWidth: 300 });
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
  zoneLayer = L.geoJSON(null, { style: { color: '#e15759', weight: 2, fillOpacity: 0.15 } }).addTo(map);
  amenityLayer = L.layerGroup().addTo(map);
  initCoastMap(map);
  window.__wafiMap = map; // handy for debugging in the browser console
  markerLayer = L.layerGroup().addTo(map);

  applyLayers();
  buildLayerPanel();
  buildSearch();
  buildLegend();
  refreshMap();
  map.on('moveend', renderAmenities);
  map.on('moveend', () => { if (state.osmSpots.length) refreshMap(); });
}

function applyLayers() {
  const on = layerOn();
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

function subLabel(loc, ev, on) {
  const h = ev?.current?.hour;
  if (!h) return '';
  const bits = [];
  if (on.sst) bits.push(h.sst != null ? fmtTemp(h.sst) : 'SST ?');
  return bits.length ? `<span class="mk-sub">${esc(bits.join(' · '))}</span>` : '';
}

export function refreshMap() {
  if (!map) return;
  const L = window.L;
  const on = layerOn();
  markerLayer.clearLayers();
  const zoom = map.getZoom();
  const bounds = map.getBounds().pad(0.2);
  for (const loc of visibleLocations()) {
    if (loc.osm && (zoom < 10 || !bounds.contains([loc.geometry.coordinates[1], loc.geometry.coordinates[0]]))) continue;
    const ev = evalFor(loc);
    const [lng, lat] = loc.geometry.coordinates;
    const cls = ev.applicable === false ? 'na' : ev.band;
    const text = ev.applicable === false ? '–' : ev.band === 'blocked' ? '✕' : ev.score ?? '?';
    const icon = L.divIcon({
      className: loc.osm ? 'mk-wrap osm' : 'mk-wrap',
      html: `<div class="spot-ico ${state.activity}" aria-hidden="true">${state.activity === 'spear' ? SPEAR_SVG : FISH_SVG}</div><div class="mk ${cls} conf-${ev.confidence?.level ?? 'low'}" aria-hidden="true">${text}</div>${subLabel(loc, ev, on)}`,
      iconSize: [38, 38], iconAnchor: [19, 19]
    });
    const m = L.marker([lat, lng], { icon, title: `${loc.name}: ${ev.applicable === false ? 'not rated for this activity' : ev.band}`, alt: loc.name, keyboard: true, zIndexOffset: 1000 });
    m.bindPopup(() => `
      <strong>${esc(loc.name)}</strong><br>
      <span class="muted small">${esc(REGIONS[loc.region]?.name ?? loc.region)} · ${esc(TYPE_LABELS[loc.type] ?? loc.type)}</span>
      <div style="margin:8px 0">${pill(ev)} <span class="small">${esc(windowText(ev))}</span></div>
      ${ev.applicable === false ? `<div class="small muted">Not listed for ${state.activity === 'spear' ? 'spearfishing' : 'shore fishing'}.</div>` : ''}
      ${ev.blocked ? `<div class="small">${esc(ev.blockReasons[0] ?? '')}</div>` : ''}
      <div>${confText(ev.confidence)}</div>
      <p style="margin:8px 0 0"><a href="#/live/${encodeURIComponent(loc.id)}">Live summary →</a> &nbsp; <a href="#/loc/${encodeURIComponent(loc.id)}">Full details →</a></p>`);
    markerLayer.addLayer(m);
  }
  zoneLayer.clearLayers();
  if (on.zones && state.data?.zones?.features?.length) zoneLayer.addData(state.data.zones);
  refreshCoastMap();
}

async function renderAmenities() {
  if (!map) return;
  const L = window.L;
  const on = layerOn();
  amenityLayer.clearLayers();
  const wanted = Object.keys(AMENITY_TYPES).filter(k => on[k]);
  const note = document.getElementById('amenity-note');
  if (!wanted.length) { note.hidden = true; return; }
  const data = await loadAmenities();
  if (!data) { note.textContent = 'Shop, servo and toilet data hasn\'t been downloaded yet — see the README (Update facilities).'; note.hidden = false; return; }
  if (map.getZoom() < 10) { note.textContent = 'Zoom in to see shops, servos and toilets.'; note.hidden = false; return; }
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
    ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['blocked', 'Blocked ✕'], ['unknown', 'Unknown']
  ].map(([c, t]) => `<span><i class="dot" style="background:var(--${c})"></i>${t}</span>`).join('') +
    '<span>dashed = lower confidence</span>';
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

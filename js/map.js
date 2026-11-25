import { CONFIG, REGIONS, TYPE_LABELS } from './config.js';
import { state, evalFor, visibleLocations } from './app.js';
import * as store from './storage.js';
import { esc, pill, windowText, confText } from './ui.js';
import { fmtWind, fmtHeight, fmtTemp } from './units.js';
import { degToCompass } from './scoring/geo.js';

let map, markerLayer, zoneLayer;
const LAYERS = [
  { id: 'wind', label: 'Wind', note: 'Forecast, shown at each spot' },
  { id: 'waves', label: 'Waves', note: 'Forecast, shown at each spot' },
  { id: 'sst', label: 'Sea temperature', note: 'Modelled, shown at each spot' },
  { id: 'zones', label: 'Marine areas', note: 'Marine parks & sanctuary zones' },
  { id: 'tides', label: 'Tide stations', note: 'Measured gauges — connecting soon' }
];
const layerOn = () => ({ wind: false, waves: false, sst: false, zones: true, tides: false, ...store.get('layers', {}) });

export function initMap() {
  const L = window.L;
  map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: false })
    .setView([CONFIG.MAP_START.lat, CONFIG.MAP_START.lng], CONFIG.MAP_START.zoom);

  if (CONFIG.ESRI_API_KEY) {
    L.tileLayer(`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${CONFIG.ESRI_API_KEY}`, {
      maxZoom: 19, attribution: 'Powered by <a href="https://www.esri.com">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }).addTo(map);
  } else {
    document.getElementById('map').classList.add('osm-dark');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }
  map.attributionControl.addAttribution('Forecasts: <a href="https://open-meteo.com/">Open-Meteo</a>');

  zoneLayer = L.geoJSON(null, { style: { color: '#e15759', weight: 2, fillOpacity: 0.15 } }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  buildLayerPanel();
  buildSearch();
  buildLegend();
  refreshMap();
}

export function showMap(show) {
  document.getElementById('map-wrap').hidden = !show;
  if (show && map) setTimeout(() => map.invalidateSize(), 0);
}

function subLabel(loc, ev, on) {
  const h = ev?.current?.hour;
  if (!h) return '';
  const bits = [];
  if (on.wind && h.wind_speed != null) bits.push(`${degToCompass(h.wind_direction) ?? ''} ${fmtWind(h.wind_speed)}`);
  if (on.waves) bits.push(h.wave_height != null ? fmtHeight(h.wave_height) : 'waves ?');
  if (on.sst) bits.push(h.sst != null ? fmtTemp(h.sst) : 'SST ?');
  return bits.length ? `<span class="mk-sub">${esc(bits.join(' · '))}</span>` : '';
}

export function refreshMap() {
  if (!map) return;
  const L = window.L;
  const on = layerOn();
  markerLayer.clearLayers();
  for (const loc of visibleLocations()) {
    const ev = evalFor(loc);
    const [lng, lat] = loc.geometry.coordinates;
    const cls = ev.applicable === false ? 'na' : ev.band;
    const text = ev.applicable === false ? '–' : ev.band === 'blocked' ? '✕' : ev.score ?? '?';
    const icon = L.divIcon({
      className: 'mk-wrap',
      html: `<div class="mk ${cls} conf-${ev.confidence?.level ?? 'low'}" aria-hidden="true">${text}</div>${subLabel(loc, ev, on)}`,
      iconSize: [38, 38], iconAnchor: [19, 19]
    });
    const m = L.marker([lat, lng], { icon, title: `${loc.name}: ${ev.applicable === false ? 'not rated for this activity' : ev.band}`, alt: loc.name, keyboard: true });
    m.bindPopup(() => `
      <strong>${esc(loc.name)}</strong><br>
      <span class="muted small">${esc(REGIONS[loc.region]?.name ?? loc.region)} · ${esc(TYPE_LABELS[loc.type] ?? loc.type)}</span>
      <div style="margin:8px 0">${pill(ev)} <span class="small">${esc(windowText(ev))}</span></div>
      ${ev.applicable === false ? `<div class="small muted">Not listed for ${state.activity === 'spear' ? 'spearfishing' : 'shore fishing'}.</div>` : ''}
      ${ev.blocked ? `<div class="small">${esc(ev.blockReasons[0] ?? '')}</div>` : ''}
      <div>${confText(ev.confidence)}</div>
      <p style="margin:8px 0 0"><a href="#/loc/${encodeURIComponent(loc.id)}">Full details →</a></p>`);
    markerLayer.addLayer(m);
  }
  zoneLayer.clearLayers();
  if (on.zones && state.data?.zones?.features?.length) zoneLayer.addData(state.data.zones);
}

function buildLayerPanel() {
  const btn = document.getElementById('layers-btn');
  const panel = document.getElementById('layers-panel');
  const render = () => {
    const on = layerOn();
    const zonesLoaded = state.data?.zones?.loaded;
    panel.innerHTML = `<h3>Map layers</h3>
      <label><input type="checkbox" checked disabled> Fishing locations</label>
      ${LAYERS.map(l => `<label><input type="checkbox" data-layer="${l.id}" ${on[l.id] ? 'checked' : ''} ${l.id === 'tides' ? 'disabled' : ''}> ${l.label}</label>
        <small>${l.id === 'zones' && !zonesLoaded ? 'Zone data not loaded yet — legal status shows "Not yet checked"' : l.note}</small>`).join('')}`;
  };
  render();
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.addEventListener('change', e => {
    const id = e.target.dataset.layer;
    if (!id) return;
    store.set('layers', { ...layerOn(), [id]: e.target.checked });
    refreshMap();
  });
}

function buildLegend() {
  document.getElementById('legend').innerHTML = [
    ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['blocked', 'Blocked ✕'], ['unknown', 'Unknown']
  ].map(([c, t]) => `<span><i class="dot" style="background:var(--${c})"></i>${t}</span>`).join('') +
    '<span>dashed ring = lower confidence</span>';
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

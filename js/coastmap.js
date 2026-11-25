// Coastline conditions layer, animated wind/wave arrows, time slider with play,
// tap-anywhere spot reports, measured buoy markers and the Windy animated view.
import { state, evalFor } from './app.js';
import { layerOn, FISH_SVG, SPEAR_SVG } from './map.js';
import { nearestCoastPoint } from './coast.js';
import { nearest } from './amenities.js';
import { nearestBuoy } from './buoys.js';
import { loadPointConditions } from './data.js';
import { legalStatus } from './zones.js';
import { initFlow, setFlowData, flowPausedByDevice } from './flow.js';
import { loadShore, shoreData, offshorePoint, nearestShore } from './shore.js';
import { band, BAND_LABEL, visibilityEstimate } from './scoring/score.js';
import { degToCompass } from './scoring/geo.js';
import { esc, typeTag } from './ui.js';
import { fmtWind, fmtHeight, fmtTemp, fmtDateTime, fmtAge } from './units.js';

let map, coastLayer, arrowLayer, buoyLayer, incidentLayer, bestLayer;
let incidents = null;
let shoreIdx = null;     // per shoreline vertex: index of nearest coast sample point (or -1)
let offset = 0;          // hours from now shown on the coast
let playing = null;
const HOUR = 3600e3;
const COLORS = { good: '#009e73', fair: '#e69f00', poor: '#d55e00', blocked: '#6b7280', unknown: '#8a94a6' };

export function selectedTime() {
  return Math.floor(Date.now() / HOUR) * HOUR + offset * HOUR;
}

export function initCoastMap(m) {
  map = m;
  const L = window.L;
  map.createPane('coast'); map.getPane('coast').style.zIndex = 420;
  map.createPane('arrows'); map.getPane('arrows').style.zIndex = 430; map.getPane('arrows').style.pointerEvents = 'none';
  coastLayer = L.layerGroup().addTo(map);
  arrowLayer = L.layerGroup().addTo(map);
  buoyLayer = L.layerGroup().addTo(map);
  bestLayer = L.layerGroup().addTo(map);
  incidentLayer = L.layerGroup().addTo(map);
  fetch('data/incidents.json').then(r => r.json()).then(d => { incidents = d; refreshCoastMap(); }).catch(() => {});
  initFlow(map);
  loadShore().then(() => { shoreIdx = null; refreshCoastMap(); });
  buildTimeBar();
  buildWindy();
  map.on('click', e => onMapClick(e.latlng));
  map.on('zoomend', () => refreshCoastMap());
}

function hourAt(ev, t) {
  return ev?.hourly?.find(h => h.t === t) ?? null;
}

export function refreshCoastMap() {
  if (!map) return;
  const L = window.L;
  const on = layerOn();
  const t = selectedTime();
  coastLayer.clearLayers();
  arrowLayer.clearLayers();
  buoyLayer.clearLayers();
  bestLayer.clearLayers();
  incidentLayer.clearLayers();
  updateTimeLabel();

  const pts = state.coast.points;
  const hasData = state.coast.fetchedAt != null;
  if (on.coast && pts.length) {
    const sh = shoreData();
    const rows = pts.map(p => hasData ? hourAt(evalFor(p), t) : null);
    const bandOf = r => r?.blocked ? 'blocked' : r?.score != null ? band(r.score) : 'unknown';
    const weight = map.getZoom() >= 10 ? 8 : 5;
    if (sh?.lines.length && !sh.precise && map.getZoom() >= 12) {
      // rough bundled coastline is ~1 km out at this zoom: don't draw a misleading line (tap for details)
    } else if (sh?.lines.length) {
      // colour the REAL shoreline: each vertex takes the colour of its nearest conditions point (<= 6 km)
      if (!shoreIdx) shoreIdx = sh.lines.map(L => L.map(([x, y]) => {
        let bi = -1, bd = 6;
        pts.forEach((p, i) => { const [px, py] = p.geometry.coordinates; const d = Math.hypot((px - x) * Math.cos(y * Math.PI / 180), py - y) * 111; if (d < bd) { bd = d; bi = i; } });
        return bi;
      }));
      sh.lines.forEach((L, li) => {
        let run = [], runBand = null;
        const flush = () => {
          if (run.length > 1 && runBand) L_poly(run, runBand);
          run = [];
        };
        const L_poly = (latlngs, b) => window.L.polyline(latlngs, { pane: 'coast', color: COLORS[b], weight, opacity: 0.9, lineCap: 'round', lineJoin: 'round', dashArray: b === 'blocked' ? '4 8' : null, interactive: false }).addTo(coastLayer);
        L.forEach(([x, y], vi) => {
          const idx = shoreIdx[li][vi];
          const b = idx < 0 ? null : bandOf(rows[idx]);
          if (b !== runBand) { const last = run[run.length - 1]; flush(); if (last && b) run.push(last); runBand = b; }
          if (b) run.push([y, x]);
        });
        flush();
      });
    } else {
      let prev = null, prevRow = null;
      pts.forEach((p, i) => {
        const row = rows[i];
        if (prev) {
          const [x1, y1] = prev.geometry.coordinates, [x2, y2] = p.geometry.coordinates;
          const km = Math.hypot((x2 - x1) * Math.cos(y1 * Math.PI / 180), y2 - y1) * 111;
          if (km < 20) {
            const blocked = row?.blocked || prevRow?.blocked;
            const scores = [row?.score, prevRow?.score].filter(v => v != null);
            const b = blocked ? 'blocked' : scores.length ? band(scores.reduce((a, c) => a + c, 0) / scores.length) : 'unknown';
            L.polyline([[y1, x1], [y2, x2]], { pane: 'coast', color: COLORS[b], weight, opacity: 0.9, lineCap: 'round', dashArray: b === 'blocked' ? '4 8' : null, interactive: false }).addTo(coastLayer);
          }
        }
        prev = p; prevRow = row;
      });
    }
  }

  // Animated wind particles + swell lines (canvas, see flow.js)
  if (hasData && pts.length) {
    const wind = [], swell = [];
    for (const p of pts) {
      const h = hourAt(evalFor(p), t)?.hour;
      if (!h) continue;
      const [lng, lat] = p.geometry.coordinates;
      if (h.wind_speed != null && h.wind_direction != null) wind.push({ lat, lng, speed: h.wind_speed, from: h.wind_direction });
      const sh = h.swell_height ?? h.wave_height, sd = h.swell_direction ?? h.wave_direction;
      if (p.sea && sh != null && sd != null) swell.push({ lat: p.sea[0], lng: p.sea[1], height: sh, from: sd, period: h.swell_period ?? h.wave_period });
    }
    setFlowData(wind, swell, { wind: on.windFlow, swell: on.swellFlow });
  } else setFlowData([], [], {});
  const note = document.getElementById('flow-note');
  if (note) note.hidden = !(flowPausedByDevice() && (on.windFlow || on.swellFlow));

  if ((on.wind || on.waves) && hasData && pts.length && map.getZoom() >= 9) {
    const z = map.getZoom();
    const every = z >= 11 ? 1 : z >= 9 ? 2 : z >= 7 ? 4 : 7;
    const bounds = map.getBounds().pad(0.1);
    pts.forEach((p, i) => {
      if (i % every) return;
      const h = hourAt(evalFor(p), t)?.hour;
      if (!h) return;
      const [lng, lat] = p.geometry.coordinates;
      if (!bounds.contains([lat, lng])) return;
      if (on.wind && h.wind_speed != null && h.wind_direction != null) {
        arrowLayer.addLayer(arrowMarker([lat, lng], (h.wind_direction + 180) % 360, 'wind', Math.min(1.6, 0.7 + h.wind_speed / 40), `${Math.round(h.wind_speed)}`));
      }
      const wh = h.wave_height ?? h.swell_height, wd = h.wave_direction ?? h.swell_direction;
      if (on.waves && wh != null && wd != null && p.sea) {
        arrowLayer.addLayer(arrowMarker([p.sea[0], p.sea[1]], (wd + 180) % 360, 'wave', Math.min(1.7, 0.7 + wh / 2.5), `${wh.toFixed(1)}`));
      }
    });
  }

  // Best stretches right now: animated fish (shore) or spear (spear) on the top 3 coast points
  if (on.coast && hasData && pts.length) {
    const ranked = pts.map(p => ({ p, r: hourAt(evalFor(p), t) }))
      .filter(x => x.r && !x.r.blocked && x.r.score != null && x.r.score >= 70)
      .sort((a, b) => b.r.score - a.r.score);
    const picked = [];
    for (const x of ranked) { // spread them out (>= 40 km apart)
      if (picked.every(y => Math.hypot(y.p.geometry.coordinates[0] - x.p.geometry.coordinates[0], y.p.geometry.coordinates[1] - x.p.geometry.coordinates[1]) * 100 > 40)) picked.push(x);
      if (picked.length === 3) break;
    }
    for (const { p, r } of picked) {
      L.marker([p.geometry.coordinates[1], p.geometry.coordinates[0]], { pane: 'arrows', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'best-now', html: `${state.activity === 'spear' ? SPEAR_SVG : FISH_SVG}<div class="line"></div><span>Best ${state.activity === 'spear' ? 'spear' : 'fishing'} ${r.score}</span>`, iconSize: [90, 50], iconAnchor: [45, 58] }) }).addTo(bestLayer);
    }
  }

  if (on.incidents && incidents?.incidents) {
    for (const i of placedIncidents()) {
      const sym = i.outcome === 'fatal' ? '☠' : i.outcome === 'injured' ? '!' : '·';
      L.marker([i.plat, i.plon], { keyboard: true, title: `Shark incident ${i.year}`,
        icon: L.divIcon({ className: 'mk-wrap', html: `<div class="incident ${esc(i.outcome)}" aria-hidden="true">${sym}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
        .bindPopup(`<strong>Recorded shark incident</strong><br><span class="small">${esc(i.place)} · ${i.month ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i.month - 1] + ' ' : ''}${i.year}</span><br>
          <span class="small">Outcome: <strong>${esc(i.outcome)}</strong>${i.shark ? ` · ${esc(i.shark)}` : ''}${i.activity ? ` · while ${esc(i.activity)}` : ''}</span><br>
          ${i.moved ? '<span class="small muted">Exact spot not recorded — shown just offshore from the reported place.</span><br>' : ''}
          <span class="small muted">Australian Shark-Incident Database, Taronga Conservation Society Australia (records to ${incidents.records_to}). Check SharkSmart WA for current activity.</span>`)
        .addTo(incidentLayer);
    }
  }

  if (on.buoys && state.buoys?.buoys) {
    for (const b of state.buoys.buoys) {
      const icon = L.divIcon({ className: 'mk-wrap', html: `<div class="buoy" aria-hidden="true">${b.hs != null ? b.hs.toFixed(1) : '?'}<small>m</small></div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
      L.marker([b.lat, b.lon], { icon, title: `${b.site} buoy`, keyboard: true, zIndexOffset: 900 })
        .bindPopup(buoyHTML(b)).addTo(buoyLayer);
    }
  }
  document.getElementById('coast-status').textContent = !pts.length ? '' :
    hasData ? `Coast updated ${fmtAge(state.coast.fetchedAt)}` : 'Loading coastline conditions…';
}

// Shark incidents are recorded against a place name, so many coordinates land on the town or the beach car
// park. Move land-side ones just offshore of the nearest real shoreline (rivers/estuaries are left alone),
// and fan out repeats at the same place so they don't stack.
let placedCache = null;
function placedIncidents() {
  if (placedCache && placedCache.shore === shoreData()) return placedCache.list;
  const WATERWAY = /river|estuary|inlet|lake|creek|swan|canning|leschenault|peel/i;
  const seen = new Map();
  const list = incidents.incidents.map(i => {
    let plat = i.lat, plon = i.lon, moved = false, along = 0;
    const n = shoreData()?.segs.length ? nearestShore(i.lat, i.lon, 30) : null;
    if (n && !WATERWAY.test(i.place || '') && (n.onLand || n.km < 0.15)) {
      const k = `${n.lat.toFixed(3)}|${n.lng.toFixed(3)}`;
      const c = seen.get(k) || 0; seen.set(k, c + 1);
      along = (c % 2 ? -1 : 1) * Math.ceil(c / 2) * 0.18;           // 180 m steps along the shore
      const out = (shoreData().precise ? 0.35 : 0.9) + Math.floor(c / 6) * 0.2;   // rough coastline: go further out to be safe
      const b = n.seaBearing * Math.PI / 180, cosl = Math.cos(n.lat * Math.PI / 180);
      plat = n.lat + (Math.cos(b) * out - Math.sin(b) * along) / 111;
      plon = n.lng + (Math.sin(b) * out + Math.cos(b) * along) / (111 * cosl);
      moved = true;
    }
    return { ...i, plat, plon, moved };
  });
  placedCache = { shore: shoreData(), list };
  return list;
}

function arrowMarker(latlng, toDeg, kind, scale, label) {
  return window.L.marker(latlng, {
    pane: 'arrows', interactive: false, keyboard: false,
    icon: window.L.divIcon({
      className: 'arrow-wrap',
      html: `<div class="flow ${kind}" style="transform:rotate(${toDeg - 90}deg) scale(${scale.toFixed(2)})"><span class="glyph">➤</span></div><span class="flow-lbl ${kind}">${label}</span>`,
      iconSize: [34, 34], iconAnchor: [17, 17]
    })
  });
}

function buoyHTML(b) {
  return `<strong>${esc(b.site)} wave buoy</strong> ${typeTag('measured')}<br>
    <span class="small">Wave height ${b.hs != null ? fmtHeight(b.hs) : 'Unknown'}${b.tp != null ? `, period ${Math.round(b.tp)} s` : ''}${b.dir != null ? ` from ${degToCompass(b.dir)}` : ''}</span><br>
    ${b.swell_h != null ? `<span class="small">Swell ${fmtHeight(b.swell_h)}${b.swell_p != null ? ` @ ${Math.round(b.swell_p)} s` : ''}${b.swell_dir != null ? ` from ${degToCompass(b.swell_dir)}` : ''}</span><br>` : ''}
    ${b.sst != null ? `<span class="small">Water ${fmtTemp(b.sst)}</span><br>` : ''}
    <span class="small muted">Measured ${fmtAge(Date.parse(b.time))} (${fmtDateTime(Date.parse(b.time))}). WA Dept of Transport via AODN — not quality controlled. Buoy sits 30–60 m deep offshore.</span>`;
}

// ---- Tap anywhere: report for the EXACT point tapped -----------------------
let tapMarker = null;
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const comp = d => COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];

async function onMapClick(latlng) {
  const L = window.L;
  const { lat, lng } = latlng;
  const sample = nearestCoastPoint(lat, lng, 30);
  const sh = nearestShore(lat, lng, 25);
  if (!sample && !sh) return;
  const precise = !!shoreData()?.precise;
  const p = sample?.p ?? null;
  const facing = sh && precise ? Math.round(sh.seaBearing) : p?.facing ?? Math.round(sh.seaBearing);
  const sea = sh ? offshorePoint(lat, lng, 1.0) : null;
  const where = !sh || !shoreData()?.precise ? '' : sh.onLand
    ? `On land, about ${fmtDist(sh.km)} from the water`
    : `In the water, about ${fmtDist(sh.km)} from shore`;
  const loc = {
    id: `tap_${lat.toFixed(5)}_${lng.toFixed(5)}`,
    name: `Point near ${p?.near ?? 'the coast'}`,
    near: p?.near, region: p?.region, bioregion: p?.bioregion,
    type: 'beach', activities: ['shore', 'spear'], confidence: 'potential', status: 'auto',
    virtual: true, tap: true, condFrom: p?.id,
    geometry: { type: 'Point', coordinates: [lng, lat] },
    sea: sea ? [sea.lat, sea.lng] : p?.sea,
    facing,
    exposure: { onshore_dirs: [-45, -22.5, 0, 22.5, 45].map(o => comp(facing + o)), sheltered_dirs: [-45, -22.5, 0, 22.5, 45].map(o => comp(facing + 180 + o)) },
    terrain: [], access: null, species_evidence: [], restrictions: [], sources: ['tap'], safety_notes: []
  };
  state.tapLoc = loc; state.tapCond = null;

  if (tapMarker) tapMarker.remove();
  tapMarker = L.marker([lat, lng], { interactive: false, keyboard: false, zIndexOffset: 2000,
    icon: L.divIcon({ className: 'tap-pin', html: '<div class="tap-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);

  const popup = L.popup({ maxWidth: 310, autoPanPaddingTopLeft: [10, 140], autoPanPaddingBottomRight: [10, 120] })
    .setLatLng([lat, lng]).setContent(tapHTML(loc, where, sh, false)).openOn(map);
  popup.on('remove', () => { if (tapMarker) { tapMarker.remove(); tapMarker = null; } });
  fillNearby(popup, [lng, lat]);

  // exact forecast for this point (one small request), then redraw the popup
  const cond = await loadPointConditions(loc);
  if (state.tapLoc !== loc || !map.hasLayer(popup)) return;
  if (cond) { state.tapCond = cond; delete loc.condFrom; }
  popup.setContent(tapHTML(loc, where, sh, !!cond));
  fillNearby(popup, [lng, lat]);
}

function fmtDist(km) { return km < 1 ? `${Math.max(10, Math.round(km * 1000 / 10) * 10)} m` : `${km.toFixed(1)} km`; }

function tapHTML(loc, where, sh, exact) {
  const t = selectedTime();
  const [lng, lat] = loc.geometry.coordinates;
  const shore = evalFor(loc, 'shore'), spear = evalFor(loc, 'spear');
  const rs = hourAt(shore, t), rp = hourAt(spear, t);
  const h = rs?.hour ?? rp?.hour;
  const vis = rp?.hour ? visibilityEstimate(rp.hour, loc) : null;
  const moon = window.SunCalc.getMoonIllumination(new Date(t));
  const buoy = nearestBuoy(state.buoys, lat, lng);
  const legal = legalStatus(state.data.zones, loc);
  const pillFor = r => !r ? '<span class="pill unknown">Unknown</span>' : r.blocked ? '<span class="pill blocked">✕ Blocked</span>' : `<span class="pill ${band(r.score)}">${BAND_LABEL[band(r.score)]} ${r.score ?? ''}</span>`;
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `
    <strong>Exact point</strong> <span class="small muted">${lat.toFixed(5)}, ${lng.toFixed(5)}</span><br>
    ${where ? `<span class="small">${esc(where)}</span><br>` : ''}
    <span class="small muted">${t === Math.floor(Date.now() / HOUR) * HOUR ? 'Now' : fmtDateTime(t)} · water faces ${degToCompass(loc.facing)}</span>
    <div class="row" style="margin:8px 0;gap:6px"><div><div class="small muted">Shore</div>${pillFor(rs)}</div><div><div class="small muted">Spear</div>${pillFor(rp)}</div></div>
    ${[rs, rp].flatMap(r => r?.blocks ?? []).map(b => `<div class="small">✕ ${esc(b.reason)}</div>`).filter((v, i, a) => a.indexOf(v) === i).join('')}
    ${h ? `<div class="small">Wind ${degToCompass(h.wind_direction) ?? ''} ${fmtWind(h.wind_speed)}${h.wind_gust != null ? ` (gusts ${fmtWind(h.wind_gust)})` : ''} · Waves ${fmtHeight(h.wave_height)}${h.wave_period != null ? ` @ ${Math.round(h.wave_period)} s` : ''} · Tide ${h.tide_rate == null ? '?' : h.tide_rate > 0.005 ? 'rising' : h.tide_rate < -0.005 ? 'falling' : 'slack'} · Sea ${fmtTemp(h.sst)}</div>
      <div class="small">Visibility: ${vis ? vis.label : 'unknown'} (estimate) · Moon ${moonName(moon.phase)} (${Math.round(moon.fraction * 100)}%)</div>
      <div class="small muted">${exact ? 'Forecast for this exact point (waves read ~1 km out to sea in front of it).' : 'Loading the forecast for this exact point… showing the nearest coast area for now.'}</div>` : '<div class="small muted">Loading forecast for this point…</div>'}
    ${buoy ? `<div class="small" style="margin-top:4px"><strong>Measured:</strong> ${esc(buoy.b.site)} buoy ${buoy.d.toFixed(0)} km away — ${fmtHeight(buoy.b.hs)}${buoy.b.tp != null ? ` @ ${Math.round(buoy.b.tp)} s` : ''}, ${fmtAge(Date.parse(buoy.b.time))}</div>` : ''}
    <div class="small" style="margin-top:4px"><strong>Legal:</strong> ${esc(legal.text)}</div>
    <div class="small" id="pop-nearby" style="margin-top:4px">Nearby: loading…</div>
    <p class="small muted" style="margin:6px 0 0">Not a checked fishing spot — check access, cliffs and private land before you go.</p>
    <p style="margin:6px 0 0"><a href="${gmaps}" target="_blank" rel="noopener">Directions here ↗</a> · <a href="#/live/${encodeURIComponent(loc.id)}">Live summary →</a></p>`;
}

async function fillNearby(popup, coords) {
  const n = await nearest(coords, 25);
  const el = popup.getElement()?.querySelector('#pop-nearby');
  if (!el) return;
  if (!n) { el.textContent = 'Nearby: shop/servo/toilet data not downloaded yet.'; return; }
  const item = (k, l) => n[k] ? `${l} ${n[k].d.toFixed(1)} km (${esc(n[k].f.properties.name || n[k].f.properties.brand || 'unnamed')})` : null;
  el.innerHTML = 'Nearby: ' + ([item('toilets', 'toilet'), item('fuel', 'servo'), item('tackle', 'tackle'), item('food24', '24/7 food')].filter(Boolean).join(' · ') || 'nothing within 25 km on OpenStreetMap');
}

export function moonName(phase) {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(phase * 8) % 8];
}

// ---- Time bar with play -----------------------------------------------------
function buildTimeBar() {
  const bar = document.getElementById('timebar');
  bar.innerHTML = `<button id="tb-play" class="tb-btn" aria-label="Play forecast">▶</button>
    <input id="tb-range" type="range" min="0" max="48" step="1" value="0" aria-label="Forecast time">
    <span id="tb-label" class="small"></span>`;
  const range = bar.querySelector('#tb-range');
  range.addEventListener('input', () => { offset = +range.value; refreshCoastMap(); });
  bar.querySelector('#tb-play').addEventListener('click', e => {
    if (playing) { clearInterval(playing); playing = null; e.currentTarget.textContent = '▶'; return; }
    e.currentTarget.textContent = '❚❚';
    playing = setInterval(() => {
      offset = (offset + 1) % 49; range.value = offset; refreshCoastMap();
    }, 800);
  });
}

function updateTimeLabel() {
  const el = document.getElementById('tb-label');
  if (el) el.textContent = (offset === 0 ? 'Now' : fmtDateTime(selectedTime())) + (state.coast.fetchedAt ? '' : ' · loading coast…');
}

// ---- Windy animated view (official embed, free with logo visible) -----------
function buildWindy() {
  const btn = document.getElementById('windy-btn');
  const panel = document.getElementById('windy-panel');
  const load = overlay => {
    const c = map.getCenter();
    const z = Math.max(5, Math.min(11, map.getZoom()));
    panel.querySelector('iframe').src = `https://embed.windy.com/embed2.html?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&detailLat=${c.lat.toFixed(3)}&detailLon=${c.lng.toFixed(3)}&zoom=${z}&level=surface&overlay=${overlay}&product=ecmwf&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`;
  };
  btn.addEventListener('click', () => {
    panel.hidden = false;
    load(panel.querySelector('[aria-pressed="true"]').dataset.overlay);
  });
  panel.querySelector('#windy-close').addEventListener('click', () => { panel.hidden = true; panel.querySelector('iframe').src = 'about:blank'; });
  panel.querySelectorAll('[data-overlay]').forEach(b => b.addEventListener('click', () => {
    panel.querySelectorAll('[data-overlay]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    load(b.dataset.overlay);
  }));
}

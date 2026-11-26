// Coastline conditions layer, animated wind/wave arrows, time slider with play,
// tap-anywhere spot reports, measured buoy markers and the Windy animated view.
import { openSheet } from './sheet.js';
import { depthAt, depthText } from './depth.js';
import { state, evalFor } from './app.js';
import { viewOn as layerOn, refreshMap, openSpotSheet, setSheetRefresher } from './map.js';
import { verdict, verdictHTML, hourStrip } from './verdict.js';
import { plainify } from './plain.js';
import { nearestCoastPoint } from './coast.js';
import { nearest } from './amenities.js';
import { nearestBuoy } from './buoys.js';
import { loadPointConditions } from './data.js';
import { legalStatus, legalHTML } from './zones.js';
import { initFlow, setFlowData, flowPausedByDevice } from './flow.js';
import { loadShore, shoreData, offshorePoint, nearestShore, riverWaterAt, estuaryNotes, placeIncident } from './shore.js';
import { band, BAND_LABEL, visibilityEstimate } from './scoring/score.js';
import { degToCompass } from './scoring/geo.js';
import { esc, typeTag, chanceIcon, blockPill, currentLine } from './ui.js';
import { fmtWind, fmtHeight, fmtTemp, fmtDateTime, fmtAge , freshness, waveWords } from './units.js';

let map, coastLayer, arrowLayer, buoyLayer, incidentLayer, bestLayer;
let incidents = null;
let shoreIdx = null;     // per shoreline vertex: index of nearest coast sample point (or -1)
let offset = 0;
let userMovedTime = false;          // hours from now shown on the coast
let playing = null;
const HOUR = 3600e3;
const COLORS = { good: '#009e73', fair: '#e69f00', poor: '#d55e00', blocked: '#6b7280', 'blk-legal': '#a855f7', 'blk-safety': '#6b7280', 'blk-dark': '#334155', unknown: '#8a94a6' };
const DASH = { 'blk-safety': '4 8', 'blk-dark': '2 6', blocked: '4 8' };

// jump the time slider to an exact hour (e.g. tapping the hour strip in a card)
export function setSelectedTime(t) {
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  offset = Math.max(0, Math.min(48, Math.round((t - now) / HOUR)));
  userMovedTime = true;
  const r = document.getElementById('tb-range'); if (r) r.value = offset;
  refreshMap();
}

export function selectedTime() {
  autoDaylightForSpear();
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

// Spearfishing is only rated in daylight. At night in Spear mode, jump the time slider to the next
// daylight hour (unless the user has moved it) instead of showing the whole coast as "too dark".
let autoJumped = false;
function autoDaylightForSpear() {
  const range = document.getElementById('tb-range');
  if (state.activity !== 'spear') {
    if (autoJumped && !userMovedTime) { offset = 0; if (range) range.value = 0; }
    autoJumped = false; return;
  }
  if (userMovedTime || offset !== 0 || !window.SunCalc) return;
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  const sc = d => window.SunCalc.getTimes(d, -31.95, 115.86);
  const today = sc(new Date(now)), tomorrow = sc(new Date(now + 24 * HOUR));
  const isDay = now + HOUR > today.sunrise.getTime() + HOUR && now < today.sunset.getTime() - HOUR;
  if (isDay) return;
  const nextRise = (now < today.sunrise.getTime() ? today.sunrise : tomorrow.sunrise).getTime();
  offset = Math.min(48, Math.max(1, Math.ceil((nextRise - now) / HOUR) + 1));
  if (range) range.value = offset;
  autoJumped = true;
}

export function refreshCoastMap() {
  if (!map) return;
  autoDaylightForSpear();
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
    const bandOf = r => r?.blocked ? `blk-${r.blockKind || 'safety'}` : r?.score != null ? band(r.score) : 'unknown';
    const weight = map.getZoom() >= 10 ? 8 : 5;
    if (sh?.lines.length && !sh.precise && map.getZoom() >= 12) {
      // rough bundled coastline is ~1 km out at this zoom: don't draw a misleading line (tap for details)
    } else if (sh?.lines.length) {
      // colour the REAL shoreline: each vertex takes the colour of its nearest conditions point (<= 6 km)
      // rivers and estuaries (Swan, Peel, Walpole…) are far from the ocean points: their banks take the
      // colour of the nearest fishing spot (<= 2.5 km) instead, so the river line shows too
      const spots = [...state.data.locations, ...(state.osmSpots || [])].filter(l => l.activities?.includes(state.activity));
      const key = `${spots.length}|${state.activity}`;
      if (!shoreIdx || shoreIdx.key !== key) {
        const grid = new Map(), cell = 0.05, put = (x, y, v) => { const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(v); };
        pts.forEach((p, i) => put(...p.geometry.coordinates, { i }));
        spots.forEach(l => put(...l.geometry.coordinates, { l }));
        const near = (x, y, r) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell), out = []; for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) out.push(...(grid.get(`${cx + a},${cy + b}`) || [])); return out; };
        shoreIdx = sh.lines.map(L => L.map(([x, y]) => {
          const k = Math.cos(y * Math.PI / 180);
          let bi = -1, bd = 6, bl = null, bld = 2.5;
          for (const v of near(x, y, 2)) {
            const [px, py] = v.i != null ? pts[v.i].geometry.coordinates : v.l.geometry.coordinates;
            const d = Math.hypot((px - x) * k, py - y) * 111;
            if (v.i != null) { if (d < bd) { bd = d; bi = v.i; } } else if (d < bld) { bld = d; bl = v.l; }
          }
          return bi >= 0 ? bi : bl ? bl : -1;
        }));
        shoreIdx.key = key;
      }
      sh.lines.forEach((L, li) => {
        let run = [], runBand = null;
        const flush = () => {
          if (run.length > 1 && runBand) L_poly(run, runBand);
          run = [];
        };
        const L_poly = (latlngs, b) => window.L.polyline(latlngs, { pane: 'coast', color: COLORS[b], weight, opacity: 0.9, lineCap: 'round', lineJoin: 'round', dashArray: DASH[b] || null, interactive: false }).addTo(coastLayer);
        L.forEach(([x, y], vi) => {
          const idx = shoreIdx[li][vi];
          const b = typeof idx === 'object' ? (hasData ? bandOf(hourAt(evalFor(idx), t)) : null) : idx < 0 ? null : bandOf(rows[idx]);
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
            const blk = row?.blocked ? row : prevRow?.blocked ? prevRow : null;
            const scores = [row?.score, prevRow?.score].filter(v => v != null);
            const b = blk ? `blk-${blk.blockKind || 'safety'}` : scores.length ? band(scores.reduce((a, c) => a + c, 0) / scores.length) : 'unknown';
            L.polyline([[y1, x1], [y2, x2]], { pane: 'coast', color: COLORS[b], weight, opacity: 0.9, lineCap: 'round', dashArray: DASH[b] || null, interactive: false }).addTo(coastLayer);
          }
        }
        prev = p; prevRow = row;
      });
    }
  }

  // Animated wind particles + swell lines (canvas, see flow.js)
  if (hasData && pts.length) {
    const wind = [], swell = [], currents = [];
    for (const p of pts) {
      const h = hourAt(evalFor(p), t)?.hour;
      if (!h) continue;
      const [lng, lat] = p.geometry.coordinates;
      if (h.wind_speed != null && h.wind_direction != null) wind.push({ lat, lng, speed: h.wind_speed, from: h.wind_direction });
      const sh = h.swell_height ?? h.wave_height, sd = h.swell_direction ?? h.wave_direction;
      if (p.sea && sh != null && sd != null) swell.push({ lat: p.sea[0], lng: p.sea[1], height: sh, from: sd, period: h.swell_period ?? h.wave_period });
      if (p.sea && h.current_speed != null && h.current_direction != null) currents.push({ lat: p.sea[0], lng: p.sea[1], speed: h.current_speed, to: h.current_direction });
    }
    // currents only over water: use the coastline to test each grid cell
    const seaTest = (la, ln) => { const n = nearestShore(la, ln, 30); return !!n && !n.onLand && !riverWaterAt(la, ln, 0); };
    setFlowData(wind, swell, { wind: on.windFlow, swell: on.swellFlow, current: on.currentFlow, currents, seaTest });
  } else setFlowData([], [], {});
  const note = document.getElementById('flow-note');
  if (note) note.hidden = !(flowPausedByDevice() && (on.windFlow || on.swellFlow || on.currentFlow));

  if ((on.wind || on.waves) && hasData && pts.length && map.getZoom() >= 8) {
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
        arrowLayer.addLayer(arrowMarker([p.sea[0], p.sea[1]], (wd + 180) % 360, 'wave', Math.min(1.7, 0.7 + wh / 2.5), `${wh.toFixed(1)} m`, waveColor(wh)));
      }
    });
  }

  // Sea temperature: a coloured dot with °C along the whole coast (blue = cold, red = warm)
  if (on.sst && hasData && pts.length && map.getZoom() >= 7) {
    const z = map.getZoom(), every = z >= 11 ? 1 : z >= 9 ? 2 : z >= 8 ? 3 : 5;
    const bounds = map.getBounds().pad(0.1);
    pts.forEach((p, i) => {
      if (i % every || !p.sea) return;
      const h = hourAt(evalFor(p), t)?.hour;
      if (h?.sst == null || !bounds.contains(p.sea)) return;
      const off = [p.sea[0] + (p.sea[0] - p.geometry.coordinates[1]) * 0.8, p.sea[1] + (p.sea[1] - p.geometry.coordinates[0]) * 0.8];
      arrowLayer.addLayer(window.L.marker(off, { pane: 'arrows', interactive: false, keyboard: false,
        icon: window.L.divIcon({ className: 'sst-dot', html: `<span style="background:${sstColor(h.sst)}">${h.sst.toFixed(0)}°</span>`, iconSize: [34, 20], iconAnchor: [17, 10] }) }));
    });
  }

  // Best stretches right now: animated fish (shore) or spear (spear) on the top 3 coast points
  if (on.coast && hasData && pts.length) {
    const act = state.activity;
    const ranked = pts.map(p => ({ p, r: hourAt(evalFor(p), t) }))
      .filter(x => x.r && !x.r.blocked && x.r.score != null && x.r.score >= 70)
      // only where this activity is actually allowed (no spearfishing in estuaries, sanctuaries, Rottnest…)
      .filter(x => !(act === 'spear' && (x.p.estuary || riverWaterAt(x.p.geometry.coordinates[1], x.p.geometry.coordinates[0], 0.3)))
        && legalStatus(state.data.zones, x.p, act, { t }).state !== 'blocked')
      .sort((a, b) => b.r.score - a.r.score);
    const picked = [];
    const px = x => map.latLngToContainerPoint([x.p.geometry.coordinates[1], x.p.geometry.coordinates[0]]);
    for (const x of ranked) { // spread them out: >= 40 km apart AND far enough apart on screen not to overlap
      const q = px(x);
      if (picked.every(y => Math.hypot(y.p.geometry.coordinates[0] - x.p.geometry.coordinates[0], y.p.geometry.coordinates[1] - x.p.geometry.coordinates[1]) * 100 > 40
        && (Math.abs(y.q.x - q.x) > 140 || Math.abs(y.q.y - q.y) > 44))) picked.push({ ...x, q });
      if (picked.length === 3) break;
    }
    for (const { p, r } of picked) {
      // tapping the label opens the SAME stretch and score it shows (it used to fall through to the map
      // and report a different point)
      const lbl = act === 'spear' ? 'Best for spearfishing' : 'Best for fishing';
      L.marker([p.geometry.coordinates[1], p.geometry.coordinates[0]], { keyboard: true, zIndexOffset: 1500, title: `${lbl} at the chosen time`,
        icon: L.divIcon({ className: 'best-pin', html: `<span>★ ${lbl} ${r.score}</span>`, iconSize: [150, 28], iconAnchor: [75, 34] }) })
        .on('click', () => openBestSheet(p, r)).addTo(bestLayer);
    }
  }

  if (on.incidents && incidents?.incidents) {
    for (const i of placedIncidents()) {
      const sym = i.outcome === 'fatal' ? '☠' : i.outcome === 'injured' ? '!' : '·';
      L.marker([i.plat, i.plon], { keyboard: true, title: `Shark incident ${i.year}`,
        icon: L.divIcon({ className: 'mk-wrap', html: `<div class="incident ${esc(i.outcome)}" aria-hidden="true">${sym}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
        .bindPopup(`<strong>Recorded shark incident</strong><br><span class="small">${esc(i.place)} · ${i.month ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i.month - 1] + ' ' : ''}${i.year}</span><br>
          <span class="small">Outcome: <strong>${esc(i.outcome)}</strong>${i.shark ? ` · ${esc(i.shark)}` : ''}${i.activity ? ` · while ${esc(i.activity)}` : ''}</span><br>
          ${i.moved ? '<span class="small muted">Exact spot not recorded — shown just offshore from the reported place.</span><br>' : ''}
          <span class="small muted">Australian Shark-Incident Database, Taronga Conservation Society Australia (records to ${incidents.records_to}). Check SharkSmart WA for current activity.</span>`)
        .addTo(incidentLayer);
    }
  }

  if (on.buoys && state.buoys?.buoys) {
    for (const b of state.buoys.buoys) {
      const fr = freshness(Date.parse(b.time));
      const icon = L.divIcon({ className: 'mk-wrap', html: `<div class="buoy ${fr.cls}" aria-hidden="true">${b.hs != null ? b.hs.toFixed(1) : '?'}<small>m</small><em>${esc(fmtAge(Date.parse(b.time)).replace(' ago', ''))}</em></div>`, iconSize: [40, 48], iconAnchor: [20, 20] });
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
// Card for a "★ Best stretch" label: same score as the label, plus the actual spots along that stretch
function openBestSheet(p, r) {
  setSheetRefresher(null);
  const t = selectedTime(), act = state.activity;
  const [plng, plat] = p.geometry.coordinates;
  const km = l => Math.hypot((l.geometry.coordinates[0] - plng) * Math.cos(plat * Math.PI / 180), l.geometry.coordinates[1] - plat) * 111;
  const near = [...state.data.locations, ...(state.osmSpots || [])].filter(l => l.activities?.includes(act) && km(l) <= 6)
    .map(l => ({ l, d: km(l), h: hourAt(evalFor(l), t) })).filter(x => x.h).sort((a, b) => (b.h.blocked ? -1 : b.h.score ?? -1) - (a.h.blocked ? -1 : a.h.score ?? -1)).slice(0, 6);
  const body = openSheet(`
    <p class="small" style="margin-top:0">This is the best-scoring <strong>stretch of coast</strong> (about 8 km${p.near ? ` near ${esc(p.near)}` : ''}) for ${act === 'spear' ? 'spearfishing' : 'shore fishing'} at ${t === Math.floor(Date.now() / HOUR) * HOUR ? 'this hour' : esc(fmtDateTime(t))}. The score rates the conditions along the whole stretch, and only stretches where ${act === 'spear' ? 'spearfishing' : 'fishing'} is allowed are picked — choose an actual spot below and check its rules.</p>
    <div class="row" style="gap:8px;align-items:center;margin:6px 0"><span class="pill ${band(r.score)}">${BAND_LABEL[band(r.score)]} ${r.score}</span>${chanceIcon(r.score, act, false)}</div>
    <h3 class="sheet-h3">Spots along this stretch</h3>
    ${near.length ? `<ul class="plain">${near.map(({ l, d, h }) => `<li><button class="linklike" data-loc="${esc(l.id)}">${esc(l.name)}</button> <span class="small muted">${d.toFixed(1)} km</span> ${h.blocked ? blockPill(h.blockKind) : `<span class="pill ${band(h.score)}">${h.score}</span>`}</li>`).join('')}</ul>`
      : '<p class="small muted">No mapped spots on this stretch — tap the coast to check an exact point.</p>'}
    <p class="small muted">Spot scores can differ from the stretch score: each spot's own exposure to wind and swell is taken into account.</p>`,
    { title: `★ Best for ${act === 'spear' ? 'spearfishing' : 'fishing'} · ${r.score}`, state: 'half' });
  body.onclick = e => {
    const b = e.target.closest('[data-loc]'); if (!b) return;
    const l = [...state.data.locations, ...(state.osmSpots || [])].find(x => x.id === b.dataset.loc);
    if (l) { map.flyTo([l.geometry.coordinates[1], l.geometry.coordinates[0]], Math.max(map.getZoom(), 14), { duration: 0.6 }); map.once('moveend', () => openSpotSheet(l)); }
  };
}

function placedIncidents() {
  if (placedCache && placedCache.shore === shoreData()) return placedCache.list;
  const seen = new Map();
  const list = incidents.incidents.map(i => { const p = placeIncident(i, seen); return p ? { ...i, ...p } : null; }).filter(Boolean);
  placedCache = { shore: shoreData(), list };
  return list;
}

function arrowMarker(latlng, toDeg, kind, scale, label, color = null) {
  const c = color ? `color:${color};` : '';
  return window.L.marker(latlng, {
    pane: 'arrows', interactive: false, keyboard: false,
    icon: window.L.divIcon({
      className: 'arrow-wrap',
      html: `<div class="flow ${kind}" style="${c}transform:rotate(${toDeg - 90}deg) scale(${scale.toFixed(2)})"><span class="glyph">➤</span></div><span class="flow-lbl ${kind}" style="${c}">${label}</span>`,
      iconSize: [34, 34], iconAnchor: [17, 17]
    })
  });
}

function buoyHTML(b) {
  return `<strong>${esc(b.site)} wave buoy</strong> ${typeTag('measured')}<br>
    <span class="small">Waves out at sea ${b.hs != null ? `<strong>${fmtHeight(b.hs)}</strong> (${waveWords(b.hs)}; the odd one up to twice that)` : 'Unknown'}${b.tp != null ? `, period ${Math.round(b.tp)} s` : ''}${b.dir != null ? ` from ${degToCompass(b.dir)}` : ''}</span><br>
    ${b.swell_h != null ? `<span class="small">Swell ${fmtHeight(b.swell_h)}${b.swell_p != null ? ` @ ${Math.round(b.swell_p)} s` : ''}${b.swell_dir != null ? ` from ${degToCompass(b.swell_dir)}` : ''}</span><br>` : ''}
    ${b.sst != null ? `<span class="small">Water ${fmtTemp(b.sst)}</span><br>` : ''}
    <span class="small fresh-${freshness(Date.parse(b.time)).cls}">● Measured ${fmtAge(Date.parse(b.time))} (${fmtDateTime(Date.parse(b.time))}) — ${freshness(Date.parse(b.time)).label}</span><br>
    <span class="small muted"> A real measurement from a WA Dept of Transport buoy in deep water offshore — waves at the beach are usually smaller. Not quality controlled.</span>`;
}

// ---- Tap anywhere: report for the EXACT point tapped -----------------------
let tapMarker = null;
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const comp = d => COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];

async function onMapClick(latlng, title = 'Exact point') {
  const L = window.L;
  const { lat, lng } = latlng;
  const sample = nearestCoastPoint(lat, lng, 30);
  const sh = nearestShore(lat, lng, 25);
  if (!sample && !sh) return;
  const precise = !!shoreData()?.precise;
  const p = sample?.p ?? null;
  const facing = sh && precise ? Math.round(sh.seaBearing) : p?.facing ?? Math.round(sh.seaBearing);
  const sea = sh ? offshorePoint(lat, lng, 1.0) : null;
  const river = riverWaterAt(lat, lng, 0.05);
  const where = river ? `In ${river.name ? `the ${river.name}` : 'a river / estuary'}` : !sh || !shoreData()?.precise ? '' : sh.onLand
    ? `On land, about ${fmtDist(sh.km)} from the water`
    : `In the water, about ${fmtDist(sh.km)} from shore`;
  const loc = {
    id: `tap_${lat.toFixed(5)}_${lng.toFixed(5)}`,
    name: river?.name ? `Point on the ${river.name}` : `Point near ${p?.near ?? 'the coast'}`,
    estuary: !!river, water_name: river?.name || null,
    near: p?.near, region: p?.region, bioregion: p?.bioregion,
    type: 'beach', activities: ['shore', 'spear'], confidence: 'potential', status: 'auto',
    virtual: true, tap: true, condFrom: p?.id,
    geometry: { type: 'Point', coordinates: [lng, lat] },
    sea: river ? p?.sea : sea ? [sea.lat, sea.lng] : p?.sea,
    facing,
    exposure: { onshore_dirs: [-45, -22.5, 0, 22.5, 45].map(o => comp(facing + o)), sheltered_dirs: [-45, -22.5, 0, 22.5, 45].map(o => comp(facing + 180 + o)) },
    terrain: [], access: null, species_evidence: [], restrictions: [], sources: ['tap'],
    safety_notes: river ? estuaryNotes(lat, lng, river.name) : []
  };
  state.tapLoc = loc; state.tapCond = null;

  if (tapMarker) tapMarker.remove();
  tapMarker = L.marker([lat, lng], { interactive: false, keyboard: false, zIndexOffset: 2000,
    icon: L.divIcon({ className: 'tap-pin', html: '<div class="tap-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);

  // report goes into the bottom sheet (no pop-up, so the map never jumps)
  let open = true;
  let exact = false;
  const body = openSheet(plainify(tapHTML(loc, where, sh, false)), { title, state: title === 'Exact point' ? 'peek' : 'half',
    onClose: () => { open = false; setSheetRefresher(null); if (tapMarker) { tapMarker.remove(); tapMarker = null; } } });
  fillNearby(body, [lng, lat]);
  wireSpotLinks(body);
  const depthP = depthAt(lat, lng);
  const fillDepth = () => depthP.then(d => { const el = body.querySelector('#pop-depth'); if (el) el.innerHTML = depthText(d, hourAt(evalFor(loc, 'shore'), selectedTime())?.hour?.sea_level); });
  fillDepth();
  // follow the time slider / play button
  setSheetRefresher(() => { if (!open) return; const y = body.scrollTop; body.innerHTML = plainify(tapHTML(loc, where, sh, exact)); fillNearby(body, [lng, lat]); fillDepth(); body.scrollTop = y; });

  // exact forecast for this point (one small request), then redraw the card
  const cond = await loadPointConditions(loc);
  if (state.tapLoc !== loc || !open) return;
  if (cond) { state.tapCond = cond; delete loc.condFrom; }
  exact = !!cond;
  body.innerHTML = plainify(tapHTML(loc, where, sh, !!cond));
  fillNearby(body, [lng, lat]);
  fillDepth();
}

// ---- Search result: a named place (campground, town, beach…) ------------------------------
let placeMarker = null;
function spotsNear(lat, lng, maxKm = 30, n = 6) {
  const t = selectedTime(), act = state.activity, k = Math.cos(lat * Math.PI / 180);
  return [...state.data.locations, ...(state.osmSpots || [])].filter(l => l.activities?.includes(act))
    .map(l => ({ l, d: Math.hypot((l.geometry.coordinates[0] - lng) * k, l.geometry.coordinates[1] - lat) * 111 }))
    .filter(x => x.d <= maxKm).sort((a, b) => a.d - b.d).slice(0, n)
    .map(x => ({ ...x, h: hourAt(evalFor(x.l), t) }));
}
function spotsListHTML(list) {
  if (!list.length) return '<p class="small muted">No mapped fishing spots within 30 km.</p>';
  return `<ul class="plain">${list.map(({ l, d, h }) => `<li><button class="linklike" data-loc="${esc(l.id)}">${esc(l.name)}</button> <span class="small muted">${d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km'}</span> ${!h ? '' : h.blocked ? blockPill(h.blockKind) : `<span class="pill ${band(h.score)}">${BAND_LABEL[band(h.score)]} ${h.score}</span>`}</li>`).join('')}</ul>`;
}
// (uses body.onclick, not addEventListener: the sheet body element is reused, so handlers must not pile up)
function wireSpotLinks(body, extra = null) {
  body.onclick = e => {
    extra?.(e);
    const c = e.target.closest('[data-t]'); if (c) { setSelectedTime(+c.dataset.t); return; }
    const b = e.target.closest('[data-loc]'); if (!b) return;
    const l = [...state.data.locations, ...(state.osmSpots || [])].find(x => x.id === b.dataset.loc);
    if (l) { map.flyTo([l.geometry.coordinates[1], l.geometry.coordinates[0]], Math.max(map.getZoom(), 15), { duration: 0.6 }); map.once('moveend', () => openSpotSheet(l)); }
  };
}
export function placeReport(lat, lng, name) {
  setSheetRefresher(null);
  const L = window.L;
  placeMarker?.remove();
  placeMarker = L.marker([lat, lng], { keyboard: false, zIndexOffset: 2100, title: name,
    icon: L.divIcon({ className: 'place-pin', html: `<div class="place-dot">📍</div><span class="place-lbl">${esc(name)}</span>`, iconSize: [30, 30], iconAnchor: [15, 28] }) }).addTo(map);
  const sh = nearestShore(lat, lng, 300);
  const nearWater = riverWaterAt(lat, lng, 0.05) || (sh && (!sh.onLand || sh.km <= 0.3));
  if (nearWater) {   // on the shore or in the water: the normal exact-point report, titled with the place name
    onMapClick({ lat, lng }, `📍 ${name}`).then(() => {});
    return;
  }
  const coast = nearestCoastPoint(lat, lng, 300);
  const r = coast ? hourAt(evalFor(coast.p), selectedTime()) : null;
  const list = spotsNear(lat, lng);
  const body = openSheet(`
    <p class="small" style="margin-top:0">${sh ? `About <strong>${fmtDist(sh.km)}</strong> from the sea${coast?.p?.near ? ` (nearest coast near ${esc(coast.p.near)})` : ''}.` : 'A long way from the coast.'}</p>
    ${r ? `<div class="small">Conditions on the nearest coast right now: ${r.blocked ? blockPill(r.blockKind) : `<span class="pill ${band(r.score)}">${BAND_LABEL[band(r.score)]} ${r.score}</span>`}</div>` : ''}
    <h3 class="sheet-h3">Fishing spots near here</h3>
    ${spotsListHTML(list)}
    ${sh ? `<button class="btn" data-act="coast" style="margin:6px 0">Show the report for the nearest beach</button>` : ''}
    <div class="small" id="pop-nearby" style="margin-top:6px">Nearby: loading…</div>
    <p class="small muted">Tap any spot for its full card, or tap the water anywhere for an exact report.</p>`,
    { title: `📍 ${name}`, state: 'half', onClose: () => { placeMarker?.remove(); placeMarker = null; } });
  wireSpotLinks(body, e => {
    if (e.target.closest('[data-act="coast"]') && sh) {
      const o = offshorePoint(sh.lat, sh.lng, 0.05) || sh;
      map.flyTo([o.lat, o.lng], 15, { duration: 0.6 }); map.once('moveend', () => onMapClick({ lat: o.lat, lng: o.lng }, `Beach nearest ${name}`));
    }
  });
  fillNearby(body, [lng, lat]);
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
  const legal = legalStatus(state.data.zones, loc, state.activity, { t });
  const pillFor = r => !r ? '<span class="pill unknown">Unknown</span>' : r.blocked ? blockPill(r.blockKind) : `<span class="pill ${band(r.score)}">${BAND_LABEL[band(r.score)]} ${r.score ?? ''}</span>`;
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `
    <span class="small muted">${lat.toFixed(5)}, ${lng.toFixed(5)}</span><br>
    ${where ? `<span class="small">${esc(where)}</span><br>` : ''}
    ${verdictHTML(verdict(state.activity === 'spear' ? spear : shore, state.activity === 'spear' ? rp : rs, legal, state.activity, t))}
    ${hourStrip(state.activity === 'spear' ? spear : shore, t)}
    <div class="small" id="pop-depth">Depth: checking…</div>
    <span class="small muted">${t === Math.floor(Date.now() / HOUR) * HOUR ? 'Now' : fmtDateTime(t)} ${loc.estuary ? '' : ` · water faces ${degToCompass(loc.facing)}`}</span>
    <div class="row" style="margin:8px 0;gap:6px"><div><div class="small muted">Shore</div>${pillFor(rs)}</div><div><div class="small muted">Spear</div>${pillFor(rp)}</div></div>
    <div style="margin:4px 0">${legalHTML(legal)}</div>
    ${[rs, rp].flatMap(r => r?.blocks ?? []).filter(b => b.kind !== 'legal').map(b => `<div class="small warn-text">⚠ ${esc(b.reason)}</div>`).filter((v, i, a) => a.indexOf(v) === i).join('')}
    ${h ? `<div class="small">Wind ${degToCompass(h.wind_direction) ?? ''} ${fmtWind(h.wind_speed)}${h.wind_gust != null ? ` (gusts ${fmtWind(h.wind_gust)})` : ''} · ${loc.estuary ? 'Sheltered water (no ocean swell)' : `Waves ${fmtHeight(h.wave_height)}${h.wave_period != null ? ` @ ${Math.round(h.wave_period)} s` : ''}`} · Tide ${h.tide_rate == null ? '?' : h.tide_rate > 0.005 ? 'rising' : h.tide_rate < -0.005 ? 'falling' : 'slack'} · Sea ${fmtTemp(h.sst)}</div>
      ${!loc.estuary ? currentLine(h) : ''}
      <div class="small">Visibility: ${vis ? vis.label : 'unknown'} (estimate) · Moon ${moonName(moon.phase)} (${Math.round(moon.fraction * 100)}%)</div>
      <div class="small muted">${exact ? (loc.estuary ? 'Wind forecast for this exact point; tide from the nearest ocean point.' : 'Forecast for this exact point (waves read ~1 km out to sea in front of it).') : 'Loading the forecast for this exact point… showing the nearest coast area for now.'}</div>` : '<div class="small muted">Loading forecast for this point…</div>'}
    ${buoy && !loc.estuary ? `<div class="small" style="margin-top:4px"><strong>Measured:</strong> ${esc(buoy.b.site)} buoy ${buoy.d.toFixed(0)} km away — ${fmtHeight(buoy.b.hs)}${buoy.b.tp != null ? ` @ ${Math.round(buoy.b.tp)} s` : ''}, ${fmtAge(Date.parse(buoy.b.time))}</div>` : ''}
    ${(loc.safety_notes || []).filter(n => !/^Spearfishing is banned/.test(n)).map(n => `<div class="small">⚠ ${esc(n)}</div>`).join('')}
    <div class="small" id="pop-nearby" style="margin-top:4px">Nearby: loading…</div>
    <h3 class="sheet-h3">Nearest fishing spots</h3>${spotsListHTML(spotsNear(lat, lng, 15, 4))}
    <p class="small muted" style="margin:6px 0 0">Not a checked fishing spot — check access, cliffs and private land before you go.</p>
    <p style="margin:6px 0 0"><a href="${gmaps}" target="_blank" rel="noopener">Directions here ↗</a> · <a href="#/live/${encodeURIComponent(loc.id)}">Live summary →</a></p>`;
}

async function fillNearby(root, coords) {
  const n = await nearest(coords, 25);
  const el = root?.querySelector('#pop-nearby');
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
  range.addEventListener('input', () => { offset = +range.value; userMovedTime = true; refreshMap(); });
  bar.querySelector('#tb-play').addEventListener('click', e => {
    if (playing) { clearInterval(playing); playing = null; e.currentTarget.textContent = '▶'; return; }
    e.currentTarget.textContent = '❚❚';
    playing = setInterval(() => {
      offset = (offset + 1) % 49; range.value = offset; userMovedTime = true; refreshMap();
    }, 800);
  });
}

function updateTimeLabel() {
  const el = document.getElementById('tb-label');
  if (el) el.textContent = (autoJumped && offset ? '🌙 Dark now — spearfishing from ' : '') + (offset === 0 ? 'Now' : fmtDateTime(selectedTime())) + (state.coast.fetchedAt ? '' : ' · loading coast…');
}

// ---- Windy animated view (official embed, free with logo visible) -----------
let openWindyFn = null;
export function openWindy() { openWindyFn?.(); }
function buildWindy() {
  const panel = document.getElementById('windy-panel');
  const load = overlay => {
    const c = map.getCenter();
    const z = Math.max(5, Math.min(11, map.getZoom()));
    panel.querySelector('iframe').src = `https://embed.windy.com/embed2.html?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&detailLat=${c.lat.toFixed(3)}&detailLon=${c.lng.toFixed(3)}&zoom=${z}&level=surface&overlay=${overlay}&product=ecmwf&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`;
  };
  openWindyFn = () => {
    panel.hidden = false;
    load(panel.querySelector('[aria-pressed="true"]').dataset.overlay);
  };
  panel.querySelector('#windy-close').addEventListener('click', () => { panel.hidden = true; panel.querySelector('iframe').src = 'about:blank'; });
  panel.querySelectorAll('[data-overlay]').forEach(b => b.addEventListener('click', () => {
    panel.querySelectorAll('[data-overlay]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    load(b.dataset.overlay);
  }));
}

// colour scales shared with the map key: waves green (small) -> red (big); sea temperature blue (cold) -> red (warm)
export function waveColor(m) { return m < 0.5 ? '#7ee2c8' : m < 1 ? '#a3e635' : m < 1.5 ? '#facc15' : m < 2.5 ? '#fb923c' : '#f87171'; }
export function sstColor(c) {
  const stops = [[14, [70, 110, 230]], [17, [60, 180, 230]], [19, [80, 200, 140]], [21, [240, 200, 70]], [24, [240, 90, 60]]];
  if (c <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 1; i < stops.length; i++) if (c <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (c - a) / (b - a);
    return `rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * f)).join(',')})`;
  }
  return `rgb(${stops[stops.length - 1][1]})`;
}

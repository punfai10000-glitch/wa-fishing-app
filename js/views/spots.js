import { state, evalFor, visibleLocations, rerender } from '../app.js';
import { REGIONS, TYPE_LABELS } from '../config.js';
import { esc, pill, confText, activityToggle, bestTimeText } from '../ui.js';
import { band, BAND_LABEL } from '../scoring/score.js';
import { nextSafe, whenText } from '../verdict.js';
import { findPlaces, kmBetween } from '../places.js';
import { plainify } from '../plain.js';
import { showSpotOnMap, showPlaceOnMap } from '../map.js';
import { guideSpecies } from '../targets.js';
import * as store from '../storage.js';

const ORDER = { good: 0, fair: 1, poor: 2, unknown: 3, blocked: 4 };
const HOUR = 3600e3;
let mini = null;

// "Now" line for a card: what it's like now and when it's best / next safe — in plain words
function nowLine(ev) {
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  const hr = ev.hourly?.find(h => h.t === now);
  if (!hr) return '';
  if (hr.blocked) {
    const ns = hr.blockKind === 'legal' ? null : nextSafe(ev, now);
    const what = { legal: '⛔ Not allowed here', dark: '🌙 Too dark now', safety: '🚫 Not safe now' }[hr.blockKind] || '🚫 Not safe now';
    return `<div class="small"><strong>${what}</strong>${ns ? ` · ${hr.blockKind === 'dark' ? 'next OK daylight time' : 'safer'}: <strong>${whenText(ns.start, ns.end)}</strong> (about ${ns.score})` : hr.blockKind === 'legal' ? '' : ' · no safer time in the forecast yet'}</div>`;
  }
  return `<div class="small"><strong>Now: ${hr.score == null ? "Unknown (no wind/wave forecast)" : `${BAND_LABEL[band(hr.score)]} ${hr.score}`}</strong>${hr.cautions?.length ? ' · ⚠ take care' : ''} · ${bestTimeText(ev, now)}</div>`;
}

const isChecked = l => l.status === 'active' && !l.osm && !l.virtual;

export function renderSpots(view) {
  const favs = store.favourites();
  const near = state.near;   // { name, lat, lng } chosen in the search box
  let rows = visibleLocations({ ignoreRegion: !!near })
    .map(l => ({ l, ev: evalFor(l), d: near ? kmBetween(near.lat, near.lng, l.geometry.coordinates[1], l.geometry.coordinates[0]) : null }))
    .filter(x => x.ev.applicable !== false);
  if (near) rows = rows.filter(x => x.d <= 40);
  // Only CHECKED spots are ranked by conditions. Unchecked ones (starter 'demo' spots, OpenStreetMap) are listed by
  // place, not as recommendations — their position, exposure and access haven't been verified.
  const checked = rows.filter(x => isChecked(x.l)), unchecked = rows.filter(x => !isChecked(x.l));
  checked.sort(near ? (a, b) => (ORDER[a.ev.band] - ORDER[b.ev.band]) || (a.d - b.d) : (a, b) => (ORDER[a.ev.band] - ORDER[b.ev.band]) || ((b.ev.score ?? -1) - (a.ev.score ?? -1)));
  const regionIdx = Object.keys(REGIONS);
  unchecked.sort(near ? (a, b) => a.d - b.d : (a, b) => (regionIdx.indexOf(a.l.region) - regionIdx.indexOf(b.l.region)) || a.l.name.localeCompare(b.l.name));
  const act = state.activity === 'spear' ? 'spearfishing' : 'shore fishing';
  const speciesOpts = guideSpecies(state.activity);
  const cardHTML = ({ l, ev, d }) => `
          <div class="card spot" data-id="${esc(l.id)}" role="button" tabindex="0">
            <div class="row">
              <div>
                <h3>${esc(l.name)} ${favs.has(l.id) ? '<span aria-label="favourite">★</span>' : ''}</h3>
                <div class="muted small">${d != null ? `${d.toFixed(1)} km away · ` : ''}${esc(REGIONS[l.region]?.name ?? l.region)} · ${esc(TYPE_LABELS[l.type] ?? l.type)}${l.osm ? ' · <span class="tag">OpenStreetMap — not yet checked</span>' : l.status === 'demo' ? ' · <span class="tag demo">starter spot — not yet checked</span>' : ''}</div>
              </div>
              <span class="spacer"></span><div style="text-align:right">${ev.blocked ? '' : '<div class="small muted" style="white-space:nowrap">best, next 24 h</div>'}${pill(ev)}</div>
            </div>
            ${nowLine(ev)}
            ${ev.explanation && !ev.blocked ? `<p class="why">${plainify(esc(ev.explanation))}</p>` : ''}
            <div class="row" style="gap:8px;margin-top:6px"><button class="btn" data-map="${esc(l.id)}">🗺 Show on map</button><a class="btn ghost" href="#/loc/${encodeURIComponent(l.id)}">Details &amp; forecast</a></div>
            <div class="small muted">${confText(ev.confidence)}</div>
          </div>`;   // only species with a seasonal guide; the others had no evidence and emptied the list

  view.innerHTML = `
    <div>
      <h1>Forecast</h1>
      <p class="muted small">Where's good for ${act} in the next 24 hours. Type where you're staying or going to see the closest spots.</p>
      <div class="fc-search">
        <input id="fc-q" type="search" placeholder="🔍 Town, campsite, beach… e.g. Mason Bay" autocomplete="off" value="${esc(near?.name ?? '')}" aria-label="Search a place">
        <ul id="fc-res" class="search-results" hidden></ul>
      </div>
      ${near ? `<div class="near-bar"><span>📍 Spots within 40 km of <strong>${esc(near.name)}</strong> — best first, then closest</span> <button class="btn ghost" id="fc-clear">✕ Clear</button></div>
        <div id="fc-map" class="fc-map" aria-label="Map of ${esc(near.name)} and nearby spots"></div>
        <button class="btn ghost" id="fc-place">Open this place on the big map</button>` : ''}
      <div class="filters">
        ${activityToggle(state.activity)}
        ${near ? '' : `<label class="sr" for="f-region">Area</label>
        <select id="f-region"><option value="">All areas</option>${Object.entries(REGIONS).map(([id, r]) => `<option value="${id}" ${state.region === id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`}
        <label class="sr" for="f-species">Target species</label>
        <select id="f-species"><option value="">Any species</option>${speciesOpts.map(s => `<option value="${s.id}" ${state.species === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="f-fav" ${state.favOnly ? 'checked' : ''}> Favourites only</label>
        <label class="check"><input type="checkbox" id="f-osm" ${state.showOsm ? 'checked' : ''}> Include ${state.osmSpots.length} extra spots (OpenStreetMap)</label>
      </div>
      <p class="small muted">Tap a spot to see it on the map. Score = conditions (wind, waves, tide, light), 0–100 — not a fish count.</p>
      <div id="list">
        <h2 class="list-h">Checked spots — best conditions first</h2>
        ${checked.length ? checked.slice(0, 60).map(cardHTML).join('') : `<div class="card muted small">No checked spots ${near ? 'here' : 'in this area'} yet. A spot is listed here only after its position, exposure, access and safety notes have been verified on site (see the curating guide in the README). Until then, use the spots below as places to look at, not recommendations.</div>`}
        ${unchecked.length ? `<h2 class="list-h">Not yet checked — conditions only, not recommendations</h2>
        <p class="small muted">Listed ${near ? 'by distance' : 'by area and name'}, not ranked. Their pins, exposure and access may be wrong — look at the spot yourself.</p>
        ${unchecked.slice(0, 60).map(cardHTML).join('')}` : ''}
        ${!rows.length ? `<div class="card muted">No spots ${near ? `within 40 km of ${esc(near.name)} for ${act}` : 'match these filters'}.</div>` : ''}
      </div>
    </div>`;

  view.querySelector('#f-region')?.addEventListener('change', e => { state.region = e.target.value; rerender(); });
  view.querySelector('#f-species').addEventListener('change', e => { state.species = e.target.value; rerender(); });
  view.querySelector('#f-fav').addEventListener('change', e => { state.favOnly = e.target.checked; rerender(); });
  view.querySelector('#f-osm').addEventListener('change', e => { state.showOsm = e.target.checked; store.set('showOsm', e.target.checked); rerender(); });
  view.querySelector('#fc-clear')?.addEventListener('click', () => { state.near = null; rerender(); });
  view.querySelector('#fc-place')?.addEventListener('click', () => showPlaceOnMap(near));
  view.querySelector('#list').addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const c = e.target.closest('[data-id]'); if (c) showSpotOnMap(c.dataset.id);
  });
  wireSearch(view);
  if (near) drawMini(view.querySelector('#fc-map'), near, rows.slice(0, 25));
}

function wireSearch(view) {
  const input = view.querySelector('#fc-q'), list = view.querySelector('#fc-res');
  let timer = null, seq = 0;
  const show = items => {
    list.innerHTML = items.map((p, i) => `<li><button data-i="${i}">${p.kind === 'spot' ? '🎣' : p.kind === 'region' ? '🗺' : '📍'} ${esc(p.name)}<small>${esc(p.sub || '')}</small></button></li>`).join('') || '<li class="small muted" style="padding:8px">No matches yet…</li>';
    list.hidden = false;
    list.onclick = e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const p = items[+b.dataset.i];
      state.near = { name: p.name, lat: p.lat, lng: p.lng };
      list.hidden = true; rerender();
    };
  };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clearTimeout(timer);
    if (q.length < 2) { list.hidden = true; return; }
    const local = [
      ...Object.values(REGIONS).filter(r => r.name.toLowerCase().includes(q) && r.center).map(r => ({ kind: 'region', name: r.name, lat: r.center[0], lng: r.center[1] })),
      ...[...state.data.locations, ...(state.osmSpots || [])].filter(l => l.name?.toLowerCase().includes(q)).slice(0, 5)
        .map(l => ({ kind: 'spot', name: l.name, sub: REGIONS[l.region]?.name, lat: l.geometry.coordinates[1], lng: l.geometry.coordinates[0] }))
    ];
    show(local);
    const my = ++seq;
    timer = setTimeout(async () => { const pl = await findPlaces(input.value.trim()); if (my === seq) show([...local, ...pl]); }, 600);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') list.querySelector('button')?.click(); });
}

// small map of the chosen place with its nearby spots (tap a pin to open it on the big map)
function drawMini(el, near, rows) {
  if (!el || !window.L) return;
  const L = window.L;
  mini?.remove();
  mini = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, preferCanvas: true });
  L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg', { maxNativeZoom: 14, maxZoom: 17, attribution: 'Sentinel-2 cloudless by EOX' }).addTo(mini);
  const pts = [[near.lat, near.lng]];
  L.marker([near.lat, near.lng], { icon: L.divIcon({ className: 'place-pin', html: `<div class="place-dot">📍</div><span class="place-lbl">${esc(near.name)}</span>`, iconSize: [30, 30], iconAnchor: [15, 28] }) }).addTo(mini);
  for (const { l, ev } of rows) {
    const [lng, lat] = l.geometry.coordinates; pts.push([lat, lng]);
    const now = Math.floor(Date.now() / HOUR) * HOUR, hr = ev.hourly?.find(h => h.t === now);
    const cls = !hr ? 'unknown' : hr.blocked ? `blocked blk-${hr.blockKind || 'safety'}` : band(hr.score);
    const txt = !hr ? '?' : hr.blocked ? ({ legal: '⛔', safety: '⚠', dark: '🌙' }[hr.blockKind] || '✕') : hr.score ?? '?';
    L.marker([lat, lng], { title: l.name, icon: L.divIcon({ className: 'mk-wrap', html: `<div class="mk ${cls}">${txt}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] }) })
      .on('click', () => showSpotOnMap(l.id)).addTo(mini);
  }
  const fit = () => { mini.invalidateSize(); mini.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 13 }); };
  fit(); requestAnimationFrame(() => setTimeout(fit, 50));
}

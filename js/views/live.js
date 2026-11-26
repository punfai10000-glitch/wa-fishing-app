// Live tab: one selected spot at a glance — score now, best window, conditions, next 12 hours.
import { state, evalFor, actions, getLoc } from '../app.js';
import { nearestBuoy, nearestStation } from '../buoys.js';
import { moonName } from '../coastmap.js';
import { legalStatus, legalHTML } from '../zones.js';
import { communityCard, sightingsCard, fillSightings } from './community.js';
import { REGIONS, TYPE_LABELS } from '../config.js';
import { esc, pill, windowText, confText, typeTag, activityToggle, chanceIcon, blockPill } from '../ui.js';
import { fmtWind, fmtHeight, fmtTemp, fmtHour, fmtAge, fmtDateTime, freshness } from '../units.js';
import { degToCompass } from '../scoring/geo.js';
import { band, BAND_LABEL, visibilityEstimate } from '../scoring/score.js';
import { nearest } from '../amenities.js';
import * as store from '../storage.js';

const arrow = deg => deg == null ? '' : `<span class="arrow" style="transform:rotate(${(deg + 180) % 360}deg)" aria-hidden="true">↑</span>`;

export function rememberLiveSpot(id) { store.set('liveSpot', id); }

export function renderLive(view, rawId) {
  const locs = state.data.locations;
  const favs = store.favourites();
  let id = rawId ? decodeURIComponent(rawId) : store.get('liveSpot') || [...favs][0] || null;
  let loc = id ? getLoc(id) : null;
  if (loc) rememberLiveSpot(loc.id);

  const options = [...locs].sort((a, b) => (favs.has(b.id) - favs.has(a.id)) || a.name.localeCompare(b.name));
  const picker = `<label class="sr" for="live-pick">Choose a spot</label>
    <select id="live-pick"><option value="">Choose a spot…</option>
    ${loc?.virtual ? `<option value="${esc(loc.id)}" selected>${esc(loc.name)} (auto area)</option>` : ''}
    ${options.map(l => `<option value="${esc(l.id)}" ${loc?.id === l.id ? 'selected' : ''}>${favs.has(l.id) ? '★ ' : ''}${esc(l.name)} — ${esc(REGIONS[l.region]?.name ?? '')}</option>`).join('')}</select>`;

  if (!loc) {
    view.innerHTML = `<div><h1>Live</h1>${picker}<div class="card muted" style="margin-top:12px">Pick a spot to see its live summary. Tip: tap ☆ on a spot to make it a favourite — your first favourite opens here automatically.</div></div>`;
    bindPicker(view);
    return;
  }

  const activity = loc.activities.includes(state.activity) ? state.activity : loc.activities[0];
  const ev = evalFor(loc, activity);
  const h = ev.current?.hour ?? {};
  const t = h.types || {};
  const vis = activity === 'spear' ? visibilityEstimate(h, loc) : null;
  const now = Date.now();
  const moon = window.SunCalc.getMoonIllumination(new Date());
  const next12 = (ev.hourly || []).filter(r => r.t >= now - 3600e3).slice(0, 12);

  view.innerHTML = `
  <div class="live">
    <div class="row wrap" style="gap:8px">${picker}<span class="spacer"></span>${activityToggle(state.activity)}</div>
    ${activity !== state.activity ? `<p class="small muted">This spot isn't listed for ${state.activity === 'spear' ? 'spearfishing' : 'shore fishing'} — showing ${activity === 'spear' ? 'spearfishing' : 'shore fishing'}.</p>` : ''}

    <div class="card live-hero ${ev.band}">
      <div class="muted small">${loc.virtual ? `Automatic coast area · faces ${degToCompass(loc.facing)} · conditions only, not a checked spot` : `${esc(REGIONS[loc.region]?.name ?? '')} · ${esc(TYPE_LABELS[loc.type] ?? loc.type)}`} ${loc.status === 'demo' ? '<span class="tag demo">unverified</span>' : ''}</div>
      <h1 style="margin:4px 0 10px">${esc(loc.name)}</h1>
      <div class="row wrap">
        <div><div class="muted small">Right now</div>${ev.current ? (ev.current.blocked ? blockPill(ev.current.blockKind, true) : `<span class="pill ${band(ev.current.score)} big">${BAND_LABEL[band(ev.current.score)]} ${ev.current.score ?? ''}</span>`) : '<span class="pill unknown big">Unknown</span>'}</div>
        <div><div class="muted small">Next 24 h</div>${pill(ev)} ${ev.applicable === false ? '' : chanceIcon(ev.score, state.activity, ev.band === 'blocked' && (ev.blockKind || true))}<div class="small">${esc(windowText(ev))}</div></div>
      </div>
      ${ev.currentBlocks?.length ? `<div class="notice danger small" style="margin-top:10px">${ev.currentBlocks.map(b => esc(b.reason)).join('<br>')}</div>` : ''}
      <div style="margin-top:8px">${confText(ev.confidence)}</div>
    </div>

    <div class="tiles">
      ${tile('Wind', h.wind_speed == null ? 'Unknown' : `${arrow(h.wind_direction)} ${degToCompass(h.wind_direction) ?? ''} ${fmtWind(h.wind_speed)}`, h.wind_gust != null ? `gusts ${fmtWind(h.wind_gust)}` : '', t.wind_speed)}
      ${tile('Waves', fmtHeight(h.wave_height), h.wave_period != null ? `${Math.round(h.wave_period)} s from ${degToCompass(h.wave_direction) ?? '?'}` : '', t.wave_height)}
      ${tile('Swell', fmtHeight(h.swell_height), h.swell_period != null ? `${Math.round(h.swell_period)} s from ${degToCompass(h.swell_direction) ?? '?'}` : '', t.swell_height)}
      ${tile('Tide', h.tide_rate == null ? 'Unknown' : h.tide_rate > 0.005 ? 'Rising' : h.tide_rate < -0.005 ? 'Falling' : 'Slack', '', h.tide_rate == null ? 'unknown' : 'modelled')}
      ${tile('Sea temp', fmtTemp(h.sst), '', t.sst)}
      ${activity === 'spear' ? tile('Visibility', vis ? vis.label[0].toUpperCase() + vis.label.slice(1) : 'Unknown', vis?.sat ? 'satellite + forecast' : 'from swell, wind & rain', vis ? 'estimated' : 'unknown') : tile('Rain', h.precipitation == null ? 'Unknown' : `${h.precipitation.toFixed(1)} mm`, 'this hour', t.precipitation)}
    </div>

    ${measuredCard(loc)}
    <div class="card small">Moon: <strong>${moonName(moon.phase)}</strong> (${Math.round(moon.fraction * 100)}% lit) ${typeTag('calculated')}. Light now: <strong>${h.light ?? 'unknown'}</strong>.</div>

    <div class="card">
      <h2>Next 12 hours</h2>
      <div class="strip" role="list">
        ${next12.map(r => `<div class="slot" role="listitem">
          <div class="small muted">${fmtHour(r.t)}</div>
          ${r.blocked ? `<span class="pill blk-${r.blockKind || 'safety'}">${{ legal: '⛔', safety: '⚠', dark: '🌙' }[r.blockKind] || '✕'}</span>` : `<span class="pill ${band(r.score)}">${r.score ?? '?'}</span>`}
          <div class="small">${arrow(r.hour.wind_direction)} ${r.hour.wind_speed == null ? '?' : Math.round(r.hour.wind_speed)}</div>
          <div class="small muted">${r.hour.wave_height == null ? '?' : fmtHeight(r.hour.wave_height)}</div>
        </div>`).join('') || '<p class="muted">No forecast loaded.</p>'}
      </div>
      <p class="small muted">Wind in ${fmtWind(0).split(' ')[1]}, arrow points the way the wind blows. ⛔ = not allowed, ⚠ = not safe, 🌙 = too dark to spear.</p>
    </div>

    ${ev.explanation ? `<div class="card small">${esc(ev.explanation)}</div>` : ''}
    ${loc.type === 'rock_platform' ? '<div class="notice danger small"><strong>Rock fishing danger.</strong> Wear a lifejacket, never fish alone, never turn your back on the sea.</div>' : ''}
    ${legalHTML(legalStatus(state.data.zones, loc, state.activity))}
    ${accessCard(loc)}
    <div class="card" id="live-sightings"><h2>What's being caught or seen here</h2>${sightingsCard()}</div>
    ${communityCard(loc)}

    <div class="card" id="nearby"><h2>Nearby</h2><p class="small muted">Loading…</p></div>

    <div class="row wrap">
      ${loc.virtual ? '' : `<a class="btn" href="#/loc/${encodeURIComponent(loc.id)}">Full details</a>`}
      <button class="btn ghost" id="live-refresh">Refresh</button>
      <span class="spacer"></span>
      <span class="small muted">Forecast for this hour · updated ${state.cond.fetchedAt ? `${fmtAge(state.cond.fetchedAt)}` : 'never'}</span>
    </div>
    <p class="small muted">Wind, waves and tide here are model forecasts for this hour (updated hourly). The "Measured" card shows real buoy readings where available.</p>
  </div>`;

  bindPicker(view);
  view.querySelector('#live-refresh').addEventListener('click', () => actions.refresh());
  fillNearby(view.querySelector('#nearby'), loc);
  fillSightings(view.querySelector('#live-sightings'), loc, true);
  fillAccess(view, loc);
}

// How to get there: directions + nearest public car park; honest about what we can't know.
export function accessCard(loc) {
  const [lng, lat] = loc.geometry.coordinates;
  return `<div class="card access" data-access="${esc(loc.id)}"><h2>Getting there</h2>
    <div class="row wrap" style="gap:8px">
      <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving" target="_blank" rel="noopener">Drive here</a>
      <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking" target="_blank" rel="noopener">Walk here</a>
    </div>
    <p class="small" data-parking>Nearest public car park: looking…</p>
    ${loc.access ? `<p class="small">Access: ${esc(loc.access.vehicle?.toUpperCase() ?? '?')}${loc.access.walk_minutes != null ? `, about ${loc.access.walk_minutes} min walk` : ''}${loc.access.parking === false ? ', no parking' : ''}.</p>` : ''}
    <p class="small muted">The app can't confirm whether the way in crosses private land, cliffs, dunes or thick bush. Use marked tracks and public beach access, obey signs and never cross fenced private property.</p></div>`;
}

async function fillAccess(view, loc) {
  const el = view.querySelector('[data-parking]');
  if (!el) return;
  const n = await nearest(loc.geometry.coordinates, 10);
  if (!n?.parking) { el.textContent = n ? 'Nearest public car park: none mapped within 10 km.' : 'Nearest public car park: facility data not downloaded yet.'; return; }
  const [x, y] = n.parking.f.geometry.coordinates;
  el.innerHTML = `Nearest public car park: <strong>${esc(n.parking.f.properties.name || 'unnamed')}</strong>, ${n.parking.d.toFixed(1)} km away — <a href="https://www.google.com/maps/dir/?api=1&destination=${y},${x}" target="_blank" rel="noopener">directions</a>, then walk ${(n.parking.d * 1000).toFixed(0)} m straight-line to the spot.`;
}

export function measuredCard(loc) {
  const [lng, lat] = loc.geometry.coordinates;
  const ns = nearestStation(state.bom, lat, lng);
  const wind = ns ? `<div class="card small"><strong>Live wind — ${esc(ns.s.site)} weather station</strong> (${ns.d.toFixed(0)} km away) ${typeTag('measured')}<br>
    ${ns.s.wind_dir ?? ''} ${fmtWind(ns.s.wind_kmh)}${ns.s.gust_kmh != null ? `, gusts ${fmtWind(ns.s.gust_kmh)}` : ''}<br>
    <span class="fresh-${freshness(Date.parse(ns.s.time)).cls}">● Observed ${ns.s.time ? `${fmtAge(Date.parse(ns.s.time))} (${fmtDateTime(Date.parse(ns.s.time))})` : 'time unknown'} — ${freshness(Date.parse(ns.s.time)).label}</span> <span class="muted">· © Bureau of Meteorology</span></div>`
    : `<div class="card small"><strong>Live wind:</strong> ${state.bom ? 'no BOM station within 60 km' : 'weather-station feed not running yet — run the Live data workflow'} ${typeTag('unknown')}</div>`;
  const nb = nearestBuoy(state.buoys, lat, lng);
  if (!nb) return wind + `<div class="card small"><strong>Live swell:</strong> ${state.buoys ? 'no buoy within 120 km' : 'buoy feed not running yet — run the Live data workflow'} ${typeTag('unknown')}</div>`;
  const b = nb.b;
  return wind + `<div class="card small"><strong>Live swell — ${esc(b.site)} buoy</strong> (${nb.d.toFixed(0)} km away) ${typeTag('measured')}<br>
    Waves ${fmtHeight(b.hs)}${b.tp != null ? ` @ ${Math.round(b.tp)} s` : ''}${b.dir != null ? ` from ${degToCompass(b.dir)}` : ''}${b.swell_h != null ? ` · swell ${fmtHeight(b.swell_h)}` : ''}${b.sst != null ? ` · water ${fmtTemp(b.sst)}` : ''}<br>
    <span class="fresh-${freshness(Date.parse(b.time)).cls}">● Measured ${fmtAge(Date.parse(b.time))} (${fmtDateTime(Date.parse(b.time))}) — ${freshness(Date.parse(b.time)).label}</span><br><span class="muted">Offshore buoy (30–60 m deep) — conditions at the shore are usually smaller. Not quality controlled.</span></div>`;
}

function tile(label, value, sub, type) {
  return `<div class="tile"><div class="muted small">${label}</div><div class="v">${value}</div>${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}<div>${typeTag(type || 'unknown')}</div></div>`;
}

function bindPicker(view) {
  view.querySelector('#live-pick').addEventListener('change', e => {
    if (e.target.value) location.hash = `#/live/${encodeURIComponent(e.target.value)}`;
  });
}

async function fillNearby(el, loc) {
  const n = await nearest(loc.geometry.coordinates);
  if (!n) { el.innerHTML = '<h2>Nearby</h2><p class="small muted">Shop, servo and toilet data hasn\'t been downloaded yet.</p>'; return; }
  const row = (k, label) => n[k]
    ? `<li>${label}: <strong>${esc(n[k].f.properties.name || n[k].f.properties.brand || 'Unnamed')}</strong> — ${n[k].d.toFixed(1)} km <a href="https://www.google.com/maps/dir/?api=1&destination=${n[k].f.geometry.coordinates[1]},${n[k].f.geometry.coordinates[0]}" target="_blank" rel="noopener">directions</a></li>`
    : `<li>${label}: none within 25 km on OpenStreetMap</li>`;
  el.innerHTML = `<h2>Nearby</h2><ul class="small">${row('tackle', 'Tackle & bait')}${row('fuel', 'Servo (bait not confirmed)')}${row('toilets', 'Public toilet')}${row('food24', '24/7 food')}</ul>
    <p class="small muted">Straight-line distance. Data © OpenStreetMap contributors.</p>`;
}

export const fillAccessFor = fillAccess;

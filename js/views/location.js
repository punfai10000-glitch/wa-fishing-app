import { state, evalFor, getLoc } from '../app.js';
import { REGIONS, TYPE_LABELS } from '../config.js';
import { esc, pill, windowText, confText, typeTag, chanceIcon, blockPill } from '../ui.js';
import { BAND_LABEL } from '../scoring/score.js';
import { fmtWind, fmtHeight, fmtTemp, fmtHour, fmtDay, fmtDateTime, fmtAge } from '../units.js';
import { degToCompass } from '../scoring/geo.js';
import { band } from '../scoring/score.js';
import * as store from '../storage.js';
import { visibilityEstimate } from '../scoring/score.js';
import { rememberLiveSpot, accessCard, fillAccessFor, measuredCard } from './live.js';
import { nearestBuoy, nearestStation } from '../buoys.js';
import { tideCheck } from '../ocean.js';
import { nearestCoastPoint } from '../coast.js';
import { legalStatus, legalHTML } from '../zones.js';
import { fourChecks } from '../checks.js';
import { likelyTargets, LEVEL_LABEL, targetsData } from '../targets.js';
import { communityCard, sightingsCard, fillSightings } from './community.js';

const val = (v, f, type) => v == null ? `Unknown ${typeTag('unknown')}` : `${f(v)} ${typeTag(type)}`;

function scoreBox(title, ev) {
  if (ev.applicable === false) return `<div class="scorebox"><div class="muted small">${title}</div><div class="muted">Not listed for this activity</div></div>`;
  // the pill is the score NOW (ev.score is the best of the next 24 h, shown in the "Best time" line below)
  const c = ev.current;
  const now = !c ? pill(ev) : c.blocked ? blockPill(c.blockKind) : c.score == null ? pill(ev) : `<span class="pill ${band(c.score)}">${BAND_LABEL[band(c.score)]} ${c.score}</span>`;
  return `<div class="scorebox">
    <div class="muted small">${title}</div>
    <div style="margin:6px 0"><span class="small muted">Now:</span> ${now} ${(c ? c.blocked : ev.band === 'blocked') ? '' : chanceIcon(c?.score ?? ev.score, state.activity, false)}</div>
    <div class="small">${esc(windowText(ev))}</div>
    <div>${confText(ev.confidence)}</div>
  </div>`;
}

export function renderLocation(view, rawId) {
  const id = decodeURIComponent(rawId || '');
  const loc = getLoc(id);
  if (!loc) { view.innerHTML = '<div class="card">Spot not found. <a href="#/spots">Back to spots</a></div>'; return; }
  const shore = evalFor(loc, 'shore');
  const spear = evalFor(loc, 'spear');
  const primary = state.activity === 'spear' && spear.applicable !== false ? spear : shore.applicable !== false ? shore : spear;
  const h = primary.current?.hour ?? state.cond.byId[loc.id]?.[0] ?? {};
  const t = h.types || {};
  const fav = store.favourites().has(loc.id);
  rememberLiveSpot(loc.id);
  const spearH = spear.current?.hour;
  const vis = spearH || h.t ? visibilityEstimate(spearH || h, loc) : null;   // shore-only spots still get the water clarity
  const isRock = loc.type === 'rock_platform';
  const live = liveReadings(loc);
  // the spot's own forecast, or the hourly coast file it falls back to (see evalFor)
  const fcAt = state.cond.byId?.[loc.id]?.length ? state.cond.fetchedAt : (loc.tap && state.tapCond ? state.tapCond.fetchedAt : state.coast.fetchedAt || state.cond.fetchedAt);
  const region = REGIONS[loc.region];

  const speciesHere = (loc.species_evidence || []).map(e => state.data.species.species.find(s => s.id === e.species)).filter(Boolean);
  const rulesHere = state.data.rules.filter(r => (!r.applies_to?.location || r.applies_to.location === loc.id) && (!r.applies_to?.bioregion || r.applies_to.bioregion === region?.bioregion));

  view.innerHTML = `
  <div>
    <div class="row loc-head">
      <a class="btn ghost" href="#/${sessionStorage.getItem('lastTab') || 'spots'}" aria-label="Back">←</a>
      <div>
        <h1 style="margin:0">${esc(loc.name)}</h1>
        <div class="muted small">${esc(region?.name ?? loc.region)} · ${esc(TYPE_LABELS[loc.type] ?? loc.type)} · ${esc(loc.confidence)} location ${loc.status === 'demo' ? '<span class="tag demo">unverified details</span>' : ''}${loc.osm ? '<span class="tag demo">from OpenStreetMap — not yet checked</span>' : ''}</div>
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" id="fav" aria-pressed="${fav}" aria-label="${fav ? 'Remove from favourites' : 'Add to favourites'}">${fav ? '★' : '☆'}</button>
    </div>

    ${isRock ? '<div class="notice danger"><strong>Rock fishing danger.</strong> Waves can sweep people off rocks without warning. Wear a lifejacket, never fish alone, and never turn your back on the sea.</div>' : ''}
    ${(loc.safety_notes || []).map(n => `<div class="notice">${esc(n)}</div>`).join('')}
    ${primary.currentBlocks?.length ? `<div class="notice danger"><strong>${{ legal: 'Not allowed right now:', safety: 'Not safe right now:', dark: 'Too dark right now:' }[primary.current?.blockKind] || 'Not available right now:'}</strong><ul>${primary.currentBlocks.map(b => `<li>${esc(b.reason)}</li>`).join('')}</ul></div>` : ''}

    <div class="card">
      <div class="scores">${scoreBox('Shore fishing', shore)}${scoreBox('Spearfishing', spear)}</div>
      ${primary.explanation ? `<p class="small" style="margin:10px 0 0"><span class="muted">At the best time —</span> ${esc(primary.explanation)}</p>` : ''}
      <p class="muted small" style="margin:8px 0 0">Scores rate environmental suitability, not the chance of catching fish.</p>
      <p style="margin:8px 0 0"><a class="btn" href="#/live/${encodeURIComponent(loc.id)}">Open live summary</a></p>
    </div>

    <div class="card">
      <h2>Conditions now</h2>
      <dl class="kv">
        <dt>Wind</dt><dd>${h.wind_speed == null ? val(null) : `${degToCompass(h.wind_direction) ?? ''} ${fmtWind(h.wind_speed)}, gusts ${fmtWind(h.wind_gust)} ${typeTag(t.wind_speed)}`}${live.wind ? `<br>${live.wind}` : ''}</dd>
        ${loc.estuary ? `<dt>Waves &amp; swell</dt><dd>Sheltered river / estuary — no ocean waves ${typeTag('na')}</dd>` : `
        <dt>Waves</dt><dd>${h.wave_height == null ? val(null) : `${fmtHeight(h.wave_height)} from ${degToCompass(h.wave_direction) ?? '?'}, ${h.wave_period != null ? Math.round(h.wave_period) + ' s' : '? s'} ${typeTag(t.wave_height)}`}${live.waves ? `<br>${live.waves}` : ''}</dd>
        <dt>Swell</dt><dd>${h.swell_height == null ? val(null) : `${fmtHeight(h.swell_height)} from ${degToCompass(h.swell_direction) ?? '?'}, ${h.swell_period != null ? Math.round(h.swell_period) + ' s' : '? s'} ${typeTag(t.swell_height)}`}</dd>
        <dt>Wind waves</dt><dd>${val(h.wind_wave_height, fmtHeight, t.wind_wave_height)}</dd>`}
        <dt>Tide</dt><dd>${h.tide_rate == null ? val(null) : `${h.tide_rate > 0.005 ? 'Rising' : h.tide_rate < -0.005 ? 'Falling' : 'Slack'} ${typeTag('modelled')}`}${live.tide ? `<br>${live.tide}` : ''}</dd>
        <dt>Sea temp</dt><dd>${val(h.sst, fmtTemp, t.sst)}</dd>
        <dt>Visibility</dt><dd>${vis ? `${vis.label[0].toUpperCase() + vis.label.slice(1)} ${typeTag('estimated')} <span class="muted small">${vis.sat ? 'satellite water clarity, adjusted for swell, wind &amp; rain since' : 'from recent swell, wind &amp; rain — not measured'}</span>` : loc.estuary ? `River / estuary water — not estimated ${typeTag('na')}` : `Unknown ${typeTag('unknown')}`}</dd>
      </dl>
      <p class="muted small" style="margin:8px 0 0">${fcAt ? `Forecast updated ${fmtAge(fcAt)} (${fmtDateTime(fcAt)})` : 'No forecast loaded'}${live.checked ? ` · live readings checked ${fmtAge(live.checked)}` : ''}</p>
    </div>

    ${(() => { const ev = evalFor(loc); return ev?.applicable === false ? '' : `<div class="card loc-checks"><h2>Right now — four checks</h2>${fourChecks(loc, ev, ev.current, state.data.zones, state.activity)}</div>
      <div class="card"><h2>What might be biting</h2>
        ${(() => { if ((ev.current?.blocks || []).some(b => b.kind === 'legal') || legalStatus(state.data.zones, loc, state.activity).state === 'blocked') return `<p class="small">${state.activity === 'spear' ? 'Spearfishing isn\'t allowed here, so no spearfishing targets. Switch to <strong>Fishing</strong> at the top to see what line fishers might catch.' : 'Fishing isn\'t allowed here, so no species suggestions.'}</p>`;
          const tg = likelyTargets(loc, ev.current?.hour, state.activity, { max: 6, zones: state.data.zones }); return tg.length ? `<table class="checks small">${tg.map(t => `<tr><th><a href="#/fish/${encodeURIComponent(t.id)}">${esc(t.name)}</a></th><td><b class="ck ${{ good: 'good', possible: 'fair', unlikely: 'unknown', closed: 'poor' }[t.level]}">${LEVEL_LABEL[t.level]}</b> ${esc(t.reasons.join(' · '))}${t.why ? `<br><span class="muted">${esc(t.why)}</span>` : ''}</td></tr>`).join('')}</table>` : '<p class="small muted">No common target species listed for this kind of spot.</p>'; })()}
        <p class="small muted">Seasonal guide from general WA angling knowledge — season, habitat, time of day and sea state for this kind of spot. Not based on catch reports, so treat it as a starting point. Sources: ${(targetsData()?.sources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name.split(' — ')[0])}</a>`).join(' · ')}</p>
      </div>`; })()}
    ${measuredCard(loc)}
    <div class="card">
      <h2>Legal status</h2>
      ${legalHTML(legalStatus(state.data.zones, loc, state.activity), { small: false })}
      ${rulesHere.map(r => `<p class="small"><strong>${esc(r.summary)}</strong><br><span class="muted">Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(r.source_name)}</a> · checked ${esc(r.last_checked)}</span></p>`).join('')}
      <p class="small"><a href="https://rules.fish.wa.gov.au" target="_blank" rel="noopener">Check all official rules (DPIRD) →</a></p>
    </div>

    ${loc.activities.includes('spear') ? '<div class="card"><h2>Shark activity</h2><p class="small">Check the official <a href="https://www.sharksmart.com.au/" target="_blank" rel="noopener">SharkSmart WA</a> app or map for recent sightings before entering the water.</p></div>' : ''}

    <details><summary>Next 24 hours</summary><div class="body tbl-scroll">${hourlyTable(shore, spear)}</div></details>
    <details><summary>Day-by-day outlook</summary><div class="body tbl-scroll">${dailyTable(shore, spear)}</div></details>
    <details><summary>Why this score</summary><div class="body">${factorTable(primary)}</div></details>
    <details><summary>Sun & moon</summary><div class="body">
      <dl class="kv">
        <dt>Sunrise</dt><dd>${sun(loc).rise}</dd><dt>Sunset</dt><dd>${sun(loc).set}</dd>
      </dl>

    </div></details>
    <details><summary>Access & terrain</summary><div class="body">
      <dl class="kv">
        <dt>Vehicle</dt><dd>${esc(loc.access?.vehicle?.toUpperCase() ?? 'Unknown')}</dd>
        <dt>Parking</dt><dd>${loc.access?.parking == null ? 'Unknown' : loc.access.parking ? 'Yes' : 'No'}</dd>
        <dt>Walk</dt><dd>${loc.access?.walk_minutes != null ? `~${loc.access.walk_minutes} min` : 'Unknown'}</dd>
        <dt>Terrain</dt><dd>${esc((loc.terrain || []).join(', ').replaceAll('_', ' ') || 'Unknown')}</dd>
        <dt>Exposed to</dt><dd>${esc((loc.exposure?.onshore_dirs || []).join(', ') || 'Unknown')}</dd>
        <dt>Pin</dt><dd>${loc.geometry.coordinates[1].toFixed(5)}, ${loc.geometry.coordinates[0].toFixed(5)} ${loc.last_verified ? `(checked ${esc(loc.last_verified)})` : '(not yet checked on site)'}</dd>
      </dl>
    </div></details>
    ${accessCard(loc)}
    <details open id="sightings"><summary>What's being caught or seen here</summary><div class="body">${sightingsCard()}</div></details>
    ${communityCard(loc)}
    <details><summary>Species notes</summary><div class="body">
      ${speciesHere.length ? speciesHere.map(s => `<p><a href="#/fish/${esc(s.id)}">${esc(s.name)}</a></p>`).join('') : '<p class="muted small">No species evidence recorded for this spot yet. Browse the <a href="#/fish">Fish library</a>.</p>'}
    </div></details>
    <details><summary>Data sources</summary><div class="body small">
      <p>Wind, waves, swell: Open-Meteo forecast models ${typeTag('forecast')}. Tide trend and sea temperature: Open-Meteo modelled ${typeTag('modelled')}. Visibility: our estimate from recent swell, wind and rain ${typeTag('estimated')}.</p>
      <p>Location details: ${esc((loc.sources || []).join(', '))}. Last verified: ${esc(loc.last_verified ?? 'not yet verified')}.</p>
      <p><a href="#/more">All sources & licences →</a></p>
    </div></details>
  </div>`;

  fillSightings(view.querySelector('#sightings .body'), loc);
  fillAccessFor(view, loc);
  view.querySelector('#fav').addEventListener('click', e => {
    const on = store.toggleFavourite(loc.id);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? '★' : '☆';
  });
}

// Real measurements near the spot (weather station, wave buoy, tide gauge) from the hourly live-data files.
// Shown under the forecast line, with their age, so "now" always has the freshest real reading when there is one.
function liveReadings(loc) {
  const [lng, lat] = loc.geometry.coordinates;
  const out = { checked: state.bom?.generated_at ? Date.parse(state.bom.generated_at) : null };
  const age = t => { const h = (Date.now() - t) / 3600e3; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : `${Math.round(h)} h ago`; };
  const ns = nearestStation(state.bom, lat, lng, 40);
  const st = ns && Date.parse(ns.s.time);
  if (st && Date.now() - st < 3 * 3600e3)
    out.wind = `<span class="small">Measured: ${esc(ns.s.wind_dir ?? '')} ${fmtWind(ns.s.wind_kmh)}${ns.s.gust_kmh != null ? `, gusts ${fmtWind(ns.s.gust_kmh)}` : ''} — ${esc(ns.s.site)} station, ${ns.d.toFixed(0)} km, ${age(st)}</span> ${typeTag('measured')}`;
  const nb = loc.estuary ? null : nearestBuoy(state.buoys, lat, lng, 80);
  const bt = nb && Date.parse(nb.b.time);
  if (bt && Date.now() - bt < 6 * 3600e3)
    out.waves = `<span class="small">Measured offshore: ${fmtHeight(nb.b.hs)}${nb.b.tp != null ? ` @ ${Math.round(nb.b.tp)} s` : ''} — ${esc(nb.b.site)} buoy, ${nb.d.toFixed(0)} km, ${age(bt)} (usually smaller at the shore)</span> ${typeTag('measured')}`;
  else if (bt) out.waves = `<span class="small muted">${esc(nb.b.site)} buoy: last reading ${age(bt)} — the buoy feed is delayed, so the forecast is used</span>`;
  const tc = tideCheck(state.tides, lat, lng, (la, ln) => { const p = nearestCoastPoint(la, ln, 30); return p ? state.coast.byId?.[p.p.id] : null; });
  if (tc && tc.ageH < 3) out.tide = `<span class="small">Measured: ${tc.trend > 0.015 ? 'rising' : tc.trend < -0.015 ? 'falling' : 'about steady'} — ${esc(tc.station)} gauge, ${Math.round(tc.km)} km</span> ${typeTag('measured')}`;
  return out;
}

function sun(loc) {
  const [lng, lat] = loc.geometry.coordinates;
  const s = window.SunCalc.getTimes(new Date(), lat, lng);
  const f = d => isNaN(d) ? 'Unknown' : `${new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Perth' }).format(d)} ${typeTag('calculated')}`;
  return { rise: f(s.sunrise), set: f(s.sunset) };
}

function cell(row, ev) {
  if (ev.applicable === false) return '<td class="muted">–</td>';
  if (!row) return '<td class="muted">?</td>';
  if (row.blocked) return '<td><span class="pill blocked">✕</span></td>';
  const b = band(row.score);
  return `<td><span class="pill ${b}">${row.score ?? '?'}</span></td>`;
}

function hourlyTable(shore, spear) {
  const base = (shore.applicable !== false ? shore : spear).hourly;
  if (!base) return '<p class="muted">No forecast loaded.</p>';
  const now = Date.now();
  const rows = base.filter(r => r.t >= now - 3600e3 && r.t < now + 24 * 3600e3);
  const sp = new Map((spear.hourly || []).map(r => [r.t, r]));
  const sh = new Map((shore.hourly || []).map(r => [r.t, r]));
  return `<table><thead><tr><th>Time</th><th>Shore</th><th>Spear</th><th>Wind</th><th>Waves</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${fmtHour(r.t)}</td>${cell(sh.get(r.t), shore)}${cell(sp.get(r.t), spear)}
      <td>${r.hour.wind_speed == null ? '?' : `${degToCompass(r.hour.wind_direction) ?? ''} ${fmtWind(r.hour.wind_speed)}`}</td>
      <td>${fmtHeight(r.hour.wave_height)}</td></tr>`).join('')}
  </tbody></table><p class="muted small">✕ = blocked (safety or legal). All values are forecasts.</p>`;
}

function dailyTable(shore, spear) {
  const days = (shore.applicable !== false ? shore : spear).daily;
  if (!days) return '<p class="muted">No forecast loaded.</p>';
  const spDays = new Map((spear.daily || []).map(d => [d.day, d]));
  const shDays = new Map((shore.daily || []).map(d => [d.day, d]));
  const c = (d, ev) => ev.applicable === false ? '<td class="muted">–</td>' : !d ? '<td>?</td>' : d.best == null ? `<td><span class="pill ${d.blockedHours ? 'blocked' : 'unknown'}">${d.blockedHours ? '✕' : '?'}</span></td>` : `<td><span class="pill ${band(d.best)}">${d.best}</span> <span class="muted small">${fmtHour(d.bestHour)}</span></td>`;
  return `<table><thead><tr><th>Day</th><th>Shore best</th><th>Spear best</th></tr></thead><tbody>
    ${days.map(d => `<tr><td>${fmtDay(d.t)}</td>${c(shDays.get(d.day), shore)}${c(spDays.get(d.day), spear)}</tr>`).join('')}
  </tbody></table><p class="muted small">Coast spots show 3 days (the hourly coast file); the hand-picked spots show 7. Forecast accuracy drops after 2–3 days.</p>`;
}

function factorTable(ev) {
  const row = ev.hourly?.filter(h => !h.blocked && h.score != null).sort((a, b) => b.score - a.score)[0] ?? ev.current;
  if (!row) return '<p class="muted">No data.</p>';
  return `<p class="small muted">Breakdown for the best hour (${fmtHour(row.t)}). Unknown factors are left out of the score and lower the confidence instead.</p>
  <table><thead><tr><th>Factor</th><th>Score</th><th>Weight</th><th>Detail</th></tr></thead><tbody>
  ${row.result.factors.map(f => `<tr><td>${esc(f.label)}</td><td>${f.score ?? '—'}</td><td>${f.weight}</td><td>${esc(f.detail)} ${typeTag(f.type)}</td></tr>`).join('')}
  </tbody></table>`;
}

import { state, evalFor, getLoc } from '../app.js';
import { REGIONS, TYPE_LABELS } from '../config.js';
import { esc, pill, windowText, confText, typeTag, chanceIcon } from '../ui.js';
import { fmtWind, fmtHeight, fmtTemp, fmtHour, fmtDay, fmtDateTime, fmtAge } from '../units.js';
import { degToCompass } from '../scoring/geo.js';
import { band } from '../scoring/score.js';
import * as store from '../storage.js';
import { visibilityEstimate } from '../scoring/score.js';
import { rememberLiveSpot, accessCard, fillAccessFor, measuredCard } from './live.js';
import { legalStatus } from '../zones.js';
import { communityCard, sightingsCard, fillSightings } from './community.js';

const val = (v, f, type) => v == null ? `Unknown ${typeTag('unknown')}` : `${f(v)} ${typeTag(type)}`;

function scoreBox(title, ev) {
  if (ev.applicable === false) return `<div class="scorebox"><div class="muted small">${title}</div><div class="muted">Not listed for this activity</div></div>`;
  return `<div class="scorebox">
    <div class="muted small">${title}</div>
    <div style="margin:6px 0">${pill(ev)} ${ev.applicable === false ? '' : chanceIcon(ev.score, state.activity, ev.band === 'blocked')}</div>
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
  const vis = spearH ? visibilityEstimate(spearH, loc) : null;
  const isRock = loc.type === 'rock_platform';
  const region = REGIONS[loc.region];

  const speciesHere = (loc.species_evidence || []).map(e => state.data.species.species.find(s => s.id === e.species)).filter(Boolean);
  const rulesHere = state.data.rules.filter(r => !r.applies_to.bioregion || r.applies_to.bioregion === region?.bioregion);

  view.innerHTML = `
  <div>
    <div class="row">
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
    ${primary.currentBlocks?.length ? `<div class="notice danger"><strong>Blocked right now:</strong><ul>${primary.currentBlocks.map(b => `<li>${esc(b.reason)}</li>`).join('')}</ul></div>` : ''}

    <div class="card">
      <div class="scores">${scoreBox('Shore fishing', shore)}${scoreBox('Spearfishing', spear)}</div>
      ${primary.explanation ? `<p class="small" style="margin:10px 0 0">${esc(primary.explanation)}</p>` : ''}
      <p class="muted small" style="margin:8px 0 0">Scores rate environmental suitability, not the chance of catching fish.</p>
      <p style="margin:8px 0 0"><a class="btn" href="#/live/${encodeURIComponent(loc.id)}">Open live summary</a></p>
    </div>

    <div class="card">
      <h2>Conditions now</h2>
      <dl class="kv">
        <dt>Wind</dt><dd>${h.wind_speed == null ? val(null) : `${degToCompass(h.wind_direction) ?? ''} ${fmtWind(h.wind_speed)}, gusts ${fmtWind(h.wind_gust)} ${typeTag(t.wind_speed)}`}</dd>
        <dt>Waves</dt><dd>${h.wave_height == null ? val(null) : `${fmtHeight(h.wave_height)} from ${degToCompass(h.wave_direction) ?? '?'}, ${h.wave_period != null ? Math.round(h.wave_period) + ' s' : '? s'} ${typeTag(t.wave_height)}`}</dd>
        <dt>Swell</dt><dd>${h.swell_height == null ? val(null) : `${fmtHeight(h.swell_height)} from ${degToCompass(h.swell_direction) ?? '?'}, ${h.swell_period != null ? Math.round(h.swell_period) + ' s' : '? s'} ${typeTag(t.swell_height)}`}</dd>
        <dt>Wind waves</dt><dd>${val(h.wind_wave_height, fmtHeight, t.wind_wave_height)}</dd>
        <dt>Tide</dt><dd>${h.tide_rate == null ? val(null) : `${h.tide_rate > 0.005 ? 'Rising' : h.tide_rate < -0.005 ? 'Falling' : 'Slack'} ${typeTag('modelled')}`}</dd>
        <dt>Sea temp</dt><dd>${val(h.sst, fmtTemp, t.sst)}</dd>
        <dt>Visibility</dt><dd>${vis ? `${vis.label[0].toUpperCase() + vis.label.slice(1)} ${typeTag('estimated')} <span class="muted small">from recent swell, wind &amp; rain — not measured</span>` : `Unknown ${typeTag('unknown')}`}</dd>
      </dl>
      <p class="muted small" style="margin:8px 0 0">${state.cond.fetchedAt ? `Forecast updated ${fmtAge(state.cond.fetchedAt)} (${fmtDateTime(state.cond.fetchedAt)})` : 'No forecast loaded'}</p>
    </div>

    ${measuredCard(loc)}
    <div class="card">
      <h2>Legal status</h2>
      ${(() => { const ls = legalStatus(state.data.zones, loc); return `<div class="notice ${ls.state === 'blocked' ? 'danger' : ls.state === 'ok' ? 'info' : ''}"><strong>${ls.state === 'blocked' ? 'No fishing here.' : ls.state === 'ok' ? 'Zone check:' : (ls.state === 'caution' ? 'Check the zone.' : 'Zone check pending.')}</strong> ${esc(ls.text)}</div>`; })()}
      ${rulesHere.map(r => `<p class="small"><strong>${esc(r.summary)}</strong><br><span class="muted">Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(r.source_name)}</a> · checked ${esc(r.last_checked)}</span></p>`).join('')}
      <p class="small"><a href="https://rules.fish.wa.gov.au" target="_blank" rel="noopener">Check all official rules (DPIRD) →</a></p>
    </div>

    ${loc.activities.includes('spear') ? '<div class="card"><h2>Shark activity</h2><p class="small">Check the official <a href="https://www.sharksmart.com.au/" target="_blank" rel="noopener">SharkSmart WA</a> app or map for recent sightings before entering the water.</p></div>' : ''}

    <details><summary>Next 24 hours</summary><div class="body tbl-scroll">${hourlyTable(shore, spear)}</div></details>
    <details><summary>7-day outlook</summary><div class="body tbl-scroll">${dailyTable(shore, spear)}</div></details>
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
  </tbody></table><p class="muted small">Forecast accuracy drops after 2–3 days.</p>`;
}

function factorTable(ev) {
  const row = ev.hourly?.filter(h => !h.blocked && h.score != null).sort((a, b) => b.score - a.score)[0] ?? ev.current;
  if (!row) return '<p class="muted">No data.</p>';
  return `<p class="small muted">Breakdown for the best hour (${fmtHour(row.t)}). Unknown factors are left out of the score and lower the confidence instead.</p>
  <table><thead><tr><th>Factor</th><th>Score</th><th>Weight</th><th>Detail</th></tr></thead><tbody>
  ${row.result.factors.map(f => `<tr><td>${esc(f.label)}</td><td>${f.score ?? '—'}</td><td>${f.weight}</td><td>${esc(f.detail)} ${typeTag(f.type)}</td></tr>`).join('')}
  </tbody></table>`;
}

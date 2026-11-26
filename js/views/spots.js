import { state, evalFor, visibleLocations, rerender } from '../app.js';
import { REGIONS, TYPE_LABELS } from '../config.js';
import { esc, pill, windowText, confText, activityToggle } from '../ui.js';
import * as store from '../storage.js';

const ORDER = { good: 0, fair: 1, poor: 2, unknown: 3, blocked: 4 };

export function renderSpots(view) {
  const favs = store.favourites();
  const locs = visibleLocations()
    .map(l => ({ l, ev: evalFor(l) }))
    .filter(x => x.ev.applicable !== false)
    .sort((a, b) => (ORDER[a.ev.band] - ORDER[b.ev.band]) || ((b.ev.score ?? -1) - (a.ev.score ?? -1)));
  const notRated = visibleLocations().filter(l => !l.activities.includes(state.activity)).length;

  const speciesOpts = state.data.species.species.filter(s => s.activities.includes(state.activity));
  view.innerHTML = `
    <div>
      <h1>Forecast · best spots next 24 h</h1>
      <p class="muted small">Ranked by environmental suitability for ${state.activity === 'spear' ? 'spearfishing' : 'shore fishing'} — not a guarantee of fish.</p>
      <div class="filters">
        ${activityToggle(state.activity)}
        <label class="sr" for="f-region">Area</label>
        <select id="f-region"><option value="">All areas</option>${Object.entries(REGIONS).map(([id, r]) => `<option value="${id}" ${state.region === id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        <label class="sr" for="f-species">Target species</label>
        <select id="f-species"><option value="">Any species</option>${speciesOpts.map(s => `<option value="${s.id}" ${state.species === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="f-fav" ${state.favOnly ? 'checked' : ''}> Favourites only</label>
        <label class="check"><input type="checkbox" id="f-osm" ${state.showOsm ? 'checked' : ''}> Include ${state.osmSpots.length} OpenStreetMap spots</label>
      </div>
      ${state.species ? '<p class="notice info small">Species filter shows only spots with recorded evidence for that species. Species-specific scoring is coming in a later version.</p>' : ''}
      <div id="list">
        ${locs.length ? locs.slice(0, 60).map(({ l, ev }) => `
          <a class="card spot" href="#/loc/${encodeURIComponent(l.id)}">
            <div class="row">
              <div>
                <h3>${esc(l.name)} ${favs.has(l.id) ? '<span aria-label="favourite">★</span>' : ''}</h3>
                <div class="muted small">${esc(REGIONS[l.region]?.name ?? l.region)} · ${esc(TYPE_LABELS[l.type] ?? l.type)}${l.status === 'demo' ? ' · <span class="tag demo">unverified</span>' : ''}${l.osm ? ' · <span class="tag">OpenStreetMap</span>' : ''}</div>
              </div>
              <span class="spacer"></span>${pill(ev)}
            </div>
            <div class="small" style="margin-top:6px">${esc(windowText(ev))}</div>
            ${ev.blocked ? `<p class="why">✕ ${esc(ev.blockReasons[0] ?? '')}</p>` : ev.explanation ? `<p class="why">${esc(ev.explanation)}</p>` : ''}
            <div>${confText(ev.confidence)}</div>
          </a>`).join('') : `<div class="card muted">No spots match these filters${state.species ? ' — no spot has recorded evidence for this species yet' : ''}.</div>`}
      </div>
      ${notRated ? `<p class="muted small">${notRated} spot(s) in this view aren't listed for ${state.activity === 'spear' ? 'spearfishing' : 'shore fishing'}.</p>` : ''}
    </div>`;

  view.querySelector('#f-region').addEventListener('change', e => { state.region = e.target.value; rerender(); });
  view.querySelector('#f-species').addEventListener('change', e => { state.species = e.target.value; rerender(); });
  view.querySelector('#f-fav').addEventListener('change', e => { state.favOnly = e.target.checked; rerender(); });
  view.querySelector('#f-osm').addEventListener('change', e => { state.showOsm = e.target.checked; store.set('showOsm', e.target.checked); rerender(); });
}

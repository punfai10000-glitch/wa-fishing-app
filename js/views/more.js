import { state, rerender, actions } from '../app.js';
import { esc } from '../ui.js';
import { getUnits, setUnits, fmtAge } from '../units.js';
import * as store from '../storage.js';

export function renderMore(view) {
  const u = getUnits();
  const favs = store.favourites();
  const draft = state.data.thresholds.filter(t => t.status === 'draft');
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  view.innerHTML = `
  <div>
    <h1>Settings & info</h1>

    <div class="card">
      <h2>Units</h2>
      <div class="filters">
        <label>Wind<br><select data-unit="wind">${opt('kmh', u.wind, 'km/h')}${opt('kn', u.wind, 'knots')}${opt('ms', u.wind, 'm/s')}</select></label>
        <label>Height<br><select data-unit="height">${opt('m', u.height, 'metres')}${opt('ft', u.height, 'feet')}</select></label>
        <label>Temperature<br><select data-unit="temp">${opt('c', u.temp, '°C')}${opt('f', u.temp, '°F')}</select></label>
      </div>
    </div>

    <div class="card">
      <h2>Data</h2>
      <p class="small">Forecast last updated: ${state.cond.fetchedAt ? fmtAge(state.cond.fetchedAt) : 'never'}.</p>
      <button class="btn" id="refresh">Refresh now</button>
      <p class="small">Favourites saved on this device: ${favs.size}. <button class="btn ghost" id="clear-fav" ${favs.size ? '' : 'disabled'}>Clear favourites</button></p>
    </div>

    <div class="card">
      <h2>Safety limits</h2>
      <p class="small">${draft.length} of ${state.data.thresholds.length} safety limits are <strong>drafts</strong> awaiting review against official safety guidance. Spots are blocked when these are exceeded:</p>
      <table><thead><tr><th>Applies to</th><th>Limit</th><th>Status</th></tr></thead><tbody>
      ${state.data.thresholds.map(t => `<tr><td>${esc(t.applies_to.activity)}${Array.isArray(t.applies_to.types) ? ' · ' + esc(t.applies_to.types.join(', ').replace('_', ' ')) : ''}</td><td>${esc(t.metric.replace(/_/g, ' '))} ≤ ${t.max}</td><td>${esc(t.status)}</td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="card">
      <h2>Data sources & licences</h2>
      <div class="tbl-scroll"><table><thead><tr><th>Source</th><th>Type</th><th>Licence</th><th>Status</th></tr></thead><tbody>
      ${state.data.sources.map(s => `<tr><td>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}<br><span class="muted small">${esc(s.attribution)}</span></td><td>${esc(s.type)}</td><td>${esc(s.licence)}</td><td>${esc(s.status)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">Every value in the app is labelled <span class="tag measured">measured</span> <span class="tag forecast">forecast</span> <span class="tag modelled">modelled</span> <span class="tag calculated">calculated</span> or <span class="tag unknown">unknown</span>. Missing data is never filled in.</p>
    </div>

    <div class="card">
      <h2>About</h2>
      <p class="small">A free, non-commercial tool for land-based fishing and shore-entry spearfishing from Perth to Esperance. Scores rate environmental suitability only — not the chance of catching fish, and not a safety guarantee. No ads, no accounts, no tracking.</p>
      <button class="btn ghost" id="show-ack">Show safety notice again</button>
    </div>
  </div>`;

  view.querySelectorAll('[data-unit]').forEach(s => s.addEventListener('change', () => { setUnits({ [s.dataset.unit]: s.value }); rerender(); }));
  view.querySelector('#refresh').addEventListener('click', () => actions.refresh());
  view.querySelector('#clear-fav').addEventListener('click', () => { store.set('favourites', []); rerender(); });
  view.querySelector('#show-ack').addEventListener('click', () => document.getElementById('ack').showModal?.());
}

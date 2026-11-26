import { state, rerender, actions } from '../app.js';
import { esc } from '../ui.js';
import { getUnits, setUnits, fmtAge } from '../units.js';
import * as store from '../storage.js';

export function renderMore(view) {
  const u = getUnits();
  const favs = store.favourites();
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  view.innerHTML = `
  <div>
    <h1>My Fishing</h1>
    <a class="card" href="#/measure" style="display:block;text-decoration:none"><h2>📏 Measure a catch</h2><p class="small muted">Take a photo with a bank card next to the fish — the app works out its length and checks the legal size.</p></a>

    <div class="card">
      <h2>Saved spots</h2>
      ${favs.size ? `<ul class="plain">${[...favs].map(id => { const l = [...state.data.locations, ...(state.osmSpots || [])].find(x => x.id === id); return l ? `<li><a href="#/loc/${encodeURIComponent(id)}">★ ${esc(l.name)}</a></li>` : ''; }).join('')}</ul>` : '<p class="small muted">Tap ☆ Save on any spot card to keep it here.</p>'}
      <p class="small muted">Fishing journal (catches and trips with no fish) is coming in a later update — saved on this phone only.</p>
    </div>

    <div class="card">
      <h2>App settings</h2>
      <label class="tog"><input type="checkbox" id="lite" ${store.get('lite') ? 'checked' : ''}><span><span class="tog-l">Battery & data saver</span><small>No wind/swell animation and fewer pins — for older phones or slow connections.</small></span></label>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn ghost" id="reset-view">Reset map view</button>
        <button class="btn ghost" id="reset-all">Reset all settings</button>
      </div>
      <p class="small muted">Saved on this phone only: map position, layers, species, units and saved spots. Your location is never stored.</p>
    </div>

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
      <p class="small">A spot shows <strong>Not safe</strong> when the forecast passes any of these. They follow published BOM, Transport WA and Recfishwest guidance, choosing the cautious end — but nobody has checked them on site. <strong>Waves can be twice the forecast height.</strong> Always look at the water yourself.</p>
      <table class="small"><thead><tr><th>Applies to</th><th>Not safe when</th></tr></thead><tbody>
      ${state.data.thresholds.map(t => {
        const who = t.applies_to.activity === 'spear' ? 'Spearfishing' : Array.isArray(t.applies_to.types) ? 'Rocks & headlands' : 'All shore spots';
        const unit = /kmh/.test(t.metric) ? ' km/h' : ' m';
        const what = t.metric === 'wave_missing' ? 'no wave forecast is available'
          : `${{ wind_gust_kmh: 'gusts', wind_speed_kmh: 'wind', onshore_wave_m: 'waves reaching the spot', wave_m_any_dir: 'waves from any direction', current_kmh: 'ocean current' }[t.metric] ?? t.metric} over ${t.max}${unit}${t.min_period_s ? ` with swell period ${t.min_period_s} s or longer` : ''}`;
        return `<tr><td>${who}</td><td>${esc(what)}<br><span class="muted">${esc(t.rationale)}</span></td></tr>`;
      }).join('')}
      </tbody></table>
      <p class="small muted">Thunderstorms and night-time spearfishing are also blocked. Sources: ${(state.data.thresholdSources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(' · ')}</p>
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
  view.querySelector('#lite').addEventListener('change', e => { store.set('lite', e.target.checked); rerender(); });
  view.querySelector('#reset-view').addEventListener('click', () => { store.remove('mapView'); location.hash = '#/map'; location.reload(); });
  view.querySelector('#reset-all').addEventListener('click', () => {
    if (!confirm('Reset all settings on this phone (map, layers, species, units, saved spots)?')) return;
    ['mapView', 'layers', 'layersV3', 'layersV4', 'targetSpecies', 'recentSpecies', 'favSpecies', 'favourites', 'units', 'lite', 'dismissed', 'activity'].forEach(k => store.remove(k));
    location.hash = '#/map'; location.reload();
  });
  view.querySelector('#show-ack').addEventListener('click', () => document.getElementById('ack').showModal?.());
}

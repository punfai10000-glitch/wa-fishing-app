// Fish tab: Library (photos, keep/protected, size & bag limits), ID helper, Rules.
import { state } from '../app.js';
import { esc } from '../ui.js';
import { speciesPhoto } from '../wiki.js';
import { renderFishId } from './fishid.js';
import { renderRules } from './rules.js';

let query = '';
let filter = 'all';

function subnav(active) {
  const items = [['', 'Library'], ['id', 'ID helper'], ['rules', 'Rules']];
  return `<div class="seg" role="tablist" aria-label="Fish sections" style="margin-bottom:12px">
    ${items.map(([k, l]) => `<a role="tab" class="seg-link" href="#/fish${k ? '/' + k : ''}" aria-selected="${active === k}">${l}</a>`).join('')}
  </div>`;
}

function statusBadge(s) {
  if (s.status === 'danger') return '<span class="pill blocked">☠ Dangerous — don\'t touch</span>';
  return s.status === 'protected'
    ? '<span class="pill poor">Protected — release</span>'
    : '<span class="pill good">Keep within limits</span>';
}

function limitsTable(s) {
  if (s.status === 'protected' || s.status === 'danger') return `<p class="notice danger small">${esc(s.protection)}</p>`;
  if (!s.limits?.length) return '<p class="small muted">Limits not entered — check the official rules.</p>';
  return `<table class="small"><thead><tr><th>Where</th><th>Min size</th><th>Daily bag</th></tr></thead><tbody>
    ${s.limits.map(l => `<tr><td>${esc(l.where)}${l.note ? `<br><span class="muted">${esc(l.note)}</span>` : ''}</td><td>${esc(l.min_size)}</td><td>${esc(l.bag)}</td></tr>`).join('')}
  </tbody></table>`;
}

function card(s, open) {
  return `<details class="fish" id="sp-${esc(s.id)}" ${open ? 'open' : ''} data-wiki="${esc(s.wiki || '')}">
    <summary>
      <div class="fish-head">
        <div class="thumb" data-thumb aria-hidden="true"></div>
        <div><strong>${esc(s.name)}</strong>${s.aka?.length ? `<span class="muted small"> · ${esc(s.aka.join(', '))}</span>` : ''}<br>
          <span class="muted small"><i>${esc(s.scientific)}</i></span><br>${statusBadge(s)}</div>
      </div>
    </summary>
    <div class="body">
      <figure class="photo" data-photo><span class="muted small">Loading photo…</span></figure>
      ${limitsTable(s)}
      <p class="small"><strong>How to tell:</strong> ${esc(s.id_tips)}</p>
      <p class="small muted">Source: ${(s.sources || []).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(' · ')} · checked ${esc(s.last_checked ?? '—')}.
</p>
    </div>
  </details>`;
}

async function hydratePhoto(el, withBig) {
  const ph = await speciesPhoto(el.dataset.wiki);
  const thumb = el.querySelector('[data-thumb]');
  const fig = el.querySelector('[data-photo]');
  if (!ph) {
    if (fig) fig.innerHTML = '<span class="muted small">No photo available.</span>';
    return;
  }
  thumb.style.backgroundImage = `url("${ph.src}")`;
  if (withBig && fig) fig.innerHTML = `<img src="${esc(ph.src)}" alt="Photo of ${esc(el.querySelector('strong').textContent)}" loading="lazy">
    <figcaption class="small muted">Photo: Wikimedia Commons — <a href="${esc(ph.credit)}" target="_blank" rel="noopener">author &amp; licence</a>. Colours vary with size, age and how long it's been out of the water.</figcaption>`;
}

export function renderFish(view, sub) {
  if (sub === 'id') { view.innerHTML = subnav('id') + '<div id="fish-body"></div>'; renderFishId(view.querySelector('#fish-body')); return; }
  if (sub === 'rules') { view.innerHTML = subnav('rules') + '<div id="fish-body"></div>'; renderRules(view.querySelector('#fish-body')); return; }

  const focus = sub && sub !== '' ? decodeURIComponent(sub) : null;
  const all = state.data.species.species;
  const list = all.filter(s =>
    (filter === 'all' || (filter === 'protected' ? s.status !== 'limits' : s.status === 'limits')) &&
    (!query || [s.name, s.scientific, ...(s.aka || [])].join(' ').toLowerCase().includes(query.toLowerCase())));

  view.innerHTML = `${subnav('')}
    <h1>Fish library</h1>
    <div class="notice small">Limits are from DPIRD's 2026 guide and the 1 June 2026 changes (checked 25 Nov 2026). Perth → Augusta is the West Coast bioregion; Denmark → Esperance is the South Coast. If DPIRD changes a rule, the official rule applies.</div>
    <div class="filters">
      <input type="search" id="fq" placeholder="Search fish" value="${esc(query)}" aria-label="Search fish">
      <select id="ff" aria-label="Show">
        <option value="all" ${filter === 'all' ? 'selected' : ''}>All (${all.length})</option>
        <option value="keep" ${filter === 'keep' ? 'selected' : ''}>Can keep within limits</option>
        <option value="protected" ${filter === 'protected' ? 'selected' : ''}>Protected or dangerous</option>
      </select>
    </div>
    <div id="fish-list">${list.map(s => card(s, s.id === focus)).join('') || '<p class="muted">No fish match.</p>'}</div>
    <p class="muted small">Not sure what you caught? Try the <a href="#/fish/id">ID helper</a>. If you can't identify it, release it.</p>`;

  view.querySelectorAll('details.fish').forEach(el => {
    hydratePhoto(el, el.open);
    el.addEventListener('toggle', () => { if (el.open) hydratePhoto(el, true); });
  });
  if (focus) view.querySelector(`#sp-${CSS.escape(focus)}`)?.scrollIntoView();
  const fq = view.querySelector('#fq');
  fq.addEventListener('input', () => { query = fq.value; const pos = fq.selectionStart; renderFish(view); const n = view.querySelector('#fq'); n.focus(); n.setSelectionRange(pos, pos); });
  view.querySelector('#ff').addEventListener('change', e => { filter = e.target.value; renderFish(view); });
}

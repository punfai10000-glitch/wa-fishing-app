// Fish tab: Library (photos, keep/protected, size & bag limits), ID helper, Rules.
import { state } from '../app.js';
import { esc } from '../ui.js';
import { speciesPhoto, speciesGallery } from '../wiki.js';
import { renderFishId } from './fishid.js';
import { renderRules } from './rules.js';
import { renderGuides } from './guides.js';

let query = '';
let filter = 'all';

function subnav(active) {
  const items = [['', 'Library'], ['id', 'ID helper'], ['guides', 'How-to'], ['rules', 'Rules']];
  return `<div class="seg" role="tablist" aria-label="Fish sections" style="margin-bottom:12px">
    ${items.map(([k, l]) => `<a role="tab" class="seg-link" href="#/fish${k ? '/' + k : ''}" aria-selected="${active === k}">${l}</a>`).join('')}
  </div>`;
}

function statusBadge(s) {
  if (s.status === 'danger') return '<span class="pill blocked">☠ Dangerous — don\'t touch</span>';
  if (s.status === 'protected') return '<span class="pill poor">Protected — release</span>';
  if (s.pest || s.category === 'pest') return '<span class="pill blocked">Pest — don\'t release</span>';
  return s.limits_verified === false
    ? '<span class="pill fair">Can keep — exact limit being added</span>'
    : '<span class="pill good">Keep within limits</span>';
}

function limitsTable(s) {
  if (s.status === 'protected' || s.status === 'danger') return `<p class="notice danger small">${esc(s.protection)}</p>`;
  if (!s.limits?.length) return '<p class="small notice">This fish\'s size and bag limit isn\'t in the app yet — check <a href="https://rules.fish.wa.gov.au" target="_blank" rel="noopener">rules.fish.wa.gov.au</a> or the Recfishwest app before you keep one. If unsure, release it.</p>';
  const pending = s.limits_verified === false
    ? `<p class="notice small">This fish's own size and bag limit is still being added. Until then the group limit below applies — and the species limit can be stricter.</p>` : '';
  return `${pending}<table class="small"><thead><tr><th>Where</th><th>Min size</th><th>Daily bag</th></tr></thead><tbody>
    ${s.limits.map(l => `<tr><td>${esc(l.where)}${l.note ? `<br><span class="muted">${esc(l.note)}</span>` : ''}</td><td>${esc(l.min_size)}</td><td>${esc(l.bag)}</td></tr>`).join('')}
  </tbody></table>`;
}

function card(s, open) {
  return `<details class="fish" id="sp-${esc(s.id)}" ${open ? 'open' : ''} data-wiki="${esc(s.wiki || '')}" data-sci="${esc(s.scientific || '')}" data-name="${esc(s.name)}">
    <summary>
      <div class="fish-head">
        <div class="thumb" data-thumb aria-hidden="true"></div>
        <div><strong>${esc(s.name)}</strong>${s.aka?.length ? `<span class="muted small"> · ${esc(s.aka.join(', '))}</span>` : ''}<br>
          <span class="muted small"><i>${esc(s.scientific)}</i></span><br>${statusBadge(s)}${s.licence && /required/.test(s.licence) ? ' <span class="pill fair">🪪 Licence</span>' : ''}</div>
      </div>
    </summary>
    <div class="body">
      <div class="gallery" data-gallery><span class="muted small">Loading photos…</span></div>
      ${s.caution ? `<p class="notice small">⚠ ${esc(s.caution)}</p>` : ''}
      ${s.licence ? `<p class="notice info small"><strong>🪪 Licence:</strong> ${esc(s.licence)}</p>` : ''}
      ${limitsTable(s)}
      ${s.id_tips ? `<p class="small"><strong>How to tell:</strong> ${esc(s.id_tips)}</p>` : ''}
      ${s.group ? `<p class="small muted">Group: ${esc(s.group)}${s.region === 'north' ? ' · mostly found north of Geraldton' : ''}</p>` : ''}
      ${s.more?.length ? `<ul class="small fish-more">${s.more.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      <p class="small muted">From the shore you don't need a licence for most fish. Fishing from a powered boat (or using one to reach a spot) needs a Recreational Fishing from Boat Licence (RFBL).</p>
      <p class="small muted">Source: ${(s.sources || []).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(' · ')} · checked ${esc(s.last_checked ?? '—')}.
</p>
    </div>
  </details>`;
}

async function hydrateThumb(el) {
  if (el.dataset.thumbDone) return;
  el.dataset.thumbDone = '1';
  const thumb = el.querySelector('[data-thumb]');
  const ph = await speciesPhoto(el.dataset.wiki);
  if (ph) { thumb.style.backgroundImage = `url("${ph.src}")`; return; }
  const g = await speciesGallery(el.dataset.sci, 6, el.dataset.name);
  if (g[0]) thumb.style.backgroundImage = `url("${g[0].src}")`;
}

async function hydrateGallery(el) {
  const box = el.querySelector('[data-gallery]');
  if (!box || box.dataset.done) return;
  box.dataset.done = '1';
  const name = el.querySelector('strong').textContent;
  let photos = await speciesGallery(el.dataset.sci, 6, el.dataset.name);
  if (!photos.length) {
    const ph = await speciesPhoto(el.dataset.wiki);
    if (ph) photos = [{ src: ph.src, attribution: 'Wikimedia Commons', license: 'see file page', page: ph.credit }];
  }
  if (!photos.length) { box.innerHTML = '<span class="muted small">No photos available yet.</span>'; return; }
  box.innerHTML = `<div class="gal-strip">${photos.map((p, i) => `<figure class="gal-item"><img src="${esc(p.src)}" alt="${esc(name)} photo ${i + 1}" loading="lazy">
      <figcaption class="small muted"><a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.attribution)}</a> · ${esc(p.license)}</figcaption></figure>`).join('')}</div>
    <p class="small muted" style="margin:4px 0 0">${photos.length} photo${photos.length > 1 ? 's' : ''} — swipe sideways. Colours change with size, age and time out of the water.${photos[0].taxon ? ` More on <a href="${esc(photos[0].taxon)}" target="_blank" rel="noopener">iNaturalist</a>.` : ''}</p>`;
}

export function renderFish(view, sub) {
  if (sub === 'id') { view.innerHTML = subnav('id') + '<div id="fish-body"></div>'; renderFishId(view.querySelector('#fish-body')); return; }
  if (sub === 'guides') { view.innerHTML = subnav('guides') + '<div id="fish-body"></div>'; renderGuides(view.querySelector('#fish-body')); return; }
  if (sub === 'rules') { view.innerHTML = subnav('rules') + '<div id="fish-body"></div>'; renderRules(view.querySelector('#fish-body')); return; }

  const focus = sub && sub !== '' ? decodeURIComponent(sub) : null;
  const all = [...state.data.species.species].sort((a, b) => a.name.localeCompare(b.name));
  const local = all.filter(s => s.region !== 'north');
  const list = all.filter(s =>
    (query || filter === 'north' ? true : s.region !== 'north') &&
    (filter === 'all' || filter === 'north' || (filter === 'protected' ? s.status !== 'limits' : filter === 'spear' ? s.activities?.includes('spear') : s.status === 'limits')) &&
    (!query || [s.name, s.scientific, ...(s.aka || [])].join(' ').toLowerCase().includes(query.toLowerCase())));

  view.innerHTML = `${subnav('')}
    <h1>Fish library</h1>
    <div class="notice small">${local.length} species you can meet from Geraldton to Esperance, plus ${all.length - local.length} mostly northern ones (pick "All of WA" or search). Extra names, groups and ID tips come from DPIRD's 2026 identification guides. Photos from iNaturalist and Wikimedia Commons (credit under each photo). Size and bag limits are from DPIRD's Recreational fishing guide 2026 (June 2026 edition), checked 25 Nov 2026. Kalbarri → Augusta is the West Coast bioregion; Denmark → Esperance is the South Coast. If DPIRD changes a rule, the official rule applies.</div>
    <div class="filters">
      <input type="search" id="fq" placeholder="Search fish" value="${esc(query)}" aria-label="Search fish">
      <select id="ff" aria-label="Show">
        <option value="all" ${filter === 'all' ? 'selected' : ''}>Geraldton → Esperance (${local.length})</option>
        <option value="north" ${filter === 'north' ? 'selected' : ''}>All of WA, incl. the north (${all.length})</option>
        <option value="keep" ${filter === 'keep' ? 'selected' : ''}>Can keep within limits</option>
        <option value="protected" ${filter === 'protected' ? 'selected' : ''}>Protected or dangerous</option>
        <option value="spear" ${filter === 'spear' ? 'selected' : ''}>Seen when spearfishing / diving</option>
      </select>
    </div>
    <div id="fish-list">${list.map(s => card(s, s.id === focus)).join('') || '<p class="muted">No fish match.</p>'}</div>
    <p class="muted small">Not sure what you caught? Try the <a href="#/fish/id">ID helper</a>. If you can't identify it, release it.</p>`;

  // load thumbnails only as cards scroll into view (100+ species)
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); hydrateThumb(e.target); } }), { rootMargin: '200px' }) : null;
  view.querySelectorAll('details.fish').forEach(el => {
    if (io) io.observe(el); else hydrateThumb(el);
    if (el.open) hydrateGallery(el);
    el.addEventListener('toggle', () => { if (el.open) hydrateGallery(el); });
  });
  if (focus) view.querySelector(`#sp-${CSS.escape(focus)}`)?.scrollIntoView();
  const fq = view.querySelector('#fq');
  fq.addEventListener('input', () => { query = fq.value; const pos = fq.selectionStart; renderFish(view); const n = view.querySelector('#fq'); n.focus(); n.setSelectionRange(pos, pos); });
  view.querySelector('#ff').addEventListener('change', e => { filter = e.target.value; renderFish(view); });
}

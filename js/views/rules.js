import { state } from '../app.js';
import { esc } from '../ui.js';
import { REGIONS } from '../config.js';

let pick = { species: '', place: '' };

// "Can I keep it?" — answers from the app's own copy of DPIRD rules (no scraping of government sites).
function checker(species) {
  const places = [
    ...Object.entries(REGIONS).map(([id, r]) => ({ id: 'r:' + id, label: r.name, bio: r.bioregion })),
    ...state.data.locations.map(l => ({ id: 'l:' + l.id, label: `${l.name} (${REGIONS[l.region]?.name ?? ''})`, bio: REGIONS[l.region]?.bioregion }))
  ];
  const sp = species.species.find(s => s.id === pick.species);
  const pl = places.find(p => p.id === pick.place);
  let answer = '<p class="small muted">Choose a fish and a place.</p>';
  if (sp && pl) {
    const bioName = pl.bio === 'south_coast' ? 'South Coast' : 'West Coast';
    if (sp.status === 'protected' || sp.status === 'danger') {
      answer = `<div class="notice danger"><strong>No — ${esc(sp.name)} ${sp.status === 'danger' ? 'is dangerous' : 'is protected'}.</strong> ${esc(sp.protection)}</div>`;
    } else {
      const lim = (sp.limits || []).filter(l => /all/i.test(l.where) || l.where.toLowerCase().includes(bioName.toLowerCase()));
      answer = lim.length ? `<div class="notice info"><strong>Yes, within limits</strong> at ${esc(pl.label)} (${bioName} bioregion):
        <ul>${lim.map(l => `<li>Minimum size: <strong>${esc(l.min_size)}</strong> · Daily bag: <strong>${esc(l.bag)}</strong>${l.note ? `<br><span class="small">${esc(l.note)}</span>` : ''}</li>`).join('')}</ul>
        ${sp.spear_banned_landbased && pl.bio === 'west_coast' ? '<strong>Not by spear from land</strong> — land-based spearfishing for WA dhufish is not permitted.<br>' : ''}
        <span class="small">Also check: marine park sanctuary zones (no fishing) and any temporary closures.</span></div>`
        : `<div class="notice">Limits for ${esc(sp.name)} in the ${bioName} bioregion aren't entered yet.</div>`;
    }
    answer += `<p class="small muted">From DPIRD's 2026 guide, checked ${esc(sp.last_checked ?? '—')}.</p>`;
  }
  return `<div class="card">
    <h2>Can I keep it?</h2>
    <div class="filters">
      <select id="ck-sp" aria-label="Fish"><option value="">Choose a fish…</option>${species.species.map(s => `<option value="${s.id}" ${pick.species === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <select id="ck-pl" aria-label="Place"><option value="">Choose a place…</option>${places.map(p => `<option value="${esc(p.id)}" ${pick.place === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
    </div>
    ${answer}
    <p class="small muted">Answers come from the rules copied into this app from DPIRD's 2026 guide.</p>
  </div>`;
}

export function renderRules(view, focusId) {
  const { species, rules, ruleLinks } = state.data;
    view.innerHTML = `
  <div>
    <h1>Fishing rules</h1>
    <div id="checker">${checker(species)}</div>
    ${(state.data.ruleGuide || []).map(g => `<details class="card rule"><summary><strong>${esc(g.title)}</strong></summary><p>${esc(g.text)}</p><p class="small muted">${esc(g.source_name)} · checked ${esc(g.last_checked)}</p></details>`).join('')}
    <div class="card">
      <h2>Recent rule changes</h2>
      ${rules.map(r => `<p><strong>${esc(r.summary)}</strong><br><span class="muted small">Applies: ${esc(r.applies_to.bioregion?.replace('_', ' ') ?? 'statewide')} · from ${esc(r.effective_from ?? '?')} · Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(r.source_name)}</a> · checked ${esc(r.last_checked)}</span></p>`).join('') || '<p class="muted">None yet.</p>'}
      <p class="muted small">West Coast bioregion runs from north of Kalbarri to east of Augusta. Denmark, Albany and Esperance are in the South Coast bioregion.</p>
    </div>
    <div class="card">
      <h2>Protected — must be released</h2>
      ${species.species.filter(s => s.status === 'protected').map(s => `<p class="small"><a href="#/fish/${esc(s.id)}"><strong>${esc(s.name)}</strong></a> — ${esc(s.protection)}</p>`).join('')}
      <p class="small muted">Not a complete list. See DPIRD's protected species page for all of them.</p>
    </div>
    <p class="small">Size and bag limits for each fish are in the <a href="#/fish">Fish library</a>.</p>
    <p class="small muted">Rules restated in plain English from DPIRD (rules last changed 1 June 2026). If DPIRD changes a rule, the official rule applies. Sources: ${ruleLinks.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ')}</p>
  </div>`;
  const bind = () => {
    view.querySelector('#ck-sp').addEventListener('change', e => { pick.species = e.target.value; redraw(); });
    view.querySelector('#ck-pl').addEventListener('change', e => { pick.place = e.target.value; redraw(); });
  };
  const redraw = () => { view.querySelector('#checker').innerHTML = checker(species); bind(); };
  bind();
}

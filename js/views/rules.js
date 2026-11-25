import { state } from '../app.js';
import { esc } from '../ui.js';

export function renderRules(view, focusId) {
  const { species, rules, ruleLinks } = state.data;
  const byId = new Map(rules.map(r => [r.id, r]));
  view.innerHTML = `
  <div>
    <h1>Fishing rules</h1>
    <div class="notice"><strong>Official rules always prevail.</strong> Rules change — they last changed on 1 June 2026. This page restates selected rules in plain English with a link to the source and the date we last checked. If anything differs, follow DPIRD.</div>
    <div class="card">
      <h2>Official sources</h2>
      ${ruleLinks.map(l => `<p><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} →</a></p>`).join('')}
    </div>
    <div class="card">
      <h2>General rules entered so far</h2>
      ${rules.map(r => `<p><strong>${esc(r.summary)}</strong><br><span class="muted small">Applies: ${esc(r.applies_to.bioregion?.replace('_', ' ') ?? 'statewide')} · from ${esc(r.effective_from ?? '?')} · Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(r.source_name)}</a> · checked ${esc(r.last_checked)}</span></p>`).join('') || '<p class="muted">None yet.</p>'}
      <p class="muted small">West Coast bioregion runs from north of Kalbarri to east of Augusta. Denmark, Albany and Esperance are in the South Coast bioregion.</p>
    </div>
    <h2>Species</h2>
    ${species.species.map(s => `
      <details id="sp-${esc(s.id)}" ${focusId === s.id ? 'open' : ''}>
        <summary>${esc(s.name)} <span class="muted small"><i>${esc(s.scientific)}</i></span></summary>
        <div class="body">
          ${s.rule_ids.length ? s.rule_ids.map(id => byId.get(id)).filter(Boolean).map(r => `<p class="small"><strong>${esc(r.summary)}</strong><br><span class="muted">Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(r.source_name)}</a> · checked ${esc(r.last_checked)}</span></p>`).join('') : ''}
          <p class="small">Size limits, bag limits and seasons for this species have <strong>not been entered here yet</strong>. <a href="https://rules.fish.wa.gov.au" target="_blank" rel="noopener">Look up ${esc(s.name)} in the official rules →</a></p>
          <p class="muted small">ID tip: ${esc(s.id_tips)}</p>
        </div>
      </details>`).join('')}
  </div>`;
  if (focusId) view.querySelector(`#sp-${CSS.escape(focusId)}`)?.scrollIntoView();
}

// "Four checks" summary: good conditions ≠ fish ≠ safe ≠ allowed. Shown in spot pop-ups and details.
import { esc } from './ui.js';
import { legalStatus } from './zones.js';
import { band } from './scoring/score.js';

export function fourChecks(loc, ev, hr, zones, activity) {
  if (!ev || ev.applicable === false) return '';
  const rows = [];
  // 1. Conditions
  const sc = hr?.score ?? null;
  rows.push(['Conditions', hr && !hr.blocked && sc != null ? `<b class="ck ${band(sc)}">${sc}/100</b> wind, waves, tide${activity === 'spear' ? ', visibility (estimate)' : ', light'}` :
    hr?.blocked ? '<b class="ck poor">Not rated</b> see safety / rules' : '<b class="ck unknown">Unknown</b> no forecast for this hour']);
  // 2. Fish activity — only from checked evidence, never guessed from weather
  const n = (loc.species_evidence || []).length;
  rows.push(['Fish', n ? `<b class="ck fair">${n} species recorded</b> here (checked info)` : '<b class="ck unknown">No evidence yet</b> conditions don\'t tell us if fish are there']);
  // 3. Safety
  const sb = (hr?.blocks || []).find(b => b.kind === 'safety');
  rows.push(['Safety', sb ? `<b class="ck poor">Not safe</b> ${esc(sb.reason)}` :
    hr?.blockKind === 'dark' ? '<b class="ck poor">Too dark</b> no spearfishing at night' :
    `<b class="ck unknown">Not verified</b> within draft limits — check on site${loc.type === 'rock_platform' ? '; wear a lifejacket on rocks' : ''}`]);
  // 4. Rules
  const ls = legalStatus(zones, loc);
  rows.push(['Rules', ls.state === 'blocked' ? '<b class="ck poor">Not allowed</b> sanctuary zone' :
    ls.state === 'ok' ? '<b class="ck good">No zone found</b> normal bag & size limits apply' :
    ls.state === 'caution' ? '<b class="ck fair">Check zone</b> inside a marine park, zones not fully mapped' : '<b class="ck unknown">Not checked</b> zone data not loaded']);
  // 5. Data confidence
  const c = ev.confidence?.level;
  rows.push(['Data', `<b class="ck ${c === 'high' ? 'good' : c === 'medium' ? 'fair' : 'unknown'}">${{ high: 'High', medium: 'Moderate', low: 'Low' }[c] ?? 'Unknown'} confidence</b>`]);
  return `<table class="checks small">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
    <div class="small muted">Good conditions don't mean fish, safe access or permission to fish.</div>`;
}

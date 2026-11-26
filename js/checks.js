// "Four checks" summary: good conditions ≠ fish ≠ safe ≠ allowed. Shown in spot pop-ups and details.
import { esc } from './ui.js';
import { currentWords } from './units.js';
import { legalStatus } from './zones.js';
import { band } from './scoring/score.js';
import { likelyTargets, LEVEL_LABEL } from './targets.js';

export function fourChecks(loc, ev, hr, zones, activity) {
  if (!ev || ev.applicable === false) return '';
  const rows = [];
  // 1. Conditions
  const sc = hr?.score ?? null;
  rows.push(['Conditions', hr && !hr.blocked && sc != null ? `<b class="ck ${band(sc)}">${sc}/100</b> wind, waves, tide${activity === 'spear' ? ', visibility (estimate)' : ', light'}` :
    hr?.blocked ? '<b class="ck poor">Not rated</b> see safety / rules' : '<b class="ck unknown">Unknown</b> no forecast for this hour']);
  // 2. Fish activity — only from checked evidence, never guessed from weather
  const legalBlocked = (hr?.blocks || []).some(b => b.kind === 'legal') || legalStatus(zones, loc, activity, { t: hr?.hour?.t }).state === 'blocked';
  const tg = legalBlocked ? [] : likelyTargets(loc, hr?.hour, activity, { max: 3, zones }).filter(t => t.level !== 'unlikely');
  const good = tg.filter(t => t.level === 'good');
  const poss = tg.filter(t => t.level === 'possible'), closed = tg.filter(t => t.level === 'closed');
  rows.push(['Fish', tg.length ? [good.length ? `<b class="ck good">Good chance</b> ${esc(good.map(t => t.name).join(', '))}` : '',
      poss.length ? `<b class="ck fair">Possible</b> ${esc(poss.map(t => t.name).join(', '))}` : '',
      closed.length ? `<b class="ck poor">Closed</b> ${esc(closed.map(t => t.name).join(', '))}` : ''].filter(Boolean).join('<br>') + ' <span class="muted">· seasonal guide</span>'
    : legalBlocked ? '<b class="ck poor">—</b> no fishing allowed here, so no species suggestions' : '<b class="ck unknown">Nothing in season</b> for this kind of spot — seasonal guide']);
  // 3. Safety
  const sb = (hr?.blocks || []).find(b => b.kind === 'safety');
  const cw = activity === 'spear' && !loc.estuary ? currentWords(hr?.hour?.current_speed) : null;
  const curNote = cw && (cw.key === 'moderate' || cw.key === 'strong') ? ` · <b class="cur-${cw.key}">${cw.label} current</b> ${hr.hour.current_speed.toFixed(1)} km/h — ${esc(cw.note)}` : '';
  rows.push(['Safety', sb ? `<b class="ck poor">Not safe</b> ${esc(sb.reason)}` :
    hr?.blockKind === 'dark' ? '<b class="ck poor">Too dark</b> no spearfishing at night' :
    `<b class="ck unknown">Not verified</b> within published safety limits — check on site${loc.type === 'rock_platform' ? '; wear a lifejacket on rocks' : ''}${curNote}`]);
  // 4. Rules
  const ls = legalStatus(zones, loc, activity, { t: hr?.hour?.t });
  const lb = (hr?.blocks || []).find(b => b.kind === 'legal');
  const extra = (ls.zones || []).filter(z => z.active && (z.type === 'species' || z.type === 'gear')).map(z => z.name);
  rows.push(['Rules', lb ? `<b class="ck poor">Not allowed</b> ${esc(lb.reason)}` : ls.state === 'blocked' ? `<b class="ck poor">Not allowed</b> ${esc(ls.text)}` :
    ls.state === 'caution' ? `<b class="ck fair">Allowed, with rules</b> ${esc(ls.text)}${extra.length ? ` · ${esc(extra.join(' · '))}` : ''}` :
    ls.state === 'ok' ? `<b class="ck good">Allowed</b> ${esc(ls.text)}` : '<b class="ck unknown">Not checked</b> zone data not loaded']);
  // 5. Data confidence
  const c = ev.confidence?.level;
  rows.push(['Data', `<b class="ck ${c === 'high' ? 'good' : c === 'medium' ? 'fair' : 'unknown'}">${{ high: 'High', medium: 'Moderate', low: 'Low' }[c] ?? 'Unknown'} confidence</b>`]);
  return `<table class="checks small">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
    <div class="small muted">Fish = season, habitat and time of day for this kind of spot — not catch reports. Good conditions don't mean safe access or permission to fish.</div>`;
}

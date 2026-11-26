// One plain answer for a spot at the chosen time ("Go", "Take care", "Not safe now", "Not allowed"),
// the next safer time, and a tappable hour-by-hour strip. Used by the spot card and the tap report.
import { esc } from './ui.js';
import { band, BAND_LABEL } from './scoring/score.js';
import { fmtHour } from './units.js';

const HOUR = 3600e3;
const dayName = (t, now = Date.now()) => {
  const d = new Date(t + 8 * HOUR).toISOString().slice(0, 10), n = new Date(now + 8 * HOUR).toISOString().slice(0, 10);
  const tm = new Date(now + 8 * HOUR + 864e5).toISOString().slice(0, 10);
  return d === n ? 'today' : d === tm ? 'tomorrow' : new Date(t).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'Australia/Perth' });
};
export const whenText = (start, end) => `${dayName(start)} ${fmtHour(start)}–${fmtHour(end)}`;

/** First stretch of 2+ hours after `t` that is allowed, within the safety limits and (spear) in daylight. */
export function nextSafe(ev, t) {
  const hrs = (ev?.hourly || []).filter(h => h.t > t);
  for (let i = 0; i < hrs.length; i++) {
    if (hrs[i].blocked || hrs[i].score == null) continue;
    let j = i;
    while (j + 1 < hrs.length && !hrs[j + 1].blocked && hrs[j + 1].score != null && hrs[j + 1].t - hrs[j].t <= HOUR) j++;
    if (j > i || i === hrs.length - 1) {
      const seg = hrs.slice(i, j + 1);
      return { start: seg[0].t, end: seg[seg.length - 1].t + HOUR, score: Math.round(seg.reduce((a, h) => a + h.score, 0) / seg.length), careful: seg.some(h => h.cautions?.length) };
    }
  }
  return null;
}

/** { cls, icon, title, text } — the one-line answer */
export function verdict(ev, hr, ls, activity, t) {
  const act = activity === 'spear' ? 'spearfishing' : 'fishing';
  if (!ev || ev.applicable === false) return { cls: 'na', icon: '–', title: `Not a ${act} spot`, text: 'Switch between Fishing and Spear at the top.' };
  if (ls?.state === 'blocked' || hr?.blockKind === 'legal') {
    const why = ls?.state === 'blocked' ? ls.text : hr.blocks.find(b => b.kind === 'legal')?.reason;
    return { cls: 'legal', icon: '⛔', title: `No ${act} allowed here`, text: why || '' };
  }
  if (!hr) return { cls: 'unknown', icon: '…', title: 'Forecast loading', text: '' };
  if (hr.blocked) {
    const ns = nextSafe(ev, t);
    const why = hr.blockKind === 'dark' ? 'Too dark — spearfishing is only rated in daylight.' : hr.blocks.find(b => b.kind === 'safety')?.reason || '';
    return { cls: hr.blockKind === 'dark' ? 'dark' : 'unsafe', icon: hr.blockKind === 'dark' ? '🌙' : '🚫', title: hr.blockKind === 'dark' ? 'Too dark now' : 'Not safe at this time',
      text: why, next: ns ? `${hr.blockKind === 'dark' ? 'Next daylight time that is OK' : 'Safer time'}: <strong>${whenText(ns.start, ns.end)}</strong> (score about ${ns.score}${ns.careful ? ', take care' : ''})` : 'No safer time in the forecast yet — check again later.' };
  }
  const s = hr.score ?? 0;
  if (hr.cautions?.length) return { cls: 'care', icon: '⚠', title: `Allowed — take care (${BAND_LABEL[band(s)]} ${s})`, text: hr.cautions[0].reason + '. For experienced people, with a buddy.' };
  if (s >= 70) return { cls: 'go', icon: '✅', title: `Good time to go (${s})`, text: 'Allowed, within the safety limits, good conditions. Still look at the water before you go in.' };
  if (s >= 40) return { cls: 'ok', icon: '👌', title: `OK, not ideal (${s})`, text: 'Allowed and within the safety limits, but conditions are only fair.' };
  return { cls: 'poor', icon: '👎', title: `Poor conditions (${s})`, text: 'Allowed and within limits, but probably not worth the trip.' };
}

export function verdictHTML(v) {
  return `<div class="verdict v-${v.cls}"><div class="v-title">${v.icon} ${esc(v.title)}</div>${v.text ? `<div class="v-text">${esc(v.text)}</div>` : ''}${v.next ? `<div class="v-next">${v.next}</div>` : ''}</div>`;
}

/** Hour-by-hour strip (next 48 h). Tap an hour to move the time slider there. */
export function hourStrip(ev, t, hours = 48) {
  if (!ev?.hourly?.length) return '';
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  const cells = [];
  for (let k = 0; k <= hours; k++) {
    const tt = now + k * HOUR, h = ev.hourly.find(x => x.t === tt);
    if (!h) continue;
    const cls = h.blocked ? `blk-${h.blockKind || 'safety'}` : h.score == null ? 'unknown' : h.cautions?.length ? 'care' : band(h.score);
    const hr = +new Date(tt + 8 * HOUR).toISOString().slice(11, 13);
    const label = hr === 0 ? dayName(tt).slice(0, 3) : hr % 6 === 0 ? fmtHour(tt).replace(':00', '') : '';
    cells.push(`<button class="hs-c hs-${cls}${tt === t ? ' sel' : ''}${hr === 0 ? ' day' : ''}" data-t="${tt}" title="${esc(`${dayName(tt)} ${fmtHour(tt)} — ${h.blocked ? (h.blockKind === 'legal' ? 'not allowed' : h.blockKind === 'dark' ? 'dark' : 'not safe') : h.score == null ? 'unknown' : (h.cautions?.length ? 'take care, ' : '') + 'score ' + h.score}`)}"><i></i><span>${label}</span></button>`);
  }
  return `<div class="hstrip" role="group" aria-label="Next 48 hours — tap an hour"><div class="hs-row">${cells.join('')}</div>
    <div class="hs-key small muted"><i class="hs-good"></i>good <i class="hs-fair"></i>fair <i class="hs-care"></i>take care <i class="hs-blk-safety"></i>not safe <i class="hs-blk-dark"></i>dark · tap an hour</div></div>`;
}

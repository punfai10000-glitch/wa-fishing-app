import { BAND_LABEL } from './scoring/score.js';
import { fmtHour, currentWords } from './units.js';
import { degToCompass } from './scoring/geo.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Blocked is split into three plain-English states.
export const BLOCK_LABEL = { legal: 'Not allowed', safety: 'Not safe', dark: 'Too dark' };
export const BLOCK_ICON = { legal: '⛔', safety: '⚠', dark: '🌙' };
export function blockPill(kind, big = false) {
  const k = kind || 'safety';
  return `<span class="pill blk-${k}${big ? ' big' : ''}">${BLOCK_ICON[k]} ${BLOCK_LABEL[k]}</span>`;
}
export function pill(ev) {
  if (!ev || ev.applicable === false) return `<span class="pill unknown">${ev?.activity === 'spear' ? 'Not a spearfishing spot' : ev?.activity === 'shore' ? 'Not a shore-fishing spot' : 'Not rated'}</span>`;
  const b = ev.band;
  if (b === 'blocked') return blockPill(ev.blockKind);
  const num = ev.score != null ? ` ${ev.score}` : '';
  return `<span class="pill ${b}">${BAND_LABEL[b]}${num}</span>`;
}

// Plain-English labels: measured = live reading; forecast = weather/ocean model forecast
// (ECMWF, Météo-France etc. via Open-Meteo); estimate = our rule of thumb; astronomical = sun/moon tables.
const TAG_LABEL = { measured: 'live measured', forecast: 'forecast', modelled: 'forecast', estimated: 'estimate', calculated: 'astronomical', curated: 'checked info', na: 'not applicable', unknown: 'unknown' };
export const typeTag = t => `<span class="tag ${esc(t)}">${esc(TAG_LABEL[t] || t || 'unknown')}</span>`;

export function confText(c) {
  if (!c) return '';
  const label = { high: 'High', medium: 'Medium', low: 'Low' }[c.level];
  return `<span class="conf">Confidence: ${label}${c.reasons.length ? ` · ${esc(c.reasons.join(' · '))}` : ''}</span>`;
}

export function windowText(ev) {
  if (!ev || ev.applicable === false) return '';
  if (ev.noData) return 'No forecast loaded';
  if (ev.blocked) return `${BLOCK_LABEL[ev.blockKind] || 'Not available'} for the next 24 h`;
  if (!ev.best) return 'No suitable window in the next 24 h';
  return `Best time: ${dayWord(ev.best.start)} ${fmtHour(ev.best.start)}–${fmtHour(ev.best.end)} (about ${ev.best.score})`;
}

export function activityToggle(activity) {
  return `<div class="seg" role="group" aria-label="Activity" data-activity-toggle>
    <button data-activity="shore" aria-pressed="${activity === 'shore'}">Shore</button>
    <button data-activity="spear" aria-pressed="${activity === 'spear'}">Spear</button>
  </div>`;
}

// "Chance" icon shown when a spot is opened (not on the map, to keep the map calm).
//  0-40 feather (very low) · 40-60 small fish · 60-80 medium fish · 80-100 big fish
const FISH_PATH = 'M2 10c5-7 14-8 20-3l7-5v16l-7-5c-6 5-15 4-20-3z';
const fishSvg = (w, fill, spear) => `<svg viewBox="0 0 32 20" width="${w}" height="${Math.round(w * 0.62)}" aria-hidden="true"><path d="${FISH_PATH}" fill="${fill}" stroke="#fff" stroke-width="1.4"/><circle cx="8" cy="9" r="1.5" fill="#04121f"/>${spear ? '<path d="M-2 13 L33 6" stroke="#ffd166" stroke-width="1.8"/><path d="M33 6 l-4 -2.5 l0.8 4.6z" fill="#ffd166"/>' : ''}</svg>`;
const FEATHER = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M20 3C12 4 6 9 5 17l-1.5 4" fill="none" stroke="#cbd5e1" stroke-width="1.6" stroke-linecap="round"/><path d="M20 3c-1 7-5 12-13 14c1-6 5-11 13-14z" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"/><path d="M9 12l3 1M11 9l3 1.2M14 6.5l2.5 1" stroke="#94a3b8" stroke-width=".9" stroke-linecap="round"/></svg>`;
export const CHANCE_TIERS = [
  { min: 80, key: 'big', label: 'Great conditions', icon: s => fishSvg(46, '#2fbf71', s) },
  { min: 60, key: 'medium', label: 'Good conditions', icon: s => fishSvg(34, '#56b4e9', s) },
  { min: 40, key: 'small', label: 'Fair conditions', icon: s => fishSvg(24, '#8fb8d8', s) },
  { min: 0, key: 'feather', label: 'Poor conditions', icon: () => FEATHER }
];
export function chanceTier(score) { return score == null ? null : CHANCE_TIERS.find(t => score >= t.min); }
export function chanceIcon(score, activity = 'shore', blocked = false, showLabel = true) {
  if (blocked) { const k = typeof blocked === 'string' ? blocked : 'safety'; return `<span class="chance blocked blk-${k}">${BLOCK_ICON[k]} <span class="small">${BLOCK_LABEL[k]}</span></span>`; }
  const t = chanceTier(score);
  if (!t) return '';
  return `<span class="chance ${t.key}" title="${t.label}">${t.icon(activity === 'spear')}${showLabel ? `<span class="small">${t.label}</span>` : ''}</span>`;
}

// One line about the forecast ocean current (Open-Meteo / Météo-France ~8 km model — offshore drift, not rips)
export function currentLine(h) {
  if (h?.current_speed == null) return '';
  const w = currentWords(h.current_speed);
  return `<div class="small">Current: <b class="cur-${w.key}">${w.label}</b> ${h.current_speed.toFixed(1)} km/h${h.current_direction != null ? `, flowing towards ${degToCompass(h.current_direction)}` : ''} — ${esc(w.note)} <span class="muted">(forecast, ~8 km grid: shows the drift offshore, not rips near the beach)</span></div>`;
}

// "today 4–6 pm" / "tomorrow 4–6 am"
export function dayWord(t, now = Date.now()) {
  const d = new Date(t), n = new Date(now);
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(n)) / 864e5);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday' : d.toLocaleDateString('en-AU', { weekday: 'short' });
}
// When is the best time? Clear about NOW vs the best window, so the score and the window never get mixed up.
export function bestTimeText(ev, t = Date.now()) {
  if (!ev || ev.applicable === false) return '';
  if (ev.noData) return 'No forecast loaded';
  if (!ev.best) return ev.blocked ? `${BLOCK_LABEL[ev.blockKind] || 'Not available'} all of the next 24 h` : 'No good time in the next 24 h';
  const { start, end, score } = ev.best;
  if (t >= start && t < end) return `This is the best time in the next 24 h (about ${score})`;
  return `Best time in the next 24 h: <strong>${dayWord(start)} ${fmtHour(start)}–${fmtHour(end)}</strong> (about ${score})`;
}

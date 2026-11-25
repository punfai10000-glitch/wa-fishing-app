import { BAND_LABEL } from './scoring/score.js';
import { fmtHour } from './units.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function pill(ev) {
  if (!ev || ev.applicable === false) return '<span class="pill unknown">Not rated</span>';
  const b = ev.band;
  const num = ev.score != null && b !== 'blocked' ? ` ${ev.score}` : '';
  const icon = b === 'blocked' ? '✕ ' : '';
  return `<span class="pill ${b}">${icon}${BAND_LABEL[b]}${num}</span>`;
}

export const typeTag = t => `<span class="tag ${esc(t)}">${esc(t || 'unknown')}</span>`;

export function confText(c) {
  if (!c) return '';
  const label = { high: 'High', medium: 'Medium', low: 'Low' }[c.level];
  return `<span class="conf">Confidence: ${label}${c.reasons.length ? ` · ${esc(c.reasons.join(' · '))}` : ''}</span>`;
}

export function windowText(ev) {
  if (!ev || ev.applicable === false) return '';
  if (ev.noData) return 'No forecast loaded';
  if (ev.blocked) return 'Blocked for the next 24 h';
  if (!ev.best) return 'No suitable window in the next 24 h';
  return `Best ${fmtHour(ev.best.start)}–${fmtHour(ev.best.end)}`;
}

export function activityToggle(activity) {
  return `<div class="seg" role="group" aria-label="Activity" data-activity-toggle>
    <button data-activity="shore" aria-pressed="${activity === 'shore'}">Shore</button>
    <button data-activity="spear" aria-pressed="${activity === 'spear'}">Spear</button>
  </div>`;
}

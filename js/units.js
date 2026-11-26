import * as store from './storage.js';

const DEFAULTS = { wind: 'kmh', height: 'm', temp: 'c' };

export function getUnits() { return { ...DEFAULTS, ...store.get('units', {}) }; }
export function setUnits(u) { store.set('units', { ...getUnits(), ...u }); }

export function fmtWind(kmh) {
  if (kmh == null) return 'Unknown';
  const u = getUnits().wind;
  if (u === 'kn') return `${Math.round(kmh / 1.852)} kn`;
  if (u === 'ms') return `${(kmh / 3.6).toFixed(1)} m/s`;
  return `${Math.round(kmh)} km/h`;
}

export function fmtHeight(m, digits = 1) {
  if (m == null) return 'Unknown';
  return getUnits().height === 'ft' ? `${(m * 3.281).toFixed(digits)} ft` : `${m.toFixed(digits)} m`;
}

export function fmtTemp(c) {
  if (c == null) return 'Unknown';
  return getUnits().temp === 'f' ? `${Math.round(c * 9 / 5 + 32)} °F` : `${c.toFixed(1)} °C`;
}

const tf = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hour12: true, timeZone: 'Australia/Perth' });
const df = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' });
const dtf = new Intl.DateTimeFormat('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Perth' });

export const fmtHour = t => tf.format(new Date(t)).replace(' ', '').toLowerCase();
export const fmtDay = t => df.format(new Date(t));
export const fmtDateTime = t => dtf.format(new Date(t));

export function fmtAge(t, now = Date.now()) {
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

// Day key in Perth time, e.g. "2026-11-25"
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' });
// Perth has no daylight saving: UTC+8 all year, so plain arithmetic is exact (and much faster than Intl)
export const dayKey = t => new Date(+t + 8 * 3600e3).toISOString().slice(0, 10);

// How fresh a MEASURED reading is (not a safety rule): fresh <1 h, aging 1–3 h, old >3 h.
export function freshness(t, now = Date.now()) {
  if (!t || Number.isNaN(t)) return { cls: 'old', label: 'time unknown' };
  const h = (now - t) / 3600e3;
  return h <= 1 ? { cls: 'fresh', label: 'fresh' } : h <= 3 ? { cls: 'aging', label: '1–3 h old' } : { cls: 'old', label: 'out of date — not current conditions' };
}

// Plain-language size of a wave height (metres, trough to crest)
export function waveWords(h) {
  if (h == null || !Number.isFinite(h)) return '';
  return h < 0.4 ? 'small — about knee-high' : h < 0.8 ? 'about waist-high' : h < 1.3 ? 'about chest-high' : h < 1.9 ? 'about as tall as an adult' : h < 3 ? 'bigger than a person' : 'very big';
}

// Ocean current speed in plain words for a breath-hold diver (km/h). A fit diver with fins can hold roughly
// 2-3 km/h for a short time; 1 knot = 1.85 km/h.
export const CURRENT_BANDS = [
  { max: 1, key: 'slow', label: 'Slow', note: 'easy to swim against' },
  { max: 2, key: 'moderate', label: 'Moderate', note: 'you will drift — start up-current and stay near your way out' },
  { max: 3, key: 'strong', label: 'Strong', note: 'hard to swim against — can carry a diver away from the exit' },
  { max: Infinity, key: 'vstrong', label: 'Very strong', note: 'too strong to dive' }
];
export const currentWords = kmh => kmh == null ? null : CURRENT_BANDS.find(b => kmh < b.max);

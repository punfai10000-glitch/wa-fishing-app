// 28 Nov 2026: measured BOM wind overrides a too-low forecast for the current hour (never lowers it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../js/engine.js';
import { readFileSync } from 'node:fs';

const thresholds = JSON.parse(readFileSync(new URL('../data/thresholds.json', import.meta.url))).thresholds;
const loc = { id: 'm', type: 'beach', region: 'perth', activities: ['shore', 'spear'], status: 'active', last_verified: new Date().toISOString().slice(0, 10),
  exposure: { onshore_dirs: ['W', 'SW'], sheltered_dirs: ['E'] }, terrain: ['sand'], species_evidence: [], geometry: { coordinates: [115.75, -32.0] } };
const NOW = Date.parse('2026-11-28T15:20:00+08:00');
const H0 = Date.parse('2026-11-28T15:00:00+08:00');
const hours = Array.from({ length: 6 }, (_, i) => ({ t: H0 + i * 3600e3, wind_speed: 10, wind_direction: 90, wind_gust: 15, wave_height: 0.5, wave_direction: 90, wave_period: 8, tide_rate: 0.04, sst: 20, weather_code: 1, types: {} }));
const ctx = m => ({ now: NOW, thresholds, zones: { loaded: true }, legalFn: () => ({ state: 'ok' }), measuredFn: () => m });

test('strong measured wind raises the current hour and adds a caution', () => {
  const e = evaluate(loc, hours, 'shore', ctx({ site: 'Swanbourne', km: 5, wind_kmh: 50, gust_kmh: 65 }));
  const cur = e.hourly.find(h => h.t === H0);
  assert.equal(cur.hour.wind_speed, 50);
  assert.ok(cur.blocked, 'measured 50 km/h / gusts 65 is past the shore limits');
  assert.equal(hours[0].wind_speed, 10, 'the shared forecast array is not changed');
  assert.equal(e.hourly.find(h => h.t === H0 + 3600e3).hour.wind_speed, 10, 'later hours keep the forecast');
});

test('a calmer or similar measurement never lowers the forecast', () => {
  for (const w of [4, 12]) {
    const e = evaluate(loc, hours, 'shore', ctx({ site: 'X', km: 5, wind_kmh: w, gust_kmh: w }));
    const cur = e.hourly.find(h => h.t === H0);
    assert.equal(cur.hour.wind_speed, 10);
    assert.ok(!cur.cautions.some(c => c.measured));
  }
});

test('windier but under the limits = take-care note naming the station', () => {
  const e = evaluate(loc, hours, 'shore', ctx({ site: 'Swanbourne', km: 5, wind_kmh: 26, gust_kmh: 37 }));
  const cur = e.hourly.find(h => h.t === H0);
  assert.ok(!cur.blocked);
  assert.ok(cur.cautions.some(c => /Swanbourne is measuring 26 km\/h/.test(c.reason)));
});

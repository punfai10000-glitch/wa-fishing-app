import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreHour, band } from '../js/scoring/score.js';
import { checkBlocks } from '../js/scoring/blocks.js';
import { computeConfidence } from '../js/scoring/confidence.js';
import { bestWindow } from '../js/scoring/window.js';
import { exposureOf } from '../js/scoring/geo.js';
import { normalise } from '../js/data.js';

const loc = { id: 'x', type: 'beach', activities: ['shore', 'spear'], status: 'active', last_verified: new Date().toISOString().slice(0,10),
  exposure: { onshore_dirs: ['W', 'SW'], sheltered_dirs: ['E'] }, terrain: ['sand', 'reef'], access: { vehicle: '2wd', walk_minutes: 5, parking: true }, species_evidence: [] };
const rock = { ...loc, type: 'rock_platform' };
const T = Date.parse('2026-11-25T08:00:00+08:00');
const calm = { t: T, wind_speed: 8, wind_direction: 90, wind_gust: 12, wave_height: 0.6, wave_direction: 250, wave_period: 9, tide_rate: 0.04, sst: 20, weather_code: 1, types: {} };
const thresholds = JSON.parse((await import('node:fs')).readFileSync(new URL('../data/thresholds.json', import.meta.url))).thresholds;

test('exposure classification', () => {
  assert.equal(exposureOf(270, loc.exposure), 'onshore');
  assert.equal(exposureOf(95, loc.exposure), 'sheltered');
  assert.equal(exposureOf(0, loc.exposure), 'cross');
});

test('calm offshore conditions score Good for shore', () => {
  const r = scoreHour(loc, calm, 'shore');
  assert.ok(r.score >= 70, `score ${r.score}`);
  assert.equal(band(r.score), 'good');
});

test('missing data is neutral, not penalised', () => {
  const noTide = { ...calm, tide_rate: null };
  const a = scoreHour(loc, calm, 'shore');
  const b = scoreHour(loc, noTide, 'shore');
  assert.ok(b.missing.includes('tide'));
  // tide was scoring well, so removing it changes the mean but never forces it to 0
  assert.ok(b.score > 0 && Math.abs(a.score - b.score) < 15);
});

test('visibility is Unknown for spearfishing and caps confidence at medium', () => {
  const r = scoreHour(loc, calm, 'spear');
  assert.ok(r.missing.includes('visibility'));
  const c = computeConfidence(r, 'spear', loc);
  assert.equal(c.level, 'medium');
});

test('strong onshore swell hard-blocks a rock platform before a beach', () => {
  const big = { ...calm, wave_height: 2.6, wave_direction: 260 };
  assert.equal(checkBlocks(loc, big, 'shore', { thresholds }).length, 0);
  assert.ok(checkBlocks(rock, big, 'shore', { thresholds }).length > 0);
});

test('thunderstorm blocks', () => {
  assert.ok(checkBlocks(loc, { ...calm, weather_code: 95 }, 'shore', { thresholds }).some(b => /Thunderstorm/.test(b.reason)));
});

test('spearfishing blocked at night', () => {
  const sun = { sunrise: T + 3600e3, sunset: T + 12 * 3600e3 };
  assert.ok(checkBlocks(loc, calm, 'spear', { thresholds, sun }).some(b => /daylight/.test(b.reason)));
  assert.equal(checkBlocks(loc, { ...calm, t: T + 2 * 3600e3 }, 'spear', { thresholds, sun }).length, 0);
});

test('best window skips blocked hours', () => {
  const hours = [50, 60, 90, 95, 30, 80].map((s, i) => ({ t: T + i * 3600e3, score: s, blocked: i === 3 }));
  const w = bestWindow(hours, { now: T });
  assert.ok(w);
  assert.ok(w.start !== T + 3 * 3600e3 && w.end <= T + 3 * 3600e3 || w.start >= T + 4 * 3600e3);
});

test('normalise keeps nulls as unknown and derives modelled tide', () => {
  const fc = { hourly: { time: [0, 3600, 7200], wind_speed_10m: [10, null, 12], wind_direction_10m: [1, 2, 3], wind_gusts_10m: [1, 2, 3], precipitation: [0,0,0], weather_code: [0,0,0], cloud_cover: [0,0,0], pressure_msl: [1,1,1] } };
  const mr = { hourly: { time: [0, 3600, 7200], sea_level_height_msl: [0.1, 0.2, 0.4], wave_height: [1, 1, 1] } };
  const h = normalise(fc, mr);
  assert.equal(h[1].wind_speed, null);
  assert.equal(h[1].types.wind_speed, 'unknown');
  assert.equal(h[1].types.tide_rate, 'modelled');
  assert.ok(Math.abs(h[1].tide_rate - 0.15) < 1e-9);
  assert.equal(h[0].types.sst, 'unknown');
});

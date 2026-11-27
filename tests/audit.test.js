// Regression tests for the 27 Nov 2026 audit: legal unknowns, missing data, warnings, species season.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreHour, NEUTRAL, WEIGHTS } from '../js/scoring/score.js';
import { checkBlocks } from '../js/scoring/blocks.js';
import { computeConfidence } from '../js/scoring/confidence.js';
import { evaluate } from '../js/engine.js';
import { verdict } from '../js/verdict.js';

const loc = { id: 'a', type: 'beach', region: 'perth', activities: ['shore', 'spear'], status: 'active', last_verified: new Date().toISOString().slice(0, 10),
  exposure: { onshore_dirs: ['W', 'SW'], sheltered_dirs: ['E'] }, terrain: ['sand'], species_evidence: [] };
const T = Date.parse('2026-11-25T08:00:00+08:00');
const calm = { t: T, wind_speed: 8, wind_direction: 90, wind_gust: 12, wave_height: 0.4, wave_direction: 90, wave_period: 8, tide_rate: 0.04, sst: 20, weather_code: 1, light: 'twilight', types: {} };
const thresholds = JSON.parse((await import('node:fs')).readFileSync(new URL('../data/thresholds.json', import.meta.url))).thresholds;

// ---- Audit 2: missing data ----
test('a missing factor counts as neutral at its full weight (no renormalising)', () => {
  const noVis = { ...calm };   // no vis_ctx and no satellite -> visibility unknown for spearfishing
  const r = scoreHour(loc, noVis, 'spear');
  assert.ok(r.missing.includes('visibility'));
  const known = r.factors.filter(f => f.score != null);
  const w = WEIGHTS.spear;
  const expected = Math.round((known.reduce((a, f) => a + f.score * f.weight, 0) + NEUTRAL * w.visibility) / known.reduce((a, f) => a + f.weight, w.visibility));
  assert.ok(Math.abs(r.score - expected) <= 1, `${r.score} vs ${expected}`);
  const renormalised = Math.round(known.reduce((a, f) => a + f.score * f.weight, 0) / known.reduce((a, f) => a + f.weight, 0));
  assert.ok(r.score < renormalised, `neutral ${r.score} should be below renormalised ${renormalised}`);
});

test('the auditor example: wind 90 + waves 80 with unknown visibility can no longer look excellent', () => {
  const r = scoreHour(loc, { ...calm, tide_rate: null, sst: null }, 'spear');
  assert.ok(r.score < 80, `score ${r.score}`);
  assert.equal(computeConfidence(r, 'spear', loc).level, 'low');   // tide + visibility unknown
});

test('no wind or wave forecast = Unknown score, never Good', () => {
  for (const h of [{ ...calm, wind_speed: null }, { ...calm, wave_height: null }]) {
    const r = scoreHour(loc, h, 'shore');
    assert.equal(r.score, null);
    assert.match(r.unknownReason, /can't check it's safe/);
  }
  const ev = evaluate(loc, [{ ...calm, wind_speed: null }], 'shore', { thresholds, zones: { loaded: true }, now: T });
  const v = verdict(ev, ev.hourly[0], { state: 'ok' }, 'shore', T);
  assert.equal(v.cls, 'unknown');
});

test('estuaries: ocean waves are not applicable, so they are not "missing"', () => {
  const est = { ...loc, type: 'estuary', estuary: true };
  const r = scoreHour(est, { ...calm, wave_height: null }, 'shore');
  assert.ok(!r.missing.includes('waves') && r.score != null);
});

// ---- Audit 1: legal ----
test('zones not loaded: hours carry a rules caution and the verdict is never "Good time to go"', () => {
  const ev = evaluate(loc, [calm], 'shore', { thresholds, zones: undefined, now: T });
  assert.ok(ev.legalUnchecked);
  assert.ok(ev.hourly[0].cautions.some(c => /zones not loaded/.test(c.reason)));
  const v = verdict(ev, ev.hourly[0], { state: 'unchecked' }, 'shore', T);
  assert.notEqual(v.cls, 'go');
});

test('park whose zones are not mapped: rules caution, not "Good time to go"', () => {
  const ls = { state: 'caution', unverified: true, text: 'Inside Western Bight. Zones not in the app.' };
  const ev = evaluate(loc, [calm], 'shore', { thresholds, zones: { loaded: true }, legalFn: () => ls, now: T });
  const v = verdict(ev, ev.hourly[0], ls, 'shore', T);
  assert.equal(v.cls, 'care');
  assert.match(v.title, /zone rules/);
});

test('a sanctuary still blocks whatever the score', () => {
  const ev = evaluate(loc, [calm], 'shore', { thresholds, zones: { loaded: true }, zoneHits: () => [{ name: 'X Sanctuary', zone_type: 'sanctuary', note: 'no fishing' }], now: T });
  assert.equal(ev.hourly[0].blockKind, 'legal');
  assert.equal(verdict(ev, ev.hourly[0], { state: 'blocked', text: 'X' }, 'shore', T).cls, 'legal');
});

// ---- Audit 6: safety ----
test('BOM Gale warning = not safe; Strong Wind warning = take care', () => {
  const gale = checkBlocks(loc, calm, 'shore', { thresholds, warnings: [{ type: 'Gale', zone: 'Perth Coast' }] });
  assert.ok(gale.some(b => b.kind === 'safety' && /Gale/.test(b.reason)));
  const strong = checkBlocks(loc, calm, 'shore', { thresholds, warnings: [{ type: 'Strong Wind', zone: 'Perth Coast' }] });
  assert.ok(strong.some(b => b.kind === 'caution' && /Strong Wind/.test(b.reason)) && !strong.some(b => b.kind === 'safety'));
  const ev = evaluate(loc, [calm], 'shore', { thresholds, zones: { loaded: true }, warningsFn: () => [{ type: 'Strong Wind', zone: 'Perth Coast' }], now: T });
  assert.equal(verdict(ev, ev.hourly[0], { state: 'ok' }, 'shore', T).cls, 'care');
});

test('rock platforms and spearfishing with no wave forecast are blocked', () => {
  const rock = { ...loc, type: 'rock_platform' };
  assert.ok(checkBlocks(rock, { ...calm, wave_height: null }, 'shore', { thresholds }).some(b => b.kind === 'safety'));
  assert.ok(checkBlocks(loc, { ...calm, wave_height: null }, 'spear', { thresholds }).some(b => b.kind === 'safety'));
});

// ---- Audit 4: species ----
test('a target species changes the score through the seasonal guide, labelled as a guide', () => {
  const seasonFn = (l, m, sp) => sp === 'peak_fish' ? { score: 100, detail: 'peak season (seasonal guide, not catch data)' } : { score: 20, detail: 'out of season (seasonal guide, not catch data)' };
  const a = scoreHour(loc, calm, 'shore', { species: 'peak_fish', seasonFn });
  const b = scoreHour(loc, calm, 'shore', { species: 'off_fish', seasonFn });
  assert.ok(a.score > b.score + 5, `${a.score} vs ${b.score}`);
  assert.equal(a.factors.find(f => f.id === 'season').type, 'guide');
  // curated per-spot evidence wins over the guide
  const curated = { ...loc, species_evidence: [{ species: 'off_fish', months: [11] }] };
  assert.equal(scoreHour(curated, calm, 'shore', { species: 'off_fish', seasonFn }).factors.find(f => f.id === 'season').type, 'curated');
});

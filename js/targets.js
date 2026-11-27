// Species targets V1 — "what might be biting here, now". Transparent rules, not catch data:
// season × habitat × light × sea state (× water clarity for squid and spearing).
import { effectiveWave, visibilityEstimate } from './scoring/score.js';
import { zoneHitsFor } from './zones.js';

let data = null;
export async function loadTargets() {
  if (data) return data;
  try { data = await fetch('data/targets.json').then(r => r.ok ? r.json() : null); } catch { data = null; }
  return data;
}
export const targetsData = () => data;

function areaOf(region) {
  if (!data) return null;
  for (const [a, list] of Object.entries(data.regions)) if (list.includes(region)) return a;
  return null;
}

const LIGHT = {
  low: { twilight: 1, night: 0.8, day: 0.75 },
  low_strong: { twilight: 1, night: 0.9, day: 0.5 },
  day: { twilight: 0.85, night: 0.3, day: 1 },
  any: { twilight: 1, night: 1, day: 1 }
};

function seaFactor(pref, wave) {
  if (wave == null) return { f: 0.9, note: null };
  if (pref === 'calm') return wave <= 0.6 ? { f: 1, note: null } : wave <= 1.2 ? { f: 0.7, note: 'a bit rough for them' } : { f: 0.4, note: 'too rough for them' };
  if (pref === 'surf') return wave < 0.3 ? { f: 0.75, note: 'prefer some white water' } : wave <= 2 ? { f: 1, note: null } : { f: 0.7, note: null };
  return { f: 1, note: null };
}

/** returns [{ id, name, level: 'good'|'possible'|'unlikely'|'closed', score, reasons[] }] best first */
export function likelyTargets(loc, hour, activity, { max = 4, zones = null } = {}) {
  if (!data || !loc) return [];
  const area = areaOf(loc.region);
  if (!area) return [];
  const t = hour?.t ?? Date.now();
  const month = new Date(t).getMonth() + 1;
  const habitats = [loc.type, ...(loc.terrain || [])];
  const wave = loc.estuary ? 0 : (hour ? effectiveWave(hour, loc)?.height ?? null : null);
  const vis = hour && hour.vis_ctx ? visibilityEstimate(hour, loc) : null;
  const out = [];
  for (const sp of data.targets) {
    if (sp.activity !== activity || !sp.areas.includes(area)) continue;
    const hab = Math.max(0, ...habitats.map(h => sp.habitat[h] ?? 0));
    if (hab < 0.5) continue;
    const reasons = [];
    // official species closures (DPIRD order areas) first, then the simple region rule as a fallback
    const official = zones ? zoneHitsFor(zones, loc).find(h => h.species_id === sp.id && (!h.months?.length || h.months.includes(month))) : null;
    if (official || (sp.closed && sp.closed.months.includes(month) && sp.closed.regions.includes(loc.region))) {
      out.push({ id: sp.id, name: sp.name, level: 'closed', score: -1, reasons: [official ? `${official.name}: ${official.note}` : sp.closed.text] }); continue;
    }
    const present = sp.present_by_area?.[area] ?? sp.present ?? [];
    const peak = sp.peak_by_area?.[area] ?? sp.peak ?? [];
    const inSeason = present.includes(month), isPeak = inSeason && peak.includes(month);
    const season = isPeak ? 1 : inSeason ? 0.65 : 0.15;
    reasons.push(isPeak ? 'peak season' : inSeason ? 'in season' : 'out of season');
    const light = hour?.light ? (LIGHT[sp.light] ?? LIGHT.any)[hour.light] : 0.9;
    if (hour?.light && light >= 1 && sp.light !== 'any') reasons.push(hour.light === 'twilight' ? 'dawn/dusk' : hour.light === 'night' ? 'night bite' : 'daytime feeder');
    if (light <= 0.5) reasons.push(sp.light === 'day' ? 'mostly a daytime fish' : 'better at dawn/dusk');
    const sea = seaFactor(sp.sea, wave);
    if (sea.note) reasons.push(sea.note);
    let clear = 1;
    if (sp.clear && vis) { clear = vis.score >= 70 ? 1 : vis.score >= 45 ? 0.75 : 0.45; if (clear < 1) reasons.push('needs clearer water'); }
    const score = season * hab * light * sea.f * clear;
    out.push({ id: sp.id, name: sp.name, level: score >= 0.6 ? 'good' : score >= 0.35 ? 'possible' : 'unlikely', score, reasons, why: sp.why });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

export const LEVEL_LABEL = { good: 'Good chance', possible: 'Possible', unlikely: 'Unlikely now', closed: 'Closed season' };

// Season factor for the score when a target species is picked (used only where the spot has no curated evidence).
// From the regional seasonal guide above — general WA angling guidance, not catch data, and labelled as such.
export function seasonGuide(loc, month, speciesId, activity = null) {
  if (!data || !loc || !speciesId) return null;
  const area = areaOf(loc.region);
  const sp = data.targets.find(x => x.id === speciesId && (!activity || x.activity === activity)) || data.targets.find(x => x.id === speciesId);
  if (!area || !sp || !sp.areas.includes(area)) return null;
  const hab = Math.max(0, ...[loc.type, ...(loc.terrain || [])].map(h => sp.habitat[h] ?? 0));
  if (sp.closed && sp.closed.months.includes(month) && sp.closed.regions.includes(loc.region)) return { score: 0, detail: `${sp.name}: closed season here` };
  if (hab < 0.5) return { score: 20, detail: `${sp.name}: not its usual habitat (seasonal guide)` };
  const present = sp.present_by_area?.[area] ?? sp.present ?? [], peak = sp.peak_by_area?.[area] ?? sp.peak ?? [];
  const base = peak.includes(month) && present.includes(month) ? 100 : present.includes(month) ? 70 : 20;
  const label = base === 100 ? 'peak season' : base === 70 ? 'in season' : 'out of season';
  return { score: Math.round(base * (0.6 + 0.4 * hab)), detail: `${sp.name}: ${label} (seasonal guide, not catch data)` };
}

// Is this species in the guide for this spot (right area and habitat)?
export function guideCovers(loc, speciesId, activity) {
  if (!data) return false;
  const area = areaOf(loc.region);
  const sp = data.targets.find(x => x.id === speciesId && x.activity === activity);
  if (!sp || !area || !sp.areas.includes(area)) return false;
  return Math.max(0, ...[loc.type, ...(loc.terrain || [])].map(h => sp.habitat[h] ?? 0)) >= 0.5;
}

export function guideSpecies(activity) { return data ? data.targets.filter(x => x.activity === activity) : []; }

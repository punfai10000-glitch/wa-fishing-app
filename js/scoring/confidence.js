// Confidence describes how much data backs a score (spec: stage-6 §5.3).
import { IMPORTANT } from './score.js';

const LEVELS = ['low', 'medium', 'high'];

export function computeConfidence(result, activity, loc, { staleSources = 0, legalUnchecked = false } = {}) {
  let level = 2; // high
  const reasons = [];
  for (const id of IMPORTANT[activity]) {
    if (result.missing.includes(id)) {
      level -= 1;
      reasons.push(`${id === 'visibility' ? 'Underwater visibility' : id[0].toUpperCase() + id.slice(1)} unknown`);
    }
  }
  if (staleSources > 0) { level -= 1; reasons.push('Some data is out of date'); }
  if (loc.status === 'demo' || isStale(loc)) { level = Math.min(level, 1); reasons.push(loc.status === 'demo' ? 'Location details not yet verified' : 'Location not re-checked in 12 months'); }
  if (activity === 'spear') level = Math.min(level, 1); // capped while visibility is Unknown
  if (legalUnchecked) reasons.push('Marine-zone check not available yet');
  return { level: LEVELS[Math.max(0, level)], reasons };
}

export function isStale(loc, now = Date.now()) {
  if (!loc.last_verified) return false;
  return now - Date.parse(loc.last_verified) > 365 * 24 * 3600 * 1000;
}

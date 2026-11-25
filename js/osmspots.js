// Extra fishing spots from OpenStreetMap (groynes, jetties, piers, breakwaters, reefs, headlands,
// rocky shores, named beaches and anything tagged leisure=fishing / fishing=yes).
// Each is a real coordinate, not just a popular name. Conditions come from the nearest coast
// sample point (same forecast cell). They're labelled "from OpenStreetMap — not yet checked".
import { pointOf, tagsOf, spotType } from './osm.js';
import { TYPE_LABELS } from './config.js';

export async function loadOsmSpots(coastPoints) {
  let d;
  try {
    const r = await fetch('data/osm-spots.geojson', { cache: 'no-cache' });
    if (!r.ok) return [];
    d = await r.json();
  } catch { return []; }
  const out = [];
  for (const f of d.features || []) {
    const t = tagsOf(f);
    const type = spotType(t);
    const pt = pointOf(f.geometry);
    if (!type || !pt) continue;
    // nearest coast sample point (must be within 3 km of the coast)
    let best = null;
    for (const p of coastPoints) {
      const [x, y] = p.geometry.coordinates;
      const dkm = Math.hypot((x - pt[0]) * Math.cos(pt[1] * Math.PI / 180), y - pt[1]) * 111;
      if (!best || dkm < best.d) best = { d: dkm, p };
    }
    if (!best || best.d > 6) continue;
    // drop near-duplicates of the same type (< 300 m)
    if (out.some(o => o.type === type && Math.hypot((o.geometry.coordinates[0] - pt[0]) * 0.83, o.geometry.coordinates[1] - pt[1]) * 111 < 0.3)) continue;
    const tagged = t.leisure === 'fishing' || t.fishing === 'yes';
    out.push({
      id: `osm-${out.length}`,
      name: t.name || `${TYPE_LABELS[type] ?? type} near ${best.p.near}`,
      region: best.p.region,
      type,
      activities: ['shore_reef', 'headland', 'rock_platform'].includes(type) ? ['shore', 'spear'] : ['shore'],
      confidence: tagged ? 'supported' : 'potential',
      status: 'osm',
      osm: true,
      condFrom: best.p.id,
      geometry: { type: 'Point', coordinates: [+pt[0].toFixed(5), +pt[1].toFixed(5)] },
      sea: best.p.sea,
      exposure: best.p.exposure,
      facing: best.p.facing,
      terrain: { groyne: ['rock_wall'], jetty: ['jetty'], headland: ['rock_platform'], shore_reef: ['reef'], rock_platform: ['rock_platform'], beach: ['sand'] }[type] || [],
      access: null, species_evidence: [], restrictions: [], sources: ['OpenStreetMap'], safety_notes: [],
      last_verified: null, tags_fishing: tagged
    });
  }
  return out;
}

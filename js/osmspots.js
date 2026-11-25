// Extra fishing spots from OpenStreetMap (groynes, jetties, piers, breakwaters, reefs, headlands,
// rocky shores, named beaches and anything tagged leisure=fishing / fishing=yes).
// Each is a real coordinate, not just a popular name. Conditions come from the nearest coast
// sample point (same forecast cell). They're labelled "from OpenStreetMap — not yet checked".
import { pointOf, tagsOf, spotType } from './osm.js';
import { TYPE_LABELS } from './config.js';
import { loadShore, riverWaterAt, hasRiverWater, estuaryNotes } from './shore.js';

export async function loadOsmSpots(coastPoints) {
  await loadShore();
  let d;
  try {
    const r = await fetch('data/osm-spots.geojson', { cache: 'no-cache' });
    if (!r.ok) return [];
    d = await r.json();
  } catch { return []; }
  const out = [];
  // best first, so the duplicate we drop is the less useful one
  const PRI = { fishing: 0, jetty: 1, groyne: 2, headland: 3, rock_platform: 4, shore_reef: 5, beach: 6 };
  const feats = (d.features || []).slice().sort((a, b) => {
    const ta = tagsOf(a), tb = tagsOf(b);
    const pa = (ta.leisure === 'fishing' || ta.fishing === 'yes' ? -2 : 0) + (ta.name ? -1 : 0) + (PRI[spotType(ta)] ?? 9);
    const pb = (tb.leisure === 'fishing' || tb.fishing === 'yes' ? -2 : 0) + (tb.name ? -1 : 0) + (PRI[spotType(tb)] ?? 9);
    return pa - pb;
  });
  for (const f of feats) {
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
    if (!best || best.d > 40) continue;
    // river/estuary spots (Swan, Peel, Leschenault, inlets...): on/near a mapped river water area, or before
    // that data exists, jetties/fishing-tagged spots inland of the ocean coast
    const water = riverWaterAt(pt[1], pt[0], 0.15);
    const tagFishing = t.leisure === 'fishing' || t.fishing === 'yes';
    const estuary = !!water || (best.d > 6 && !hasRiverWater() && (type === 'jetty' || tagFishing));
    if (best.d > 6 && !estuary) continue;
    // drop near-duplicates: anything within 120 m, or the same type within 300 m
    if (out.some(o => { const d = Math.hypot((o.geometry.coordinates[0] - pt[0]) * 0.83, o.geometry.coordinates[1] - pt[1]) * 111; return d < 0.12 || (o.type === type && d < 0.3); })) continue;
    const tagged = t.leisure === 'fishing' || t.fishing === 'yes';
    out.push({
      id: `osm-${out.length}`,
      name: t.name || `${TYPE_LABELS[type] ?? type}${water?.name ? ` on the ${water.name}` : ` near ${best.p.near}`}`,
      estuary, water_name: water?.name || null,
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
      access: null, species_evidence: [], restrictions: [], sources: ['OpenStreetMap'],
      safety_notes: estuary ? estuaryNotes(pt[1], pt[0], water?.name) : [],
      last_verified: null, tags_fishing: tagged
    });
  }
  return out;
}

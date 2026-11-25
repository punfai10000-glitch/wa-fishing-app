// Extra fishing spots from OpenStreetMap (groynes, jetties, piers, breakwaters, reefs, headlands,
// rocky shores, named beaches and anything tagged leisure=fishing / fishing=yes).
// Each is a real coordinate, not just a popular name. Conditions come from the nearest coast
// sample point (same forecast cell). They're labelled "from OpenStreetMap — not yet checked".
import { pointOf, tagsOf, spotType } from './osm.js';
import { TYPE_LABELS } from './config.js';
import { loadShore, riverWaterAt, estuaryNotes, nearestShore, shoreData } from './shore.js';
const shoreIsPrecise = () => !!shoreData()?.precise;
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const comp = d => COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
function ownFacing(pt, p, estuary) {
  if (estuary || !shoreIsPrecise()) return { exposure: p.exposure, facing: p.facing };
  const n = nearestShore(pt[1], pt[0], 1);
  if (!n) return { exposure: p.exposure, facing: p.facing };
  // blend the local shore direction with the regional one (tiny rocks can point anywhere)
  const a = n.seaBearing * Math.PI / 180, b = p.facing * Math.PI / 180;
  const f = Math.round(((Math.atan2(Math.sin(a) * 0.6 + Math.sin(b) * 0.4, Math.cos(a) * 0.6 + Math.cos(b) * 0.4) * 180 / Math.PI) + 360) % 360);
  const dirs = off => [-45, -22.5, 0, 22.5, 45].map(o => comp(f + off + o)).filter((v, i, x) => x.indexOf(v) === i);
  return { facing: f, exposure: { onshore_dirs: dirs(0), sheltered_dirs: dirs(180) } };
}

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
    // Keep a spot only if it's really on fishable salt water:
    //  - in/next to a mapped tidal river or estuary (Swan, Canning, Peel, Leschenault, inlets) -> estuary spot
    //  - otherwise right on the sea shore (incl. islands like Rottnest) -> ocean spot
    // Lakes, dams and quarry ponds are dropped.
    const water = riverWaterAt(pt[1], pt[0], 0.15);
    const estuary = !!water;
    if (!estuary) {
      if (shoreIsPrecise()) {
        const n = nearestShore(pt[1], pt[0], 1);
        if (!n || n.km > 0.35 || best.d > 25) continue;
      } else if (best.d > 6) continue;
    }
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
      // each spot faces its own bit of shore (detailed coastline), so neighbouring spots score differently
      ...ownFacing(pt, best.p, estuary),
      terrain: { groyne: ['rock_wall'], jetty: ['jetty'], headland: ['rock_platform'], shore_reef: ['reef'], rock_platform: ['rock_platform'], beach: ['sand'] }[type] || [],
      access: null, species_evidence: [], restrictions: [], sources: ['OpenStreetMap'],
      safety_notes: estuary ? estuaryNotes(pt[1], pt[0], water?.name) : [],
      last_verified: null, tags_fishing: tagged
    });
  }
  return out;
}

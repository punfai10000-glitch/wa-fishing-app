// Point-in-polygon legal check against WA marine park zones (data/zones/marine-parks.geojson).
function inRing(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
function inPolygon(pt, poly) {
  if (!inRing(pt, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(pt, poly[k])) return false; // holes
  return true;
}
function contains(geom, pt) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return inPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => inPolygon(pt, p));
  return false;
}

const cache = new Map();
export function zoneHitsFor(zones, loc) {
  if (!zones?.loaded || !zones.features?.length) return [];
  if (cache.has(loc.id)) return cache.get(loc.id);
  const pt = loc.geometry.coordinates;
  const hits = zones.features.filter(f => contains(f.geometry, pt)).map(f => f.properties);
  cache.set(loc.id, hits);
  return hits;
}

// Plain-English legal status for a spot
export function legalStatus(zones, loc) {
  if (!zones?.loaded) return { state: 'unchecked', text: 'Marine park zones not loaded yet — run the weekly data update (see README).' };
  const hits = zoneHitsFor(zones, loc);
  const sanct = hits.find(h => (h.prohibits || []).length || h.zone_type === 'sanctuary');
  if (sanct) return { state: 'blocked', text: `Inside ${sanct.name} (${(sanct.zone_type || 'sanctuary').replace('_', ' ')} zone) — no fishing or collecting.` };
  if (hits.length) return { state: 'ok', text: `Inside ${hits[0].name} (${(hits[0].zone_type || 'zone').replace(/_/g, ' ')}). Fishing allowed here under normal rules — check any special rules for this zone.` };
  return { state: 'ok', text: 'Not inside a mapped marine park sanctuary zone. Normal fishing rules apply.' };
}

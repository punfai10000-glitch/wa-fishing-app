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
const nice = z => (z || 'zone').replace(/_/g, ' ');
export function legalStatus(zones, loc) {
  if (!zones?.loaded) return { state: 'unchecked', text: 'Marine park zones not loaded yet — run the weekly data update (see README).' };
  const hits = zoneHitsFor(zones, loc);
  const sanct = hits.find(h => (h.prohibits || []).length || h.zone_type === 'sanctuary');
  if (sanct) return { state: 'blocked', text: `Inside ${sanct.name} (${nice(sanct.zone_type || 'sanctuary')}) — no fishing, spearing or collecting.${sanct.verified === false ? ' Zone boundary from OpenStreetMap — check the DBCA zoning map.' : ''}` };
  const zoned = hits.find(h => h.zone_type && h.zone_type !== 'marine_park');
  if (zoned) {
    const sp = zoned.zone_type === 'special_purpose' ? ' Special purpose zones can have extra limits — check the park rules.' : '';
    return { state: 'ok', text: `Inside ${zoned.name} (${nice(zoned.zone_type)} zone). Fishing allowed under normal rules.${sp}` };
  }
  if (hits.length) return { state: 'caution', text: `Inside ${hits[0].name}, but the exact zone here isn't mapped. Check the park's zoning map before fishing.` };
  return { state: 'ok', text: 'Not inside a mapped marine park sanctuary zone. Normal fishing rules apply.' };
}

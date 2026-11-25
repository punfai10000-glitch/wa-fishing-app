// Helpers for OpenStreetMap GeoJSON — accepts both our pipeline output and a raw
// Overpass Turbo "Export → GeoJSON" file, so data can be downloaded by hand if GitHub Actions isn't running.

// Representative point for any geometry
export function pointOf(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates;
  const flat = [];
  const walk = c => (typeof c[0] === 'number' ? flat.push(c) : c.forEach(walk));
  walk(geom.coordinates);
  if (!flat.length) return null;
  const x = flat.reduce((a, p) => a + p[0], 0) / flat.length;
  const y = flat.reduce((a, p) => a + p[1], 0) / flat.length;
  return [x, y];
}

// Overpass Turbo puts tags in properties (sometimes under properties.tags)
export const tagsOf = f => ({ ...(f.properties?.tags || {}), ...(f.properties || {}) });

export function amenityKind(t) {
  if (t.kind) return t.kind;
  if (t.shop === 'fishing' || t.shop === 'bait') return 'tackle';
  if (t.amenity === 'parking') return ['private', 'customers', 'no'].includes(t.access) ? null : 'parking';
  if (['restaurant', 'fast_food', 'cafe'].includes(t.amenity) && t.opening_hours === '24/7') return 'food24';
  if (t.amenity === 'fuel') return 'fuel';
  if (t.amenity === 'toilets') return ['private', 'customers', 'no'].includes(t.access) ? null : 'toilets';
  return null;
}

// OSM feature → spot type for the fishing-spot layer
export function spotType(t) {
  if (t.man_made === 'groyne' || t.man_made === 'breakwater') return 'groyne';
  if (t.man_made === 'pier' || t.man_made === 'jetty') return 'jetty';
  if (t.natural === 'cape') return 'headland';
  if (t.natural === 'reef') return 'shore_reef';
  if (t.natural === 'bare_rock' || t.natural === 'rock') return 'rock_platform';
  if (t.natural === 'beach') return 'beach';
  if (t.leisure === 'fishing' || t.fishing === 'yes') return 'beach';
  return null;
}

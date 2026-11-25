import { pointOf, tagsOf, amenityKind } from './osm.js';
// Tackle shops, servos and public toilets from a weekly OpenStreetMap extract
// (data/amenities.geojson, built by .github/workflows/amenities.yml).
// The app never queries Overpass from users' phones — that would break its usage policy.
export const AMENITY_TYPES = {
  tackle: { label: 'Tackle & bait shop', short: 'B' },
  fuel: { label: 'Servo (fuel station)', short: 'F' },
  toilets: { label: 'Public toilet', short: 'WC' },
  food24: { label: '24/7 food', short: '24' },
  parking: { label: 'Public car park', short: 'P' }
};

let cache;
export function loadAmenities() {
  if (!cache) {
    cache = fetch('data/amenities.geojson', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d && Array.isArray(d.features) && d.features.length ? normalise(d) : null))
      .catch(() => null);
  }
  return cache;
}

// Car parks are only useful near the shore; keep those within ~2.5 km of a coast sample point
let coastPts = [];
export function setCoastPoints(pts) { coastPts = pts.map(p => p.geometry.coordinates); }
function nearCoastIfParking(f) {
  if (f.properties.kind !== 'parking' || !coastPts.length) return true;
  const [x, y] = f.geometry.coordinates;
  return coastPts.some(([cx, cy]) => Math.hypot((cx - x) * Math.cos(y * Math.PI / 180), cy - y) * 111 < 2.5);
}

// Works for both the pipeline file and a raw Overpass Turbo export
function normalise(d) {
  const features = [];
  for (const f of d.features) {
    const t = tagsOf(f);
    const kind = amenityKind(t);
    const pt = pointOf(f.geometry);
    if (!kind || !pt) continue;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pt }, properties: { kind, name: t.name, brand: t.brand, opening_hours: t.opening_hours, access: t.access } });
  }
  return features.length ? { type: 'FeatureCollection', features: features.filter(nearCoastIfParking) } : null;
}

const R = 6371;
export function distanceKm(a, b) {
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]), dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Nearest of each kind to a [lng, lat] point
export async function nearest(point, maxKm = 25) {
  const data = await loadAmenities();
  if (!data) return null;
  const out = {};
  for (const f of data.features) {
    const k = f.properties.kind;
    const d = distanceKm(point, f.geometry.coordinates);
    if (d > maxKm) continue;
    if (!out[k] || d < out[k].d) out[k] = { d, f };
  }
  return out;
}

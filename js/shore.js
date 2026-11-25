// Real shoreline geometry (data/coastline.json, land on the LEFT of each line — OSM convention).
// Used to: draw the conditions colour along the actual shore, tell land from sea, measure distance to
// the shore, and place things (e.g. reported shark incidents) just offshore.
let shore = null;         // { lines, segs, grid }
const G = 0.05;           // grid bucket size in degrees (~5 km)
const key = (x, y) => `${Math.floor(x / G)}|${Math.floor(y / G)}`;

export async function loadShore() {
  if (shore) return shore;
  try {
    const d = await (await fetch('data/coastline.json')).json();
    const segs = [], grid = new Map();
    d.lines.forEach((L, li) => {
      for (let i = 0; i < L.length - 1; i++) {
        const s = { a: L[i], b: L[i + 1], li, i };
        const id = segs.push(s) - 1;
        const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]);
        const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
        for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++)
          for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G); gy++) {
            const k = `${gx}|${gy}`;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(id);
          }
      }
    });
    shore = { lines: d.lines, segs, grid, source: d.source, precise: d.precise === true };
  } catch { shore = { lines: [], segs: [], grid: new Map(), source: null, precise: false }; }
  return shore;
}
export const shoreData = () => shore;

/** Nearest shore point to (lat,lng). Returns { lat, lng, km, onLand, seaBearing } or null if > maxKm. */
export function nearestShore(lat, lng, maxKm = 25) {
  if (!shore?.segs.length) return null;
  const k = Math.cos(lat * Math.PI / 180);
  const r = Math.ceil((maxKm / 111) / G) + 1;
  const gx = Math.floor(lng / G), gy = Math.floor(lat / G);
  let best = null;
  for (let ring = 0; ring <= r; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      for (const id of shore.grid.get(`${gx + dx}|${gy + dy}`) || []) {
        const { a, b } = shore.segs[id];
        const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = lng * k, py = lat;
        const vx = bx - ax, vy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / ((vx * vx + vy * vy) || 1e-18)));
        const cx = ax + t * vx, cy = ay + t * vy;
        const d = Math.hypot(px - cx, py - cy) * 111;
        if (!best || d < best.km) best = { km: d, cx: cx / k, cy, cross: vx * (py - ay) - vy * (px - ax), vx, vy };
      }
    }
    // once we have a hit, one more ring is enough to be sure it's the closest
    if (best && ring * G * 111 * k > best.km + G * 111) break;
  }
  if (!best || best.km > maxKm) return null;
  // sea is on the RIGHT of the segment direction: rotate (vx,vy) by -90deg
  const sx = best.vy, sy = -best.vx;
  const seaBearing = (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
  return { lat: best.cy, lng: best.cx, km: best.km, onLand: best.cross > 0, seaBearing };
}

/** Point `km` out to sea from the nearest shore point. */
export function offshorePoint(lat, lng, km = 0.3) {
  const n = nearestShore(lat, lng);
  if (!n) return null;
  const b = n.seaBearing * Math.PI / 180;
  return { lat: n.lat + Math.cos(b) * km / 111, lng: n.lng + Math.sin(b) * km / (111 * Math.cos(n.lat * Math.PI / 180)), shore: n };
}

/** Pins whose coordinates fall on land (> 80 m inland, < 3 km from shore) are moved onto the shoreline. */
export function snapPinsToShore(locs) {
  if (!shore?.precise) return;   // only with the detailed OSM coastline; the bundled one is too rough
  for (const loc of locs) {
    const [lng, lat] = loc.geometry.coordinates;
    const n = nearestShore(lat, lng, 3);
    if (n && n.onLand && n.km > 0.08) {
      loc.pinOriginal = [lng, lat];
      loc.geometry = { ...loc.geometry, coordinates: [+n.lng.toFixed(5), +n.lat.toFixed(5)] };
      loc.pinSnapped = true;
    }
  }
}

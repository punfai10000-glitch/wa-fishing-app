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
    const water = (d.water || []).map(w => {
      const r = w.rings[0];
      let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
      for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      return { ...w, bbox: [x0, y0, x1, y1] };
    });
    shore = { lines: d.lines, segs, grid, water, source: d.source, precise: d.precise === true };
  } catch { shore = { lines: [], segs: [], grid: new Map(), water: [], source: null, precise: false }; }
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

function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

/** River / estuary / inlet water area containing the point (within `padKm`), or null. */
export function riverWaterAt(lat, lng, padKm = 0) {
  if (!shore?.water?.length) return null;
  const pad = padKm / 111;
  for (const w of shore.water) {
    const [x0, y0, x1, y1] = w.bbox;
    if (lng < x0 - pad || lng > x1 + pad || lat < y0 - pad || lat > y1 + pad) continue;
    if (inRing(lng, lat, w.rings[0])) return w;
    if (padKm > 0) {   // near the edge (jetty pins sit on the bank)
      const k = Math.cos(lat * Math.PI / 180), r = w.rings[0];
      for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = r[i], [bx, by] = r[i + 1];
        const vx = (bx - ax) * k, vy = by - ay, px = (lng - ax) * k, py = lat - ay;
        const t = Math.max(0, Math.min(1, (px * vx + py * vy) / ((vx * vx + vy * vy) || 1e-18)));
        if (Math.hypot(px - t * vx, py - t * vy) * 111 <= padKm) return w;
      }
    }
  }
  return null;
}
export const hasRiverWater = () => !!shore?.water?.length;

// Rules that apply in rivers/estuaries (DPIRD). Shown on estuary spots and taps.
export function estuaryNotes(lat, lng, name = '') {
  const notes = ['Spearfishing is banned in all WA rivers, estuaries, creeks and inland waters.'];
  const swan = /swan|canning/i.test(name) || (lat > -32.12 && lat < -31.75 && lng > 115.73 && lng < 116.05);
  const mandurah = /peel|harvey|mandurah/i.test(name) || (lat > -32.85 && lat < -32.45 && lng > 115.65 && lng < 115.85);
  if (swan || mandurah) notes.push('Wire trace (shark fishing gear) is banned in these waters.');
  if (lat > -33.5 && lat < -31.6) {   // Swan River to Minninup Beach
    const m = new Date().getMonth() + 1;
    notes.push(`Crabbing in rivers and estuaries from the Swan River to Minninup Beach is closed 1 September – 30 November${m >= 9 && m <= 11 ? ' (closed right now)' : ''}.`);
  }
  return notes;
}

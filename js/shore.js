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
      // a closed loop with no area (e.g. A→B→A, a rock mapped as a line) has no land side: it made the sea around it read as land
      if (L.length < 3 || (L[0][0] === L[L.length - 1][0] && L[0][1] === L[L.length - 1][1] &&
          Math.abs(L.reduce((a, q, i) => i ? a + (L[i - 1][0] * q[1] - q[0] * L[i - 1][1]) : 0, 0)) < 1e-11)) return;
      for (let i = 0; i < L.length - 1; i++) {
        const s = { a: L[i], b: L[i + 1], li, i, n: L.length - 1, closed: L[0][0] === L[L.length - 1][0] && L[0][1] === L[L.length - 1][1] };
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
    // coastline pieces that join end-to-start (an island split into several lines): link them so corner tests work at joins
    const pk = q => `${q[0]}|${q[1]}`, firstSeg = new Map(), lastSeg = new Map();
    segs.forEach((sg, id) => { if (sg.i === 0) firstSeg.set(pk(sg.a), id); if (sg.i === sg.n - 1) lastSeg.set(pk(sg.b), id); });
    shore = { lines: d.lines, segs, grid, water, source: d.source, precise: d.precise === true, firstSeg, lastSeg };
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
        if (!best || d < best.km) best = { km: d, cx: cx / k, cy, cross: vx * (py - ay) - vy * (px - ax), vx, vy, id, t, px, py, k };
      }
    }
    // once we have a hit, one more ring is enough to be sure it's the closest
    if (best && ring * G * 111 * k > best.km + G * 111) break;
  }
  if (!best || best.km > maxKm) return null;
  // Nearest point is a CORNER (end of a segment): the side test against one segment can be wrong there (e.g. the open
  // sea off an island's tip read as land). Use both segments meeting at the corner instead.
  if (best.t <= 0 || best.t >= 1) {
    const s0 = shore.segs[best.id], pk = q => `${q[0]}|${q[1]}`;
    const nb = best.t <= 0 ? (s0.i > 0 ? best.id - 1 : s0.closed ? best.id + s0.n - 1 : shore.lastSeg?.get(pk(s0.a)) ?? null)
      : (s0.i < s0.n - 1 ? best.id + 1 : s0.closed ? best.id - s0.n + 1 : shore.firstSeg?.get(pk(s0.b)) ?? null);
    if (nb != null && shore.segs[nb]) {
      const [s1, s2] = best.t <= 0 ? [shore.segs[nb], s0] : [s0, shore.segs[nb]];   // s1 comes into the corner, s2 leaves it
      const K = best.k, V = best.t <= 0 ? s0.a : s0.b, vx0 = V[0] * K, vy0 = V[1];
      const d1 = [(s1.b[0] - s1.a[0]) * K, s1.b[1] - s1.a[1]], d2 = [(s2.b[0] - s2.a[0]) * K, s2.b[1] - s2.a[1]];
      const X = [best.px - vx0, best.py - vy0];
      const c1 = d1[0] * X[1] - d1[1] * X[0], c2 = d2[0] * X[1] - d2[1] * X[0], turn = d1[0] * d2[1] - d1[1] * d2[0];
      best.cross = (turn > 0 ? (c1 > 0 && c2 > 0) : (c1 > 0 || c2 > 0)) ? 1 : -1;   // land on the left: a left-turning (convex) corner holds land only inside both edges
    }
  }
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

// ---- Placing reported shark incidents in the water ---------------------------------------
// ASID positions are geocoded to a place name (town, beach, suburb), so many land on the land.
// River/estuary incidents go to the nearest river water; coastal ones go just offshore, and the
// result is checked to really be water.
const RIVER_NAME = /(swan|canning|collie|blackwood|murray|serpentine|harvey) river|estuary|creek|lake|\binlet\b/i;
const COASTAL_NAME = /beach|break|bay|point|reef|island|harbour|cove|prevelly|lefthanders|cottesloe|off coast/i;

function nearestRiverWater(lat, lng, maxKm = 20, prefer = null) {
  if (!shore?.water?.length) return null;
  const k = Math.cos(lat * Math.PI / 180);
  let best = null;
  for (const w of shore.water) {
    const [x0, y0, x1, y1] = w.bbox, pad = maxKm / 111;
    if (lng < x0 - pad || lng > x1 + pad || lat < y0 - pad || lat > y1 + pad) continue;
    const bonus = prefer && prefer.test(w.name || '') ? 0.5 : 1;   // prefer the river named in the report
    const r = w.rings[0];
    for (let i = 0; i < r.length - 1; i++) {
      const d = Math.hypot((r[i][0] - lng) * k, r[i][1] - lat) * 111 * bonus;
      if (d <= maxKm && (!best || d < best.d)) best = { d, w, i };
    }
  }
  if (!best) return null;
  // step from the bank vertex toward the water body's centre until we are inside the water
  const r = best.w.rings[0];
  let cx = 0, cy = 0; for (const [x, y] of r) { cx += x; cy += y; } cx /= r.length; cy /= r.length;
  const [vx, vy] = r[best.i];
  for (const t of [0.01, 0.02, 0.04, 0.08, 0.15, 0.3]) {
    const px = vx + (cx - vx) * t, py = vy + (cy - vy) * t;
    if (inRing(px, py, r)) return { lat: py, lng: px, name: best.w.name };
  }
  // fall back to the neighbouring edge midpoints nudged inward
  for (let j = Math.max(0, best.i - 3); j < Math.min(r.length - 1, best.i + 3); j++) {
    const mx = (r[j][0] + r[j + 1][0]) / 2, my = (r[j][1] + r[j + 1][1]) / 2;
    for (const t of [0.02, 0.05, 0.1]) { const px = mx + (cx - mx) * t, py = my + (cy - my) * t; if (inRing(px, py, r)) return { lat: py, lng: px, name: best.w.name }; }
  }
  return null;
}

export function placeIncident(i, seen) {
  const place = i.place || '';
  if (riverWaterAt(i.lat, i.lon)) return { plat: i.lat, plon: i.lon, moved: false, where: 'river' };
  const n0 = nearestShore(i.lat, i.lon, 120);
  const riverReport = RIVER_NAME.test(place) && (!COASTAL_NAME.test(place) || /^(swan|canning|collie) river/i.test(place));
  if (riverReport) {
    const preferRe = /swan/i.test(place) ? /swan|canning|melville|perth water/i : /canning/i.test(place) ? /canning/i : null;
    const rw = nearestRiverWater(i.lat, i.lon, 25, preferRe);
    if (rw) return { plat: rw.lat, plon: rw.lng, moved: true, where: 'river' };
  }
  if (n0 && !n0.onLand && n0.km >= 0.15) return { plat: i.lat, plon: i.lon, moved: false, where: 'sea' };
  if (!n0) return null;   // can't place it sensibly — leave it off the map
  const key = `${n0.lat.toFixed(3)}|${n0.lng.toFixed(3)}`;
  const c = seen.get(key) || 0; seen.set(key, c + 1);
  const along = (c % 2 ? -1 : 1) * Math.ceil(c / 2) * 0.18;          // fan repeats out 180 m along the shore
  const b = n0.seaBearing * Math.PI / 180, cosl = Math.cos(n0.lat * Math.PI / 180);
  for (let out = (shore.precise ? 0.35 : 0.9) + Math.floor(c / 6) * 0.2; out <= 3; out += 0.35) {
    const plat = n0.lat + (Math.cos(b) * out - Math.sin(b) * along) / 111;
    const plon = n0.lng + (Math.sin(b) * out + Math.cos(b) * along) / (111 * cosl);
    const chk = nearestShore(plat, plon, 10);
    if (chk && !chk.onLand && !riverWaterAt(plat, plon)) return { plat, plon, moved: true, where: 'sea' };
  }
  return null;
}

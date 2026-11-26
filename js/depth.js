// Water depth: detailed nearshore tiles from Transport WA surveys (LiDAR / multibeam, 5 m source grids,
// pre-cut into z13 tiles by pipeline/fetch_depth.py), with Geoscience Australia's 250 m national grid as a
// coarse fallback. Values are metres relative to the survey datum: negative = below (water), positive = above.
let Z = 13;   // finest tile zoom — read from data/depth/index.json (14 = ~8 m pixels)
let index = null, indexP = null;
const tileCache = new Map();   // "x/y" -> Promise<Float32Array|null>

export function loadDepthIndex() {
  if (!indexP) indexP = fetch('data/depth/index.json').then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(j => { index = j; if (j?.z) Z = j.z; if (j) { j.set = new Set(j.tiles); j.ov = Object.fromEntries(Object.entries(j.overviews || {}).map(([z, t]) => [z, new Set(t)])); } return j; });
  return indexP;
}
export const depthMeta = () => index;

function tileXY(lat, lng, z = Z) {
  const n = 2 ** z, x = (lng + 180) / 360 * n;
  const r = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return { x, y };
}

export function depthTile(x, y, z = Z) {
  const k = `${x}/${y}`, ck = `${z}/${k}`;
  const has = z === Z ? index?.set?.has(k) : index?.ov?.[z]?.has(k);
  if (!has) return Promise.resolve(null);
  if (!tileCache.has(ck)) {
    tileCache.set(ck, fetch(`data/depth/${z}/${k}.png`).then(r => (r.ok ? r.blob() : null))
      .then(b => b && createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then(img => {
        if (!img) return null;
        const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, 256, 256).data, out = new Float32Array(256 * 256);
        for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] < 128 ? NaN : (d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256) - 32768;
        return out;
      }).catch(() => null));
  }
  return tileCache.get(ck);
}

/** { value (m, negative = below), source, detail, coarse } or null */
export async function depthAt(lat, lng) {
  await loadDepthIndex();
  const t = tileXY(lat, lng), x = Math.floor(t.x), y = Math.floor(t.y);
  const a = await depthTile(x, y);
  if (a) {
    // small 3x3 look-around so a tap a few metres off a surveyed cell still gets a value
    const fx = (t.x - x) * 256 - 0.5, fy = (t.y - y) * 256 - 0.5;
    const px = Math.max(0, Math.min(255, Math.round(fx))), py = Math.max(0, Math.min(255, Math.round(fy)));
    let v = a[py * 256 + px];
    const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
    const q = [a[y0 * 256 + x0], a[y0 * 256 + x1], a[y1 * 256 + x0], a[y1 * 256 + x1]];
    if (q.every(Number.isFinite)) {
      const wx = Math.min(1, Math.max(0, fx - x0)), wy = Math.min(1, Math.max(0, fy - y0));
      v = q[0] * (1 - wx) * (1 - wy) + q[1] * wx * (1 - wy) + q[2] * (1 - wx) * wy + q[3] * wx * wy;
    }
    if (!Number.isFinite(v)) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      const q = a[Math.min(255, Math.max(0, py + dy)) * 256 + Math.min(255, Math.max(0, px + dx))];
      if (Number.isFinite(q)) { v = q; break; }
    }
    if (Number.isFinite(v)) return { value: v, source: 'Transport WA survey (LiDAR / multibeam)', detail: `averaged over ~${Z >= 14 ? '8' : '16'} m squares, so right at the shore it smooths out the first few metres`, coarse: false };
  }
  // coarse fallback: Geoscience Australia national grid (250 m) — fine offshore, often wrong right at the shore
  try {
    const d = 0.01;
    const u = `https://services.ga.gov.au/gis/rest/services/DEM_SRTM_1Second_over_Bathymetry_Topography_2024/MapServer/identify?f=json&geometry=${lng},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1&mapExtent=${lng - d},${lat - d},${lng + d},${lat + d}&imageDisplay=400,400,96&returnGeometry=false`;
    const j = await fetch(u).then(r => r.json());
    const pv = j?.results?.[0]?.attributes?.['Stretch.Pixel Value'] ?? j?.results?.[0]?.attributes?.['Pixel Value'];
    const v = pv != null && pv !== 'NoData' ? Number(pv) : NaN;
    if (Number.isFinite(v)) return { value: v, source: 'Geoscience Australia national grid', detail: '250 m grid — near the shore it can be several metres off', coarse: true };
  } catch { /* offline or service down */ }
  return null;
}

const fmtLen = m => { const a = Math.abs(m); return a < 1 ? `${Math.max(5, Math.round(a * 100 / 5) * 5)} cm` : a < 10 ? `${a.toFixed(1)} m` : `${Math.round(a)} m`; };

/** seaLevel: forecast water level now (m above mean sea level), if known — adds the tide to the depth */
export function depthText(d, seaLevel = null) {
  if (!d) return 'Depth: not available here.';
  const v = d.value;
  // the 250 m national grid can't see shallow estuaries, inlets or the first few hundred metres off a beach
  if (d.coarse && v > -0.5) return 'Depth: <strong>no detailed survey here</strong> — likely shallow. The national 250 m depth grid is too coarse for this spot (it reads it as land). Check with your own eyes. <span class="muted">(Not for navigation.)</span>';                       // seabed height vs mean sea level (negative = under water)
  const now = Number.isFinite(seaLevel) ? seaLevel - v : null;   // water depth at the forecast tide
  let main;
  if (v < -0.05) main = `about <strong>${fmtLen(v)} deep</strong> at mean sea level`;
  else if (v > 0.05) main = `seabed/sand about <strong>${fmtLen(v)} above</strong> mean sea level (dry or just awash)`;
  else main = '<strong>right at the water line</strong> (about 0 cm at mean sea level)';
  const tide = now == null ? '' : now > 0.05 ? ` · with the forecast tide: <strong>about ${fmtLen(now)}</strong> of water now` : ' · with the forecast tide: <strong>dry or only a few cm</strong> now';
  return `Depth: ${main}${tide} <span class="muted">(${d.coarse ? '≈ ' : ''}${d.source}, ${d.detail}. Waves and moving sand change this — check with your own eyes. Not for navigation.)</span>`;
}

// colour bands for the map layer (depth below datum, metres)
export const DEPTH_BANDS = [[1, [198, 241, 245]], [2, [159, 227, 239]], [3, [115, 207, 230]], [5, [75, 179, 218]], [8, [46, 143, 200]], [12, [33, 105, 173]], [20, [27, 74, 138]], [Infinity, [20, 47, 98]]];
export function bandColour(depth) {
  for (const [max, c] of DEPTH_BANDS) if (depth <= max) return c;
  return DEPTH_BANDS[DEPTH_BANDS.length - 1][1];
}

// Leaflet layer that colours the detailed survey tiles (z11–18)
export function makeDepthLayer(L) {
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const z = coords.z;
      if (z < 11) { setTimeout(() => done(null, c), 0); return c; }
      loadDepthIndex().then(() => {
        const ctx = c.getContext('2d'), img = ctx.createImageData(256, 256), jobs = [];
        if (z >= Z) {
          const s = 2 ** (z - Z), px = Math.floor(coords.x / s), py = Math.floor(coords.y / s), ox = (coords.x % s) * 256 / s, oy = (coords.y % s) * 256 / s;
          jobs.push(depthTile(px, py).then(a => {
            if (!a) return;
            // smooth (bilinear) when zoomed past the data so band edges follow the seabed instead of showing squares
            for (let j = 0; j < 256; j++) {
              const sy = Math.min(255, Math.max(0, oy + (j + 0.5) / s - 0.5)), y0 = Math.floor(sy), y1 = Math.min(255, y0 + 1), wy = sy - y0;
              for (let i = 0; i < 256; i++) {
                const sx = Math.min(255, Math.max(0, ox + (i + 0.5) / s - 0.5)), x0 = Math.floor(sx), x1 = Math.min(255, x0 + 1), wx = sx - x0;
                const p00 = a[y0 * 256 + x0], p10 = a[y0 * 256 + x1], p01 = a[y1 * 256 + x0], p11 = a[y1 * 256 + x1];
                const v = Number.isFinite(p00) && Number.isFinite(p10) && Number.isFinite(p01) && Number.isFinite(p11)
                  ? (p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy
                  : a[Math.round(sy) * 256 + Math.round(sx)];
                paint(img.data, (j * 256 + i) * 4, v);
              }
            }
          }));
        } else if (index?.ov?.[z]) {   // pre-built overview tile: one small file
          jobs.push(depthTile(coords.x, coords.y, z).then(a => { if (a) for (let i = 0; i < 65536; i++) paint(img.data, i * 4, a[i]); }));
        } else {                        // data without overviews: build from the z13 tiles
          const s = 2 ** (Z - z), w = 256 / s;
          for (let cy = 0; cy < s; cy++) for (let cx = 0; cx < s; cx++) jobs.push(depthTile(coords.x * s + cx, coords.y * s + cy).then(a => {
            if (a) for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) paint(img.data, ((cy * w + j) * 256 + cx * w + i) * 4, a[(j * s) * 256 + i * s]);
          }));
        }
        return Promise.all(jobs).then(() => { ctx.putImageData(img, 0, 0); done(null, c); });
      }).catch(() => done(null, c));
      return c;
    }
  });
  return new Layer({ pane: 'depthPane', opacity: 0.78, minZoom: 11, maxZoom: 19, updateWhenIdle: false, updateWhenZooming: false, keepBuffer: 3, attribution: 'Depth: <a href="https://www.transport.wa.gov.au/imarine/marine-geographic-data.asp">Transport WA</a> (CC BY 3.0 AU)' });
}
function paint(d, o, v) {
  if (!Number.isFinite(v) || v > -0.2) return;   // land / dry / no survey: leave clear
  const [r, g, b] = bandColour(-v);
  d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
}

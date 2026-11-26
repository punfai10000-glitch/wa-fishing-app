// Water depth: detailed nearshore tiles from Transport WA surveys (LiDAR / multibeam, 5 m source grids,
// pre-cut into z13 tiles by pipeline/fetch_depth.py), with Geoscience Australia's 250 m national grid as a
// coarse fallback. Values are metres relative to the survey datum: negative = below (water), positive = above.
const Z = 13;
let index = null, indexP = null;
const tileCache = new Map();   // "x/y" -> Promise<Float32Array|null>

export function loadDepthIndex() {
  if (!indexP) indexP = fetch('data/depth/index.json').then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(j => { index = j; if (j) j.set = new Set(j.tiles); return j; });
  return indexP;
}
export const depthMeta = () => index;

function tileXY(lat, lng, z = Z) {
  const n = 2 ** z, x = (lng + 180) / 360 * n;
  const r = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return { x, y };
}

export function depthTile(x, y) {
  const k = `${x}/${y}`;
  if (!index?.set?.has(k)) return Promise.resolve(null);
  if (!tileCache.has(k)) {
    tileCache.set(k, fetch(`data/depth/${Z}/${k}.png`).then(r => (r.ok ? r.blob() : null))
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
  return tileCache.get(k);
}

/** { value (m, negative = below), source, detail, coarse } or null */
export async function depthAt(lat, lng) {
  await loadDepthIndex();
  const t = tileXY(lat, lng), x = Math.floor(t.x), y = Math.floor(t.y);
  const a = await depthTile(x, y);
  if (a) {
    // small 3x3 look-around so a tap a few metres off a surveyed cell still gets a value
    const px = Math.floor((t.x - x) * 256), py = Math.floor((t.y - y) * 256);
    let v = a[py * 256 + px];
    if (!Number.isFinite(v)) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      const q = a[Math.min(255, Math.max(0, py + dy)) * 256 + Math.min(255, Math.max(0, px + dx))];
      if (Number.isFinite(q)) { v = q; break; }
    }
    if (Number.isFinite(v)) return { value: v, source: 'Transport WA survey (LiDAR / multibeam)', detail: '~15–20 m grid', coarse: false };
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

export function depthText(d) {
  if (!d) return 'Depth: not available here.';
  const v = d.value;
  const main = v < -0.3 ? `about <strong>${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v))} m deep</strong>`
    : v > 0.3 ? `land or reef top, about <strong>+${v < 10 ? v.toFixed(1) : Math.round(v)} m</strong> above sea level`
    : '<strong>about 0 m</strong> — the water\u2019s edge or very shallow';
  return `Depth: ${main} <span class="muted">(${d.coarse ? '≈ ' : ''}${d.source}, ${d.detail}. Sand moves and tide changes this by up to ~1 m. Not for navigation.)</span>`;
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
      const ctx = c.getContext('2d'), img = ctx.createImageData(256, 256);
      const jobs = [];
      if (z >= Z) {
        const s = 2 ** (z - Z), px = Math.floor(coords.x / s), py = Math.floor(coords.y / s), ox = (coords.x % s) * 256 / s, oy = (coords.y % s) * 256 / s;
        jobs.push(depthTile(px, py).then(a => {
          if (!a) return;
          for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
            const v = a[Math.floor(oy + j / s) * 256 + Math.floor(ox + i / s)];
            paint(img.data, (j * 256 + i) * 4, v);
          }
        }));
      } else {
        const s = 2 ** (Z - z);   // 2 or 4 child tiles per side
        for (let cy = 0; cy < s; cy++) for (let cx = 0; cx < s; cx++) {
          jobs.push(depthTile(coords.x * s + cx, coords.y * s + cy).then(a => {
            if (!a) return;
            const w = 256 / s;
            for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) paint(img.data, ((cy * w + j) * 256 + cx * w + i) * 4, a[(j * s) * 256 + i * s]);
          }));
        }
      }
      Promise.all(jobs).then(() => { ctx.putImageData(img, 0, 0); done(null, c); });
      return c;
    }
  });
  return new Layer({ pane: 'underwater', opacity: 0.72, minZoom: 11, maxZoom: 19, attribution: 'Depth: <a href="https://www.transport.wa.gov.au/imarine/marine-geographic-data.asp">Transport WA</a> (CC BY 3.0 AU)' });
}
function paint(d, o, v) {
  if (!Number.isFinite(v) || v > -0.2) return;   // land / dry / no survey: leave clear
  const [r, g, b] = bandColour(-v);
  d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
}

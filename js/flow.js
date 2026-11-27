// Animated wind particles + rolling swell lines drawn on one canvas over the map (Windy-style, but
// built from our own forecast points so it costs no extra API calls).
// Wind: thousands of short-lived particles follow the forecast wind field (interpolated from the
// coast sample points). Swell: wave crests roll in toward the shore at each offshore sample point,
// bigger/faster for bigger/longer swell. Everything here is FORECAST data, not measured.

let map, canvas, ctx, canvas2, ctx2, raf = null;
let windSamples = [], swellSamples = [], currentSamples = [];
let show = { wind: true, swell: true, current: false };
let grid = null;                // screen-space wind vectors every CELL px
let particles = [];
let cgrid = null, cparticles = [];   // ocean currents (sea cells only)
let seaTest = null;                  // (lat,lng) => true when the point is water (from the coastline data)
let swellSea = null, swellSeaFine = null;
let lastFrame = 0;
const CELL = 20;
const MAX_KM = 70;              // don't draw wind further than this from any forecast point
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function initFlow(m) {
  map = m;
  canvas = document.createElement('canvas');
  canvas.className = 'flow-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  map.createPane('flow');
  map.getPane('flow').style.zIndex = 415;          // above satellite tiles, below coast colours, pins and popups
  map.getPane('flow').style.pointerEvents = 'none';
  map.getPane('flow').appendChild(canvas);
  ctx = canvas.getContext('2d');
  canvas2 = canvas.cloneNode();
  map.getPane('flow').appendChild(canvas2);
  ctx2 = canvas2.getContext('2d');
  const rebuild = () => { resize(); buildGrid(); seed(); };
  map.on('movestart zoomstart', () => { stop(); clear(); });
  map.on('moveend zoomend resize', () => { rebuild(); start(); });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  rebuild();
}

/** wind: [{lat,lng,speed(km/h),from(deg)}], swell: [{lat,lng,height(m),from(deg),period(s)}],
 *  opts.currents: [{lat,lng,speed(km/h),to(deg)}], opts.seaTest(lat,lng) -> bool */
export function setFlowData(wind, swell, opts) {
  windSamples = wind || [];
  swellSamples = swell || [];
  currentSamples = opts?.currents || [];
  seaTest = opts?.seaTest || null;
  swellSea = opts?.swellSea || seaTest;
  swellSeaFine = opts?.swellSeaFine || swellSea;
  show = { wind: !!opts?.wind, swell: !!opts?.swell, current: !!opts?.current };
  if (!map) return;
  buildGrid(); seed();
  stop(); clear();
  if (show.wind || show.swell || show.current) start();
}

export const flowPausedByDevice = () => reduced();

function resize() {
  const s = map.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const [c, x] of [[canvas, ctx], [canvas2, ctx2]]) {
    window.L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    c.width = s.x * dpr; c.height = s.y * dpr;
    c.style.width = s.x + 'px'; c.style.height = s.y + 'px';
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
function clear() {
  ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx2 && ctx2.clearRect(0, 0, canvas2.width, canvas2.height);
}

// ---- wind + current fields ----------------------------------------------------
// samples: [{lat,lng,u,v}] (km/h, u east, v north). Inverse-distance blend onto a screen grid.
function makeGrid(samples, maxKm, maskFn) {
  if (!map || !samples.length) return null;
  const s = map.getSize();
  const cols = Math.ceil(s.x / CELL) + 1, rows = Math.ceil(s.y / CELL) + 1;
  const g = new Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ll = map.containerPointToLatLng([c * CELL, r * CELL]);
    const k = Math.cos(ll.lat * Math.PI / 180);
    let su = 0, sv = 0, sw = 0, dmin = 1e9;
    for (const p of samples) {
      const d = Math.hypot((p.lng - ll.lng) * k, p.lat - ll.lat) * 111;
      if (d < dmin) dmin = d;
      if (d > maxKm * 1.5) continue;
      const w = 1 / Math.max(1, d) ** 2;
      su += p.u * w; sv += p.v * w; sw += w;
    }
    g[r * cols + c] = sw && dmin <= maxKm && (!maskFn || maskFn(ll.lat, ll.lng)) ? [su / sw, sv / sw] : null;
  }
  return { cols, rows, g };
}
function buildGrid() {
  buildSwellGrid();
  const vec = (lat, lng, spd, toDeg) => { const a = toDeg * Math.PI / 180; return { lat, lng, u: spd * Math.sin(a), v: spd * Math.cos(a) }; };
  grid = show.wind || !show.current ? makeGrid(windSamples.map(w => vec(w.lat, w.lng, w.speed, w.from + 180)), MAX_KM) : null;
  cgrid = show.current ? makeGrid(currentSamples.map(w => vec(w.lat, w.lng, w.speed, w.to)), 25, seaTest) : null;
}
function sample(G0, x, y) {
  if (!G0) return null;
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  if (c < 0 || r < 0 || c >= G0.cols - 1 || r >= G0.rows - 1) return null;
  const fx = x / CELL - c, fy = y / CELL - r, G = G0.g, n = G0.cols;
  const a = G[r * n + c], b = G[r * n + c + 1], d = G[(r + 1) * n + c], e = G[(r + 1) * n + c + 1];
  if (!a || !b || !d || !e) return null;           // edge of the field (coast / range limit): stop here
  const lerp = (p, q, t) => p + (q - p) * t;
  return [lerp(lerp(a[0], b[0], fx), lerp(d[0], e[0], fx), fy), lerp(lerp(a[1], b[1], fx), lerp(d[1], e[1], fx), fy)];
}
const currentAt = (x, y) => sample(cgrid, x, y);
function windAt(x, y) {
  if (!grid) return null;
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  if (c < 0 || r < 0 || c >= grid.cols - 1 || r >= grid.rows - 1) return null;
  const fx = x / CELL - c, fy = y / CELL - r, G = grid.g, n = grid.cols;
  const a = G[r * n + c], b = G[r * n + c + 1], d = G[(r + 1) * n + c], e = G[(r + 1) * n + c + 1];
  if (!a || !b || !d || !e) return a || b || d || e || null;
  const lerp = (p, q, t) => p + (q - p) * t;
  return [lerp(lerp(a[0], b[0], fx), lerp(d[0], e[0], fx), fy), lerp(lerp(a[1], b[1], fx), lerp(d[1], e[1], fx), fy)];
}

function seed() {
  particles = []; cparticles = [];
  if (!map) return;
  const s = map.getSize();
  if (grid) { const n = Math.min(2500, Math.round(s.x * s.y / 1500)); for (let i = 0; i < n; i++) particles.push(newParticle(s)); }
  if (cgrid) { const n = Math.min(1100, Math.round(s.x * s.y / 2200)); for (let i = 0; i < n; i++) cparticles.push(newParticle(s)); }
  seedSwell();
}
function newParticle(s) {
  return { x: Math.random() * s.x, y: Math.random() * s.y, age: Math.floor(Math.random() * 80), max: 50 + Math.random() * 50 };
}

// ---- animation loop ---------------------------------------------------------
function start() {
  if (raf || !map || document.hidden) return;
  if (reduced()) { drawStatic(); return; }
  lastFrame = 0;
  raf = requestAnimationFrame(frame);
}
function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }

function frame(ts) {
  raf = requestAnimationFrame(frame);
  if (ts - lastFrame < 30) return;       // ~30 fps is plenty and saves battery
  lastFrame = ts;
  const s = map.getSize();
  // fade previous frame -> trails
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = 'rgba(0,0,0,0.86)';
  ctx.fillRect(0, 0, s.x, s.y);
  ctx.restore();
  if (show.wind) drawWind(s);
  if (show.current) drawCurrent(s);
  ctx2.clearRect(0, 0, s.x, s.y);
  if (show.swell) drawSwell();
}

function speedPx() { // km/h -> px per frame, a little faster when zoomed in
  return 0.05 * Math.min(2.2, Math.max(0.8, (map.getZoom() - 5) / 3));
}

function drawWind(s) {
  const k = speedPx();
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (const p of particles) {
    const w = windAt(p.x, p.y);
    if (!w || ++p.age > p.max) { Object.assign(p, newParticle(s), { age: 0 }); continue; }
    const spd = Math.hypot(w[0], w[1]);
    const nx = p.x + w[0] * k, ny = p.y - w[1] * k;
    ctx.strokeStyle = windColor(spd);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
    p.x = nx; p.y = ny;
  }
}
// Currents are slow (0-3 km/h) so they move ~14x faster on screen than wind would; colour = how hard to swim against
function drawCurrent(s) {
  const k = speedPx() * 12;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  for (const p of cparticles) {
    const w = currentAt(p.x, p.y);
    if (!w || ++p.age > p.max) { Object.assign(p, newParticle(s), { age: 0 }); continue; }
    const spd = Math.hypot(w[0], w[1]);
    const m = spd < 0.7 && spd > 0 ? 0.7 / spd : 1;      // slow water still shows as short, gentle streaks
    const nx = p.x + w[0] * k * m, ny = p.y - w[1] * k * m;
    ctx.strokeStyle = currentColor(spd);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
    p.x = nx; p.y = ny;
  }
}
export function currentColor(kmh) {
  if (kmh < 1) return 'rgba(150,255,220,0.75)';
  if (kmh < 2) return 'rgba(255,230,100,0.9)';
  if (kmh < 3) return 'rgba(255,150,60,0.95)';
  return 'rgba(255,70,90,1)';
}
function windColor(kmh) {
  if (kmh < 10) return 'rgba(255,255,255,0.55)';
  if (kmh < 20) return 'rgba(190,240,255,0.75)';
  if (kmh < 30) return 'rgba(255,225,120,0.85)';
  return 'rgba(255,140,110,0.95)';
}

// ---- swell colours (Windy-style wave scale), shared with the map arrows, labels and the colour bar ------------
export const SWELL_STOPS = [[0, [42, 72, 150]], [0.5, [38, 120, 200]], [1, [30, 170, 190]], [1.5, [50, 190, 120]],
  [2, [180, 205, 60]], [2.5, [240, 185, 45]], [3, [240, 125, 45]], [4, [215, 60, 60]], [6, [165, 60, 170]]];
export const SWELL_TICKS = [0.5, 1, 1.5, 2, 3, 4, 6];   // labels on the colour bar
export function swellRGBsmooth(m) {
  if (m <= SWELL_STOPS[0][0]) return SWELL_STOPS[0][1];
  for (let i = 1; i < SWELL_STOPS.length; i++) if (m <= SWELL_STOPS[i][0]) {
    const [a, ca] = SWELL_STOPS[i - 1], [b, cb] = SWELL_STOPS[i], f = (m - a) / (b - a);
    return ca.map((v, k) => Math.round(v + (cb[k] - v) * f));
  }
  return SWELL_STOPS[SWELL_STOPS.length - 1][1];
}
export const swellCss = m => `rgb(${swellRGBsmooth(m).join(',')})`;

// ---- swell, Windy-style: an opaque colour field (swell height) over the SEA ONLY + moving white streaks ---------
// The field is worked out on a coarse grid (every CELL px) and then refined to FINE px along the coast, where every
// pixel is tested against the real coastline — so the colour stops at the beach instead of spilling onto land.
let sgrid = null, sparticles = [], fieldCanvas = null, fine = null;
const SWELL_KM = 200, FADE_FROM = 90, FINE = 5, ALPHA = 150;   // open ocean: drawn up to 200 km out, fading after 90 km
function buildSwellGrid() {
  sgrid = null; fieldCanvas = null; fine = null;
  if (!show.swell || !map || !swellSamples.length || map.getZoom() < 6) return;
  const s = map.getSize();
  const cols = Math.ceil(s.x / CELL) + 1, rows = Math.ceil(s.y / CELL) + 1;
  const g = new Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ll = map.containerPointToLatLng([c * CELL, r * CELL]);
    const k = Math.cos(ll.lat * Math.PI / 180);
    let su = 0, sv = 0, sh = 0, sp = 0, sw = 0, dmin = 1e9;
    for (const p of swellSamples) {
      if (p.height == null || p.from == null) continue;
      const d = Math.hypot((p.lng - ll.lng) * k, p.lat - ll.lat) * 111;
      if (d < dmin) dmin = d;
      if (d > SWELL_KM * 1.5) continue;
      const w = 1 / Math.max(1, d) ** 2, a = (p.from + 180) * Math.PI / 180;
      su += Math.sin(a) * w; sv += Math.cos(a) * w; sh += p.height * w; sp += (p.period || 9) * w; sw += w;
    }
    g[r * cols + c] = sw && dmin <= SWELL_KM && (!swellSea || swellSea(ll.lat, ll.lng))
      ? { u: su / sw, v: sv / sw, h: sh / sw, p: sp / sw, d: dmin } : null;
  }
  sgrid = { cols, rows, g };
  // fine field: open-sea pixels interpolate the 4 grid nodes around them; pixels between sea and land nodes
  // (the coastline runs through that square) are tested one by one against the coastline
  const fw = Math.ceil(s.x / FINE), fh = Math.ceil(s.y / FINE), ratio = FINE / CELL;
  fine = { w: fw, h: fh, e: new Array(fw * fh) };
  fieldCanvas = document.createElement('canvas'); fieldCanvas.width = fw; fieldCanvas.height = fh;
  const fx = fieldCanvas.getContext('2d'), img = fx.createImageData(fw, fh);
  const node = (c, r) => (c >= 0 && r >= 0 && c < cols && r < rows ? g[r * cols + c] : null);
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
    const gx = (i + 0.5) * ratio, gy = (j + 0.5) * ratio, c = Math.floor(gx), r = Math.floor(gy), tx = gx - c, ty = gy - r;
    const q = [[node(c, r), (1 - tx) * (1 - ty)], [node(c + 1, r), tx * (1 - ty)], [node(c, r + 1), (1 - tx) * ty], [node(c + 1, r + 1), tx * ty]];
    const sea = q.filter(([e]) => e);
    if (!sea.length) continue;
    if (sea.length < 4) {   // coast (or edge of the forecast area) in this square: test this exact pixel
      if (!swellSeaFine) continue;
      const ll = map.containerPointToLatLng([(i + 0.5) * FINE, (j + 0.5) * FINE]);
      if (!swellSeaFine(ll.lat, ll.lng)) continue;
    }
    const wsum = sea.reduce((a, [, w]) => a + w, 0) || 1;
    const mix = key => sea.reduce((a, [e, w]) => a + e[key] * (w || 0.25), 0) / (wsum || 1);
    const e = { u: mix('u'), v: mix('v'), h: mix('h'), p: mix('p'), d: mix('d') };
    fine.e[j * fw + i] = e;
    const [R, G, B] = swellRGBsmooth(e.h);
    const fade = Math.max(0, Math.min(1, 1 - (e.d - FADE_FROM) / (SWELL_KM - FADE_FROM)));   // soft outer edge, no blocks
    img.data.set([R, G, B, Math.round(ALPHA * fade)], (j * fw + i) * 4);
  }
  fx.putImageData(img, 0, 0);
}
function swellAt(x, y) {
  if (!fine) return null;
  const i = Math.floor(x / FINE), j = Math.floor(y / FINE);
  if (i < 0 || j < 0 || i >= fine.w || j >= fine.h) return null;
  return fine.e[j * fine.w + i] || null;
}
function newSwellParticle(s) {
  for (let t = 0; t < 8; t++) {
    const x = Math.random() * s.x, y = Math.random() * s.y;
    if (swellAt(x, y)) return { x, y, age: 0, max: 90 + Math.random() * 90 };
  }
  return { x: -99, y: -99, age: 0, max: 1 };
}
function seedSwell() {
  sparticles = [];
  if (!fine) return;
  const s = map.getSize(), n = Math.min(450, Math.round(s.x * s.y / 900));
  for (let i = 0; i < n; i++) { const p = newSwellParticle(s); p.age = Math.floor(Math.random() * p.max); sparticles.push(p); }
}

function drawSwell() {
  if (!fine) return;
  const s = map.getSize(), g = ctx2;
  if (fieldCanvas) {
    g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(fieldCanvas, 0, 0, fine.w * FINE, fine.h * FINE); g.restore();
  }
  if (reduced()) return;
  // white streaks moving the way the swell travels, like Windy's wave animation: longer + faster for longer periods
  const zs = Math.min(1.6, Math.max(0.8, (map.getZoom() - 6) / 3));
  g.lineCap = 'round';
  for (const p of sparticles) {
    const e = swellAt(p.x, p.y);
    if (!e || ++p.age > p.max) { Object.assign(p, newSwellParticle(s)); continue; }
    const n = Math.hypot(e.u, e.v) || 1, dx = e.u / n, dy = -e.v / n;
    const speed = (0.35 + e.p * 0.04) * zs;
    p.x += dx * speed; p.y += dy * speed;
    const a = Math.sin(Math.PI * p.age / p.max), len = (6 + e.p * 0.9) * zs;
    g.strokeStyle = `rgba(255,255,255,${(0.75 * a).toFixed(2)})`;
    g.lineWidth = 1.2 + Math.min(3, e.h) * 0.3;
    g.beginPath(); g.moveTo(p.x - dx * len, p.y - dy * len); g.lineTo(p.x, p.y); g.stroke();
  }
}

// Reduce Motion on: draw one still picture (streamlines + crests) instead of moving ones.
function drawStatic() {
  clear();
  const s = map.getSize();
  if (show.wind && grid) {
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 400; i++) {
      let x = Math.random() * s.x, y = Math.random() * s.y;
      const w0 = windAt(x, y); if (!w0) continue;
      ctx.strokeStyle = windColor(Math.hypot(w0[0], w0[1]));
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 12; j++) { const w = windAt(x, y); if (!w) break; x += w[0] * 0.25; y -= w[1] * 0.25; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  if (show.current && cgrid) {
    ctx.lineWidth = 2;
    for (let i = 0; i < 300; i++) {
      let x = Math.random() * s.x, y = Math.random() * s.y;
      const w0 = currentAt(x, y); if (!w0) continue;
      ctx.strokeStyle = currentColor(Math.hypot(w0[0], w0[1]));
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 12; j++) { const w = currentAt(x, y); if (!w) break; x += w[0] * 3; y -= w[1] * 3; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  if (show.swell) { ctx2.clearRect(0, 0, s.x, s.y); drawSwell(); }
}

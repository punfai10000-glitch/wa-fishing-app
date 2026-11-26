// Compass helpers. Directions are meteorological: the direction wind/waves come FROM.
const POINTS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

const C2D = new Map();
export function compassToDeg(name) {
  let v = C2D.get(name);
  if (v === undefined) { const i = POINTS.indexOf(String(name).toUpperCase()); v = i < 0 ? null : i * 22.5; C2D.set(name, v); }
  return v;
}

export function degToCompass(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  return POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export function angleDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// True if `deg` falls within ±tolerance of any listed compass direction.
export function isFrom(deg, dirs, tolerance = 30) {
  if (deg == null || !dirs || !dirs.length) return false;
  return dirs.some(d => {
    const c = compassToDeg(d);
    return c != null && angleDiff(deg, c) <= tolerance;
  });
}

// Classify how a direction hits a location: 'onshore' | 'sheltered' | 'cross'
export function exposureOf(deg, exposure) {
  if (deg == null || !exposure) return null;
  if (isFrom(deg, exposure.onshore_dirs)) return 'onshore';
  if (isFrom(deg, exposure.sheltered_dirs)) return 'sheltered';
  return 'cross';
}

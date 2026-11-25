// localStorage wrapper that never throws (private mode, quota, disabled storage).
const PREFIX = 'wafi.';

export function get(key, fallback = null) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

export function set(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

export function favourites() { return new Set(get('favourites', [])); }
export function toggleFavourite(id) {
  const f = favourites();
  f.has(id) ? f.delete(id) : f.add(id);
  set('favourites', [...f]);
  return f.has(id);
}

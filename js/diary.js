// Fishing diary — stored only on this phone (IndexedDB), never uploaded. Export/import as a file.
const DB = 'wafi-diary', STORE = 'trips';
let dbp = null;
const open = () => dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };

export const listTrips = async () => (await tx('readonly', s => s.getAll())).sort((a, b) => b.t - a.t);
export const saveTrip = trip => tx('readwrite', s => s.put({ ...trip, id: trip.id || `trip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }));
export const deleteTrip = id => tx('readwrite', s => s.delete(id));

// photo -> small JPEG data URL (max 1024 px) so the diary stays light
export function shrinkPhoto(fileOrImg, max = 1024) {
  return new Promise(res => {
    const go = img => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.72));
    };
    if (fileOrImg instanceof HTMLImageElement) return go(fileOrImg);
    const img = new Image(); img.onload = () => go(img); img.onerror = () => res(null); img.src = URL.createObjectURL(fileOrImg);
  });
}

export async function exportTrips({ photos = true } = {}) {
  const trips = (await listTrips()).map(t => (photos ? t : { ...t, photo: undefined }));
  const blob = new Blob([JSON.stringify({ app: 'wa-fishing-app diary', exported: new Date().toISOString(), trips }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fishing-diary-${new Date().toISOString().slice(0, 10)}.json`; a.click();
}
export async function importTrips(file) {
  const d = JSON.parse(await file.text());
  let n = 0; for (const t of d.trips || []) { if (t?.t) { await saveTrip(t); n++; } }
  return n;
}

// a pending entry handed over from the measure tool or a spot card
let draft = null;
export const setDraft = d => { draft = { ...(draft || {}), ...d }; };
export const takeDraft = () => { const d = draft; draft = null; return d; };

// Species photos from Wikipedia's public REST API (CORS-enabled, free).
// Each photo links to its Wikimedia Commons file page, which shows the author and licence.
import * as store from './storage.js';

const mem = new Map();

export async function speciesPhoto(title) {
  if (!title) return null;
  if (mem.has(title)) return mem.get(title);
  const cached = store.get('wiki.' + title);
  if (cached && Date.now() - cached.at < 30 * 86400e3) { mem.set(title, cached.v); return cached.v; }
  const p = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (!j?.thumbnail?.source) return null;
      const orig = j.originalimage?.source || j.thumbnail.source;
      const file = decodeURIComponent(orig.split('/').pop()).replace(/^\d+px-/, '');
      const v = {
        src: j.thumbnail.source,
        page: j.content_urls?.desktop?.page,
        credit: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`
      };
      store.set('wiki.' + title, { at: Date.now(), v });
      return v;
    })
    .catch(() => null);
  mem.set(title, p);
  return p;
}

// Several photos per species from iNaturalist (CORS-enabled, free). Only openly licensed photos
// (CC0 / CC BY / CC BY-SA / CC BY-NC…) are used, each shown with its photographer and licence.
const gmem = new Map();
export function speciesGallery(scientific, max = 6) {
  if (!scientific) return Promise.resolve([]);
  if (gmem.has(scientific)) return gmem.get(scientific);
  const key = 'inat.' + scientific;
  const cached = store.get(key);
  if (cached && Date.now() - cached.at < 30 * 86400e3) { const p = Promise.resolve(cached.v); gmem.set(scientific, p); return p; }
  const p = (async () => {
    const s = await fetch(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientific)}&per_page=5`).then(r => r.ok ? r.json() : null);
    const want = scientific.toLowerCase();
    const hit = s?.results?.find(t => t.name?.toLowerCase() === want) || s?.results?.[0];
    if (!hit) return [];
    const full = await fetch(`https://api.inaturalist.org/v1/taxa/${hit.id}`).then(r => r.ok ? r.json() : null);
    const photos = (full?.results?.[0]?.taxon_photos || []).map(tp => tp.photo)
      .filter(ph => ph && ph.license_code && ph.medium_url)
      .slice(0, max)
      .map(ph => ({ src: ph.medium_url, attribution: ph.attribution || 'iNaturalist contributor', license: ph.license_code.toUpperCase(), page: `https://www.inaturalist.org/photos/${ph.id}`, taxon: `https://www.inaturalist.org/taxa/${hit.id}` }));
    store.set(key, { at: Date.now(), v: photos });
    return photos;
  })().catch(() => []);
  gmem.set(scientific, p);
  return p;
}

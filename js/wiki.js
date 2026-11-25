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
const OPEN = 'cc0,cc-by,cc-by-nc,cc-by-sa,cc-by-nc-sa,cc-by-nd,cc-by-nc-nd';
async function inatTaxon(scientific, common) {
  for (const q of [scientific, common].filter(Boolean)) {
    const s = await fetch(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(q)}&per_page=10`).then(r => r.ok ? r.json() : null);
    const want = scientific?.toLowerCase();
    const hit = s?.results?.find(t => t.name?.toLowerCase() === want) || s?.results?.find(t => t.iconic_taxon_name === 'Actinopterygii' || t.iconic_taxon_name === 'Animalia' || t.iconic_taxon_name === 'Mollusca') || s?.results?.[0];
    if (hit) return hit;
  }
  return null;
}
// Several photos per species from iNaturalist (CORS-enabled, free). Only openly licensed photos are used,
// each shown with its photographer and licence. Falls back to research-grade observation photos.
export function speciesGallery(scientific, max = 6, common = '') {
  if (!scientific && !common) return Promise.resolve([]);
  const k = scientific || common;
  if (gmem.has(k)) return gmem.get(k);
  const key = 'inat2.' + k;
  const cached = store.get(key);
  if (cached && cached.v?.length && Date.now() - cached.at < 30 * 86400e3) { const p = Promise.resolve(cached.v); gmem.set(k, p); return p; }
  const p = (async () => {
    const hit = await inatTaxon(scientific, common);
    if (!hit) return [];
    const full = await fetch(`https://api.inaturalist.org/v1/taxa/${hit.id}`).then(r => r.ok ? r.json() : null);
    let photos = (full?.results?.[0]?.taxon_photos || []).map(tp => tp.photo)
      .filter(ph => ph && ph.license_code && ph.medium_url)
      .map(ph => ({ src: ph.medium_url, attribution: ph.attribution || 'iNaturalist contributor', license: ph.license_code.toUpperCase(), page: `https://www.inaturalist.org/photos/${ph.id}` }));
    if (photos.length < max) {   // top up with openly licensed research-grade observation photos
      const obs = await fetch(`https://api.inaturalist.org/v1/observations?taxon_id=${hit.id}&quality_grade=research&photo_license=${OPEN}&per_page=${max * 2}&order_by=votes`).then(r => r.ok ? r.json() : null).catch(() => null);
      for (const o of obs?.results || []) {
        const ph = (o.photos || []).find(x => x.license_code && x.url);
        if (!ph || photos.some(x => x.page.endsWith('/' + ph.id))) continue;
        photos.push({ src: ph.url.replace('/square.', '/medium.'), attribution: ph.attribution || 'iNaturalist contributor', license: ph.license_code.toUpperCase(), page: `https://www.inaturalist.org/photos/${ph.id}` });
        if (photos.length >= max) break;
      }
    }
    photos = photos.slice(0, max).map(x => ({ ...x, taxon: `https://www.inaturalist.org/taxa/${hit.id}` }));
    if (photos.length) store.set(key, { at: Date.now(), v: photos });
    return photos;
  })().catch(() => []);
  gmem.set(k, p);
  return p;
}

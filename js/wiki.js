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

// "What's being caught or seen here": iNaturalist records (verified photos with dates and places)
// plus Reddit discussion links collected weekly. Both are community sources — shown as such,
// never used in scores, never treated as rules.
import { state } from '../app.js';
import { REGIONS } from '../config.js';
import { esc } from '../ui.js';
import * as store from '../storage.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function sightingsCard() {
  return '<p class="small muted">Loading recent records near this spot…</p>';
}

async function inat(lat, lng, month) {
  const key = `inat.${lat.toFixed(2)},${lng.toFixed(2)},${month ?? 'all'}`;
  const c = store.get(key);
  if (c && Date.now() - c.at < 7 * 86400e3) return c.v;
  const u = `https://api.inaturalist.org/v1/observations/species_counts?lat=${lat}&lng=${lng}&radius=6&iconic_taxa=Actinopterygii,Mollusca&quality_grade=research&per_page=12&locale=en${month ? `&month=${month}` : ''}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('iNaturalist ' + r.status);
  const v = (await r.json()).results || [];
  store.set(key, { at: Date.now(), v });
  return v;
}

export async function fillSightings(el, loc, withHeading = false) {
  if (!el) return;
  const [lng, lat] = loc.geometry.coordinates;
  const m = new Date().getMonth() + 1;
  const h = withHeading ? '<h2>What\'s being caught or seen here</h2>' : '';
  try {
    let list = await inat(lat, lng, m);
    let label = `in ${MONTHS[m - 1]} (any year)`;
    if (!list.length) { list = await inat(lat, lng, null); label = 'at any time of year (none recorded this month)'; }
    if (!list.length) { el.innerHTML = `${h}<p class="small muted">No verified fish or squid records within 6 km on iNaturalist yet.</p>`; return; }
    el.innerHTML = `${h}<p class="small">Fish &amp; squid photographed within 6 km ${label}:</p>
      <ul class="sightings">${list.map(r => {
        const t = r.taxon;
        const inLib = state.data.species.species.find(s => s.scientific.toLowerCase() === t.name.toLowerCase());
        return `<li>${t.default_photo?.square_url ? `<img src="${esc(t.default_photo.square_url)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
          <span><strong>${esc(t.preferred_common_name || t.name)}</strong> <i class="muted">${esc(t.name)}</i><br>
          <span class="small muted">${r.count} record${r.count === 1 ? '' : 's'}</span>
          ${inLib ? ` · <a class="small" href="#/fish/${esc(inLib.id)}">${inLib.status === 'protected' ? 'Protected — see rules' : 'Size &amp; bag limits'}</a>` : ''}</span></li>`;
      }).join('')}</ul>
      <p class="small muted">Source: iNaturalist community observations (research grade: photo + date + place, confirmed by other users). Includes divers' sightings, not only catches. Not a guarantee fish are there today.</p>`;
  } catch {
    el.innerHTML = `${h}<p class="small muted">Couldn't reach iNaturalist right now.</p>`;
  }
}

// ---- Reddit discussion links (weekly GitHub Action; titles + links only) ----
let community;
async function loadCommunity() {
  if (community !== undefined) return community;
  try {
    const r = await fetch('data/community.json', { cache: 'no-cache' });
    community = r.ok ? await r.json() : null;
  } catch { community = null; }
  return community;
}

function areaFor(loc, areas) {
  const hay = [loc.name, loc.near, REGIONS[loc.region]?.name].filter(Boolean).join(' ').toLowerCase();
  return Object.keys(areas).find(a => hay.includes(a.toLowerCase()))
    || Object.keys(areas).find(a => (REGIONS[loc.region]?.name || '').toLowerCase().includes(a.toLowerCase()));
}

export function communityCard(loc) {
  const id = `comm-${Math.random().toString(36).slice(2, 8)}`;
  queueMicrotask(async () => {
    const el = document.getElementById(id);
    const data = await loadCommunity();
    if (!el) return;
    if (!data?.areas) { el.innerHTML = '<h2>Community talk</h2><p class="small muted">Reddit discussion links aren\'t switched on yet (needs a free Reddit app key — see README).</p>'; return; }
    const area = areaFor(loc, data.areas);
    const posts = area ? data.areas[area] : [];
    if (!posts?.length) { el.innerHTML = '<h2>Community talk</h2><p class="small muted">No recent public discussions found for this area.</p>'; return; }
    const m = new Date().getMonth() + 1;
    const near = p => [m - 1, m, m + 1].map(x => ((x + 11) % 12) + 1).includes(p.month);
    const sorted = [...posts.filter(near), ...posts.filter(p => !near(p))].slice(0, 8);
    el.innerHTML = `<h2>Community talk — ${esc(area)}</h2>
      <ul class="small">${sorted.map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a> <span class="muted">r/${esc(p.subreddit)} · ${esc(p.date)}${near(p) ? ' · this time of year' : ''}</span></li>`).join('')}</ul>
      <p class="small muted">Public Reddit posts, unverified. Shown for local knowledge only — never used in scores or rules. Facebook groups can't be included (no public access).</p>`;
  });
  return `<div class="card" id="${id}"><h2>Community talk</h2><p class="small muted">Loading…</p></div>`;
}

// Point-in-polygon legal check against WA marine park zones (data/zones/marine-parks.geojson).
function inRing(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
function inPolygon(pt, poly) {
  if (!inRing(pt, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(pt, poly[k])) return false; // holes
  return true;
}
function contains(geom, pt) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return inPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => inPolygon(pt, p));
  return false;
}

const cache = new Map();
export function zoneHitsFor(zones, loc) {
  if (!zones?.loaded || !zones.features?.length) return [];
  if (cache.has(loc.id)) return cache.get(loc.id);
  const pt = loc.geometry.coordinates;
  const hits = zones.features.filter(f => contains(f.geometry, pt)).map(f => f.properties);
  cache.set(loc.id, hits);
  return hits;
}

// Plain-English legal status for a spot (activity: 'shore' | 'spear').
// Sources: DPIRD fishing orders (sanctuaries, wrecks, closures — data/zones/closures.geojson) on top of
// CAPAD marine park outlines. Returns { state: ok|caution|blocked|unchecked, text, link, notes[] }.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function legalStatus(zones, loc, activity = 'shore') {
  if (!zones?.loaded) return { state: 'unchecked', text: 'Marine park zones not loaded yet.', notes: [] };
  const hits = zoneHitsFor(zones, loc);
  const notes = hits.filter(h => h.zone_type === 'species' || h.zone_type === 'gear').map(h => ({ text: `${h.name}: ${h.note}`, link: h.link }));
  const act = activity === 'spear' ? 'spearfishing' : 'fishing';
  const block = hits.find(h => h.zone_type === 'sanctuary' || (h.prohibits || []).includes(activity));
  if (block) return { state: 'blocked', text: `${block.name} — ${block.note || `no ${act}.`}${block.verified === false ? ' Boundary from OpenStreetMap — check the DBCA zoning map.' : ''}`, link: block.link, notes };
  const restr = hits.find(h => h.zone_type === 'restricted');
  if (restr) return { state: 'caution', text: `${restr.name} — ${restr.note}`, link: restr.link, notes };
  const general = hits.find(h => h.zone_type === 'general_use');
  if (general) return { state: 'ok', text: `${general.name} — normal fishing rules apply. Not inside a mapped sanctuary zone.`, link: general.link, notes };
  const park = hits.find(h => h.zone_type === 'marine_park');
  if (park) {
    const covered = (zones.covers_parks || []).some(n => (park.name || '').toLowerCase().includes(n.toLowerCase()));
    return covered
      ? { state: 'ok', text: `Inside ${park.name} but outside its sanctuary zones (from DPIRD fishing orders). Normal rules apply.`, notes }
      : { state: 'caution', text: `Inside ${park.name}. Its sanctuary zones aren't in the app yet — check the DBCA zoning map before fishing.`, notes };
  }
  return { state: 'ok', text: 'Not inside a marine park or closed area. Normal fishing rules apply (check closures for your target species).', notes };
}

// Small HTML block for pop-ups and pages
export function legalHTML(ls, { small = true } = {}) {
  const head = { blocked: 'No fishing here.', caution: 'Special rules here.', ok: 'Zone check:', unchecked: 'Zone check pending.' }[ls.state];
  return `<div class="notice ${small ? 'small' : ''} ${ls.state === 'blocked' ? 'danger' : ls.state === 'ok' ? 'info' : ''}"><strong>${head}</strong> ${esc(ls.text)}${ls.link ? ` <a href="${esc(ls.link)}" target="_blank" rel="noopener">Read the order ↗</a>` : ''}
    ${(ls.notes || []).map(n => `<div>• ${esc(n.text)}${n.link ? ` <a href="${esc(n.link)}" target="_blank" rel="noopener">order ↗</a>` : ''}</div>`).join('')}</div>`;
}

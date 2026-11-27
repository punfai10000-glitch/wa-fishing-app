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
  if (!geom._bb) {   // bounding box once per zone: most points are rejected without walking the polygon
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const walk = x => { if (typeof x[0] === 'number') { if (x[0] < a) a = x[0]; if (x[0] > c) c = x[0]; if (x[1] < b) b = x[1]; if (x[1] > d) d = x[1]; } else x.forEach(walk); };
    walk(geom.coordinates); Object.defineProperty(geom, '_bb', { value: [a, b, c, d] });
  }
  const [a, b, c, d] = geom._bb;
  if (pt[0] < a || pt[0] > c || pt[1] < b || pt[1] > d) return false;
  if (geom.type === 'Polygon') return inPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => inPolygon(pt, p));
  return false;
}

// metres from a point to the nearest edge of a polygon (for zones traced from maps, whose edges are approximate)
function edgeDist(geom, pt) {
  const k = Math.cos(pt[1] * Math.PI / 180) * 111320, m = 110540;
  let best = Infinity;
  const ring = r => { for (let i = 1; i < r.length; i++) {
    const ax = (r[i - 1][0] - pt[0]) * k, ay = (r[i - 1][1] - pt[1]) * m, bx = (r[i][0] - pt[0]) * k, by = (r[i][1] - pt[1]) * m;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy); if (d < best) best = d; } };
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  polys.forEach(p => p.forEach(ring));
  return best;
}
const NEAR_M = 250;
const nearCache = new Map();
// Sanctuary / no-fishing zones traced from a map that end just outside this point (within NEAR_M)
export function nearZonesFor(zones, loc) {
  if (!zones?.loaded || !zones.features?.length) return [];
  if (nearCache.has(loc.id)) return nearCache.get(loc.id);
  const pt = loc.geometry.coordinates, dLat = NEAR_M / 110540, dLng = dLat / Math.cos(pt[1] * Math.PI / 180);
  const out = [];
  for (const f of zones.features) {
    const p = f.properties || {};
    if (!p.approx || !(p.zone_type === 'sanctuary' || (p.prohibits || []).length)) continue;
    contains(f.geometry, [0, 0]);   // makes sure the bounding box exists
    const [a, b, c, d] = f.geometry._bb;
    if (pt[0] < a - dLng || pt[0] > c + dLng || pt[1] < b - dLat || pt[1] > d + dLat) continue;
    if (contains(f.geometry, pt)) continue;
    const dist = edgeDist(f.geometry, pt);
    if (dist <= NEAR_M) out.push({ ...p, dist: Math.round(dist) });
  }
  nearCache.set(loc.id, out);
  return out;
}

// Is this exact point inside a zone where the activity is banned (sanctuary, or prohibited without a permit)?
export function bannedAt(zones, pt, act) {
  if (!zones?.loaded || !zones.features?.length) return false;
  let ban = false, permit = false;
  for (const f of zones.features) {
    const p = f.properties || {};
    const relevant = p.zone_type === 'sanctuary' || (p.prohibits || []).includes(act) || (p.permits || []).includes(act);
    if (!relevant || !contains(f.geometry, pt)) continue;
    if (p.zone_type === 'sanctuary') return true;
    if ((p.permits || []).includes(act)) permit = true; else ban = true;
  }
  return ban && !permit;
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
// Sources: DPIRD fishing orders (sanctuaries, park zones, wrecks, closures — data/zones/closures.geojson, each
// with the exact rules read from its order) on top of CAPAD marine park outlines, plus the statewide ban on
// spearfishing in rivers and estuaries.
// Returns { state: ok|caution|blocked|unchecked, text, link, notes[], allow: {shore, spear}, why: {shore, spear}, zones[] }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ACT = { shore: 'Line fishing', spear: 'Spearfishing' };
// Parks whose zoning isn't in the DPIRD order data (checked Nov 2026)
const PARK_NOTES = [
  { re: /swan estuary/i, state: 'ok', link: 'https://exploreparks.dbca.wa.gov.au/park/swan-estuary-marine-park',
    text: 'Inside Swan Estuary Marine Park (Alfred Cove, Pelican Point or Milyu) — the whole park is a general use zone: line fishing is allowed anywhere in it under the normal rules. (Spearfishing is banned in all rivers and estuaries.)' },
  { re: /walpole/i, state: 'ok', link: 'https://exploreparks.dbca.wa.gov.au/park/walpole-and-nornalup-inlets-marine-park',
    text: 'Inside Walpole and Nornalup Inlets Marine Park — zoned for recreation: rod and line, crabbing and prawning allowed under the Walpole fishing order and normal rules.' },
  { re: /mamang|wudjari|western bight|mirning/i, state: 'caution', link: 'https://www.dbca.wa.gov.au/scmp',
    text: 'Inside the South Coast Marine Park (created Dec 2024). Fishing is allowed in most of it, but it has sanctuary zones (no fishing at all) that are NOT in the app for this part yet. Check the DBCA zoning map before you fish here.' }
];
const monthOf = t => new Date(t ?? Date.now()).getMonth() + 1;

function verdict(hits, loc, act) {
  const permit = hits.find(h => (h.permits || []).includes(act));
  const sanct = hits.find(h => h.zone_type === 'sanctuary');
  if (sanct) return { ok: false, why: `${sanct.name} — ${sanct.note}`, link: sanct.link };
  const ban = hits.find(h => (h.prohibits || []).includes(act));
  if (ban && !permit) return { ok: false, why: `${ban.name} — ${ban.note}`, link: ban.link };
  if (act === 'spear' && loc.estuary) return { ok: false, why: 'Spearfishing is banned in all WA rivers, estuaries, creeks and inland waters.', link: 'https://www.dpird.wa.gov.au/individuals/recreational-fishing/' };
  return { ok: true, why: permit && ban ? permit.note : '' };
}

export function legalStatus(zones, loc, activity = 'shore', { t } = {}) {
  if (!zones?.loaded) return { state: 'unchecked', text: 'Marine park zones not loaded yet.', notes: [], allow: {}, why: {}, zones: [] };
  const hits = zoneHitsFor(zones, loc);
  const m = monthOf(t);
  const v = { shore: verdict(hits, loc, 'shore'), spear: verdict(hits, loc, 'spear') };
  const allow = { shore: v.shore.ok, spear: v.spear.ok }, why = { shore: v.shore.why, spear: v.spear.why };
  // every zone that adds a rule here, with its exact allowed / not-allowed list
  const zonesHere = hits.filter(h => h.zone_type !== 'marine_park').map(h => {
    const seasonal = h.months?.length;
    const active = !seasonal || h.months.includes(m);
    return { name: h.name, type: h.zone_type, note: h.note, details: h.details || [], link: h.link, seasonal: !!seasonal, active, approx: !!h.approx };
  });
  const notes = zonesHere.filter(z => z.type === 'species' || z.type === 'gear').map(z => ({ text: `${z.name}${z.seasonal ? (z.active ? ' — closed now' : ' — open now') : ''}`, link: z.link }));
  const me = v[activity] || v.shore;
  const park = hits.find(h => h.zone_type === 'marine_park');
  const parkCovered = park && (zones.covers_parks || []).some(n => (park.name || '').toLowerCase().includes(n.toLowerCase()));
  const base = { notes, allow, why, zones: zonesHere, park: park?.name || null };
  if (!me.ok) return { ...base, state: 'blocked', text: me.why, link: me.link };
  const close = nearZonesFor(zones, loc)[0];
  if (close) return { ...base, state: 'caution', text: `Only about ${close.dist} m from the ${close.name} (no fishing). Its line in the app is traced from the official map and can be out by ~100 m — check the signs and the DBCA map before you fish here.`, link: close.link };
  const special = zonesHere.find(z => z.type === 'restricted' || z.type === 'special_purpose' || z.type === 'general_use' && (z.details || []).some(d => d.startsWith('✗')));
  if (special) return { ...base, state: 'caution', text: `${special.name} — ${special.note}`, link: special.link };
  if (park && /nature reserve/i.test(park.park_type || '') && !parkCovered)
    return { ...base, state: 'ok', text: `Next to ${park.name} Nature Reserve (islands). Normal fishing rules apply in the water; landing on the islands may be restricted — check DBCA.`, link: 'https://exploreparks.dbca.wa.gov.au/' };
  const pn = park && PARK_NOTES.find(n => n.re.test(park.name || ''));
  if (park && !parkCovered && pn) return { ...base, state: pn.state, text: pn.text, link: pn.link };
  if (park && !parkCovered) return { ...base, state: 'caution', text: `Inside ${park.name}. Its zones aren't in the app yet — check the DBCA zoning map before fishing.`, link: 'https://exploreparks.dbca.wa.gov.au/' };
  if (park) return { ...base, state: 'ok', text: `Inside ${park.name}, outside its sanctuary zones. Normal fishing rules apply.${/mamang|wudjari/i.test(park.name || '') ? ' (Zones here are traced from the DBCA map — check signs near any boundary.)' : ''}` };
  const active = zonesHere.filter(z => z.active && (z.type === 'species' || z.type === 'gear'));
  if (active.length) return { ...base, state: 'caution', text: 'Not in a marine park or sanctuary, but extra rules apply here (below).' };
  return { ...base, state: 'ok', text: 'Not in a marine park, sanctuary or closed area. Normal bag and size limits apply.' };
}

// "What's allowed here" box for cards and pages: a yes/no line per activity, then each zone's exact rules.
export function legalHTML(ls, { small = true } = {}) {
  if (ls.state === 'unchecked') return `<div class="notice ${small ? 'small' : ''}"><strong>Rules:</strong> ${esc(ls.text)}</div>`;
  const same = !ls.allow.shore && !ls.allow.spear && ls.why.shore === ls.why.spear;
  const yn = a => `<div class="allow-row"><span>${a === 'spear' ? '🔱' : '🎣'} ${ACT[a]}</span><b class="${ls.allow[a] ? 'yes' : 'no'}">${ls.allow[a] ? '✓ Allowed' : '✗ Not allowed'}</b></div>
    ${(!ls.allow[a] || ls.why[a]) && !(same && a === 'shore') ? `<div class="allow-why">${esc(ls.why[a])}</div>` : ''}`;
  const zoneBox = z => `<div class="zone-rules${z.seasonal && !z.active ? ' inactive' : ''}"><strong>${esc(z.name)}</strong>${z.seasonal ? ` <span class="pill ${z.active ? 'blk-legal' : 'good'}">${z.active ? 'Closed now' : 'Open now'}</span>` : ''}
      ${z.details.length ? `<ul>${z.details.map(d => `<li class="${d.startsWith('✗') ? 'no' : d.startsWith('✓') ? 'yes' : ''}">${esc(d)}</li>`).join('')}</ul>` : `<div>${esc(z.note)}</div>`}
      ${z.link ? `<a href="${esc(z.link)}" target="_blank" rel="noopener">${z.approx ? 'Official zoning map & plan ↗' : 'Read the official order ↗'}</a>` : ''}</div>`;
  // name the activity that is banned, so "Not allowed" never sits above "Line fishing ✓ Allowed"
  const banned = ['shore', 'spear'].filter(a => !ls.allow[a]);
  const blockedHead = banned.length === 2 ? '⛔ No fishing allowed here' : banned.length === 1 ? `⛔ ${ACT[banned[0]]} not allowed here` : '⛔ Not allowed here';
  const head = { blocked: blockedHead, caution: '⚠ Special rules here', ok: '✓ Rules check' }[ls.state];
  return `<div class="notice legal-box ${small ? 'small' : ''} ${ls.state === 'blocked' ? 'danger' : ls.state === 'ok' ? 'info' : 'warn'}">
    <div class="legal-head"><strong>${head}</strong></div>
    ${yn('shore')}${yn('spear')}
    <div class="legal-text">${esc(ls.state === 'blocked' ? '' : ls.text)}</div>
    ${ls.zones.map(zoneBox).join('')}
    <div class="muted legal-foot">Bag and size limits, licences and statewide closures still apply. From the official fishing orders (DPIRD) and DBCA zoning maps — signs on site and new orders win.</div></div>`;
}

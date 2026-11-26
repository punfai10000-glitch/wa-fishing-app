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
// Sources: DPIRD fishing orders (sanctuaries, park zones, wrecks, closures — data/zones/closures.geojson, each
// with the exact rules read from its order) on top of CAPAD marine park outlines, plus the statewide ban on
// spearfishing in rivers and estuaries.
// Returns { state: ok|caution|blocked|unchecked, text, link, notes[], allow: {shore, spear}, why: {shore, spear}, zones[] }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ACT = { shore: 'Line fishing', spear: 'Spearfishing' };
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
    return { name: h.name, type: h.zone_type, note: h.note, details: h.details || [], link: h.link, seasonal: !!seasonal, active };
  });
  const notes = zonesHere.filter(z => z.type === 'species' || z.type === 'gear').map(z => ({ text: `${z.name}${z.seasonal ? (z.active ? ' — closed now' : ' — open now') : ''}`, link: z.link }));
  const me = v[activity] || v.shore;
  const park = hits.find(h => h.zone_type === 'marine_park');
  const parkCovered = park && (zones.covers_parks || []).some(n => (park.name || '').toLowerCase().includes(n.toLowerCase()));
  const base = { notes, allow, why, zones: zonesHere, park: park?.name || null };
  if (!me.ok) return { ...base, state: 'blocked', text: me.why, link: me.link };
  const special = zonesHere.find(z => z.type === 'restricted' || z.type === 'general_use' && (z.details || []).some(d => d.startsWith('✗')));
  if (special) return { ...base, state: 'caution', text: `${special.name} — ${special.note}`, link: special.link };
  if (park && !parkCovered) return { ...base, state: 'caution', text: `Inside ${park.name}. Its zones aren't in the app yet — check the DBCA zoning map before fishing.` };
  if (park) return { ...base, state: 'ok', text: `Inside ${park.name}, outside its sanctuary zones. Normal fishing rules apply.` };
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
      ${z.link ? `<a href="${esc(z.link)}" target="_blank" rel="noopener">Read the official order ↗</a>` : ''}</div>`;
  const head = { blocked: '⛔ Not allowed here', caution: '⚠ Special rules here', ok: '✓ Rules check' }[ls.state];
  return `<div class="notice legal-box ${small ? 'small' : ''} ${ls.state === 'blocked' ? 'danger' : ls.state === 'ok' ? 'info' : 'warn'}">
    <div class="legal-head"><strong>${head}</strong></div>
    ${yn('shore')}${yn('spear')}
    <div class="legal-text">${esc(ls.state === 'blocked' ? '' : ls.text)}</div>
    ${ls.zones.map(zoneBox).join('')}
    <div class="muted legal-foot">Bag and size limits, licences and statewide closures still apply. From the official fishing orders (DPIRD) — signs on site and new orders win.</div></div>`;
}

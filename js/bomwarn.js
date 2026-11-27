// BOM marine wind warnings (Strong Wind / Gale / Storm Force) for the coastal zone a point is in.
// Source: BOM anonymous FTP product IDW20100, copied hourly to the live-data branch by pipeline/fetch_bom_warnings.py.
import { CONFIG } from './config.js';
import { esc } from './ui.js';

export async function loadBomWarnings() {
  if (!CONFIG.GITHUB_REPO) return null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${CONFIG.GITHUB_REPO}/live-data/bom_warnings.json?t=${Math.floor(Date.now() / 300000)}`);
    if (!r.ok) return null;
    const d = await r.json();
    // a summary older than 8 h may list warnings that have been cancelled — don't show it
    return d.fetched_at && Date.now() - Date.parse(d.fetched_at) < 8 * 3600e3 ? d : null;
  } catch { return null; }
}

// BOM WA coastal waters zones (boundaries as named in BOM's Coastal Waters Forecasts IDW11130/IDW11140)
export function bomZones(lat, lng) {
  if (lat > -27.71) return ['Gascoyne Coast'];                       // Cape Cuvier – Kalbarri
  if (lat > -30.31 && lng < 115.3) return ['Geraldton Coast'];       // Kalbarri – Jurien Bay (incl. Abrolhos)
  if (lat > -31.50 && lng < 115.9) return ['Lancelin Coast'];        // Jurien Bay – Two Rocks
  if (lat > -32.60 && lng < 116.0) {                                  // Two Rocks – Dawesville
    const local = lat < -31.75 && lat > -32.35 && lng > 115.45;      // Rottnest, Fremantle, Cockburn Sound
    return local ? ['Perth Coast', 'Perth Local Waters'] : ['Perth Coast'];
  }
  if (lat > -33.55 && lng < 116.0) return ['Bunbury Geographe Coast']; // Dawesville – Cape Naturaliste
  if (lng < 116.73) return ['Leeuwin Coast'];                         // Cape Naturaliste – Walpole
  if (lng < 119.40) return ['Albany Coast'];                          // Walpole – Bremer Bay
  if (lng < 124.0) return ['Esperance Coast'];                        // Bremer Bay – east
  return ['Eucla Coast'];
}

const perthDate = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);   // WA has no daylight saving

// Warnings for this point on the day of time t (ms). [{type, zone}]
export function warningsAt(data, lat, lng, t = Date.now()) {
  if (!data?.days) return [];
  const zones = bomZones(lat, lng), day = data.days.find(d => d.date === perthDate(t));
  if (!day) return [];
  const out = [];
  for (const w of day.warnings) for (const z of zones) if (w.areas.includes(z)) out.push({ type: w.type, zone: z });
  return out;
}

export function warningHTML(data, lat, lng, t) {
  const ws = warningsAt(data, lat, lng, t);
  if (!ws.length) return '';
  const worst = ws.find(w => !/^Strong Wind/i.test(w.type)) || ws[0];
  const today = perthDate(t) === perthDate(Date.now());
  return `<div class="notice danger bom-warn"><strong>⚠ BOM ${esc(worst.type)} Warning</strong> ${today ? 'today' : 'that day'} for ${esc([...new Set(ws.map(w => w.zone))].join(' and '))}.
    Wind and seas can be dangerous for small boats, kayaks and rock fishing. <a href="${esc(data.link || 'https://www.bom.gov.au/wa/warnings/')}" target="_blank" rel="noopener">Full warning on BOM ↗</a></div>`;
}

// Per-source data age written by pipeline/check_freshness.py each hour
export async function loadLiveStatus() {
  if (!CONFIG.GITHUB_REPO) return null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${CONFIG.GITHUB_REPO}/live-data/status.json?t=${Math.floor(Date.now() / 300000)}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

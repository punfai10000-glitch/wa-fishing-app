// Diary page: log a trip (spot, time, catch, photo) and what it was REALLY like, next to what the app predicted.
// Those "reality checks" are what make the scores and safety limits more accurate over time.
import { state, evalFor } from '../app.js';
import { esc } from '../ui.js';
import { fmtDateTime } from '../units.js';
import { listTrips, saveTrip, deleteTrip, shrinkPhoto, exportTrips, importTrips, takeDraft } from '../diary.js';

const HOUR = 3600e3;
const opts = (name, list, cur) => list.map(([v, l]) => `<label class="opt"><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''}> ${l}</label>`).join('');
const localInput = t => new Date(t + 8 * HOUR).toISOString().slice(0, 16);

// what the app said for that spot and hour (stored with the trip so we can compare later)
function predicted(locId, t, activity) {
  const loc = [...state.data.locations, ...(state.osmSpots || [])].find(l => l.id === locId);
  if (!loc) return null;
  const ev = evalFor(loc, activity);
  const h = ev?.hourly?.find(x => x.t === Math.floor(t / HOUR) * HOUR);
  if (!h) return null;
  return { score: h.score, blocked: h.blocked, blockKind: h.blockKind || null, caution: !!h.cautions?.length, wave: h.hour?.wave_height, period: h.hour?.wave_period, wind: h.hour?.wind_speed, gust: h.hour?.wind_gust, current: h.hour?.current_speed };
}

export async function renderDiary(view) {
  const d = takeDraft() || {};
  const spots = [...state.data.locations, ...(state.osmSpots || [])].slice().sort((a, b) => a.name.localeCompare(b.name));
  const sp = state.data.species.species.slice().sort((a, b) => a.name.localeCompare(b.name));
  const t0 = d.t || Math.floor(Date.now() / HOUR) * HOUR;
  view.innerHTML = `
    <div>
      <h1>📓 Fishing diary</h1>
      <p class="small muted">Saved only on this phone. Each entry keeps what the app predicted, next to what it was really like — over time that shows how far to trust it at your spots.</p>
      <form id="trip" class="card diary-form">
        <h2>Log a trip</h2>
        <label>Where <select name="loc" required><option value="">Choose a spot…</option>${spots.map(l => `<option value="${esc(l.id)}" ${l.id === (d.loc || state.selectedId) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <label>When <input type="datetime-local" name="t" value="${localInput(t0)}"></label>
        <div class="optrow"><span>Activity</span>${opts('act', [['shore', '🎣 Line fishing'], ['spear', '🔱 Spearfishing']], d.act || state.activity)}</div>
        <div class="optrow"><span>Waves really were</span>${opts('waves', [['calm', 'Calm'], ['ok', 'OK'], ['rough', 'Rough'], ['dangerous', 'Too dangerous']], '')}</div>
        <div class="optrow"><span>Wind</span>${opts('wind', [['light', 'Light'], ['ok', 'OK'], ['strong', 'Strong']], '')}</div>
        <div class="optrow"><span>Water clarity</span>${opts('clarity', [['clear', 'Clear'], ['ok', 'OK'], ['murky', 'Murky']], '')}</div>
        <div class="optrow"><span>Fishing was</span>${opts('result', [['good', 'Good'], ['average', 'Average'], ['poor', 'Poor / nothing']], '')}</div>
        <label>Catch (species) <select name="species"><option value="">—</option>${sp.map(s => `<option value="${s.id}" ${s.id === d.species ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <div class="row" style="gap:8px">
          <label style="flex:1">How many <input type="number" name="count" min="0" max="999" value="${d.count ?? ''}"></label>
          <label style="flex:1">Biggest (cm) <input type="number" name="length" min="0" max="400" step="0.1" value="${d.length ?? ''}"></label>
        </div>
        <div class="optrow"><span>Kept or released</span>${opts('kept', [['kept', 'Kept'], ['released', 'Released'], ['mixed', 'Some of each']], '')}</div>
        <label>Notes <textarea name="notes" rows="2" placeholder="Bait, rig, tide, anything worth remembering">${esc(d.notes || '')}</textarea></label>
        <label class="btn ghost" style="display:inline-block">📷 ${d.photo ? 'Change photo' : 'Add a photo'}<input type="file" name="photo" accept="image/*" capture="environment" hidden></label>
        <img id="d-prev" class="d-prev" ${d.photo ? `src="${d.photo}"` : 'hidden'} alt="Catch photo">
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn" type="submit">Save trip</button></div>
      </form>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn ghost" id="d-export">⬇ Export diary (file)</button>
        <label class="btn ghost">⬆ Import<input type="file" id="d-import" accept="application/json" hidden></label>
      </div>
      <p class="small muted">Export makes a file you can keep as a backup or share — e.g. to help improve the app's accuracy.</p>
      <h2>Your trips</h2>
      <div id="d-list" class="small muted">Loading…</div>
    </div>`;
  let photo = d.photo || null;
  const form = view.querySelector('#trip');
  form.photo.addEventListener('change', async e => { const f = e.target.files?.[0]; if (!f) return; photo = await shrinkPhoto(f); const im = view.querySelector('#d-prev'); im.src = photo; im.hidden = false; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    if (!fd.get('loc')) { form.loc.focus(); return; }
    const t = new Date(fd.get('t') + ':00+08:00').getTime();
    const act = fd.get('act') || 'shore';
    const loc = spots.find(l => l.id === fd.get('loc'));
    await saveTrip({ t, loc: loc.id, locName: loc.name, act, waves: fd.get('waves'), wind: fd.get('wind'), clarity: fd.get('clarity'), result: fd.get('result'),
      species: fd.get('species'), count: fd.get('count') ? +fd.get('count') : null, length: fd.get('length') ? +fd.get('length') : null, kept: fd.get('kept'),
      notes: fd.get('notes'), photo, predicted: predicted(loc.id, t, act), saved: Date.now() });
    renderDiary(view);
  });
  view.querySelector('#d-export').addEventListener('click', () => exportTrips());
  view.querySelector('#d-import').addEventListener('change', async e => { const f = e.target.files?.[0]; if (f) { const n = await importTrips(f).catch(() => 0); alertish(view, `${n} trip(s) imported`); renderDiary(view); } });
  const trips = await listTrips().catch(() => []);
  const list = view.querySelector('#d-list');
  list.className = '';
  list.innerHTML = trips.length ? trips.map(tr => {
    const p = tr.predicted, s = state.data.species.species.find(x => x.id === tr.species);
    const said = !p ? 'no forecast saved' : p.blocked ? ({ legal: 'not allowed', dark: 'too dark', safety: 'not safe' }[p.blockKind] || 'not safe') : `score ${p.score}${p.caution ? ', take care' : ''}`;
    return `<div class="card trip">
      ${tr.photo ? `<img src="${tr.photo}" alt="" class="trip-ph">` : ''}
      <div><strong>${esc(tr.locName)}</strong> · ${tr.act === 'spear' ? '🔱' : '🎣'} <span class="muted">${fmtDateTime(tr.t)}</span>
      <div class="small">App said: <b>${esc(said)}</b>${p?.wave != null ? ` (waves ${p.wave.toFixed(1)} m, wind ${Math.round(p.wind ?? 0)} km/h)` : ''} · Really: ${esc([tr.waves && `waves ${tr.waves}`, tr.wind && `wind ${tr.wind}`, tr.clarity && `water ${tr.clarity}`, tr.result && `fishing ${tr.result}`].filter(Boolean).join(', ') || '—')}</div>
      ${s || tr.count != null ? `<div class="small">🐟 ${esc(s?.name || '')}${tr.count != null ? ` × ${tr.count}` : ''}${tr.length ? ` · biggest ${tr.length} cm` : ''}${tr.kept ? ` · ${tr.kept}` : ''}</div>` : ''}
      ${tr.notes ? `<div class="small muted">${esc(tr.notes)}</div>` : ''}
      <button class="linklike small" data-del="${esc(tr.id)}">Delete</button></div></div>`;
  }).join('') : '<p class="small muted">No trips yet.</p>';
  list.onclick = async e => { const b = e.target.closest('[data-del]'); if (b && confirmDel(b)) { await deleteTrip(b.dataset.del); renderDiary(view); } };
}
// two-tap delete (no browser pop-ups)
function confirmDel(b) { if (b.dataset.sure) return true; b.dataset.sure = '1'; b.textContent = 'Tap again to delete'; return false; }
function alertish(view, msg) { const p = document.createElement('p'); p.className = 'notice info small'; p.textContent = msg; view.prepend(p); }

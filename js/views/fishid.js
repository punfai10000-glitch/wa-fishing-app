// Fish ID helper: photo stays on the device; the user answers 3 quick questions and the
// app shortlists likely species from the curated list. It does NOT claim an identification.
import { state } from '../app.js';
import { esc } from '../ui.js';

const answers = { shape: null, marks: null, feature: null };
let photoUrl = null;

export function rankSpecies(speciesList, a) {
  const asked = Object.entries(a).filter(([, v]) => v && v !== 'none');
  if (!asked.length) return [];
  return speciesList.map(s => {
    let hit = 0;
    for (const [q, v] of asked) if ((s.traits[q] || []).includes(v)) hit++;
    // shape is the strongest signal: a wrong shape rules a species out
    const shapeMiss = a.shape && !(s.traits.shape || []).includes(a.shape);
    return { s, pct: shapeMiss ? 0 : Math.round(hit / asked.length * 100) };
  }).filter(x => x.pct > 0).sort((x, y) => y.pct - x.pct).slice(0, 5);
}

export function renderFishId(view) {
  const { id_questions, species } = state.data.species;
  const results = rankSpecies(species, answers);
  view.innerHTML = `
  <div>
    <h1>Fish ID helper</h1>
    <p class="muted small">Take or choose a photo, then answer three quick questions to shortlist likely species. Your photo stays on your phone — it is never uploaded.</p>

    <div class="card photo-drop">
      ${photoUrl ? `<img src="${photoUrl}" alt="Your fish photo">` : '<div class="muted">No photo yet</div>'}
      <label class="btn primary" for="photo">📷 ${photoUrl ? 'Change photo' : 'Take or choose photo'}</label>
      <input id="photo" type="file" accept="image/*" capture="environment" hidden>
    </div>

    ${id_questions.map(q => `
      <div class="card">
        <h3>${esc(q.text)}</h3>
        <div class="chips" role="group" aria-label="${esc(q.text)}">
          ${q.options.map(o => `<button class="chip" data-q="${q.id}" data-v="${o.id}" aria-pressed="${answers[q.id] === o.id}">${esc(o.label)}</button>`).join('')}
        </div>
      </div>`).join('')}

    <div class="card" aria-live="polite">
      <h2>Possible matches</h2>
      ${results.length ? results.map(({ s, pct }) => `
        <div style="margin-bottom:14px">
          <div class="row"><strong>${esc(s.name)}</strong>${s.status === 'protected' ? ' <span class="pill poor">Protected</span>' : ''}<span class="spacer"></span><span class="small">${pct}% match</span></div>
          <div class="muted small"><i>${esc(s.scientific)}</i></div>
          <div class="match" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <p class="small" style="margin:6px 0">${esc(s.id_tips)}</p>
          <a class="small" href="#/fish/${esc(s.id)}">Limits &amp; photo for ${esc(s.name)} →</a>
        </div>`).join('') : '<p class="muted">Answer the questions above to see a shortlist.</p>'}
      ${results.length ? '<button class="btn ghost" id="reset">Start again</button>' : ''}
    </div>

    <div class="notice"><strong>This is a guide, not a confirmed ID.</strong> Only ${species.length} species are included so far, and some look very similar. Compare your fish carefully with the official DPIRD fish guides. If you're not sure what it is, or whether it's legal size, release it.</div>
    <p class="muted small">Automatic photo recognition is on the future list — no free, accurate model for WA species exists yet.</p>
  </div>`;

  view.querySelector('#photo').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(f);
    renderFishId(view);
  });
  view.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    answers[b.dataset.q] = answers[b.dataset.q] === b.dataset.v ? null : b.dataset.v;
    renderFishId(view);
  }));
  view.querySelector('#reset')?.addEventListener('click', () => {
    Object.keys(answers).forEach(k => { answers[k] = null; });
    renderFishId(view);
  });
}

// Measure a catch with the phone camera: photo with a bank card (or A4 sheet / ruler) lying next to the fish,
// drag two blue handles to the card's ends and two orange handles to the fish's nose and tail. The card's known
// size gives the scale. Works offline; the photo never leaves the phone.
import { state } from '../app.js';
import { esc } from '../ui.js';

const REFS = [
  { id: 'card', label: 'Bank card / driver licence — long side (85.6 mm)', mm: 85.6 },
  { id: 'a4', label: 'A4 paper — long side (297 mm)', mm: 297 },
  { id: 'note', label: 'Australian $5 note — long side (130 mm)', mm: 130 },
  { id: 'custom', label: 'Something else — I\'ll type its length', mm: null }
];
let img = null, pts = null, refId = 'card', customMm = 100, speciesId = '';

const minSizes = sp => (sp?.limits || []).map(l => ({ where: l.where, text: l.min_size, mm: parseFloat(String(l.min_size).match(/([\d.]+)\s*mm/)?.[1]), carapace: /carapace/i.test(l.min_size) }));

export function renderMeasure(view) {
  const sp = state.data.species.species.slice().sort((a, b) => a.name.localeCompare(b.name));
  view.innerHTML = `
    <div>
      <h1>📏 Measure your catch</h1>
      <ol class="steps small">
        <li><strong>Lay the fish flat</strong> with a bank card (or A4 sheet) right next to it, on the same surface.</li>
        <li><strong>Hold the phone straight above</strong> (not at an angle) and take the photo.</li>
        <li>Drag the <span style="color:#4cc3ff">blue</span> dots to the two ends of the card, and the <span style="color:#ffa53c">orange</span> dots to the tip of the nose and the end of the tail.</li>
      </ol>
      <label class="btn" style="display:inline-block">📷 Take or choose a photo<input id="m-file" type="file" accept="image/*" capture="environment" hidden></label>
      <div class="filters" style="margin-top:8px">
        <label class="small">Size reference <select id="m-ref">${REFS.map(r => `<option value="${r.id}" ${r.id === refId ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
        <label class="small" id="m-custom-wrap" ${refId === 'custom' ? '' : 'hidden'}>Its length (mm) <input id="m-custom" type="number" min="5" max="2000" value="${customMm}" style="width:90px"></label>
        <label class="small">Species <select id="m-sp"><option value="">— choose to check the legal size —</option>${sp.map(s => `<option value="${s.id}" ${s.id === speciesId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      </div>
      <div class="measure-wrap"><canvas id="m-cv" hidden></canvas><canvas id="m-loupe" class="loupe" width="120" height="120" hidden></canvas></div>
      <div id="m-out" class="card" ${img ? '' : 'hidden'}></div>
      <p class="small muted">Most WA fish are measured from the tip of the snout to the end of the tail (total length); crabs and lobster are measured across or along the shell — check the species rules. The photo method is accurate to about ±5% when the card is right next to the fish and the phone is straight above. <strong>If it's close to the limit, use a proper measuring ruler or let it go</strong> — fines apply for undersize fish. Your photo stays on your phone.</p>
    </div>`;
  const cv = view.querySelector('#m-cv'), loupe = view.querySelector('#m-loupe'), out = view.querySelector('#m-out');
  view.querySelector('#m-file').addEventListener('change', e => {
    const f = e.target.files?.[0]; if (!f) return;
    const im = new Image();
    im.onload = () => {
      img = im;
      const W = im.naturalWidth, H = im.naturalHeight;
      pts = { r1: [W * 0.2, H * 0.82], r2: [W * 0.42, H * 0.82], f1: [W * 0.12, H * 0.5], f2: [W * 0.88, H * 0.5] };
      draw();
    };
    im.src = URL.createObjectURL(f);
  });
  view.querySelector('#m-ref').addEventListener('change', e => { refId = e.target.value; view.querySelector('#m-custom-wrap').hidden = refId !== 'custom'; result(); });
  view.querySelector('#m-custom').addEventListener('input', e => { customMm = +e.target.value || 0; result(); });
  view.querySelector('#m-sp').addEventListener('change', e => { speciesId = e.target.value; result(); });

  let scale = 1;
  function draw() {
    if (!img) return;
    cv.hidden = false; out.hidden = false;
    const cssW = Math.min(view.clientWidth || 360, 900);
    scale = cssW / img.naturalWidth;
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = cssW + 'px'; cv.style.height = img.naturalHeight * scale + 'px';
    cv.width = cssW * dpr; cv.height = img.naturalHeight * scale * dpr;
    const c = cv.getContext('2d');
    c.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    c.drawImage(img, 0, 0);
    const lw = 3 / scale, r = 13 / scale;
    const seg = (a, b, col) => {
      c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(...pts[a]); c.lineTo(...pts[b]); c.stroke();
      for (const k of [a, b]) { c.fillStyle = col; c.globalAlpha = 0.35; c.beginPath(); c.arc(...pts[k], r, 0, 7); c.fill(); c.globalAlpha = 1; c.lineWidth = lw * 0.8; c.beginPath(); c.arc(...pts[k], r, 0, 7); c.stroke(); c.beginPath(); c.arc(...pts[k], 2 / scale, 0, 7); c.fill(); }
    };
    seg('r1', 'r2', '#4cc3ff'); seg('f1', 'f2', '#ffa53c');
    result();
  }
  function result() {
    if (!img || !pts) return;
    const ref = REFS.find(r => r.id === refId), refMm = ref.mm ?? customMm;
    const d = (a, b) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
    const refPx = d('r1', 'r2');
    if (!refPx || !refMm) { out.innerHTML = 'Move the blue dots onto the reference.'; return; }
    const mm = d('f1', 'f2') / refPx * refMm;
    const s = state.data.species.species.find(x => x.id === speciesId);
    const lims = minSizes(s);
    const verdictRows = lims.map(l => {
      if (!Number.isFinite(l.mm)) return `<li>${esc(l.where)}: ${esc(l.text)}</li>`;
      const margin = mm - l.mm;
      const tag = margin < -0.05 * l.mm ? '<b class="no">✗ Undersize — release it</b>' : margin < 0.05 * l.mm ? '<b class="care">⚠ Too close to call — measure with a ruler</b>' : '<b class="yes">✓ Over the minimum</b>';
      return `<li>${esc(l.where)}: min ${esc(l.text)} → ${tag}</li>`;
    }).join('');
    out.innerHTML = `<div style="font-size:1.6em;font-weight:800">${(mm / 10).toFixed(1)} cm</div>
      <div class="small muted">about ±${(mm * 0.05 / 10).toFixed(1)} cm · scale from: ${esc(ref.label.split(' —')[0])}</div>
      ${s ? `<div style="margin-top:6px"><strong>${esc(s.name)}</strong><ul class="small measure-lims">${verdictRows || '<li>No size limit listed.</li>'}</ul>
        ${lims.some(l => l.carapace) ? '<div class="small">This one is measured on the shell (carapace), not nose to tail — put the orange dots on the shell edges.</div>' : ''}
        <a class="small" href="#/fish">Bag limits and rules →</a></div>` : '<div class="small">Choose the species above to check the legal size.</div>'}`;
  }
  // drag handles (pointer events: touch + mouse), with a magnifier so you can see under your finger
  let drag = null;
  const toImg = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) / scale, (e.clientY - b.top) / scale]; };
  cv.addEventListener('pointerdown', e => {
    if (!pts) return;
    const p = toImg(e), hit = Object.entries(pts).map(([k, v]) => [k, Math.hypot(v[0] - p[0], v[1] - p[1])]).sort((a, b) => a[1] - b[1])[0];
    if (hit[1] * scale > 40) return;
    drag = hit[0]; cv.setPointerCapture(e.pointerId); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = toImg(e);
    pts[drag] = [Math.max(0, Math.min(img.naturalWidth, p[0])), Math.max(0, Math.min(img.naturalHeight, p[1]))];
    draw();
    const lc = loupe.getContext('2d'), z = 3, s = 120 / (z * scale);
    loupe.hidden = false;
    lc.clearRect(0, 0, 120, 120);
    lc.drawImage(img, pts[drag][0] - s / 2, pts[drag][1] - s / 2, s, s, 0, 0, 120, 120);
    lc.strokeStyle = drag.startsWith('r') ? '#4cc3ff' : '#ffa53c'; lc.lineWidth = 2;
    lc.beginPath(); lc.moveTo(60, 48); lc.lineTo(60, 72); lc.moveTo(48, 60); lc.lineTo(72, 60); lc.stroke();
    loupe.style.left = (e.clientX - cv.getBoundingClientRect().left < 160 ? cv.clientWidth - 130 : 10) + 'px';
  });
  const up = () => { drag = null; loupe.hidden = true; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  if (img) draw();
}

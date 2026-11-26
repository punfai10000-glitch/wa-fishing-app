// Draggable bottom sheet (mobile) / side panel (desktop ≥ 900 px).
// States: 'peek' (small summary), 'half' (essentials), 'full' (details). Drag the handle, tap it,
// or use the buttons. The browser Back button closes the sheet before leaving the map.
const H = { peek: 0.34, half: 0.58, full: 0.92 };   // fraction of the map area height
let el, body, handle, current = null, onCloseCb = null, onStateCb = null, pushed = false;

export function initSheet() {
  el = document.getElementById('sheet');
  if (!el) {   // old cached page without the sheet markup: build it so the app still starts
    el = document.createElement('section');
    el.id = 'sheet'; el.className = 'sheet'; el.hidden = true; el.dataset.state = 'closed';
    el.innerHTML = '<div class="sheet-head"><button class="sheet-handle" aria-label="Resize"><span></span></button><div class="sheet-bar"><strong class="sheet-title"></strong><span class="spacer"></span><button class="sheet-grow ctl-sm" aria-label="Show more">⌃</button><button class="sheet-close ctl-sm" aria-label="Close">✕</button></div></div><div class="sheet-body"></div>';
    (document.getElementById('map-wrap') || document.body).appendChild(el);
  }
  body = el.querySelector('.sheet-body');
  handle = el.querySelector('.sheet-handle');
  el.querySelector('.sheet-close').addEventListener('click', () => closeSheet());
  el.querySelector('.sheet-grow').addEventListener('click', () => setState(current === 'full' ? 'half' : current === 'half' ? 'full' : 'half'));
  handle.addEventListener('click', e => { if (!dragMoved) setState(current === 'peek' ? 'half' : current === 'half' ? 'full' : 'peek'); });
  handle.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { setState(current === 'peek' ? 'half' : 'full'); e.preventDefault(); }
    if (e.key === 'ArrowDown') { setState(current === 'full' ? 'half' : 'peek'); e.preventDefault(); }
    if (e.key === 'Escape') closeSheet();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) closeSheet(); });
  // drag (pointer events cover touch + mouse); only the handle/header starts a drag, so scrolling the
  // body never moves the sheet or the map
  let startY = 0, startH = 0, dragMoved = false, dragging = false;
  const area = () => el.parentElement.getBoundingClientRect().height;
  el.querySelector('.sheet-head').addEventListener('pointerdown', e => {
    if (e.target.closest('button:not(.sheet-handle), a, input, select')) return;
    dragging = true; dragMoved = false; startY = e.clientY; startH = el.getBoundingClientRect().height;
    el.classList.add('dragging'); e.currentTarget.setPointerCapture(e.pointerId);
  });
  el.querySelector('.sheet-head').addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 6) dragMoved = true;
    el.style.height = Math.max(60, Math.min(area() * H.full, startH + dy)) + 'px';
  });
  const end = e => {
    if (!dragging) return;
    dragging = false; el.classList.remove('dragging');
    const frac = el.getBoundingClientRect().height / area();
    el.style.height = '';
    if (!dragMoved) return;
    if (frac < H.peek * 0.6) return closeSheet();
    setState(frac < (H.peek + H.half) / 2 ? 'peek' : frac < (H.half + H.full) / 2 ? 'half' : 'full');
  };
  el.querySelector('.sheet-head').addEventListener('pointerup', end);
  el.querySelector('.sheet-head').addEventListener('pointercancel', end);
  window.addEventListener('popstate', () => { if (current && pushed) { pushed = false; closeSheet(true); } });
}

export function openSheet(html, { state = 'peek', title = '', onClose = null, onState = null } = {}) {
  if (current && onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }   // replacing another sheet
  onCloseCb = onClose; onStateCb = onState;
  el.querySelector('.sheet-title').textContent = title;
  body.innerHTML = html;
  body.scrollTop = 0;
  el.hidden = false;
  if (!pushed) { history.pushState({ sheet: 1 }, ''); pushed = true; }
  requestAnimationFrame(() => setState(state));
  return body;
}

export function setState(s) {
  if (!el || el.hidden) return;
  current = s;
  el.dataset.state = s;
  el.querySelector('.sheet-grow').setAttribute('aria-label', s === 'full' ? 'Show less' : 'Show more');
  el.querySelector('.sheet-grow').textContent = s === 'full' ? '⌄' : '⌃';
  handle.setAttribute('aria-valuenow', String(Math.round(H[s] * 100)));
  onStateCb?.(s, body);
}

export function closeSheet(fromHistory = false) {
  if (!el || el.hidden) return;
  el.hidden = true; el.dataset.state = 'closed'; current = null;
  if (pushed && !fromHistory) { pushed = false; history.back(); }
  const cb = onCloseCb; onCloseCb = null; onStateCb = null;
  cb?.();
}

export const sheetState = () => current;
export const sheetBody = () => body;

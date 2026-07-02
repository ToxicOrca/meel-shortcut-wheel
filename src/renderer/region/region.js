// Region selector renderer. Drag a rectangle; report it (CSS px == DIP local to
// this window) back to main, which converts to physical px for cropping.

'use strict';

const dim = document.getElementById('dim');
const sel = document.getElementById('sel');

let dragging = false;
let start = { x: 0, y: 0 };

window.meelRegion.ready();

// When the window is (re)shown, reset any prior selection.
window.meelRegion.onShow(() => {
  dragging = false;
  sel.hidden = true;
});

function rectFrom(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  return { x, y, width, height };
}

function draw(r) {
  sel.hidden = false;
  sel.style.left = r.x + 'px';
  sel.style.top = r.y + 'px';
  sel.style.width = r.width + 'px';
  sel.style.height = r.height + 'px';
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  start = { x: e.clientX, y: e.clientY };
  draw({ x: start.x, y: start.y, width: 0, height: 0 });
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  draw(rectFrom(start, { x: e.clientX, y: e.clientY }));
});

window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  const r = rectFrom(start, { x: e.clientX, y: e.clientY });
  window.meelRegion.done(r);
});

// Escape (or right-click) cancels.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.meelRegion.done(null);
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.meelRegion.done(null);
});

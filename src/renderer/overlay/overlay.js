// Overlay renderer. Draws the radial wheel as SVG and reports which slice the
// cursor is over back to the main process.
//
// Geometry:
//   - The wheel is centered at `center` (window-local px), which is where the
//     cursor was when the trigger fired.
//   - N slices are laid out evenly around the ring. Slice 0 starts at the top
//     (12 o'clock) and they go clockwise.
//   - Selection is by ANGLE: we take the vector from center to the cursor, and
//     if its length exceeds a small dead-zone, we pick the slice whose angular
//     wedge contains that vector. Inside the dead-zone => no selection (lets
//     the user cancel by releasing near the center).

'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

let state = {
  center: { x: 200, y: 200 },
  slices: [],
  appearance: null,
  selectedId: null,
  radius: 150,
  inner: 55
};

const svg = document.getElementById('wheel');

window.meelOverlay.ready();

window.meelOverlay.onShow((data) => {
  state.center = data.center;
  state.slices = data.slices || [];
  state.appearance = data.appearance || {};
  state.radius = state.appearance.wheelRadius || 150;
  state.inner = state.appearance.innerRadius || 55;
  state.selectedId = null;
  render();
});

window.meelOverlay.onHide(() => {
  clearSvg();
  state.selectedId = null;
});

window.meelOverlay.onCursor((pt) => {
  updateSelection(pt);
});

function clearSvg() {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

// ---- Rendering --------------------------------------------------------------

function render() {
  clearSvg();
  const { center, slices, appearance } = state;
  const t = appearance.theme || {};
  const n = slices.length;
  if (!n) return;

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'wheel-group');
  group.style.setProperty('--anim', (appearance.animationMs || 120) + 'ms');
  // Animate from the wheel's own center.
  group.style.transformOrigin = `${center.x}px ${center.y}px`;
  svg.appendChild(group);

  const gap = ((appearance.sliceGapDeg || 0) * Math.PI) / 180;
  const seg = (2 * Math.PI) / n;

  slices.forEach((slice, i) => {
    // Each slice spans [start, end], centered so slice 0 points up.
    const mid = -Math.PI / 2 + i * seg;      // -90deg = top
    const start = mid - seg / 2 + gap / 2;
    const end = mid + seg / 2 - gap / 2;

    const path = wedgePath(center, state.inner, state.radius, start, end);
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', path);
    p.setAttribute('data-id', slice.id);
    p.setAttribute('fill', slice.color || t.slice || '#1e222c');
    p.setAttribute('stroke', t.border || '#2a2f3a');
    p.setAttribute('stroke-width', '1');
    p.style.transition = 'fill 90ms ease';
    group.appendChild(p);

    // Icon + label positioned at the middle of the wedge.
    const lr = (state.inner + state.radius) / 2;
    const lx = center.x + Math.cos(mid) * lr;
    const ly = center.y + Math.sin(mid) * lr;

    if (slice.iconImage) {
      // Render imported program icon as an image
      const imgSize = 28;
      const img = document.createElementNS(SVG_NS, 'image');
      img.setAttribute('href', slice.iconImage);
      img.setAttribute('x', lx - imgSize / 2);
      img.setAttribute('y', ly - imgSize / 2 - (appearance.showLabels !== false && slice.label ? 8 : 0));
      img.setAttribute('width', imgSize);
      img.setAttribute('height', imgSize);
      img.setAttribute('class', 'slice-label');
      group.appendChild(img);

      if (appearance.showLabels !== false && slice.label) {
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', lx);
        label.setAttribute('y', ly + imgSize / 2 + 2);
        label.setAttribute('class', 'slice-label');
        label.setAttribute('font-size', '12');
        label.setAttribute('font-family', appearance.fontFamily || 'Segoe UI, sans-serif');
        label.setAttribute('fill', t.text || '#e6e9f0');
        label.textContent = slice.label;
        group.appendChild(label);
      }
    } else if (slice.icon) {
      const icon = document.createElementNS(SVG_NS, 'text');
      icon.setAttribute('x', lx);
      icon.setAttribute('y', ly - (appearance.showLabels ? 8 : 0));
      icon.setAttribute('class', 'slice-label');
      icon.setAttribute('font-size', '22');
      icon.setAttribute('fill', t.text || '#e6e9f0');
      icon.textContent = slice.icon;
      group.appendChild(icon);

      if (appearance.showLabels !== false && slice.label) {
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', lx);
        label.setAttribute('y', ly + 14);
        label.setAttribute('class', 'slice-label');
        label.setAttribute('font-size', '12');
        label.setAttribute('font-family', appearance.fontFamily || 'Segoe UI, sans-serif');
        label.setAttribute('fill', t.text || '#e6e9f0');
        label.textContent = slice.label;
        group.appendChild(label);
      }
    } else if (appearance.showLabels !== false && slice.label) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', lx);
      label.setAttribute('y', ly);
      label.setAttribute('class', 'slice-label');
      label.setAttribute('font-size', '12');
      label.setAttribute('font-family', appearance.fontFamily || 'Segoe UI, sans-serif');
      label.setAttribute('fill', t.text || '#e6e9f0');
      label.textContent = slice.label;
      group.appendChild(label);
    }
  });

  // Center dot / dead-zone indicator.
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', center.x);
  dot.setAttribute('cy', center.y);
  dot.setAttribute('r', '6');
  dot.setAttribute('fill', t.centerDot || '#2b64f5');
  group.appendChild(dot);
}

// Build an SVG path for an annular wedge (donut segment).
function wedgePath(c, r0, r1, a0, a1) {
  const p = (r, a) => [c.x + Math.cos(a) * r, c.y + Math.sin(a) * r];
  const [x0o, y0o] = p(r1, a0);
  const [x1o, y1o] = p(r1, a1);
  const [x1i, y1i] = p(r0, a1);
  const [x0i, y0i] = p(r0, a0);
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  return [
    `M ${x0o} ${y0o}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1o} ${y1o}`,
    `L ${x1i} ${y1i}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x0i} ${y0i}`,
    'Z'
  ].join(' ');
}

// ---- Selection by cursor angle ---------------------------------------------

function updateSelection(pt) {
  const { center, slices } = state;
  const n = slices.length;
  if (!n) return;

  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  const dist = Math.hypot(dx, dy);

  let selectedId = null;
  // Dead-zone: inside inner radius (minus a little) => no selection.
  if (dist >= state.inner * 0.6) {
    let ang = Math.atan2(dy, dx);        // -PI..PI, 0 = right, -PI/2 = up
    // Shift so slice 0 (which points up at -PI/2) maps to index 0.
    let rel = ang - (-Math.PI / 2) + Math.PI / n; // add half-segment
    rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const idx = Math.floor(rel / ((2 * Math.PI) / n)) % n;
    selectedId = slices[idx].id;
  }

  if (selectedId !== state.selectedId) {
    state.selectedId = selectedId;
    highlight(selectedId);
    window.meelOverlay.select(selectedId);
  }
}

function highlight(id) {
  const t = (state.appearance && state.appearance.theme) || {};
  const paths = svg.querySelectorAll('path[data-id]');
  paths.forEach((p) => {
    const isSel = p.getAttribute('data-id') === id;
    const base = state.slices.find((s) => s.id === p.getAttribute('data-id'));
    p.setAttribute('fill', isSel ? (t.sliceHover || '#2b64f5') : ((base && base.color) || t.slice || '#1e222c'));
    // Clear visual emphasis: selected slice gets a bright accent outline and a
    // brightness pop via CSS class (fill stays inline so no conflict).
    if (isSel) p.classList.add('selected');
    else p.classList.remove('selected');
  });
  // Pulse the center dot when something is selected vs. in the cancel zone.
  const dot = svg.querySelector('circle');
  if (dot) dot.setAttribute('fill', id ? (t.sliceHover || '#2b64f5') : (t.centerDot || '#2b64f5'));
}

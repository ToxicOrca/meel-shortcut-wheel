// Overlay renderer. Draws the radial wheel as SVG and reports which slice the
// cursor is over back to the main process.
//
// Geometry:
//   - The wheel is centered at `center` (window-local px), which is where the
//     cursor was when the trigger fired.
//   - N slices are laid out evenly around the ring. Slice 0 starts at the top
//     (12 o'clock) and they go clockwise.
//   - Selection is by ANGLE + DISTANCE: angle determines the slice, distance
//     determines the ring level (main wheel vs sub-rings).
//   - SubWheel slices show a collapsed thin ring outside their parent wedge.
//     Moving the cursor to the collapsed ring expands it to show sub-slices.

'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

let state = {
  center: { x: 200, y: 200 },
  slices: [],
  appearance: null,
  selectedSlice: null, // { id, action } of the leaf slice under cursor, or null
  radius: 150,
  inner: 55,
  expandedParents: new Set(),
  // Flat registry of all rendered rings for hit-testing
  hitZones: [],
  subRings: new Map(), // parentId -> { collapsedG, expandedG }
  collapseTimers: new Map() // parentId -> timer
};

const svg = document.getElementById('wheel');

window.meelOverlay.ready();

window.meelOverlay.onShow((data) => {
  state.center = data.center;
  state.slices = data.slices || [];
  state.appearance = data.appearance || {};
  state.radius = state.appearance.wheelRadius || 150;
  state.inner = state.appearance.innerRadius || 55;
  state.selectedSlice = null;
  state.hitZones = [];
  state.expandedParents.clear();
  state.subRings.clear();
  state.collapseTimers.forEach((t) => clearTimeout(t));
  state.collapseTimers.clear();
  render();
});

window.meelOverlay.onHide(() => {
  clearSvg();
  state.selectedSlice = null;
  state.hitZones = [];
  state.expandedParents.clear();
  state.subRings.clear();
  state.collapseTimers.forEach((t) => clearTimeout(t));
  state.collapseTimers.clear();
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
  state.hitZones = [];
  const { center, slices, appearance } = state;
  const t = appearance.theme || {};
  const n = slices.length;
  if (!n) return;

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'wheel-group');
  group.style.transformOrigin = `${center.x}px ${center.y}px`;
  svg.appendChild(group);

  // Open animation via Web Animations API (one-shot, never re-triggers).
  const animMs = appearance.animationMs || 120;
  if (animMs > 0) {
    group.animate(
      [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: animMs, easing: 'ease-out', fill: 'forwards' }
    );
  }

  const gap = ((appearance.sliceGapDeg || 0) * Math.PI) / 180;
  const seg = (2 * Math.PI) / n;
  const startOffset = -Math.PI / 2; // slice 0 at 12 o'clock

  renderRing(group, slices, state.inner, state.radius, startOffset - seg / 2, startOffset + (2 * Math.PI) - seg / 2, gap, 0, state.radius - state.inner);

  // Center dot / dead-zone indicator.
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', center.x);
  dot.setAttribute('cy', center.y);
  dot.setAttribute('r', '6');
  dot.setAttribute('fill', t.centerDot || '#2b64f5');
  group.appendChild(dot);

}

// Render a ring of slices between innerR..outerR, spanning startAngle..endAngle.
// parentWidth is the ring width of the parent level (used to scale sub-rings).
function renderRing(group, slices, innerR, outerR, startAngle, endAngle, gap, depth, parentWidth) {
  const { center, appearance } = state;
  const t = appearance.theme || {};
  const n = slices.length;
  if (!n) return;

  const totalAngle = endAngle - startAngle;
  const seg = totalAngle / n;
  const subGap = appearance.subWheelGap || 4;
  const collapsedWidth = appearance.subWheelCollapsedWidth || 8;

  slices.forEach((slice, i) => {
    const mid = startAngle + (i + 0.5) * seg;
    const sStart = startAngle + i * seg + gap / 2;
    const sEnd = startAngle + (i + 1) * seg - gap / 2;

    // Draw the wedge
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', wedgePath(center, innerR, outerR, sStart, sEnd));
    p.setAttribute('data-id', slice.id);
    p.setAttribute('data-depth', depth);
    p.setAttribute('fill', slice.color || t.slice || '#1e222c');
    p.setAttribute('stroke', t.border || '#2a2f3a');
    p.setAttribute('stroke-width', '1');
    p.style.transition = 'fill 90ms ease';
    group.appendChild(p);

    // Register hit zone for this slice
    state.hitZones.push({ innerR, outerR, startAngle: sStart, endAngle: sEnd, slice, depth });

    // Icon + label
    renderSliceContent(group, slice, center, innerR, outerR, mid, sStart, sEnd, appearance, t, depth);

    // SubWheel: pre-render both collapsed indicator and expanded ring.
    if (slice.action && slice.action.type === 'SubWheel' && Array.isArray(slice.action.slices) && slice.action.slices.length > 0) {
      const subInner = outerR + subGap;

      // Collapsed: thin arc indicator
      const collapsedG = document.createElementNS(SVG_NS, 'g');
      const subOuterC = subInner + collapsedWidth;
      const colP = document.createElementNS(SVG_NS, 'path');
      colP.setAttribute('d', wedgePath(center, subInner, subOuterC, sStart, sEnd));
      colP.setAttribute('fill', t.sliceHover || '#2b64f5');
      colP.setAttribute('opacity', '0.4');
      colP.setAttribute('stroke', 'none');
      collapsedG.appendChild(colP);
      const dotCount = Math.min(slice.action.slices.length, 5);
      const dotR = (subInner + subOuterC) / 2;
      for (let d = 0; d < dotCount; d++) {
        const dotAng = sStart + ((d + 0.5) / dotCount) * (sEnd - sStart);
        const dd = document.createElementNS(SVG_NS, 'circle');
        dd.setAttribute('cx', center.x + Math.cos(dotAng) * dotR);
        dd.setAttribute('cy', center.y + Math.sin(dotAng) * dotR);
        dd.setAttribute('r', '1.5');
        dd.setAttribute('fill', t.text || '#e6e9f0');
        dd.setAttribute('opacity', '0.6');
        collapsedG.appendChild(dd);
      }
      group.appendChild(collapsedG);

      // Expanded: full sub-ring with labels (hidden initially)
      const expandedG = document.createElementNS(SVG_NS, 'g');
      expandedG.setAttribute('opacity', '0');
      const expandedWidth = Math.max(30, parentWidth * 0.55);
      const subOuterE = subInner + expandedWidth;
      renderRing(expandedG, slice.action.slices, subInner, subOuterE, sStart, sEnd, gap * 0.8, depth + 1, expandedWidth);
      group.appendChild(expandedG);

      // Hit zone for collapsed ring (expansion trigger)
      state.hitZones.push({ innerR: subInner, outerR: subOuterC, startAngle: sStart, endAngle: sEnd, slice, depth, isCollapsedRing: true });
      // Hit zone for expanded area (keep-alive) — extends into parent slice
      // outer half so cursor can travel between parent and sub-ring
      const keepAliveInner = innerR + (outerR - innerR) * 0.5;
      state.hitZones.push({ innerR: keepAliveInner, outerR: subOuterE + 6, startAngle: sStart, endAngle: sEnd, slice, depth, isExpandedArea: true });
      // Tag expanded sub-slice hit zones
      for (const hz of state.hitZones) {
        if (!hz.expandedParent && !hz.isCollapsedRing && !hz.isExpandedArea && hz.depth === depth + 1) {
          hz.expandedParent = slice.id;
        }
      }

      state.subRings.set(slice.id, { collapsedG, expandedG });
    }
  });
}

// Render icon/label content for a slice
function renderSliceContent(group, slice, center, innerR, outerR, mid, sStart, sEnd, appearance, t, depth) {
  const lr = (innerR + outerR) / 2;
  const lx = center.x + Math.cos(mid) * lr;
  const ly = center.y + Math.sin(mid) * lr;

  // Scale font size for sub-rings
  const fontScale = depth === 0 ? 1 : Math.max(0.6, 1 - depth * 0.2);
  const iconSize = Math.round(22 * fontScale);
  const labelSize = Math.round(12 * fontScale);
  const imgSize = Math.round(28 * fontScale);

  // Check if this wedge is too narrow for content
  const arcLength = (sEnd - sStart) * lr;
  if (arcLength < 12) return; // too narrow to show anything

  if (slice.iconImage) {
    const img = document.createElementNS(SVG_NS, 'image');
    img.setAttribute('href', slice.iconImage);
    img.setAttribute('x', lx - imgSize / 2);
    img.setAttribute('y', ly - imgSize / 2 - (appearance.showLabels !== false && slice.label ? 8 * fontScale : 0));
    img.setAttribute('width', imgSize);
    img.setAttribute('height', imgSize);
    img.setAttribute('class', 'slice-label');
    group.appendChild(img);

    if (appearance.showLabels !== false && slice.label) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', lx);
      label.setAttribute('y', ly + imgSize / 2 + 2);
      label.setAttribute('class', 'slice-label');
      label.setAttribute('font-size', labelSize);
      label.setAttribute('font-family', appearance.fontFamily || 'Segoe UI, sans-serif');
      label.setAttribute('fill', t.text || '#e6e9f0');
      label.textContent = slice.label;
      group.appendChild(label);
    }
  } else if (slice.icon) {
    const icon = document.createElementNS(SVG_NS, 'text');
    icon.setAttribute('x', lx);
    icon.setAttribute('y', ly - (appearance.showLabels ? 8 * fontScale : 0));
    icon.setAttribute('class', 'slice-label');
    icon.setAttribute('font-size', iconSize);
    icon.setAttribute('fill', t.text || '#e6e9f0');
    icon.textContent = slice.icon;
    group.appendChild(icon);

    if (appearance.showLabels !== false && slice.label) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', lx);
      label.setAttribute('y', ly + 14 * fontScale);
      label.setAttribute('class', 'slice-label');
      label.setAttribute('font-size', labelSize);
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
    label.setAttribute('font-size', labelSize);
    label.setAttribute('font-family', appearance.fontFamily || 'Segoe UI, sans-serif');
    label.setAttribute('fill', t.text || '#e6e9f0');
    label.textContent = slice.label;
    group.appendChild(label);
  }

  // SubWheel indicator chevron on parent slice
  if (slice.action && slice.action.type === 'SubWheel' && slice.action.slices && slice.action.slices.length > 0) {
    const chevR = outerR - 8;
    const cx = center.x + Math.cos(mid) * chevR;
    const cy = center.y + Math.sin(mid) * chevR;
    const chev = document.createElementNS(SVG_NS, 'text');
    chev.setAttribute('x', cx);
    chev.setAttribute('y', cy);
    chev.setAttribute('class', 'slice-label');
    chev.setAttribute('font-size', '10');
    chev.setAttribute('fill', t.textDim || '#8b93a7');
    chev.textContent = '›';
    group.appendChild(chev);
  }
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

// ---- Selection by cursor angle + distance -----------------------------------

// Normalize angle to [0, 2π)
function normAngle(a) {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// Check if angle a is between a0 and a1 (handling wrap-around)
function angleInRange(a, a0, a1) {
  const na = normAngle(a);
  const n0 = normAngle(a0);
  const n1 = normAngle(a1);
  if (n0 <= n1) return na >= n0 && na <= n1;
  return na >= n0 || na <= n1; // wraps around 0
}

function updateSelection(pt) {
  const { center } = state;
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  const dist = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);

  // Dead-zone: inside inner radius => no selection
  if (dist < state.inner * 0.6) {
    setSelected(null);
    highlightSlice(null);
    return;
  }

  // Find which zone the cursor is over
  let hit = null;
  let onCollapsed = null;
  let onExpandedArea = false;

  for (let i = state.hitZones.length - 1; i >= 0; i--) {
    const zone = state.hitZones[i];
    if (dist < zone.innerR || dist > zone.outerR) continue;
    if (!angleInRange(ang, zone.startAngle, zone.endAngle)) continue;

    // Skip expanded sub-slice zones when their parent is collapsed
    if (zone.expandedParent && !state.expandedParents.has(zone.expandedParent)) continue;

    if (zone.isCollapsedRing && !state.expandedParents.has(zone.slice.id)) {
      onCollapsed = zone;
      continue;
    }
    if (zone.isExpandedArea && state.expandedParents.has(zone.slice.id)) {
      onExpandedArea = true;
      continue;
    }
    if (zone.isCollapsedRing || zone.isExpandedArea) continue;
    hit = zone;
    break;
  }

  // Expand collapsed ring when cursor enters it
  if (onCollapsed && !hit) {
    const pid = onCollapsed.slice.id;
    if (!state.expandedParents.has(pid)) {
      // Cancel any pending collapse for this parent
      if (state.collapseTimers.has(pid)) { clearTimeout(state.collapseTimers.get(pid)); state.collapseTimers.delete(pid); }
      state.expandedParents.add(pid);
      const sr = state.subRings.get(pid);
      if (sr) { sr.collapsedG.setAttribute('opacity', '0'); sr.expandedG.setAttribute('opacity', '1'); }
    }
  }

  // Determine which expanded parents to keep open
  const keepExpanded = new Set();
  // If cursor is on a sub-slice, keep its parent expanded
  if (hit && hit.expandedParent) {
    keepExpanded.add(hit.expandedParent);
  }
  // If cursor is on a SubWheel parent slice, keep it expanded
  if (hit && hit.slice.action && hit.slice.action.type === 'SubWheel') {
    keepExpanded.add(hit.slice.id);
  }
  // If cursor is in the expanded area zone
  if (onExpandedArea) {
    for (const zone of state.hitZones) {
      if (zone.isExpandedArea && dist >= zone.innerR && dist <= zone.outerR && angleInRange(ang, zone.startAngle, zone.endAngle)) {
        keepExpanded.add(zone.slice.id);
      }
    }
  }

  for (const pid of state.expandedParents) {
    if (!keepExpanded.has(pid)) {
      // Schedule collapse for this specific parent (if not already scheduled)
      if (!state.collapseTimers.has(pid)) {
        state.collapseTimers.set(pid, setTimeout(() => {
          state.collapseTimers.delete(pid);
          state.expandedParents.delete(pid);
          const sr = state.subRings.get(pid);
          if (sr) { sr.collapsedG.setAttribute('opacity', '1'); sr.expandedG.setAttribute('opacity', '0'); }
        }, 120));
      }
    } else {
      // Cancel pending collapse — cursor is still in range
      if (state.collapseTimers.has(pid)) { clearTimeout(state.collapseTimers.get(pid)); state.collapseTimers.delete(pid); }
    }
  }

  // Set selection
  if (hit) {
    if (hit.slice.action && hit.slice.action.type === 'SubWheel') {
      // SubWheel parent wedge: select primaryAction if one is configured
      if (hit.slice.action.primaryAction) {
        setSelected({ id: hit.slice.id, action: hit.slice.action.primaryAction });
      } else {
        setSelected(null);
      }
    } else {
      setSelected({ id: hit.slice.id, action: hit.slice.action });
    }
    highlightSlice(hit.slice.id);
  } else {
    setSelected(null);
    highlightSlice(null);
  }
}

function setSelected(sliceData) {
  const prevId = state.selectedSlice ? state.selectedSlice.id : null;
  const newId = sliceData ? sliceData.id : null;
  if (prevId !== newId) {
    state.selectedSlice = sliceData;
    window.meelOverlay.select(sliceData);
  }
}

// Find a slice by ID in the nested tree (for highlight color lookup)
function findSliceById(slices, id) {
  for (const s of slices) {
    if (s.id === id) return s;
    if (s.action && s.action.type === 'SubWheel' && Array.isArray(s.action.slices)) {
      const found = findSliceById(s.action.slices, id);
      if (found) return found;
    }
  }
  return null;
}

function highlightSlice(id) {
  const t = (state.appearance && state.appearance.theme) || {};
  const paths = svg.querySelectorAll('path[data-id]');
  paths.forEach((p) => {
    const pid = p.getAttribute('data-id');
    const isSel = pid === id;
    const base = findSliceById(state.slices, pid);
    p.setAttribute('fill', isSel ? (t.sliceHover || '#2b64f5') : ((base && base.color) || t.slice || '#1e222c'));
    if (isSel) p.classList.add('selected');
    else p.classList.remove('selected');
  });
  const dot = svg.querySelector('circle');
  if (dot) dot.setAttribute('fill', id ? (t.sliceHover || '#2b64f5') : (t.centerDot || '#2b64f5'));
}

// Overlay window manager. Owns the transparent, borderless, always-on-top,
// click-through window that renders the radial wheel.
//
// Design notes:
// - The window is created ONCE and hidden between activations (cheaper than
//   create/destroy each press, and avoids a white flash).
// - It is click-through (setIgnoreMouseEvents) because the real mouse events
//   are handled by the global hook, not by the window. The window is purely a
//   visual overlay drawn on top of everything.
// - We size/position it to cover the display under the cursor so the wheel can
//   be centered exactly at the cursor point.

'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { IPC } = require('../shared/constants');

class OverlayManager {
  constructor() {
    this.win = null;
    this.visible = false;
    this._ready = false;
  }

  create() {
    if (this.win) return this.win;

    this.win = new BrowserWindow({
      width: 400,
      height: 400,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,          // never steal focus from the user's work
      hasShadow: false,
      // Dark background is irrelevant because transparent:true, but set it so
      // there is never a white paint before first render.
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        v8CacheOptions: 'none'
      }
    });

    // Float above fullscreen apps and other topmost windows.
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Click-through: the overlay never intercepts clicks.
    this.win.setIgnoreMouseEvents(true, { forward: true });

    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));

    this.win.webContents.on('did-finish-load', () => {
      this._ready = true;
    });

    return this.win;
  }

  isReady() {
    return this._ready;
  }

  // Show the wheel centered at screen coordinates {x, y}. slices/appearance
  // come from the current config.
  show(center, slices, appearance) {
    if (!this.win) this.create();

    // Cover the display that contains the cursor so we can position the wheel
    // anywhere on it.
    const display = screen.getDisplayNearestPoint(center);
    const b = display.bounds;
    this.win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });

    // Convert absolute screen center into window-local coordinates for the
    // renderer.
    const local = { x: center.x - b.x, y: center.y - b.y };

    const payload = { center: local, slices, appearance };
    const send = () => this.win.webContents.send(IPC.OVERLAY_SHOW, payload);

    if (this._ready) send();
    else this.win.webContents.once('did-finish-load', send);

    this.win.showInactive(); // show without taking focus
    this.visible = true;
  }

  // Update the cursor position (screen coords) so the renderer can highlight
  // the slice under the pointer. We translate to window-local coords.
  updateCursor(point) {
    if (!this.visible || !this.win) return;
    const b = this.win.getBounds();
    this.win.webContents.send(IPC.OVERLAY_CURSOR, { x: point.x - b.x, y: point.y - b.y });
  }

  hide() {
    if (!this.win || !this.visible) return;
    this.win.webContents.send(IPC.OVERLAY_HIDE);
    this.win.hide();
    this.visible = false;
  }

  destroy() {
    if (this.win) {
      this.win.destroy();
      this.win = null;
      this.visible = false;
      this._ready = false;
    }
  }
}

module.exports = { OverlayManager };

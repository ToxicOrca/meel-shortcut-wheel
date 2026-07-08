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
// - Always-on-top is RE-ASSERTED on every show() (see show() below), not just
//   at creation, because Windows can drop the effective topmost state.
//
// KNOWN LIMITATION: over a true fullscreen-EXCLUSIVE app (common in some games,
// which take exclusive ownership of the display via DirectX), Windows may not
// let ANY window — including a 'screen-saver'-level topmost one — draw on top.
// That case is unavoidable from Electron. Everything else (normal windows,
// maximized windows, borderless-fullscreen apps, and the taskbar) is covered by
// the 'screen-saver' level + re-assert + moveTop().

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
  //
  // Z-ORDER: the creation-time `alwaysOnTop` flag is NOT enough — Windows can
  // demote our window when other apps assert themselves as topmost, which is
  // why the wheel would "occasionally" open behind another window. The fix is
  // to RE-ASSERT the highest topmost level on every open and force the window
  // to the top of the z-order after it is shown. The strict order is:
  //   1) position/size at the cursor  (before showing, so it never flashes at a
  //      stale spot or gets raised before it's placed)
  //   2) setAlwaysOnTop(true, 'screen-saver')  (re-assert the highest level;
  //      'screen-saver' sits above normal topmost windows and the taskbar)
  //   3) showInactive()  (visible without stealing focus — input is captured by
  //      the global hook, not by this window, so it must never take focus)
  //   4) moveTop()  (explicitly raise to the front of the z-order)
  show(center, slices, appearance) {
    if (!this.win) this.create();

    // (1) Cover the display that contains the cursor and position FIRST, so the
    // window is never shown/raised before it's placed.
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

    // (2) Re-assert the highest always-on-top level on EVERY open. A previous
    // hide, or another app grabbing topmost, can drop the effective topmost
    // state; re-setting it here is the core of the reliability fix.
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // (3) Show without taking focus.
    this.win.showInactive();

    // (4) Force to the very top of the z-order, after it's visible.
    this.win.moveTop();

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

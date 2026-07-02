// Region selector. A transparent, fullscreen, *focusable* (not click-through)
// window that dims the display under the cursor and lets the user drag a
// rectangle. Used by the Screenshot action's "region" mode.
//
// selectRegion() resolves with:
//   { display, rect }  where `rect` is {x,y,width,height} in DIP coordinates
//                      LOCAL to `display` (0,0 = the display's top-left), and
//                      `display` is the Electron Display object (so the caller
//                      can use display.scaleFactor to convert to physical px).
// or null if the user pressed Escape / made a zero-size selection.
//
// Unlike the wheel overlay this window must receive mouse events, so it is NOT
// click-through and it takes focus while active.

'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { IPC } = require('../shared/constants');

class RegionManager {
  constructor() {
    this.win = null;
    this._resolve = null;
    this._display = null;
  }

  _create() {
    this.win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'region-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'region', 'region.html'));
    this.win.on('closed', () => { this.win = null; });
    // Safety: if the window loses focus (user alt-tabs), cancel the selection.
    this.win.on('blur', () => this._finish(null));
  }

  // Called by main once, to route the renderer's result here.
  handleDone(rect) {
    this._finish(rect);
  }

  _finish(rect) {
    const resolve = this._resolve;
    const display = this._display;
    this._resolve = null;
    this._display = null;
    if (this.win) { this.win.hide(); }
    if (resolve) {
      if (rect && rect.width > 2 && rect.height > 2) resolve({ display, rect });
      else resolve(null);
    }
  }

  // Show the selector on the display under the cursor and resolve with the
  // chosen region (or null).
  selectRegion() {
    // Only one selection at a time.
    if (this._resolve) return Promise.resolve(null);

    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    this._display = display;

    if (!this.win) this._create();

    const b = display.bounds; // DIP
    this.win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });

    return new Promise((resolve) => {
      this._resolve = resolve;
      const send = () => this.win.webContents.send(IPC.REGION_SHOW);
      if (this.win.webContents.isLoading()) {
        this.win.webContents.once('did-finish-load', send);
      } else {
        send();
      }
      this.win.show();
      this.win.focus();
    });
  }

  destroy() {
    if (this.win) { this.win.destroy(); this.win = null; }
  }
}

module.exports = { RegionManager };

// System tray icon + menu: Open Settings, Enable/Disable Meel, Quit.

'use strict';

const path = require('path');
const fs = require('fs');
const { Tray, Menu, nativeImage } = require('electron');

class MeelTray {
  constructor({ onOpenSettings, onToggleEnabled, onQuit, getEnabled }) {
    this.onOpenSettings = onOpenSettings;
    this.onToggleEnabled = onToggleEnabled;
    this.onQuit = onQuit;
    this.getEnabled = getEnabled;
    this.tray = null;
  }

  _icon() {
    // Prefer a shipped PNG; fall back to a tiny generated dark dot so the app
    // still runs before an icon asset is added.
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
    if (fs.existsSync(iconPath)) {
      return nativeImage.createFromPath(iconPath);
    }
    // 16x16 transparent placeholder (empty image is acceptable to Tray).
    return nativeImage.createEmpty();
  }

  create() {
    this.tray = new Tray(this._icon());
    this.tray.setToolTip('Meel — radial shortcut wheel');
    this.refresh();
    // Left-click shows the context menu (same as right-click), so users
    // don't have to know to right-click.
    this.tray.on('click', () => this.tray.popUpContextMenu());
    // Double-click opens settings directly.
    this.tray.on('double-click', () => this.onOpenSettings());
  }

  refresh() {
    if (!this.tray) return;
    const enabled = this.getEnabled();
    const menu = Menu.buildFromTemplate([
      { label: 'Open Settings', click: () => this.onOpenSettings() },
      { type: 'separator' },
      {
        label: enabled ? 'Disable Meel' : 'Enable Meel',
        click: () => this.onToggleEnabled()
      },
      { type: 'separator' },
      { label: 'Quit Meel', click: () => this.onQuit() }
    ]);
    this.tray.setContextMenu(menu);
    this.tray.setToolTip(`Meel — ${enabled ? 'active' : 'disabled'}`);
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = { MeelTray };

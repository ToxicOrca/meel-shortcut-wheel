// Meel — main process entry point.
//
// Responsibilities:
//   - Load config (userData JSON, seeded from default-config.json).
//   - Start the global input hook (uiohook-napi) and wire trigger events to
//     showing/hiding the radial overlay.
//   - Own the overlay window, the settings window, and the tray icon.
//   - Execute the selected slice's action via the actions engine.
//   - Expose IPC so the settings window can read/write config, pick files,
//     capture a new trigger, and toggle enabled state.

'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');

// Reduce GPU cache contention on startup (harmless Chromium noise when a
// previous instance locked the cache dir).
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

const { IPC } = require('../shared/constants');
const configStore = require('./config');
const { TriggerHook } = require('./hook');
const { OverlayManager } = require('./overlay-manager');
const { RegionManager } = require('./region-manager');
const { MeelTray } = require('./tray');
const { runAction } = require('./actions');

// ---- App-wide state ---------------------------------------------------------

let config = null;
let hook = null;
let overlay = null;
let region = null;
let tray = null;
let settingsWin = null;

// Tracks whether the wheel is currently open, and the slice the cursor is
// hovering (reported by the overlay renderer). hoveredSlice is { id, action }
// for the leaf slice under the cursor, or null.
let wheelOpen = false;
let hoveredSlice = null;

// While the wheel is open we poll the cursor position ourselves via
// screen.getCursorScreenPoint(). That returns DIP coordinates that line up with
// BrowserWindow bounds on every monitor regardless of DPI scaling — unlike the
// raw physical pixels uiohook reports, which are wrong on HiDPI/mixed-DPI
// setups. ~120 Hz while open only; cleared the moment the wheel closes.
let cursorPollTimer = null;
const CURSOR_POLL_MS = 8;

// Single instance — a launcher must not run twice.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Do not show a dock/taskbar entry; Meel lives in the tray.
if (process.platform === 'darwin' && app.dock) app.dock.hide();

// ---- Wheel open/close logic -------------------------------------------------

function startCursorPoll() {
  stopCursorPoll();
  cursorPollTimer = setInterval(() => {
    if (!wheelOpen) return;
    overlay.updateCursor(screen.getCursorScreenPoint());
  }, CURSOR_POLL_MS);
}

function stopCursorPoll() {
  if (cursorPollTimer) { clearInterval(cursorPollTimer); cursorPollTimer = null; }
}

function openWheel(cursorHint) {
  if (!config.enabled) return;
  if (wheelOpen) return; // already open — ignore re-entry
  const slices = configStore.activeSlices(config);
  if (!slices.length) return;
  hoveredSlice = null;
  // Always take the true cursor position in DIP coords (works on every
  // monitor); the hook's physical-pixel hint is only used as a fallback.
  const center = screen.getCursorScreenPoint();
  overlay.show(center, slices, config.appearance);
  wheelOpen = true;
  startCursorPoll();
}

async function closeWheelAndFire() {
  if (!wheelOpen) return;
  wheelOpen = false;
  stopCursorPoll();
  overlay.hide();
  if (hoveredSlice && hoveredSlice.action) {
    await runAction(hoveredSlice.action, actionContext());
  }
  hoveredSlice = null;
}

function closeWheelNoFire() {
  if (!wheelOpen) return;
  wheelOpen = false;
  stopCursorPoll();
  overlay.hide();
  hoveredSlice = null;
}

// Context handed to the actions engine so an action can, e.g., ask the user to
// drag out a screen region without the engine knowing about Electron windows.
function actionContext() {
  return {
    selectRegion: () => region.selectRegion()
  };
}

// ---- Hook wiring ------------------------------------------------------------

function wireHook() {
  hook = new TriggerHook();
  hook.setTrigger(config.trigger);
  hook.setEnabled(config.enabled);

  hook.on('error', (err) => {
    dialog.showErrorBox(
      'Meel: input hook failed',
      'The global input hook (uiohook-napi) could not start.\n\n' +
      'Make sure `npm install` completed and native modules built.\n\n' +
      String(err && err.message || err)
    );
  });

  // In 'hold' mode: press opens, release fires the hovered slice.
  // In 'toggle' mode: press toggles open/closed; while open, a press over a
  //   slice fires it (handled here by firing on the second press).
  hook.on('triggerdown', (pos) => {
    const cursor = pos || currentCursor();
    if (config.trigger.mode === 'toggle') {
      if (wheelOpen) closeWheelAndFire();
      else openWheel(cursor);
    } else {
      openWheel(cursor);
    }
  });

  hook.on('triggerup', () => {
    if (config.trigger.mode === 'hold') {
      closeWheelAndFire();
    }
    // In toggle mode, release does nothing.
  });

  // Cursor tracking for slice highlighting is done by startCursorPoll() using
  // DIP coordinates (correct on HiDPI/multi-monitor). We intentionally do NOT
  // use the hook's raw physical-pixel 'move' events for positioning.

  // The settings UI asked us to capture the next input as a new trigger.
  hook.on('captured', (input) => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send('trigger:captured', input);
    }
  });

  hook.start();
}

// Fallback cursor read (keyboard triggers carry no position).
function currentCursor() {
  const { screen } = require('electron');
  return screen.getCursorScreenPoint();
}

// ---- Settings window --------------------------------------------------------

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const { nativeImage } = require('electron');
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon-256.png');
  const fs = require('fs');
  const winIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  settingsWin = new BrowserWindow({
    width: 940,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'Meel Settings',
    icon: winIcon,
    backgroundColor: '#14161c', // dark first paint — no white flash
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---- Enable/disable + config apply -----------------------------------------

function setEnabled(value) {
  config.enabled = value;
  if (hook) hook.setEnabled(value);        // actually gate the trigger
  if (!value) closeWheelNoFire();          // close the wheel if it was open
  configStore.saveConfig(config);
  tray.refresh();
  broadcastConfig();
}

function applyConfig(newConfig) {
  // Validate whatever the settings UI handed us before trusting it.
  config = configStore.validate(newConfig);
  configStore.saveConfig(config);
  if (hook) { hook.setTrigger(config.trigger); hook.setEnabled(config.enabled); }
  tray.refresh();
  broadcastConfig();
}

function broadcastConfig() {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC.CONFIG_CHANGED, config);
  }
}

// ---- IPC --------------------------------------------------------------------

function wireIpc() {
  // Overlay renderer tells us which slice the cursor is over (or null).
  ipcMain.on(IPC.OVERLAY_SELECT, (_e, sliceData) => { hoveredSlice = sliceData; });
  ipcMain.on(IPC.OVERLAY_READY, () => { /* overlay finished first paint */ });

  // Region selector renderer reports the dragged rectangle (or null).
  ipcMain.on(IPC.REGION_DONE, (_e, rect) => { if (region) region.handleDone(rect); });
  ipcMain.on(IPC.REGION_READY, () => { /* region overlay first paint */ });

  // Settings <-> main
  ipcMain.handle(IPC.CONFIG_GET, () => config);
  ipcMain.handle(IPC.CONFIG_SAVE, (_e, newConfig) => { applyConfig(newConfig); return true; });
  ipcMain.handle(IPC.CONFIG_RESET, () => { config = configStore.resetConfig(); applyConfig(config); return config; });

  ipcMain.handle(IPC.PICK_FILE, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle(IPC.PICK_FOLDER, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle(IPC.PICK_ICON_SOURCE, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Pick a file to extract its icon',
      properties: ['openFile'],
      filters: [
        { name: 'Programs & shortcuts', extensions: ['exe', 'lnk', 'ico', 'png', 'jpg'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // Extract an icon from a file path and return it as a data URI.
  // For .lnk files, resolves the shortcut target first. Uses PowerShell
  // ExtractAssociatedIcon (gets the real app icon, not shell file-type icon)
  // with upscaling to 64x64, falling back to Electron's getFileIcon.
  ipcMain.handle(IPC.EXTRACT_ICON, async (_e, filePath) => {
    if (!filePath) return null;
    const fs = require('fs');
    const { nativeImage, shell } = require('electron');
    const { execFile } = require('child_process');
    const os = require('os');
    const ext = path.extname(filePath).toLowerCase();

    // Expand environment variables (e.g. %LOCALAPPDATA%)
    let resolved = filePath.replace(/%([^%]+)%/g, (_, v) => process.env[v] || _);

    // If it's a .lnk, resolve to the actual exe before doing anything else
    if (ext === '.lnk') {
      try {
        const link = shell.readShortcutLink(resolved);
        if (link.target) resolved = link.target;
      } catch { /* keep original path */ }
    }

    // For image files (.png, .ico, etc.), read them directly
    const resolvedExt = path.extname(resolved).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.ico', '.bmp'].includes(resolvedExt)) {
      try {
        const img = nativeImage.createFromPath(resolved);
        if (!img.isEmpty()) return img.toDataURL();
      } catch { /* fall through */ }
    }

    // Primary method: PowerShell ExtractAssociatedIcon → upscale to 64x64 PNG.
    // This gets the actual embedded application icon (not the shell file-type
    // icon that Electron's getFileIcon often returns for Electron apps).
    try {
      const tmp = path.join(os.tmpdir(), `meel-icon-${Date.now()}.png`);
      const psPath = resolved.replace(/'/g, "''");
      const psTmp = tmp.replace(/'/g, "''");
      const ps = [
        'Add-Type -AssemblyName System.Drawing;',
        `$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${psPath}');`,
        'if ($icon) {',
        '  $bmp = New-Object System.Drawing.Bitmap($icon.ToBitmap(), 64, 64);',
        `  $bmp.Save('${psTmp}', [System.Drawing.Imaging.ImageFormat]::Png);`,
        '  $bmp.Dispose(); $icon.Dispose();',
        '}'
      ].join(' ');
      await new Promise((res, rej) => {
        execFile('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 8000 }, (err) => err ? rej(err) : res());
      });
      if (fs.existsSync(tmp)) {
        const img = nativeImage.createFromPath(tmp);
        try { fs.unlinkSync(tmp); } catch { /* cleanup best-effort */ }
        if (!img.isEmpty()) return img.toDataURL();
      }
    } catch (err) {
      console.warn('[extractIcon] PowerShell extraction failed:', err.message);
    }

    // Fallback: Electron's getFileIcon
    for (const size of ['large', 'normal']) {
      try {
        const icon = await app.getFileIcon(resolved, { size });
        if (!icon.isEmpty()) return icon.toDataURL();
      } catch { /* next */ }
    }

    console.warn('[extractIcon] no icon found for', resolved);
    return null;
  });

  // Begin capturing the next physical input to use as the trigger.
  ipcMain.handle(IPC.START_LISTEN_TRIGGER, () => { if (hook) hook.captureNext(); return true; });

  ipcMain.handle(IPC.SET_ENABLED, (_e, value) => { setEnabled(!!value); return config.enabled; });
  ipcMain.handle(IPC.APP_STATE, () => ({ enabled: config.enabled }));

  // Where the live config JSON lives (shown in Settings for transparency).
  ipcMain.handle(IPC.GET_CONFIG_PATH, () => configStore.userConfigPath());

  // Start-on-login. Uses Electron's login-item API (Windows/macOS).
  ipcMain.handle(IPC.GET_LOGIN_ITEM, () => {
    try { return { openAtLogin: app.getLoginItemSettings().openAtLogin }; }
    catch { return { openAtLogin: false }; }
  });
  ipcMain.handle(IPC.SET_LOGIN_ITEM, (_e, value) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!value });
      return app.getLoginItemSettings().openAtLogin;
    } catch (err) {
      console.error('[main] setLoginItem failed', err);
      return false;
    }
  });
}

// ---- Lifecycle --------------------------------------------------------------

app.whenReady().then(() => {
  config = configStore.loadConfig();

  overlay = new OverlayManager();
  // Defer overlay window creation to first wheel open (overlay.show calls create
  // internally if needed). Avoids GPU/window overhead at startup.

  region = new RegionManager();

  tray = new MeelTray({
    onOpenSettings: openSettings,
    onToggleEnabled: () => setEnabled(!config.enabled),
    onQuit: () => { app.quit(); },
    getEnabled: () => config.enabled
  });
  tray.create();

  wireIpc();
  wireHook();

  // Open settings on first ever run so the user can configure the wheel.
  // (Detected by absence of a saved config before this run — simplified here
  // to: always available from the tray. Uncomment to auto-open.)
  // openSettings();
});

app.on('second-instance', () => openSettings());

// Keep running with no windows — Meel is a tray-resident background app.
app.on('window-all-closed', (e) => { /* do not quit */ });

app.on('before-quit', () => {
  stopCursorPoll();
  if (hook) hook.stop();
  if (overlay) overlay.destroy();
  if (region) region.destroy();
  if (tray) tray.destroy();
});

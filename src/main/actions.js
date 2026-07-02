// Actions engine — extensible, data-driven.
//
// Each action is a plain object { type, ...params } stored in the config.
// To add a new action type: add a handler to the HANDLERS map and list the type
// in shared/constants.js ACTION_TYPES (and add a UI editor in the settings
// renderer). Nothing else needs to change.
//
// Handlers receive (action, ctx). `ctx` is supplied by the caller (main.js) and
// currently exposes:
//   ctx.selectRegion() -> Promise<{ display, rect }|null>   (for region capture)
// This keeps the engine decoupled from Electron window management.
//
// Implemented: LaunchProgram, Screenshot (full + region + clipboard), OpenURL,
// OpenFolder, RunCommand, SendHotkey (PowerShell SendKeys), MediaKey (PowerShell
// keybd_event). SendHotkey/MediaKey are Windows-only and shell out to
// PowerShell so we need no native key-injection dependency.

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec, execFile } = require('child_process');
const { shell, clipboard, nativeImage, screen } = require('electron');

// screenshot-desktop shells out to platform tools. Require lazily so a missing
// binary only breaks the Screenshot action, not startup.
function loadScreenshot() {
  return require('screenshot-desktop');
}

// Expand %USERPROFILE%, %APPDATA%, etc. and a leading ~ in a path string.
function expandEnv(p) {
  if (!p) return p;
  let out = String(p).replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
  if (out.startsWith('~')) out = path.join(os.homedir(), out.slice(1));
  return out;
}

// ---- Screenshot helpers ----------------------------------------------------

// Capture a specific Electron display as a PNG Buffer. Falls back to the
// primary display capture if we can't match it in screenshot-desktop's list.
async function captureDisplayPng(screenshot, targetDisplay) {
  try {
    const eDisplays = screen.getAllDisplays();
    const idx = eDisplays.findIndex((d) => d.id === (targetDisplay && targetDisplay.id));
    const sdDisplays = await screenshot.listDisplays();
    if (idx >= 0 && idx < sdDisplays.length) {
      return await screenshot({ screen: sdDisplays[idx].id, format: 'png' });
    }
  } catch (err) {
    console.warn('[actions] per-display capture failed, using primary:', err.message);
  }
  // Fallback: primary display.
  return await screenshot({ format: 'png' });
}

function clampRect(rect, size) {
  const x = Math.max(0, Math.min(rect.x, size.width - 1));
  const y = Math.max(0, Math.min(rect.y, size.height - 1));
  const width = Math.max(1, Math.min(rect.width, size.width - x));
  const height = Math.max(1, Math.min(rect.height, size.height - y));
  return { x, y, width, height };
}

// ---- PowerShell helpers (Windows key injection) ----------------------------

// Run a PowerShell command, resolving on exit. Best-effort; logs on failure.
function runPowerShell(psCommand) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCommand],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) console.error('[actions] powershell error:', err.message, stderr);
        resolve({ stdout, stderr });
      }
    );
  });
}

// Translate a human combo like "Ctrl+Shift+S" into WScript.Shell SendKeys
// syntax ("^+s"). Handles the common modifiers and a set of named keys.
function comboToSendKeys(combo) {
  const MODS = { ctrl: '^', control: '^', alt: '%', shift: '+', win: '', windows: '' };
  const NAMED = {
    enter: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}',
    space: ' ', backspace: '{BACKSPACE}', del: '{DEL}', delete: '{DEL}',
    home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
    up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
    f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
    f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}'
  };
  const parts = String(combo).split('+').map((s) => s.trim()).filter(Boolean);
  let prefix = '';
  let key = '';
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low in MODS) { prefix += MODS[low]; continue; }
    key = NAMED[low] || (part.length === 1 ? part.toLowerCase() : `{${part.toUpperCase()}}`);
  }
  return prefix + key;
}

// Virtual-key codes for media/volume keys (Windows).
const MEDIA_VK = {
  volume_mute: 0xAD, volume_down: 0xAE, volume_up: 0xAF,
  next: 0xB0, prev: 0xB1, stop: 0xB2, play_pause: 0xB3
};

// ---- Action handlers -------------------------------------------------------

const HANDLERS = {
  // Launch an executable with optional args and working directory.
  LaunchProgram(action) {
    const exe = expandEnv(action.path);
    if (!exe) throw new Error('LaunchProgram: no path set');
    const args = Array.isArray(action.args) ? action.args.map(expandEnv) : [];
    const cwd = action.cwd ? expandEnv(action.cwd) : undefined;
    const child = spawn(exe, args, {
      detached: true,
      stdio: 'ignore',
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
      windowsHide: false
    });
    child.unref();
    return { launched: exe, cwd };
  },

  // Capture the screen to PNG. mode 'full' grabs the primary display; mode
  // 'region' asks the caller for a drag-selected rectangle and crops to it.
  // Optionally also copies the image to the clipboard.
  async Screenshot(action, ctx) {
    const screenshot = loadScreenshot();
    const dir = expandEnv(action.saveDir) || path.join(os.homedir(), 'Pictures', 'Meel Screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `meel-${stamp}.png`);

    let buf;

    if (action.mode === 'region') {
      if (!ctx || typeof ctx.selectRegion !== 'function') {
        throw new Error('Screenshot region: no region selector available');
      }
      const sel = await ctx.selectRegion();
      if (!sel) return { cancelled: true };

      const full = await captureDisplayPng(screenshot, sel.display);
      let img = nativeImage.createFromBuffer(full);
      const sf = (sel.display && sel.display.scaleFactor) || 1;
      // Selection came in DIP local to the display; the captured image is in
      // physical pixels, so scale by the display's DPI factor.
      const physical = {
        x: Math.round(sel.rect.x * sf),
        y: Math.round(sel.rect.y * sf),
        width: Math.round(sel.rect.width * sf),
        height: Math.round(sel.rect.height * sf)
      };
      const cropped = img.crop(clampRect(physical, img.getSize()));
      buf = cropped.toPNG();
      if (action.toClipboard) clipboard.writeImage(cropped);
    } else {
      // Full screen.
      buf = await screenshot({ format: 'png' });
      if (action.toClipboard) clipboard.writeImage(nativeImage.createFromBuffer(buf));
    }

    fs.writeFileSync(file, buf);
    return { saved: file, clipboard: !!action.toClipboard };
  },

  // Open a URL in the default browser.
  OpenURL(action) {
    if (!action.url) throw new Error('OpenURL: no url set');
    // Basic guard: only allow http(s) and mailto to avoid surprising protocols.
    if (!/^(https?:|mailto:)/i.test(action.url)) {
      throw new Error('OpenURL: only http(s)/mailto URLs are allowed');
    }
    shell.openExternal(action.url);
    return { opened: action.url };
  },

  // Open a folder in the file explorer.
  OpenFolder(action) {
    const dir = expandEnv(action.path);
    if (!dir) throw new Error('OpenFolder: no path set');
    shell.openPath(dir);
    return { opened: dir };
  },

  // Run an arbitrary shell command with optional working directory. Powerful —
  // the settings UI flags this as advanced.
  RunCommand(action) {
    if (!action.command) throw new Error('RunCommand: no command set');
    const cwd = action.cwd ? expandEnv(action.cwd) : undefined;
    exec(action.command, { windowsHide: true, cwd: cwd && fs.existsSync(cwd) ? cwd : undefined }, (err) => {
      if (err) console.error('[actions] RunCommand error', err);
    });
    return { ran: action.command };
  },

  // Send a keystroke / hotkey combo to the foreground window via PowerShell's
  // WScript.Shell SendKeys. Windows-only. Note: SendKeys can't produce every
  // low-level combo (e.g. Win-key chords) — those need a real injector.
  async SendHotkey(action) {
    if (process.platform !== 'win32') { console.warn('[actions] SendHotkey is Windows-only'); return { unsupported: true }; }
    if (!action.combo) throw new Error('SendHotkey: no combo set');
    const keys = comboToSendKeys(action.combo);
    // Escape single quotes for the PowerShell string literal.
    const safe = keys.replace(/'/g, "''");
    await runPowerShell(
      `$w = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 40; $w.SendKeys('${safe}')`
    );
    return { sent: action.combo, keys };
  },

  // Media / volume keys via keybd_event (P/Invoke through Add-Type). Windows-only.
  async MediaKey(action) {
    if (process.platform !== 'win32') { console.warn('[actions] MediaKey is Windows-only'); return { unsupported: true }; }
    const vk = MEDIA_VK[action.key];
    if (vk === undefined) throw new Error('MediaKey: unknown key ' + action.key);
    const ps = [
      'Add-Type -Name Meel -Namespace Win32 -MemberDefinition ',
      "'[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);';",
      `[Win32.Meel]::keybd_event(${vk},0,0,[System.UIntPtr]::Zero);`,
      `[Win32.Meel]::keybd_event(${vk},0,2,[System.UIntPtr]::Zero);`
    ].join(' ');
    await runPowerShell(ps);
    return { media: action.key };
  }
};

// Execute an action object. Returns a result object; logs and swallows errors
// so one bad slice never crashes the app.
async function runAction(action, ctx) {
  if (!action || !action.type) {
    console.error('[actions] missing action or type');
    return { error: 'no action' };
  }
  const handler = HANDLERS[action.type];
  if (!handler) {
    console.error('[actions] unknown action type:', action.type);
    return { error: 'unknown type: ' + action.type };
  }
  try {
    const result = await handler(action, ctx || {});
    return result;
  } catch (err) {
    console.error('[actions] failed', action.type, err);
    return { error: String((err && err.message) || err) };
  }
}

module.exports = { runAction, expandEnv, comboToSendKeys, ACTION_HANDLERS: HANDLERS };

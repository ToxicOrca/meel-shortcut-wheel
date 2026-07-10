// Window-focus helpers (Windows-only). Used by the actions engine to implement
// "focus instead of relaunch" behavior:
//   - focusProcessWindow(name)          -> focus an already-running program
//   - focusNewProcessWindow(pid, name)  -> bring a freshly launched window to front
//   - openFolderOnTop(path)             -> focus an existing Explorer window at a
//                                          folder, or open one and force it on top
//   - focusBrowserTab(terms)            -> select an already-open Chrome/Edge tab
//                                          matching a title term and focus the browser
//
// All helpers shell out to PowerShell (consistent with the rest of Meel — no
// native dependency needed). SetForegroundWindow is normally blocked for
// background processes, so the embedded C# helper sends a zero-width ALT tap
// first (the documented way to release Windows' foreground lock), restores the
// window if minimized, and then raises it.
//
// Every helper is best-effort: it resolves false/'FAIL' rather than throwing,
// so callers can always fall back to the plain "just open it" path.

'use strict';

const path = require('path');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';

// C# P/Invoke helper compiled once per PowerShell invocation via Add-Type.
const CSHARP_FOCUS = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MeelWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Focus(IntPtr h) {
    if (h == IntPtr.Zero) return;
    if (IsIconic(h)) ShowWindowAsync(h, 9); // SW_RESTORE
    // ALT tap: releases the foreground lock so SetForegroundWindow succeeds
    // even though we are a background (tray) process.
    keybd_event(0xA4, 0, 0, UIntPtr.Zero);
    keybd_event(0xA4, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
  }
}
'@
`;

// Escape a string for inclusion inside a single-quoted PowerShell literal.
function psq(s) {
  return String(s).replace(/'/g, "''");
}

// Run a PowerShell script; resolve with trimmed stdout ('' on any failure).
function runPs(script, timeoutMs = 10000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          console.warn('[windows] powershell failed:', err.message, (stderr || '').slice(0, 300));
          resolve('');
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

// Normalize a folder path for comparison with Explorer's reported path.
function normalizeFolder(p) {
  let out = path.normalize(String(p));
  // Strip trailing separators, but keep "C:\" style drive roots intact.
  out = out.replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(out)) out += '\\';
  return out;
}

// ---- Public helpers ----------------------------------------------------------

// Focus the main window of a running process by base name (no ".exe").
// Resolves true if a window was found and focused.
async function focusProcessWindow(baseName) {
  if (!IS_WIN || !baseName) return false;
  const out = await runPs(`
${CSHARP_FOCUS}
$p = Get-Process -Name '${psq(baseName)}' -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) { [MeelWin]::Focus($p.MainWindowHandle); 'OK' } else { 'NO' }
`);
  return out === 'OK';
}

// After launching a program, wait for its window to appear and bring it to the
// front (new windows from a background launcher often open behind the current
// app). Tries the exact pid first, then falls back to the process name — many
// apps (single-instance apps, launchers, store apps) hand off to another
// process, so the spawned pid may never own a window.
async function focusNewProcessWindow(pid, baseName, timeoutMs = 5000) {
  if (!IS_WIN) return false;
  const out = await runPs(`
${CSHARP_FOCUS}
$deadline = (Get-Date).AddMilliseconds(${Math.max(500, timeoutMs)})
while ((Get-Date) -lt $deadline) {
  $p = $null
  if (${Number(pid) > 0 ? Number(pid) : 0} -gt 0) {
    $p = Get-Process -Id ${Number(pid) > 0 ? Number(pid) : 0} -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 }
  }
  if (-not $p -and '${psq(baseName || '')}' -ne '') {
    $p = Get-Process -Name '${psq(baseName || '')}' -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if ($p) { [MeelWin]::Focus(($p | Select-Object -First 1).MainWindowHandle); 'OK'; exit }
  Start-Sleep -Milliseconds 150
}
'NO'
`, timeoutMs + 5000);
  return out === 'OK';
}

// Open a folder in Explorer, reusing an existing window if one is already
// showing that folder, and force the window on top either way.
// Resolves 'FOCUSED' (reused existing), 'OPENED' (new window, foregrounded),
// 'OPENED-NOFOCUS' (opened but window never appeared in time), or 'FAIL'.
async function openFolderOnTop(folderPath) {
  if (!IS_WIN) return 'FAIL';
  const target = normalizeFolder(folderPath);
  const out = await runPs(`
${CSHARP_FOCUS}
$target = '${psq(target)}'
function Find-FolderWindow([string]$t) {
  $shell = New-Object -ComObject Shell.Application
  foreach ($w in @($shell.Windows())) {
    try {
      $p = $w.Document.Folder.Self.Path
      if ($p -and ($p.TrimEnd('\\') -ieq $t.TrimEnd('\\'))) { return [IntPtr]$w.HWND }
    } catch { }
  }
  return [IntPtr]::Zero
}
$h = Find-FolderWindow $target
if ($h -ne [IntPtr]::Zero) { [MeelWin]::Focus($h); 'FOCUSED'; exit }
Start-Process explorer.exe -ArgumentList ('"' + $target + '"')
$deadline = (Get-Date).AddSeconds(4)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 150
  $h = Find-FolderWindow $target
  if ($h -ne [IntPtr]::Zero) { [MeelWin]::Focus($h); 'OPENED'; exit }
}
'OPENED-NOFOCUS'
`, 12000);
  return out || 'FAIL';
}

// Look for an already-open browser tab whose title contains any of `terms`
// (case-insensitive). Scans Chrome and Edge windows via Windows UI Automation,
// selects the matching tab, and focuses that browser window.
// Resolves true if a tab was selected.
async function focusBrowserTab(terms) {
  if (!IS_WIN) return false;
  const list = (Array.isArray(terms) ? terms : [terms])
    .filter((t) => t && String(t).trim().length >= 2)
    .map((t) => `'${psq(String(t).trim())}'`);
  if (!list.length) return false;
  const out = await runPs(`
${CSHARP_FOCUS}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$terms = @(${list.join(',')})
$procs = Get-Process -Name chrome, msedge -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($p in $procs) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($tab in $tabs) {
      $name = $tab.Current.Name
      if (-not $name) { continue }
      foreach ($t in $terms) {
        if ($name.ToLower().Contains($t.ToLower())) {
          try {
            $pat = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
            $pat.Select()
          } catch { }
          [MeelWin]::Focus($p.MainWindowHandle)
          'OK'
          exit
        }
      }
    }
  } catch { }
}
'NO'
`, 12000);
  return out === 'OK';
}

// Derive title-match terms for a URL. Tab titles usually contain the site
// name, occasionally the domain, so we return (in order):
//   - hostname without "www."               (mail.google.com)
//   - the registrable domain's name          (google)
//   - the subdomain label, if any            (mail — helps things like Gmail)
// e.g. https://www.youtube.com/watch -> ["youtube.com", "youtube"]
// Two-part public suffixes (co.uk, com.au, ...) are handled heuristically.
function urlMatchTerms(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    const labels = host.split('.').filter(Boolean);
    const terms = [host];
    if (labels.length >= 2) {
      // Index of the registrable domain's name label.
      const SECOND_LEVEL_TLDS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
      let nameIdx = labels.length - 2;
      if (labels.length >= 3 && SECOND_LEVEL_TLDS.has(labels[labels.length - 2].toLowerCase())) {
        nameIdx = labels.length - 3;
      }
      const name = labels[nameIdx];
      if (name && name.toLowerCase() !== host.toLowerCase()) terms.push(name);
      // Subdomain label (e.g. "mail" in mail.google.com) as a last resort.
      if (nameIdx > 0 && labels[0].toLowerCase() !== name.toLowerCase()) terms.push(labels[0]);
    }
    return [...new Set(terms)];
  } catch {
    return [];
  }
}

module.exports = {
  focusProcessWindow,
  focusNewProcessWindow,
  openFolderOnTop,
  focusBrowserTab,
  urlMatchTerms
};

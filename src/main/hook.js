// Global input hook. This is the single trickiest / riskiest part of Meel.
//
// Electron's built-in globalShortcut can register keyboard accelerators but
// CANNOT capture extra mouse buttons (MB4/MB5). uiohook-napi installs a
// low-level OS input hook (SetWindowsHookEx on Windows) and reports every
// keyboard and mouse event globally — including the side buttons — which is
// exactly what we need for a mouse-button-triggered launcher.
//
// This module isolates uiohook so the rest of the app only sees clean
// "trigger down / trigger up / mouse move" events.
//
// IMPORTANT limitation — event suppression:
//   libuiohook (and therefore uiohook-napi) installs a *listening* hook. It
//   reports input but CANNOT swallow/consume it. So if the trigger is MB4, the
//   OS still delivers MB4's default action (e.g. "browser back") to whatever
//   app is focused. There is no reliable cross-app way to suppress it from Node.
//   Mitigations we can offer: (a) pick a side button that has no default action
//   in the apps you use, or remap it to "unassigned" in your mouse vendor's
//   software; (b) use a keyboard trigger. suppressTrigger is accepted in config
//   for forward-compat but currently only logs a one-time warning.

'use strict';

const { EventEmitter } = require('events');

// uiohook-napi is a native module. Requiring it can throw if the prebuilt
// binary is missing (e.g. before `npm install` finished, or on an
// unsupported platform). We require lazily and surface a friendly error.
let uIOhook = null;
let UiohookKey = null;

class TriggerHook extends EventEmitter {
  constructor() {
    super();
    this.started = false;
    this.trigger = { type: 'mouse', button: 4, keycode: null, mode: 'hold' };
    this._down = false;
    // When set, the next input event is captured and reported via
    // 'captured' instead of being treated as a trigger. Used by the
    // settings UI "press a button to set your trigger" flow.
    this._captureNext = false;
    // Master gate. When false the trigger is ignored entirely (the wheel can't
    // open) but capture mode still works so Settings can rebind while disabled.
    this._enabled = true;
    // Debounce: ignore a second trigger-down that arrives within this many ms
    // of the last one. Guards against double-fire from noisy mice / bounce.
    this.debounceMs = 60;
    this._lastDownAt = 0;
    this._suppressWarned = false;
  }

  // Enable/disable the trigger without tearing down the OS hook. Capture mode
  // (rebinding the trigger) keeps working while disabled.
  setEnabled(value) {
    this._enabled = !!value;
    if (!this._enabled) this._down = false; // drop any half-press state
  }

  _ensureLoaded() {
    if (uIOhook) return true;
    try {
      const mod = require('uiohook-napi');
      uIOhook = mod.uIOhook;
      UiohookKey = mod.UiohookKey;
      return true;
    } catch (err) {
      console.error('[hook] uiohook-napi failed to load. Did native install succeed?', err);
      this.emit('error', err);
      return false;
    }
  }

  setTrigger(trigger) {
    this.trigger = Object.assign({}, this.trigger, trigger);
    if (this.trigger.suppressTrigger && !this._suppressWarned) {
      this._suppressWarned = true;
      console.warn('[hook] config requests suppressTrigger, but uiohook cannot ' +
        'consume events; the trigger button\'s default action will still fire.');
    }
  }

  // Begin capture mode: the next mouse-button or key press is reported via
  // the 'captured' event so the settings UI can learn a new trigger.
  captureNext() {
    this._captureNext = true;
  }

  start() {
    if (this.started) return;
    if (!this._ensureLoaded()) return;

    uIOhook.on('mousedown', (e) => this._onMouseDown(e));
    uIOhook.on('mouseup', (e) => this._onMouseUp(e));
    // Only forward movement while the trigger is held, to keep overhead near
    // zero when the wheel is closed. (main also polls the cursor for DPI-safe
    // coordinates; this event is a lightweight extra signal.)
    uIOhook.on('mousemove', (e) => { if (this._down) this.emit('move', { x: e.x, y: e.y }); });
    uIOhook.on('keydown', (e) => this._onKeyDown(e));
    uIOhook.on('keyup', (e) => this._onKeyUp(e));

    uIOhook.start();
    this.started = true;
    console.log('[hook] global input hook started');
  }

  stop() {
    if (!this.started || !uIOhook) return;
    try {
      uIOhook.stop();
    } catch (err) {
      console.error('[hook] stop error', err);
    }
    this.started = false;
  }

  _matchesMouse(e) {
    return this.trigger.type === 'mouse' && e.button === this.trigger.button;
  }

  _matchesKey(e) {
    return this.trigger.type === 'keyboard' && e.keycode === this.trigger.keycode;
  }

  // Debounce guard shared by mouse + keyboard trigger-down.
  _debounced() {
    const now = Date.now();
    if (now - this._lastDownAt < this.debounceMs) return true;
    this._lastDownAt = now;
    return false;
  }

  _onMouseDown(e) {
    if (this._captureNext) {
      this._captureNext = false;
      this.emit('captured', { type: 'mouse', button: e.button });
      return;
    }
    if (!this._enabled) return;
    if (this._matchesMouse(e)) {
      if (this._debounced()) return;
      this._down = true;
      this.emit('triggerdown', { x: e.x, y: e.y });
    }
  }

  _onMouseUp(e) {
    if (this._matchesMouse(e) && this._down) {
      this._down = false;
      this.emit('triggerup', { x: e.x, y: e.y });
    }
  }

  _onKeyDown(e) {
    if (this._captureNext) {
      this._captureNext = false;
      this.emit('captured', { type: 'keyboard', keycode: e.keycode });
      return;
    }
    if (!this._enabled) return;
    if (this._matchesKey(e) && !this._down) {
      if (this._debounced()) return;
      this._down = true;
      this.emit('triggerdown', null); // keyboard events carry no cursor pos
    }
  }

  _onKeyUp(e) {
    if (this._matchesKey(e) && this._down) {
      this._down = false;
      this.emit('triggerup', null);
    }
  }
}

module.exports = { TriggerHook };

// Shared constants used across main and renderer processes.
// Kept dependency-free so it can be required from anywhere.

'use strict';

// IPC channel names. Centralized to avoid typos between main/preload/renderer.
const IPC = {
  // Overlay <-> main
  OVERLAY_SHOW: 'overlay:show',          // main -> overlay renderer: {slices, appearance, center}
  OVERLAY_HIDE: 'overlay:hide',          // main -> overlay renderer
  OVERLAY_CURSOR: 'overlay:cursor',      // main -> overlay renderer: {x, y} (screen coords)
  OVERLAY_SELECT: 'overlay:select',      // overlay renderer -> main: {sliceId | null}
  OVERLAY_READY: 'overlay:ready',        // overlay renderer -> main

  // Settings <-> main
  CONFIG_GET: 'config:get',              // settings renderer -> main (invoke) -> config object
  CONFIG_SAVE: 'config:save',            // settings renderer -> main (invoke) : config object
  CONFIG_RESET: 'config:reset',          // settings renderer -> main (invoke)
  CONFIG_CHANGED: 'config:changed',      // main -> all renderers: new config
  PICK_FILE: 'dialog:pickFile',          // settings renderer -> main (invoke) : {path}
  PICK_FOLDER: 'dialog:pickFolder',      // settings renderer -> main (invoke) : {path}
  START_LISTEN_TRIGGER: 'trigger:listen',// settings renderer -> main (invoke): capture next input
  TRIGGER_CAPTURED: 'trigger:captured',  // main -> settings: {type, button|keycode}
  APP_STATE: 'app:state',                // main -> settings: {enabled}
  SET_ENABLED: 'app:setEnabled',         // settings renderer -> main: bool

  // Misc settings
  GET_CONFIG_PATH: 'config:path',        // settings renderer -> main (invoke): absolute path string
  GET_LOGIN_ITEM: 'app:getLogin',        // settings renderer -> main (invoke): {openAtLogin}
  SET_LOGIN_ITEM: 'app:setLogin',        // settings renderer -> main (invoke): bool

  // Icon extraction
  EXTRACT_ICON: 'app:extractIcon',       // settings renderer -> main (invoke): exe path -> data URI
  PICK_ICON_SOURCE: 'dialog:pickIconSource', // settings renderer -> main (invoke): filtered file picker

  // Region-capture overlay <-> main
  REGION_SHOW: 'region:show',            // main -> region renderer: (no payload)
  REGION_DONE: 'region:done',            // region renderer -> main: {rect}|null
  REGION_READY: 'region:ready'           // region renderer -> main: first paint done
};

// uiohook mouse button numbers (see uiohook-napi docs).
const MOUSE_BUTTON = {
  LEFT: 1,
  RIGHT: 2,
  MIDDLE: 3,
  MB4: 4, // "back" / side button — the recommended default trigger
  MB5: 5  // "forward" / side button
};

// The set of action types the engine knows about. Renderer uses this to
// build the action-type dropdown; main uses it to dispatch.
const ACTION_TYPES = [
  'LaunchProgram',
  'Screenshot',
  'OpenURL',
  'RunCommand',
  'OpenFolder',
  'SendHotkey',
  'MediaKey',
  'SubWheel'
];

module.exports = { IPC, MOUSE_BUTTON, ACTION_TYPES };

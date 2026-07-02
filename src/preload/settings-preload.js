// Preload for the settings window. Exposes a minimal, typed API surface to the
// renderer. contextIsolation ON, nodeIntegration OFF.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { IPC, ACTION_TYPES, MOUSE_BUTTON } = require('../shared/constants');

contextBridge.exposeInMainWorld('meel', {
  // Constants the UI needs to build dropdowns.
  actionTypes: ACTION_TYPES,
  mouseButtons: MOUSE_BUTTON,

  // Config
  getConfig: () => ipcRenderer.invoke(IPC.CONFIG_GET),
  saveConfig: (cfg) => ipcRenderer.invoke(IPC.CONFIG_SAVE, cfg),
  resetConfig: () => ipcRenderer.invoke(IPC.CONFIG_RESET),
  onConfigChanged: (cb) => ipcRenderer.on(IPC.CONFIG_CHANGED, (_e, cfg) => cb(cfg)),

  // Dialogs
  pickFile: () => ipcRenderer.invoke(IPC.PICK_FILE),
  pickFolder: () => ipcRenderer.invoke(IPC.PICK_FOLDER),

  // Icon extraction (returns data URI or null)
  extractIcon: (filePath) => ipcRenderer.invoke(IPC.EXTRACT_ICON, filePath),
  pickIconSource: () => ipcRenderer.invoke(IPC.PICK_ICON_SOURCE),

  // Trigger capture
  listenForTrigger: () => ipcRenderer.invoke(IPC.START_LISTEN_TRIGGER),
  onTriggerCaptured: (cb) => ipcRenderer.on(IPC.TRIGGER_CAPTURED, (_e, input) => cb(input)),

  // Enable / disable
  getState: () => ipcRenderer.invoke(IPC.APP_STATE),
  setEnabled: (v) => ipcRenderer.invoke(IPC.SET_ENABLED, v),

  // Misc
  getConfigPath: () => ipcRenderer.invoke(IPC.GET_CONFIG_PATH),
  getLoginItem: () => ipcRenderer.invoke(IPC.GET_LOGIN_ITEM),
  setLoginItem: (v) => ipcRenderer.invoke(IPC.SET_LOGIN_ITEM, v)
});

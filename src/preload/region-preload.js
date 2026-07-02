// Preload for the region-selection window. contextIsolation ON.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/constants');

contextBridge.exposeInMainWorld('meelRegion', {
  onShow: (cb) => ipcRenderer.on(IPC.REGION_SHOW, () => cb()),
  // rect: {x, y, width, height} in CSS px (== DIP local to the window), or null.
  done: (rect) => ipcRenderer.send(IPC.REGION_DONE, rect),
  ready: () => ipcRenderer.send(IPC.REGION_READY)
});

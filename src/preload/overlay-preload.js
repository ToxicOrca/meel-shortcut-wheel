// Preload for the overlay window. contextIsolation is ON, so the renderer has
// no direct Node access — it only sees the small, safe `meelOverlay` API we
// expose here.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/constants');

contextBridge.exposeInMainWorld('meelOverlay', {
  // main -> renderer subscriptions
  onShow: (cb) => ipcRenderer.on(IPC.OVERLAY_SHOW, (_e, data) => cb(data)),
  onHide: (cb) => ipcRenderer.on(IPC.OVERLAY_HIDE, () => cb()),
  onCursor: (cb) => ipcRenderer.on(IPC.OVERLAY_CURSOR, (_e, pt) => cb(pt)),

  // renderer -> main
  select: (sliceId) => ipcRenderer.send(IPC.OVERLAY_SELECT, sliceId),
  ready: () => ipcRenderer.send(IPC.OVERLAY_READY)
});

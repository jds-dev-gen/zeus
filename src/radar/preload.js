'use strict';
// Ponte do Radar: só estas funções chegam ao processo principal do Zeus.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('radar', {
  load: () => ipcRenderer.invoke('radar:load'),
  save: data => ipcRenderer.invoke('radar:save', data),
  fetch: url => ipcRenderer.invoke('radar:fetch', url),
  open: (url, background) => ipcRenderer.invoke('radar:open', url, !!background),
  theme: () => ipcRenderer.invoke('radar:theme'),
  onTheme: fn => { ipcRenderer.on('radar:theme', (e, t) => fn(t)); },
  onRefresh: fn => { ipcRenderer.on('radar:refresh', () => fn()); },
  preview: (url, rect) => ipcRenderer.invoke('radar:preview', url, rect),
  previewRect: rect => ipcRenderer.invoke('radar:previewRect', rect),
  previewClose: () => ipcRenderer.invoke('radar:previewClose'),
  previewToTab: () => ipcRenderer.invoke('radar:previewToTab'),
  share: (at, title) => ipcRenderer.invoke('radar:share', at, title),
  zoomSave: () => ipcRenderer.invoke('radar:zoomSave'),
  zoomHas: url => ipcRenderer.invoke('radar:zoomHas', url),
  onPreviewState: fn => { ipcRenderer.on('radar:previewState', (e, st) => fn(st)); },
  onPreviewClosed: fn => { ipcRenderer.on('radar:previewClosed', () => fn()); }
});

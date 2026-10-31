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
  onRefresh: fn => { ipcRenderer.on('radar:refresh', () => fn()); }
});

'use strict';
// Ponte da página Futebol: ler os jogos de hoje, abrir um jogo no Sofascore, o tema e fechar.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('futebol', {
  details: () => ipcRenderer.invoke('futebol:details'),
  open: id => ipcRenderer.invoke('futebol:open', id),
  theme: () => ipcRenderer.invoke('futebol:theme'),
  close: () => ipcRenderer.invoke('futebol:close'),
  onTheme: fn => { ipcRenderer.on('futebol:theme', (e, t) => fn(t)); },
  onChanged: fn => { ipcRenderer.on('futebol:changed', () => fn()); }
});

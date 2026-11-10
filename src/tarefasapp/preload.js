'use strict';
// Ponte da página das Tarefas: só estas funções chegam ao processo principal do Zeus.
const { contextBridge, ipcRenderer } = require('electron');
const NAMES = ['state', 'add', 'change', 'done', 'remove', 'reorder', 'addArea', 'changeArea', 'removeArea', 'open', 'macgyver', 'events'];
const api = {};
NAMES.forEach(n => { api[n] = (...a) => ipcRenderer.invoke('tarefas:' + n, ...a); });
api.onChanged = fn => ipcRenderer.on('tarefas:changed', () => fn());
api.onTheme = fn => ipcRenderer.on('tarefas:theme', (e, d) => fn(d));
contextBridge.exposeInMainWorld('TF', api);

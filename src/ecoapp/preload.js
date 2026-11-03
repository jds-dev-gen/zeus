'use strict';
// Ponte do Eco: só estas funções chegam ao processo principal do Zeus.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const NAMES = ['theme', 'projects', 'load', 'save', 'create', 'remove', 'chooseFiles', 'addFiles', 'peaks', 'silences', 'preview', 'export', 'cancelExport', 'reveal', 'openOrfeu'];
const api = {};
NAMES.forEach(n => { api[n] = (...a) => ipcRenderer.invoke('eco:' + n, ...a); });
api.pathFor = file => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } };
['theme', 'busy', 'export', 'open'].forEach(ev => { api['on' + ev[0].toUpperCase() + ev.slice(1)] = fn => { ipcRenderer.on('eco:' + ev, (e, d) => fn(d)); }; });
contextBridge.exposeInMainWorld('ecoApp', api);

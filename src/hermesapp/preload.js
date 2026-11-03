'use strict';
// Ponte do Hermes: só estas funções chegam ao processo principal do Zeus.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (n, ...a) => ipcRenderer.invoke('hermes:' + n, ...a);
const NAMES = ['theme', 'places', 'pin', 'unpin', 'seenDownloads', 'list', 'counts', 'sizes', 'folderSize', 'recent', 'tagged', 'setTag', 'search', 'snippet', 'thumb', 'preview',
  'open', 'openWith', 'reveal', 'copyPath', 'rename', 'mkdir', 'move', 'copy', 'duplicate', 'chooseFolder', 'trash', 'compress', 'unzip', 'batchRename', 'convertOptions', 'convert', 'menu'];
const api = {};
NAMES.forEach(n => { api[n] = (...a) => call(n, ...a); });
api.drag = paths => ipcRenderer.send('hermes:drag', paths);
api.pathFor = file => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } };
['theme', 'changed', 'size', 'cmd', 'busy'].forEach(ev => { api['on' + ev[0].toUpperCase() + ev.slice(1)] = fn => { ipcRenderer.on('hermes:' + ev, (e, d) => fn(d)); }; });
contextBridge.exposeInMainWorld('hermesApp', api);

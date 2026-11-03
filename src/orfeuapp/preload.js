'use strict';
// Ponte do Orfeu: só estas funções chegam ao processo principal do Zeus.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (n, ...a) => ipcRenderer.invoke('orfeu:' + n, ...a);
const NAMES = ['theme', 'library', 'item', 'addPaths', 'openDialog', 'forget', 'setPos', 'touch', 'setQueue', 'setMarks', 'reveal', 'editInEco', 'addFolder', 'removeFolder',
  'folder', 'ensure', 'wave', 'jobs', 'dismissJob', 'convert', 'exportClip', 'exportAudio', 'marksToNote', 'transcribe', 'openNotes', 'subs', 'chooseSubs', 'clearConv'];
const api = {};
NAMES.forEach(n => { api[n] = (...a) => call(n, ...a); });
// caminho no Mac de um ficheiro arrastado para a página
api.pathFor = file => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } };
['theme', 'jobs', 'thumb', 'play'].forEach(ev => { api['on' + ev[0].toUpperCase() + ev.slice(1)] = fn => { ipcRenderer.on('orfeu:' + ev, (e, d) => fn(d)); }; });
contextBridge.exposeInMainWorld('orfeuApp', api);

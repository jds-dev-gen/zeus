'use strict';
// Ponte da página Notas: só estas funções chegam ao processo principal do Zeus.
const { contextBridge, ipcRenderer } = require('electron');
const call = (n, ...a) => ipcRenderer.invoke('notas:' + n, ...a);
const NAMES = ['theme', 'list', 'search', 'read', 'create', 'save', 'remove', 'addFolder', 'renameFolder', 'removeFolder', 'where', 'chooseRoot', 'resetRoot',
  'setWordCopy', 'reveal', 'openLink', 'exportWord', 'exportPdf', 'noteMenu', 'zoomHighlights', 'micAccess', 'recStart', 'recStop', 'recCancel',
  'modelState', 'modelDownload', 'modelCancel', 'modelRemove', 'jobs', 'takeResults', 'retryJob', 'dismissJob', 'hasKey', 'setKey', 'summarize'];
const api = {};
NAMES.forEach(n => { api[n] = (...a) => call(n, ...a); });
api.recPcm = buf => ipcRenderer.send('notas:recPcm', buf);
api.recAud = buf => ipcRenderer.send('notas:recAud', buf);
['changed', 'theme', 'cmd', 'model', 'jobs', 'results'].forEach(ev => {
  api['on' + ev[0].toUpperCase() + ev.slice(1)] = fn => { ipcRenderer.on('notas:' + ev, (e, d) => fn(d)); };
});
contextBridge.exposeInMainWorld('notasApp', api);

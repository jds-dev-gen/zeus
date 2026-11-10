'use strict';
// Ponte da bolinha do MacGyver: só estas funções chegam ao processo principal do Zeus.
const { contextBridge, ipcRenderer } = require('electron');
const NAMES = ['state', 'ask', 'done', 'change', 'remove', 'add', 'open', 'openNote', 'act', 'layout', 'setting', 'clearChat', 'setKey',
  'micAccess', 'listenStart', 'listenStop', 'stopSpeaking', 'speak', 'confirmReply', 'fresh', 'openSetup', 'dragStart', 'dragEnd', 'resetPos', 'history', 'openConv', 'deleteConv', 'openNotas', 'scriptUpdate'];
const api = {};
NAMES.forEach(n => { api[n] = (...a) => ipcRenderer.invoke('macgyver:' + n, ...a); });
api.pcm = buf => ipcRenderer.send('macgyver:pcm', buf);
['state', 'alert', 'listen', 'changed', 'theme', 'focus', 'toggle', 'anchor'].forEach(ev => {
  api['on' + ev[0].toUpperCase() + ev.slice(1)] = fn => { ipcRenderer.on('macgyver:' + ev, (e, d) => fn(d)); };
});
contextBridge.exposeInMainWorld('MG', api);

'use strict';
/*
 * Ponte entre a interface do Olimpo (e a barra flutuante) e o processo principal.
 * A interface não tem acesso ao Node: só a estas funções.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['state', 'web', 'claude', 'space', 'entrada', 'cmd', 'dock']);

contextBridge.exposeInMainWorld('olimpo', {
  call: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  on: (ch, fn) => {
    if (!EVENTS.has(ch)) throw new Error('evento desconhecido: ' + ch);
    const h = (e, data) => fn(data);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
  drag: p => ipcRenderer.send('files:drag', p),
  pathOf: file => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } }
});

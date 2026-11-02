'use strict';
// Ponte da página Zoom: ler e alterar os artigos guardados, as coleções e os destaques; abrir um artigo.
const { contextBridge, ipcRenderer } = require('electron');
const call = (n, ...a) => ipcRenderer.invoke('zoomapp:' + n, ...a);
contextBridge.exposeInMainWorld('zoomApp', {
  data: () => call('data'), theme: () => call('theme'),
  update: (id, patch) => call('update', id, patch), remove: id => call('remove', id),
  addCol: name => call('addCol', name), renameCol: (id, name) => call('renameCol', id, name), removeCol: id => call('removeCol', id), moveCol: (id, dir) => call('moveCol', id, dir),
  updateHl: (id, hid, patch) => call('updateHl', id, hid, patch), removeHl: (id, hid) => call('removeHl', id, hid),
  open: (id, bg) => call('open', id, bg), copy: t => call('copy', t),
  preview: (id, rect) => call('preview', id, rect), previewRect: rect => call('previewRect', rect),
  previewClose: () => call('previewClose'), previewToTab: () => call('previewToTab'),
  onPreviewClosed: fn => { ipcRenderer.on('zoomapp:previewClosed', () => fn()); },
  onPreviewState: fn => { ipcRenderer.on('zoomapp:previewState', (e, st) => fn(st)); },
  onChanged: fn => { ipcRenderer.on('zoomapp:changed', () => fn()); },
  onTheme: fn => { ipcRenderer.on('zoomapp:theme', (e, t) => fn(t)); }
});

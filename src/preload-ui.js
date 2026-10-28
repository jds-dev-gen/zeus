'use strict';
/*
 * Ponte entre a interface do Zeus e o processo principal.
 * Só expõe canais conhecidos; as páginas web nunca recebem este preload.
 */
const { contextBridge, ipcRenderer } = require('electron');
const { injectBrowserAction } = require('electron-chrome-extensions/browser-action');

// elemento <browser-action-list> com os botões das extensões
try { injectBrowserAction(); } catch (e) { /* sem extensões */ }

const INVOKE = new Set([
  'ready', 'layout', 'mosaic:prepare',
  'tab:new', 'tab:open', 'tab:close', 'tab:later', 'tab:move', 'tab:restore', 'tab:reopen',
  'navigate', 'nav', 'find', 'history:suggest', 'page:share', 'page:snapshot', 'pip:toggle',
  'space:add', 'space:rename', 'space:remove',
  'app:open', 'app:close', 'app:mode', 'app:add', 'app:update', 'app:remove', 'app:menu', 'app:reload', 'app:reorder', 'page:insertText',
  'claude:toggle', 'claude:sendPage', 'claude:ask', 'claude:new',
  'settings:set', 'permissions:list', 'permissions:forget',
  'ext:list', 'ext:store', 'ext:remove', 'data:clear', 'ui:focusPage',
  'update:status', 'update:check', 'update:install'
]);
const EVENTS = new Set(['state', 'alt', 'toast', 'ui-command', 'find-result', 'extensions', 'update']);

contextBridge.exposeInMainWorld('zeus', {
  platform: process.platform,
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) return Promise.reject(new Error('Canal desconhecido: ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, fn) {
    if (!EVENTS.has(channel)) return () => {};
    const h = (e, data) => fn(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  }
});

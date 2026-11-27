'use strict';
/*
 * Corre no início de cada página web aberta no Olimpo (Zeus, Apolo e apps web) — vem do Zeus.
 *  1. Desliga a API de "badge" da app (navigator.setAppBadge), que sites como o Gmail ou o
 *     WhatsApp usam para pôr o número vermelho no ícone na Dock.
 *  2. Na página de início de sessão da Google (accounts.google.com), esconde a API
 *     navigator.userAgentData, que o Firefox não tem: aí o Olimpo apresenta-se como Firefox
 *     (ver web.js), porque a Google recusa browsers feitos com Electron.
 */
const { contextBridge } = require('electron');

const google = location.hostname === 'accounts.google.com';
try {
  contextBridge.executeInMainWorld({
    func: isGoogle => {
      try {
        const noop = () => Promise.resolve();
        Object.defineProperty(Navigator.prototype, 'setAppBadge', { value: noop, configurable: true, writable: true });
        Object.defineProperty(Navigator.prototype, 'clearAppBadge', { value: noop, configurable: true, writable: true });
      } catch (e) { /* ignorar */ }
      if (isGoogle) { try { delete Navigator.prototype.userAgentData; } catch (e) { /* ignorar */ } }
    },
    args: [google]
  });
} catch (e) { /* ignorar */ }

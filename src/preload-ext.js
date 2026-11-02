'use strict';
/*
 * Corre nas páginas e nos service workers das extensões (chrome-extension://).
 * O Chromium já traz um objeto `browser` próprio (o nome usado pelo Firefox), que fica de fora das peças que o Zeus
 * acrescenta ao `chrome` (separadores, janelas, ícone da extensão…). Extensões feitas com o webextension-polyfill,
 * como o Raindrop, usam esse `browser` e perguntavam ao Chromium qual é o separador aberto — e a resposta vinha vazia
 * (sem título nem endereço). Aqui o `browser` passa a ser o mesmo `chrome` do Zeus.
 */
const { contextBridge } = require('electron');
try {
  if (typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
    contextBridge.executeInMainWorld({
      func: () => {
        const c = globalThis.chrome;
        if (!c) return;
        try { Object.defineProperty(globalThis, 'browser', { value: c, writable: true, configurable: true }); }
        catch (e) { try { globalThis.browser = c; } catch (e2) { /* ignorar */ } }
      }
    });
  }
} catch (e) { /* ignorar */ }

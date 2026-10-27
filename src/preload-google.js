'use strict';
/*
 * Só atua na página de início de sessão da Google (accounts.google.com).
 * A Google recusa browsers "embutidos"; nessa página o Zeus apresenta-se como Firefox
 * (ver main.js) e aqui esconde a API navigator.userAgentData, que o Firefox não tem,
 * para a identificação ser coerente. Não toca em mais nenhum site.
 */
const { contextBridge } = require('electron');

if (location.hostname === 'accounts.google.com') {
  try {
    contextBridge.executeInMainWorld({
      func: () => { try { delete Navigator.prototype.userAgentData; } catch (e) { /* ignorar */ } }
    });
  } catch (e) { /* ignorar */ }
}

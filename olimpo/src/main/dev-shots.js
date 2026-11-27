'use strict';
/*
 * Só para desenvolvimento: corre uma sequência de passos na interface e tira capturas do ecrã
 * (OLIMPO_SHOTS=caminho/para/passos.json). Não é carregado na app normal.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

module.exports = async function shots(getWin, file) {
  const steps = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = path.dirname(file);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const s of steps) {
    const win = getWin();
    if (s.wait) await wait(s.wait);
    if (s.js) { try { const r = await win.webContents.executeJavaScript(s.js, true); if (r !== undefined) console.log('[js]', JSON.stringify(r).slice(0, 2000)); } catch (e) { console.log('[js erro]', e.message); } }
    if (s.after) await wait(s.after);
    if (s.dock) {
      const { BrowserWindow } = require('electron');
      const d = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/dock/'));
      if (d) { const img = await d.webContents.capturePage(); fs.writeFileSync(path.join(out, s.dock + '.png'), img.toPNG()); console.log('[dock]', JSON.stringify(d.getBounds()), d.isVisible()); }
    }
    if (s.shot) await new Promise(r => execFile('import', ['-window', 'root', path.join(out, s.shot + '.png')], () => r()));
  }
  require('electron').app.exit(0);
};

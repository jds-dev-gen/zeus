'use strict';
/*
 * Apps do computador: listar as instaladas, os ícones, abrir, saber quais estão a correr
 * e trazê-las para a frente.
 *  - Mac: /Applications, /System/Applications e ~/Applications (pacotes .app).
 *  - Linux: ficheiros .desktop (para a fase seguinte do Olimpo).
 */
const fs = require('fs');
const path = require('path');
const { isMac, HOME, run } = require('./platform');

let cache = null, cacheAt = 0;

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function listMac() {
  const roots = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(HOME, 'Applications')];
  const out = new Map();
  for (const r of roots) {
    let names = [];
    try { names = fs.readdirSync(r); } catch (e) { continue; }
    for (const n of names) {
      if (!n.endsWith('.app')) {
        // apps dentro de pastas de fabricantes (ex.: /Applications/DaVinci Resolve/DaVinci Resolve.app)
        if (r === '/Applications' && !n.startsWith('.')) {
          try {
            for (const m of fs.readdirSync(path.join(r, n))) {
              if (m.endsWith('.app')) { const nome = m.slice(0, -4); const id = 'mac-' + slug(nome); if (!out.has(id)) out.set(id, { id, nome, tipo: 'mac', caminho: path.join(r, n, m) }); }
            }
          } catch (e) { /* não é pasta */ }
        }
        continue;
      }
      const nome = n.slice(0, -4);
      const id = 'mac-' + slug(nome);
      if (!out.has(id)) out.set(id, { id, nome, tipo: 'mac', caminho: path.join(r, n) });
    }
  }
  return [...out.values()];
}

function listLinux() {
  const dirs = ['/usr/share/applications', '/usr/local/share/applications', path.join(HOME, '.local', 'share', 'applications'), '/var/lib/flatpak/exports/share/applications'];
  const out = new Map();
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { continue; }
    for (const n of names) {
      if (!n.endsWith('.desktop')) continue;
      let txt = '';
      try { txt = fs.readFileSync(path.join(d, n), 'utf8'); } catch (e) { continue; }
      const sec = txt.split(/^\[/m).find(s => s.startsWith('Desktop Entry]')) || '';
      const get = k => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(sec); return m ? m[1].trim() : ''; };
      if (get('NoDisplay') === 'true' || get('Hidden') === 'true' || get('Type') !== 'Application') continue;
      const nome = get('Name[pt_PT]') || get('Name[pt]') || get('Name');
      if (!nome) continue;
      const id = 'mac-' + slug(nome);   // o prefixo mantém-se para os dados serem os mesmos nos dois sistemas
      if (!out.has(id)) out.set(id, { id, nome, tipo: 'mac', caminho: path.join(d, n), desktopId: n });
    }
  }
  return [...out.values()];
}

function installed(force = false) {
  if (cache && !force && Date.now() - cacheAt < 5 * 60 * 1000) return cache;
  cache = (isMac ? listMac() : listLinux()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  cacheAt = Date.now();
  return cache;
}

/* Ícone da app como dataURL (o Electron lê o ícone do pacote .app no Mac). */
const iconCache = new Map();
async function icon(electronApp, caminho, size = 'large') {
  const k = caminho + '|' + size;
  if (iconCache.has(k)) return iconCache.get(k);
  let url = '';
  try {
    const img = await electronApp.getFileIcon(caminho, { size });
    if (!img.isEmpty()) url = img.toDataURL();
  } catch (e) { /* sem ícone */ }
  iconCache.set(k, url);
  return url;
}

async function open(app, shell) {
  if (isMac) {
    await run('/usr/bin/open', ['-a', app.caminho]);
  } else if (app.desktopId) {
    try { await run('gtk-launch', [app.desktopId.replace(/\.desktop$/, '')]); }
    catch (e) { await shell.openPath(app.caminho); }
  } else {
    await shell.openPath(app.caminho);
  }
}

/*
 * Apps abertas e app da frente (Mac): pergunta ao System Events.
 * Da primeira vez o macOS pede autorização ("O Olimpo quer controlar o System Events").
 */
const RUNNING_JXA = `
const se = Application('System Events');
const procs = se.processes.whose({ backgroundOnly: false });
const names = procs.name();
let front = '';
try { front = se.processes.whose({ frontmost: true })[0].name(); } catch (e) {}
JSON.stringify({ names, front });`;
async function running() {
  if (!isMac) return { names: [], front: '', ok: false };
  try {
    const out = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', RUNNING_JXA], { timeout: 4000 });
    const r = JSON.parse(out);
    return { names: r.names || [], front: r.front || '', ok: true };
  } catch (e) {
    return { names: [], front: '', ok: false, error: String(e.stderr || e.message || e) };
  }
}

async function activate(app) {
  // "open -a" traz a app para a frente se já estiver aberta (não pede autorização)
  return open(app, require('electron').shell);
}

module.exports = { installed, icon, open, running, activate, slug };

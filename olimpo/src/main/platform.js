'use strict';
/*
 * Tudo o que muda entre o Mac e o Linux fica aqui, para o Olimpo poder vir a correr
 * no futuro sistema em Linux sem mexer no resto do código.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const HOME = os.homedir();

/* Pasta dos dados do Olimpo: ~/Library/Application Support/Olimpo (Mac) ou ~/.config/Olimpo (Linux). */
function dataDir() {
  if (isMac) return path.join(HOME, 'Library', 'Application Support', 'Olimpo');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Olimpo');
}

/* "~/Projetos" -> caminho absoluto; e o contrário, para mostrar. */
function expand(p) {
  if (!p) return p;
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}
function tilde(p) {
  if (!p) return p;
  return p === HOME ? '~' : p.startsWith(HOME + path.sep) ? '~' + p.slice(HOME.length) : p;
}

/* Pastas habituais, com os nomes que o utilizador vê. */
function userFolders() {
  const L = [
    ['Secretária', 'Desktop'], ['Documentos', 'Documents'], ['Transferências', 'Downloads'],
    ['Imagens', 'Pictures'], ['Vídeos', isMac ? 'Movies' : 'Videos'], ['Música', 'Music']
  ];
  return L.map(([nome, dir]) => ({ nome, path: path.join(HOME, dir) })).filter(f => fs.existsSync(f.path));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout || 20000, ...opts }, (err, out, errOut) => {
      if (err) { err.stderr = errOut; reject(err); } else resolve(out);
    });
  });
}

/* Procura um executável nos sítios habituais (as apps abertas a partir do Finder não herdam o PATH do terminal). */
function findExecutable(name, extra = []) {
  const dirs = [
    ...extra,
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(HOME, '.local', 'bin'), path.join(HOME, '.claude', 'local'), path.join(HOME, '.npm-global', 'bin'),
    path.join(HOME, 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'
  ];
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch (e) { /* não está aqui */ }
  }
  return null;
}

module.exports = { isMac, isLinux, HOME, dataDir, expand, tilde, userFolders, run, findExecutable };

'use strict';
/*
 * Ficheiros: procurar (Spotlight no Mac, índice próprio no Linux), recentes, filtros,
 * Entrada (ficheiros novos por arrumar), arrumar num projeto e mandar para o Lixo.
 * Nada se apaga diretamente: remover é sempre mover para o Lixo, depois de confirmar na interface.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { isMac, HOME, expand, tilde } = require('./platform');

const KIND_EXT = {
  doc: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'pages', 'odt', 'xls', 'xlsx', 'csv', 'numbers', 'key', 'ppt', 'pptx', 'odp', 'ods', 'epub', 'json', 'html'],
  img: ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'tif', 'tiff', 'bmp', 'svg', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'psd'],
  audio: ['mp3', 'wav', 'aif', 'aiff', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'wma'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts', 'wmv', 'drp', 'braw', 'mxf'],
  apps: ['app', 'dmg', 'pkg', 'appimage', 'deb']
};
const EXT_KIND = {};
for (const [k, list] of Object.entries(KIND_EXT)) for (const e of list) EXT_KIND[e] = k;
const extOf = p => path.extname(p).slice(1).toLowerCase();
const kindOf = p => EXT_KIND[extOf(p)] || 'outros';

const SPOTLIGHT_TYPES = {
  doc: '(kMDItemContentTypeTree == "public.text" || kMDItemContentTypeTree == "com.adobe.pdf" || kMDItemContentTypeTree == "public.composite-content" || kMDItemContentTypeTree == "public.presentation" || kMDItemContentTypeTree == "public.spreadsheet")',
  img: 'kMDItemContentTypeTree == "public.image"',
  audio: 'kMDItemContentTypeTree == "public.audio"',
  video: 'kMDItemContentTypeTree == "public.movie"'
};

const skipDir = n => n.startsWith('.') || n === 'node_modules' || n === 'Library' || n === '__pycache__' || n.endsWith('.photoslibrary') || n.endsWith('.app');

/* Corre o mdfind e pára ao fim de `limit` linhas ou do tempo máximo. */
function mdfind(args, { limit = 60, timeout = 1500 } = {}) {
  return new Promise(resolve => {
    const out = [];
    let buf = '';
    let p;
    try { p = spawn('/usr/bin/mdfind', args); } catch (e) { resolve(out); return; }
    const done = () => { clearTimeout(t); try { p.kill(); } catch (e) { /* já acabou */ } resolve(out); };
    const t = setTimeout(done, timeout);
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line) out.push(line);
        if (out.length >= limit) { done(); return; }
      }
    });
    p.on('error', done);
    p.on('close', () => { if (buf) out.push(buf); done(); });
  });
}
const mdq = s => String(s).replace(/["\\*]/g, ' ').trim();

/* ---------- índice próprio (Linux, ou Mac sem Spotlight) ---------- */
class FileIndex {
  constructor() { this.items = []; this.building = null; this.builtAt = 0; }
  async build(roots = [HOME], max = 200000) {
    if (this.building) return this.building;
    this.building = (async () => {
      const items = [];
      const queue = roots.slice();
      while (queue.length && items.length < max) {
        const dir = queue.shift();
        let d;
        try { d = await fsp.opendir(dir); } catch (e) { continue; }
        for await (const ent of d) {
          if (skipDir(ent.name)) continue;
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) { queue.push(p); continue; }
          if (!ent.isFile()) continue;
          try { const st = await fsp.stat(p); items.push({ p, n: ent.name.toLowerCase(), size: st.size, mtime: st.mtimeMs, atime: st.atimeMs }); } catch (e) { /* sumiu */ }
          if (items.length >= max) break;
        }
      }
      this.items = items; this.builtAt = Date.now(); this.building = null;
      return items;
    })();
    return this.building;
  }
  async ready() { if (!this.builtAt || Date.now() - this.builtAt > 30 * 60 * 1000) { if (this.items.length) this.build(); else await this.build(); } }
}
const index = new FileIndex();

async function describe(paths) {
  const out = [];
  for (const p of paths) {
    try {
      const st = await fsp.stat(p);
      out.push({ path: p, nome: path.basename(p), onde: tilde(path.dirname(p)), size: st.isDirectory() ? null : st.size, mtime: st.mtimeMs, kind: st.isDirectory() ? 'pasta' : kindOf(p), ext: st.isDirectory() ? '' : extOf(p) });
    } catch (e) { /* já não existe */ }
  }
  return out;
}

/*
 * Procurar ficheiros.
 *  q: texto (nome ou conteúdo); kind: doc|img|audio|video; hoje: bool; grandes: bool (+1 GB)
 */
async function search({ q = '', kind = null, hoje = false, grandes = false, limit = 40, conteudo = true } = {}) {
  q = String(q || '').trim();
  if (isMac) {
    const conds = [];
    if (kind && SPOTLIGHT_TYPES[kind]) conds.push(SPOTLIGHT_TYPES[kind]);
    if (hoje) conds.push('kMDItemFSContentChangeDate >= $time.today');
    if (grandes) conds.push('kMDItemFSSize > 1000000000');
    let paths = [];
    if (q) {
      const byName = await mdfind(['-onlyin', HOME, [`kMDItemFSName == "*${mdq(q)}*"cdw`, ...conds].join(' && ')], { limit });
      paths = byName;
      if (conteudo && paths.length < limit && q.length > 2) {
        // por descrição/conteúdo (o Spotlight interpreta o texto)
        const more = conds.length ? await mdfind(['-onlyin', HOME, [`kMDItemTextContent == "${mdq(q)}"cdw`, ...conds].join(' && ')], { limit: limit - paths.length })
          : await mdfind(['-onlyin', HOME, '-interpret', q], { limit: limit - paths.length });
        for (const p of more) if (!paths.includes(p)) paths.push(p);
      }
    } else if (conds.length) {
      paths = await mdfind(['-onlyin', HOME, conds.join(' && ')], { limit: limit * 3 });
    }
    paths = paths.filter(p => !p.split(path.sep).some(seg => seg.startsWith('.') || seg === 'Library'));
    const items = await describe(paths.slice(0, limit * 2));
    return sortResults(items, q).slice(0, limit);
  }
  await index.ready();
  const ql = q.toLowerCase();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const res = [];
  for (const it of index.items) {
    if (ql && !it.n.includes(ql)) continue;
    if (kind && kindOf(it.p) !== kind) continue;
    if (hoje && it.mtime < today.getTime()) continue;
    if (grandes && it.size < 1e9) continue;
    res.push(it.p);
    if (res.length >= limit * 3) break;
  }
  return sortResults(await describe(res), q).slice(0, limit);
}

function sortResults(items, q) {
  const ql = q.toLowerCase();
  const score = it => {
    const n = it.nome.toLowerCase();
    let s = 0;
    if (ql) { if (n === ql) s += 1000; else if (n.startsWith(ql)) s += 500; else if (n.includes(ql)) s += 200; }
    s += Math.max(0, 100 - (Date.now() - it.mtime) / 86400000);   // mais recente, mais acima
    return s;
  };
  return items.sort((a, b) => score(b) - score(a));
}

/* Ficheiros abertos recentemente (Spotlight: kMDItemLastUsedDate). */
async function recent({ dias = 14, limit = 12 } = {}) {
  if (isMac) {
    const lines = await mdfind(['-onlyin', HOME, '-attr', 'kMDItemLastUsedDate', `kMDItemLastUsedDate >= $time.today(-${dias}) && kMDItemContentTypeTree != "public.folder" && kMDItemContentTypeTree != "com.apple.application"`], { limit: 400, timeout: 2500 });
    const rows = [];
    for (const l of lines) {
      const m = /^(.*?)\s+kMDItemLastUsedDate = (.*)$/.exec(l);
      if (!m) continue;
      const p = m[1].trim();
      if (p.split(path.sep).some(seg => seg.startsWith('.') || seg === 'Library')) continue;
      const t = Date.parse(m[2].replace(' +0000', 'Z').replace(' ', 'T'));
      rows.push({ p, t: isNaN(t) ? 0 : t });
    }
    rows.sort((a, b) => b.t - a.t);
    const items = await describe(rows.slice(0, limit).map(r => r.p));
    const byP = new Map(rows.map(r => [r.p, r.t]));
    items.forEach(it => { it.usado = byP.get(it.path) || it.mtime; });
    return items;
  }
  await index.ready();
  const items = index.items.slice().sort((a, b) => Math.max(b.atime, b.mtime) - Math.max(a.atime, a.mtime)).slice(0, limit);
  const out = await describe(items.map(i => i.p));
  out.forEach(it => { const i = items.find(x => x.p === it.path); it.usado = i ? Math.max(i.atime, i.mtime) : it.mtime; });
  return out;
}

/* ---------- Entrada ---------- */
async function entrada(cfg) {
  const dias = cfg.entradaDias || 14;
  const since = Date.now() - dias * 86400000;
  const dispensados = new Set(cfg.dispensados || []);
  const out = [];
  for (const dir of (cfg.entrada || []).map(expand)) {
    let names = [];
    try { names = await fsp.readdir(dir); } catch (e) { continue; }
    for (const n of names) {
      if (n.startsWith('.') || /\.(crdownload|download|part|tmp)$/i.test(n) || n === 'Icon\r') continue;
      const p = path.join(dir, n);
      if (dispensados.has(p)) continue;
      let st;
      try { st = await fsp.stat(p); } catch (e) { continue; }
      const t = Math.max(st.mtimeMs, st.birthtimeMs || 0);
      if (t < since) continue;
      const isDir = st.isDirectory();
      out.push({ path: p, nome: n, onde: tilde(dir), size: isDir ? null : st.size, mtime: t, kind: isDir ? 'pasta' : kindOf(p), ext: isDir ? '' : extOf(p) });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/* Vigia as pastas da Entrada; chama onChange (com atraso) quando algo muda. */
function watchEntrada(cfg, onChange) {
  const watchers = [];
  let t = null;
  const kick = () => { clearTimeout(t); t = setTimeout(onChange, 800); };
  for (const dir of (cfg.entrada || []).map(expand)) {
    try { watchers.push(fs.watch(dir, { persistent: false }, kick)); } catch (e) { /* pasta não existe */ }
  }
  return () => { clearTimeout(t); watchers.forEach(w => { try { w.close(); } catch (e) { /* ok */ } }); };
}

/* Mover para uma pasta (ex.: a do projeto), sem nunca escrever por cima de outro ficheiro. */
async function freeName(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let cand = name, i = 2;
  for (;;) {
    try { await fsp.access(path.join(dir, cand)); cand = `${base} (${i++})${ext}`; } catch (e) { return path.join(dir, cand); }
  }
}
async function moveTo(src, destDir) {
  destDir = expand(destDir);
  await fsp.mkdir(destDir, { recursive: true });
  if (path.resolve(path.dirname(src)) === path.resolve(destDir)) return src;
  const dest = await freeName(destDir, path.basename(src));
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    // outro disco: copia e só depois tira o original
    await fsp.cp(src, dest, { recursive: true, errorOnExist: true, preserveTimestamps: true });
    await fsp.rm(src, { recursive: true });
  }
  return dest;
}

async function listDir(dir, { limit = 300 } = {}) {
  dir = expand(dir);
  let names = [];
  try { names = await fsp.readdir(dir); } catch (e) { return []; }
  const items = await describe(names.filter(n => !n.startsWith('.')).slice(0, limit).map(n => path.join(dir, n)));
  return items.sort((a, b) => ((b.kind === 'pasta') - (a.kind === 'pasta')) || b.mtime - a.mtime);
}

module.exports = { search, recent, entrada, watchEntrada, moveTo, listDir, describe, kindOf, extOf, KIND_EXT, index, skipDir, mdfind };

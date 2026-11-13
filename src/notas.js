'use strict';
/*
 * Notas — guardadas como ficheiros .html normais numa pasta (por defeito, dentro do Google Drive).
 * Cada subpasta é uma "pasta" das notas. Os dados do Zeus (id, favorita, data, áudio) ficam em <meta> no próprio ficheiro,
 * por isso a pasta pode ser copiada, sincronizada ou aberta noutro lado sem perder nada.
 *   <raiz>/<Pasta>/<Título>.html      a nota
 *   <raiz>/<Pasta>/<Título>.docx      cópia em Word (automática)
 *   <raiz>/<Pasta>/<Título> — áudio.m4a   gravação da reunião, se houver
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const START = '<!--zeus:inicio-->', END = '<!--zeus:fim-->';
const FILE_CSS = `body{font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:760px;margin:40px auto;padding:0 24px}
h1{font-size:30px;line-height:1.2;margin:0 0 18px}h2{font-size:22.5px;margin:26px 0 8px}h3{font-size:18px;margin:20px 0 6px}
blockquote{margin:16px 0;padding:10px 16px;border-left:3px solid #d8b400;background:#f6f6f4;border-radius:0 8px 8px 0}
ul.todo{list-style:none;padding-left:4px}ul.todo li::before{content:"☐  "}ul.todo li[data-done]::before{content:"☑  "}ul.todo li[data-done]{color:#888;text-decoration:line-through}
.ts{font-family:Menlo,monospace;font-size:12px;color:#777;margin-right:6px}.src{font-size:13px;color:#666}a{color:#1a5fb4}`;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = s => String(s || '').replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
// nome de ficheiro a partir do título: sem caracteres proibidos no Mac, no Windows ou no Drive
function fileBase(title) {
  let b = String(title || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (b.length > 80) b = b.slice(0, 80).trim();
  return b || 'Sem título';
}
const okFolder = name => { const n = fileBase(name); return n === 'Sem título' && !String(name || '').trim() ? '' : n; };
const toText = html => unesc(String(html || '').replace(/<(br|\/p|\/h[1-3]|\/li|\/blockquote)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t ]+/g, ' ').replace(/\n\s*/g, '\n').trim();

// pasta do Google Drive no Mac (app "Google Drive para computador"): ~/Library/CloudStorage/GoogleDrive-<conta>/<O meu disco>
function findGoogleDrive() {
  const base = path.join(os.homedir(), 'Library', 'CloudStorage');
  let accts = [];
  try { accts = fs.readdirSync(base).filter(n => /^GoogleDrive-/i.test(n)); } catch (e) { return null; }
  for (const a of accts) {
    let subs = [];
    try { subs = fs.readdirSync(path.join(base, a), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch (e) { continue; }
    const mine = subs.find(n => /^(my drive|o meu disco|a minha unidade|meu drive|mi unidad|mon drive)$/i.test(n))
      || subs.find(n => !/shared|partilhad|compartilhad|other computers|outros computadores|computadores/i.test(n));
    if (mine) return path.join(base, a, mine);
  }
  return null;
}

class Notas {
  constructor(userData, onChange) {
    this.cfgFile = path.join(userData, 'notas.json');
    this.cacheFile = path.join(userData, 'notas-cache.json');
    this.onChange = onChange || (() => {});
    try { this.cfg = JSON.parse(fs.readFileSync(this.cfgFile, 'utf8')); } catch (e) { this.cfg = {}; }
    try { this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch (e) { this.cache = {}; }
    this.index = new Map();   // id -> info
    this.scanned = false;
  }
  saveCfg() { try { fs.writeFileSync(this.cfgFile, JSON.stringify(this.cfg, null, 1)); } catch (e) { /* ok */ } }
  saveCache() { clearTimeout(this.cacheT); this.cacheT = setTimeout(() => { try { fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache)); } catch (e) { /* ok */ } }, 1000); }

  /* ---------- onde ficam ---------- */
  autoRoot() {
    if (process.env.ZEUS_TEST_NOTAS) return { dir: process.env.ZEUS_TEST_NOTAS, drive: false };
    const g = findGoogleDrive();
    if (g) return { dir: path.join(g, 'Zeus Notas'), drive: true };
    return { dir: path.join(os.homedir(), 'Documents', 'Zeus Notas'), drive: false };
  }
  root() {
    if (this.cfg.root) return this.cfg.root;
    return this.autoRoot().dir;
  }
  where() {
    const r = this.root();
    const drive = /CloudStorage[\/\\]GoogleDrive-/i.test(r) ? 'Google Drive' : /CloudStorage[\/\\]ProtonDrive/i.test(r) ? 'Proton Drive' : /CloudStorage[\/\\]/i.test(r) ? 'a cloud' : '';
    // caminho legível: "Google Drive › Zeus Notas"
    let nice = r;
    const m = /CloudStorage[\/\\][^\/\\]+[\/\\](.+)$/.exec(r);
    if (m) nice = (drive || 'Cloud') + ' › ' + m[1].split(/[\/\\]/).slice(1).join(' › ');
    else nice = r.replace(os.homedir(), '~').split(/[\/\\]/).filter(Boolean).join(' › ');
    return { root: r, nice, drive, custom: !!this.cfg.root, exists: fs.existsSync(r), wordCopy: this.cfg.wordCopy !== false };
  }
  setRoot(dir) { this.cfg.root = dir || ''; this.saveCfg(); this.index.clear(); this.scanned = false; }
  setWordCopy(on) { this.cfg.wordCopy = !!on; this.saveCfg(); }
  ensureRoot() { fs.mkdirSync(this.root(), { recursive: true }); }

  /* ---------- ler a pasta ---------- */
  parse(txt) {
    const meta = n => { const m = new RegExp(`<meta name="zeus-${n}" content="([^"]*)"`).exec(txt); return m ? unesc(m[1]) : ''; };
    const t = /<title>([\s\S]*?)<\/title>/i.exec(txt);
    let html;
    const a = txt.indexOf(START), b = txt.lastIndexOf(END);
    if (a > -1 && b > a) html = txt.slice(a + START.length, b).trim();
    else { const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(txt); html = m ? m[1].trim() : txt; }   // ficheiro .html que não foi feito pelo Zeus
    return { id: meta('id'), title: t ? unesc(t[1]).trim() : '', fav: meta('fav') === '1', created: meta('created'), audio: meta('audio'), html };
  }
  async scan() {
    const root = this.root();
    const seen = new Map(), folders = [];
    let entries = [];
    try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { entries = []; }
    const dirs = [{ rel: '', abs: root }];
    for (const d of entries) if (d.isDirectory() && !d.name.startsWith('.')) { dirs.push({ rel: d.name, abs: path.join(root, d.name) }); folders.push(d.name); }
    for (const d of dirs) {
      let files = [];
      try { files = (await fsp.readdir(d.abs)).filter(f => /\.html?$/i.test(f) && !f.startsWith('.')); } catch (e) { continue; }
      for (const f of files) {
        const p = path.join(d.abs, f);
        let st; try { st = await fsp.stat(p); } catch (e) { continue; }
        let c = this.cache[p];
        if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
          let txt; try { txt = await fsp.readFile(p, 'utf8'); } catch (e) { continue; }
          const n = this.parse(txt);
          if (!n.id) {   // ficheiro de fora (ou antigo): dá-se-lhe um id, sem lhe mexer no conteúdo até ser editado
            const prev = Object.values(this.cache).find(x => x.path === p);
            n.id = prev && prev.id ? prev.id : 'x' + crypto.createHash('sha1').update(p).digest('hex').slice(0, 12);
          }
          const text = toText(n.html);
          c = { path: p, mtime: st.mtimeMs, size: st.size, id: n.id, title: n.title || f.replace(/\.html?$/i, ''), fav: n.fav, created: n.created || new Date(st.birthtimeMs || st.mtimeMs).toISOString(), audio: n.audio, excerpt: text.slice(0, 220), text: text.slice(0, 40000), words: (text.match(/\S+/g) || []).length };
          this.cache[p] = c;
        }
        if (seen.has(c.id)) continue;   // cópia duplicada (o Drive às vezes cria "… (1).html"): fica a primeira
        seen.set(c.id, Object.assign({}, c, { folder: d.rel, updated: st.mtimeMs }));
      }
    }
    // limpa da cache ficheiros que já não existem
    const live = new Set([...seen.values()].map(x => x.path));
    for (const k of Object.keys(this.cache)) if (!live.has(k)) delete this.cache[k];
    this.saveCache();
    this.index = seen; this.folderList = folders.sort((a, b) => a.localeCompare(b, 'pt'));
    this.scanned = true;
    return this.list();
  }
  list() {
    const ct = n => Date.parse(n.created) || n.updated || 0;
    const notes = [...this.index.values()].sort((a, b) => ct(b) - ct(a) || b.updated - a.updated)   // a criada mais recentemente em cima
      .map(n => ({ id: n.id, title: n.title, folder: n.folder, fav: n.fav, created: n.created, updated: n.updated, excerpt: n.excerpt, audio: !!n.audio, words: n.words }));
    const folders = (this.folderList || []).map(name => ({ name, count: notes.filter(n => n.folder === name).length }));
    return { where: this.where(), folders, notes };
  }
  search(q) {
    const fold = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    return [...this.index.values()].filter(n => { const hay = fold(n.title + ' ' + n.text); return words.every(w => hay.includes(w)); }).map(n => n.id);
  }
  info(id) { return this.index.get(String(id)) || null; }

  /* ---------- escrever ---------- */
  render(n) {
    return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(n.title)}</title>
<meta name="generator" content="Zeus Notas">
<meta name="zeus-id" content="${esc(n.id)}">
<meta name="zeus-created" content="${esc(n.created)}">
<meta name="zeus-fav" content="${n.fav ? 1 : 0}">
<meta name="zeus-audio" content="${esc(n.audio || '')}">
<style>${FILE_CSS}</style>
</head>
<body>
<h1>${esc(n.title)}</h1>
${START}
${n.html || ''}
${END}
</body>
</html>
`;
  }
  async writeAtomic(p, txt) {
    const tmp = path.join(path.dirname(p), '.' + path.basename(p) + '.' + process.pid + '.tmp');
    await fsp.writeFile(tmp, txt, 'utf8');
    await fsp.rename(tmp, p);
  }
  freeName(dir, base, ext, self) {
    let name = base + ext, k = 2;
    while (fs.existsSync(path.join(dir, name)) && path.join(dir, name) !== self) name = `${base} ${k++}${ext}`;
    return path.join(dir, name);
  }
  companions(p, audio) {
    const dir = path.dirname(p), base = path.basename(p).replace(/\.html?$/i, '');
    const out = [path.join(dir, base + '.docx')];
    if (audio && !path.isAbsolute(audio)) out.push(path.join(dir, audio));
    return out;
  }
  async read(id) {
    const n = this.info(id); if (!n) return null;
    let txt; try { txt = await fsp.readFile(n.path, 'utf8'); } catch (e) { return null; }
    const p = this.parse(txt);
    return { id: n.id, title: p.title || n.title, html: p.html, fav: n.fav, folder: n.folder, created: n.created, updated: n.updated, audio: n.audio ? (path.isAbsolute(n.audio) ? n.audio : path.join(path.dirname(n.path), n.audio)) : '' };
  }
  async create(folder, title, html = '', audio = '') {
    this.ensureRoot();
    folder = folder && (this.folderList || []).includes(folder) ? folder : '';
    const dir = path.join(this.root(), folder);
    await fsp.mkdir(dir, { recursive: true });
    const n = { id: uid(), title: String(title || '').trim() || 'Nota sem título', fav: false, created: new Date().toISOString(), audio: audio || '', html };
    const p = this.freeName(dir, fileBase(n.title), '.html');
    await this.writeAtomic(p, this.render(n));
    await this.scan();
    this.onChange();
    return n.id;
  }
  // grava conteúdo e título; muda o nome do ficheiro (e da cópia em Word e do áudio) quando o título muda
  async save(id, patch) {
    const n = this.info(id); if (!n) return null;
    let cur; try { cur = this.parse(await fsp.readFile(n.path, 'utf8')); } catch (e) { cur = { html: '', title: n.title }; }
    const next = {
      id: n.id, created: n.created, audio: 'audio' in patch ? patch.audio : n.audio,
      fav: 'fav' in patch ? !!patch.fav : n.fav,
      title: 'title' in patch ? (String(patch.title || '').trim().slice(0, 200) || 'Nota sem título') : (cur.title || n.title),
      html: 'html' in patch ? String(patch.html || '') : cur.html
    };
    let p = n.path;
    const dir = path.dirname(p);
    if (fileBase(next.title) !== fileBase(n.title) || 'folder' in patch) {
      const ndir = 'folder' in patch ? path.join(this.root(), patch.folder && (this.folderList || []).includes(patch.folder) ? patch.folder : '') : dir;
      const np = this.freeName(ndir, fileBase(next.title), '.html', p);
      if (np !== p) {
        const oldBase = path.basename(p).replace(/\.html?$/i, ''), newBase = path.basename(np).replace(/\.html?$/i, '');
        // a cópia em Word e o áudio acompanham a nota
        try { await fsp.rename(path.join(dir, oldBase + '.docx'), path.join(ndir, newBase + '.docx')); } catch (e) { /* sem cópia */ }
        if (next.audio && !path.isAbsolute(next.audio)) {
          const na = next.audio.startsWith(oldBase) ? newBase + next.audio.slice(oldBase.length) : next.audio;
          try { await fsp.rename(path.join(dir, next.audio), path.join(ndir, na)); next.audio = na; } catch (e) { /* ok */ }
        }
        await this.writeAtomic(np, this.render(next));
        try { await fsp.unlink(p); } catch (e) { /* ok */ }
        delete this.cache[p];
        p = np;
      } else await this.writeAtomic(p, this.render(next));
    } else await this.writeAtomic(p, this.render(next));
    await this.scan();
    this.onChange();
    const i = this.info(id);
    return i ? { id, title: i.title, folder: i.folder, fav: i.fav, updated: i.updated, path: i.path } : null;
  }
  /* ---------- Lixo das Notas ----------
     Apagar uma nota leva-a (com a cópia em Word e a gravação) para a pasta escondida ".lixo" dentro da pasta das notas,
     numa subpasta só dela; fica lá 30 dias e depois vai para o Lixo do Mac. Pode ser recuperada para a pasta onde estava. */
  trashDir() { return path.join(this.root(), '.lixo'); }
  async trashIndex() { try { return JSON.parse(await fsp.readFile(path.join(this.trashDir(), 'lixo.json'), 'utf8')); } catch (e) { return []; } }
  async trashSave(list) { await fsp.mkdir(this.trashDir(), { recursive: true }); await this.writeAtomic(path.join(this.trashDir(), 'lixo.json'), JSON.stringify(list, null, 1)); }
  async remove(id, trash) {
    const n = this.info(id); if (!n) return false;
    const key = n.id.replace(/[^\w-]/g, '') + '-' + Date.now().toString(36);
    const dir = path.join(this.trashDir(), key);
    const files = [];
    try {
      await fsp.mkdir(dir, { recursive: true });
      for (const f of [n.path, ...this.companions(n.path, n.audio)]) {
        if (!fs.existsSync(f)) continue;
        const dst = path.join(dir, path.basename(f));
        try { await fsp.rename(f, dst); } catch (e) { await fsp.copyFile(f, dst); await fsp.unlink(f); }
        files.push(path.basename(f));
      }
      const list = await this.trashIndex();
      list.unshift({ key, id: n.id, title: n.title, folder: n.folder || '', created: n.created, deletedAt: Date.now(), main: path.basename(n.path), files, excerpt: n.excerpt || '', words: n.words || 0, audio: !!n.audio });
      await this.trashSave(list);
    } catch (e) {
      // sem conseguir usar o Lixo das Notas: como antes, vai para o Lixo do Mac
      for (const f of [n.path, ...this.companions(n.path, n.audio)]) { if (!fs.existsSync(f)) continue; try { await trash(f); } catch (e2) { try { await fsp.unlink(f); } catch (e3) { /* ok */ } } }
    }
    await this.scan(); this.onChange(); return true;
  }
  async trashList(trash) {
    let list = await this.trashIndex();
    const old = list.filter(t => Date.now() - t.deletedAt > 30 * 864e5);
    if (old.length) {
      for (const t of old) { const d = path.join(this.trashDir(), t.key); try { await trash(d); } catch (e) { try { await fsp.rm(d, { recursive: true, force: true }); } catch (e2) { /* ok */ } } }
      list = list.filter(t => !old.includes(t)); await this.trashSave(list);
    }
    return list.filter(t => fs.existsSync(path.join(this.trashDir(), t.key, t.main)))
      .map(t => ({ key: t.key, title: t.title, folder: t.folder, created: t.created, deletedAt: t.deletedAt, excerpt: t.excerpt, words: t.words, audio: t.audio, folderExists: !t.folder || (this.folderList || []).includes(t.folder) }));
  }
  async trashRead(key) {
    const t = (await this.trashIndex()).find(x => x.key === key); if (!t) return null;
    let txt; try { txt = await fsp.readFile(path.join(this.trashDir(), t.key, t.main), 'utf8'); } catch (e) { return null; }
    const p = this.parse(txt);
    return { key: t.key, title: p.title || t.title, html: p.html, folder: t.folder, deletedAt: t.deletedAt, created: t.created };
  }
  async restore(key) {
    const list = await this.trashIndex(); const t = list.find(x => x.key === key); if (!t) return null;
    this.ensureRoot();
    const folder = t.folder && (this.folderList || []).includes(t.folder) ? t.folder : '';
    const dstDir = folder ? path.join(this.root(), folder) : this.root();
    const src = path.join(this.trashDir(), t.key);
    // a nota principal pode ter de mudar de nome (se entretanto houver outra igual); a gravação e a cópia em Word acompanham
    const base = t.main.replace(/\.html?$/i, '');
    const mainDst = this.freeName(dstDir, base, '.html');
    const newBase = path.basename(mainDst).replace(/\.html?$/i, '');
    for (const f of t.files) {
      const from = path.join(src, f);
      let to = f === t.main ? mainDst : path.join(dstDir, f.startsWith(base) && newBase !== base ? newBase + f.slice(base.length) : f);
      if (f !== t.main && fs.existsSync(to)) { const ext = (/\.[^.]+$/.exec(f) || [''])[0]; to = this.freeName(dstDir, path.basename(to, ext), ext); }
      try { await fsp.rename(from, to); } catch (e) { try { await fsp.copyFile(from, to); await fsp.unlink(from); } catch (e2) { /* ok */ } }
      // se a gravação mudou de nome, a nota tem de apontar para o nome novo
      if (f !== t.main && path.basename(to) !== f && fs.existsSync(mainDst)) {
        try { const html = await fsp.readFile(mainDst, 'utf8'); await this.writeAtomic(mainDst, html.split(`content="${f.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join(`content="${path.basename(to).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)); } catch (e) { /* ok */ }
      }
    }
    try { await fsp.rm(src, { recursive: true, force: true }); } catch (e) { /* ok */ }
    await this.trashSave(list.filter(x => x !== t));
    await this.scan(); this.onChange();
    return { id: t.id, folder, title: t.title, folderGone: !!t.folder && !folder };
  }
  async purge(key, trash) {
    const list = await this.trashIndex();
    const keys = key === '*' ? list.map(t => t.key) : [key];
    for (const k of keys) { const d = path.join(this.trashDir(), k); if (!fs.existsSync(d)) continue; try { await trash(d); } catch (e) { try { await fsp.rm(d, { recursive: true, force: true }); } catch (e2) { /* ok */ } } }
    await this.trashSave(list.filter(t => !keys.includes(t.key)));
    this.onChange(); return true;
  }
  async addFolder(name) {
    const n = okFolder(name); if (!n) return null;
    this.ensureRoot();
    const p = path.join(this.root(), n);
    if (fs.existsSync(p)) return n;
    await fsp.mkdir(p); await this.scan(); this.onChange(); return n;
  }
  async renameFolder(from, to) {
    const n = okFolder(to); if (!n || !(this.folderList || []).includes(from)) return null;
    if (n === from) return n;
    const dst = path.join(this.root(), n);
    if (fs.existsSync(dst)) return null;
    await fsp.rename(path.join(this.root(), from), dst);
    await this.scan(); this.onChange(); return n;
  }
  // apagar uma pasta: as notas (e as cópias e gravações) passam para a raiz; a pasta vai para o Lixo
  async removeFolder(name, trash) {
    if (!(this.folderList || []).includes(name)) return false;
    const dir = path.join(this.root(), name);
    let files = []; try { files = await fsp.readdir(dir); } catch (e) { /* ok */ }
    for (const f of files) {
      if (f.startsWith('.')) continue;
      const dst = this.freeName(this.root(), f.replace(/\.[^.]+$/, ''), (/\.[^.]+$/.exec(f) || [''])[0]);
      try { await fsp.rename(path.join(dir, f), dst); } catch (e) { /* ok */ }
    }
    try { await trash(dir); } catch (e) { try { await fsp.rmdir(dir); } catch (e2) { /* ok */ } }
    await this.scan(); this.onChange(); return true;
  }
}

module.exports = { Notas, fileBase, toText, FILE_CSS, findGoogleDrive };

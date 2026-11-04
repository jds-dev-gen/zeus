'use strict';
/*
 * Hermes — explorador de ficheiros do Zeus (parte do processo principal).
 * Pastas do Mac, Google Drive e iCloud; mudar nomes, mover, copiar, comprimir, etiquetas do Finder, Lixo;
 * pesquisa do Spotlight (nomes e conteúdo); espaço ocupado pelas pastas; conversão rápida; arrastar ficheiros para as páginas.
 * Os ficheiros e pastas escondidos (começados por ".") nunca aparecem. Apagar vai sempre para o Lixo.
 * Só a página interna do Hermes pode chamar estas funções.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { findGoogleDrive } = require('./notas');

const HOME = os.homedir();
const isMac = process.platform === 'darwin';
const KIND = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'svg', 'avif', 'raw', 'cr2', 'nef', 'dng'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'aif', 'aiff', 'wma', 'm4b', 'caf'],
  video: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', '3gp', 'mxf'],
  pdf: ['pdf'],
  doc: ['doc', 'docx', 'rtf', 'odt', 'pages', 'txt', 'md', 'rtfd'],
  sheet: ['xls', 'xlsx', 'csv', 'numbers', 'ods'],
  slides: ['ppt', 'pptx', 'key', 'odp'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'dmg', 'pkg'],
  code: ['js', 'ts', 'json', 'py', 'css', 'sh', 'yml', 'yaml', 'xml', 'gs', 'swift', 'java', 'c', 'cpp', 'h', 'rb', 'go', 'rs', 'sql'],
  html: ['html', 'htm', 'webarchive']
};
const extOf = p => path.extname(p).slice(1).toLowerCase();
const kindOf = (p, dir) => { if (dir) return 'folder'; const e = extOf(p); for (const [k, list] of Object.entries(KIND)) if (list.includes(e)) return k; if (/\.app$/i.test(p)) return 'app'; return 'file'; };
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'css', 'sh', 'yml', 'yaml', 'xml', 'gs', 'html', 'htm', 'srt', 'vtt', 'log', 'sql', 'swift', 'c', 'cpp', 'h', 'rb', 'go', 'rs', 'ini', 'conf', 'tsv']);
const hidden = n => n.startsWith('.') || n === 'Icon\r' || n === '$RECYCLE.BIN';
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, Object.assign({ maxBuffer: 64e6 }, opts), (e, out, err) => (e ? rej(Object.assign(e, { stderr: err })) : res(out))));

// cores das etiquetas do Finder (o número é a cor guardada pelo macOS)
const TAGS = [['Vermelho', 6, '#ff453a'], ['Laranja', 7, '#ff9f0a'], ['Amarelo', 5, '#ffd60a'], ['Verde', 2, '#30d158'], ['Azul', 4, '#0a84ff'], ['Roxo', 3, '#bf5af2'], ['Cinzento', 1, '#8e8e93']];

function setupHermes(x) {
  const { app, ipcMain, dialog, shell, Menu, BrowserWindow, nativeImage } = x;
  const UD = path.join(app.getPath('userData'), 'hermes');
  fs.mkdirSync(path.join(UD, 'mini'), { recursive: true });
  const CFG = path.join(app.getPath('userData'), 'hermes.json');
  let C; try { C = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) { C = {}; }
  C.pinned = C.pinned || []; C.seenDownloads = C.seenDownloads || 0;
  const saveCfg = () => { try { fs.writeFileSync(CFG, JSON.stringify(C, null, 1)); } catch (e) { /* ok */ } };
  const wc = () => { const w = x.getWC(); return w && !w.isDestroyed() ? w : null; };
  const send = (ch, ...a) => { const w = wc(); if (w) w.send('hermes:' + ch, ...a); };
  const toast = msg => { const u = x.getUi(); if (u && !u.isDestroyed()) u.send('toast', msg); };
  const from = e => { const w = wc(); return !!w && e.sender === w && e.senderFrame === w.mainFrame; };
  const h = (name, fn) => ipcMain.handle('hermes:' + name, async (e, ...a) => (from(e) ? fn(...a) : null));
  const str = (v, n = 4000) => String(v == null ? '' : v).slice(0, n);
  const abs = p => { p = str(p); return p && path.isAbsolute(p) ? path.normalize(p) : null; };
  // só se escreve dentro da pasta pessoal ou de discos externos (nunca nas pastas do sistema)
  const writable = p => !!p && (p === HOME || p.startsWith(HOME + path.sep) || p.startsWith('/Volumes/') || (!!process.env.ZEUS_TEST_HERMES && p.startsWith(process.env.ZEUS_TEST_HERMES)));
  const exists = p => { try { fs.accessSync(p); return true; } catch (e) { return false; } };

  /* ---------- sítios ---------- */
  function places() {
    const g = findGoogleDrive();
    const icloud = path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    const dl = app.getPath('downloads');
    let fresh = 0;
    try { for (const n of fs.readdirSync(dl)) { if (hidden(n)) continue; try { if (fs.statSync(path.join(dl, n)).mtimeMs > C.seenDownloads) fresh++; } catch (e) { /* ok */ } } } catch (e) { /* ok */ }
    const root = process.env.ZEUS_TEST_HERMES;
    return {
      home: root || HOME,
      main: [
        { id: 'recent', name: 'Recentes', icon: 'recent' },
        { path: root ? path.join(root, 'Secretária') : app.getPath('desktop'), name: 'Secretária', icon: 'desktop' },
        { path: root ? path.join(root, 'Documentos') : app.getPath('documents'), name: 'Documentos', icon: 'docs' },
        { path: root ? path.join(root, 'Transferências') : dl, name: 'Transferências', icon: 'down', badge: fresh > 0 && fresh < 100 ? fresh : 0 },
        { path: root || HOME, name: path.basename(root || HOME), icon: 'home' }
      ],
      cloud: [
        g ? { path: g, name: 'Google Drive', icon: 'gdrive' } : null,
        exists(icloud) ? { path: icloud, name: 'iCloud Drive', icon: 'icloud' } : null
      ].filter(Boolean),
      pinned: C.pinned.filter(p => exists(p)).map(p => ({ path: p, name: path.basename(p), icon: 'folder' })),
      tags: isMac ? TAGS.map(([name, , color]) => ({ name, color })) : [],
      volumes: isMac ? (() => { try { return fs.readdirSync('/Volumes').filter(n => !hidden(n) && n !== 'Macintosh HD').map(n => ({ path: '/Volumes/' + n, name: n, icon: 'disk' })); } catch (e) { return []; } })() : []
    };
  }
  h('places', () => places());
  h('pin', p => { p = abs(p); if (p && !C.pinned.includes(p)) { C.pinned.push(p); saveCfg(); } return places(); });
  h('unpin', p => { C.pinned = C.pinned.filter(q => q !== str(p)); saveCfg(); return places(); });
  h('seenDownloads', () => { C.seenDownloads = Date.now(); saveCfg(); return true; });

  /* ---------- ler uma pasta ---------- */
  async function entry(dir, name, dirent) {
    const p = path.join(dir, name);
    let st; try { st = await fsp.stat(p); } catch (e) { return null; }
    const isDir = st.isDirectory() && !/\.(app|rtfd|pages|numbers|key|bundle|photoslibrary)$/i.test(name);
    return { path: p, name, dir: isDir, size: isDir ? null : st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, kind: kindOf(p, isDir), ext: isDir ? '' : extOf(p), link: dirent && dirent.isSymbolicLink() };
  }
  async function readTags(paths) {
    if (!isMac || !paths.length) return {};
    const out = {};
    for (let i = 0; i < paths.length; i += 200) {
      const part = paths.slice(i, i + 200);
      try {
        const raw = await run('/usr/bin/mdls', ['-name', 'kMDItemUserTags', '-raw', ...part]);
        raw.split('\0').forEach((v, k) => { const t = v.replace(/^\(|\)$/g, '').split('\n').map(s => s.trim().replace(/,$/, '').replace(/^"|"$/g, '')).filter(s => s && s !== '(null)' && s !== 'null'); if (t.length) out[part[k]] = t; });
      } catch (e) { /* sem Spotlight nesta pasta */ }
    }
    return out;
  }
  h('list', async dir => {
    dir = abs(dir); if (!dir) return { error: 'Pasta inválida.' };
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (e) { return { error: e.code === 'EPERM' || e.code === 'EACCES' ? 'O macOS não deixou o Zeus abrir esta pasta. Em Definições do Sistema › Privacidade e segurança › Ficheiros e pastas (ou Acesso total ao disco), ativa o Zeus.' : e.code === 'ENOENT' ? 'Esta pasta já não existe.' : 'Não foi possível abrir esta pasta.' }; }
    const list = (await Promise.all(ents.filter(d => !hidden(d.name)).slice(0, 5000).map(d => entry(dir, d.name, d)))).filter(Boolean);
    const tags = await readTags(list.map(i => i.path));
    list.forEach(i => { if (tags[i.path]) i.tags = tags[i.path]; });
    let free = null; try { const s = await fsp.statfs(dir); free = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch (e) { /* ok */ }
    if (dir === app.getPath('downloads')) { C.seenDownloads = Date.now(); saveCfg(); }
    return { dir, items: list, free, writable: writable(dir), parent: path.dirname(dir) !== dir ? path.dirname(dir) : null };
  });
  // número de itens dentro de cada pasta (para a coluna do tamanho, enquanto o espaço é calculado)
  h('counts', async dirs => {
    const out = {};
    for (const d of (Array.isArray(dirs) ? dirs : []).slice(0, 500)) { try { out[d] = (await fsp.readdir(d)).filter(n => !hidden(n)).length; } catch (e) { /* ok */ } }
    return out;
  });

  /* ---------- espaço ocupado pelas pastas ---------- */
  const sizeCache = new Map();   // pasta -> { size, at }
  let duQueue = [], duBusy = 0, duGen = 0;
  function du(dir) {
    return new Promise(resolve => {
      // tamanho aparente: conta também os ficheiros que estão só na cloud (Google Drive, iCloud)
      const args = isMac ? ['-skA', dir] : ['-sk', '--apparent-size', dir];
      const p = spawn('/usr/bin/du', args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', d => { out += d; });
      const t = setTimeout(() => p.kill(), 120000);
      p.on('close', () => { clearTimeout(t); const k = parseInt(out, 10); resolve(isFinite(k) ? k * 1024 : null); });
      p.on('error', () => { clearTimeout(t); resolve(null); });
    });
  }
  function pumpDu() {
    while (duBusy < 3 && duQueue.length) {
      const { dir, gen } = duQueue.shift();
      if (gen !== duGen) continue;
      duBusy++;
      du(dir).then(size => { duBusy--; if (size != null) { sizeCache.set(dir, { size, at: Date.now() }); if (gen === duGen) send('size', { dir, size }); } pumpDu(); });
    }
  }
  h('sizes', dirs => {
    duGen++; duQueue = [];
    const out = {};
    for (const d of (Array.isArray(dirs) ? dirs : []).slice(0, 400)) {
      const c = sizeCache.get(d);
      if (c && Date.now() - c.at < 10 * 60e3) out[d] = c.size; else duQueue.push({ dir: d, gen: duGen });
    }
    pumpDu();
    return out;
  });
  h('folderSize', async dir => { dir = abs(dir); if (!dir) return null; const c = sizeCache.get(dir); if (c && Date.now() - c.at < 10 * 60e3) return c.size; const s = await du(dir); if (s != null) sizeCache.set(dir, { size: s, at: Date.now() }); return s; });

  /* ---------- Recentes e etiquetas (Spotlight) ---------- */
  function mdfind(args, limit = 300, ms = 6000) {
    return new Promise(resolve => {
      if (!isMac) return resolve(null);
      const p = spawn('/usr/bin/mdfind', args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '', lines = [];
      const done = () => { try { p.kill(); } catch (e) { /* ok */ } resolve(lines); };
      const t = setTimeout(done, ms);
      p.stdout.on('data', d => { buf += d; const parts = buf.split('\n'); buf = parts.pop(); lines.push(...parts.filter(Boolean)); if (lines.length >= limit) { clearTimeout(t); done(); } });
      p.on('close', () => { clearTimeout(t); if (buf) lines.push(buf); resolve(lines.slice(0, limit)); });
      p.on('error', () => { clearTimeout(t); resolve(null); });
    });
  }
  const visible = p => !p.split(path.sep).some(s => hidden(s)) && !p.includes('/Library/') && !p.startsWith('/System') && !p.includes('/node_modules/');
  async function walk(dir, depth, test, out, max) {
    if (out.length >= max) return;
    let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of ents) {
      if (hidden(d.name) || d.name === 'node_modules' || d.name === 'Library') continue;
      const p = path.join(dir, d.name);
      if (await test(p, d)) out.push(p);
      if (out.length >= max) return;
      if (d.isDirectory() && depth > 0) await walk(p, depth - 1, test, out, max);
    }
  }
  async function entries(paths) {
    const list = (await Promise.all(paths.map(p => entry(path.dirname(p), path.basename(p))))).filter(Boolean);
    const tags = await readTags(list.map(i => i.path));
    list.forEach(i => { if (tags[i.path]) i.tags = tags[i.path]; });
    return list;
  }
  h('recent', async () => {
    let paths = await mdfind(['-onlyin', HOME, 'kMDItemFSContentChangeDate >= $time.today(-7) && kMDItemContentTypeTree != public.folder'], 600);
    if (!paths) {   // sem Spotlight (testes): percorre as pastas principais
      paths = [];
      const lim = Date.now() - 7 * 864e5;
      for (const d of places().main.filter(m => m.path && m.icon !== 'home')) await walk(d.path, 3, async (p, de) => { if (!de.isFile()) return false; try { return (await fsp.stat(p)).mtimeMs > lim; } catch (e) { return false; } }, paths, 400);
    }
    const list = await entries(paths.filter(visible).slice(0, 400));
    return list.sort((a, b) => b.mtime - a.mtime).slice(0, 200);
  });
  h('tagged', async tag => {
    const t = str(tag, 60).replace(/["\\]/g, '');
    const paths = await mdfind(['-onlyin', HOME, `kMDItemUserTags == "${t}"`], 500);
    return entries((paths || []).filter(visible));
  });
  // escrever etiquetas: lista de textos "Nome\nCor" num plist binário, no atributo que o Finder lê
  function bplistStrings(arr) {
    const objs = [], offsets = [];
    const intBytes = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return n < 256 ? Buffer.from([0x10, n]) : Buffer.concat([Buffer.from([0x11]), b]); };
    const strObj = s => {
      const ascii = /^[\x00-\x7f]*$/.test(s);
      const body = ascii ? Buffer.from(s, 'ascii') : Buffer.from(s, 'utf16le').swap16();
      const n = ascii ? s.length : body.length / 2;
      const head = n < 15 ? Buffer.from([(ascii ? 0x50 : 0x60) | n]) : Buffer.concat([Buffer.from([(ascii ? 0x50 : 0x60) | 0x0f]), intBytes(n)]);
      return Buffer.concat([head, body]);
    };
    const n = arr.length;
    const arrHead = n < 15 ? Buffer.from([0xa0 | n]) : Buffer.concat([Buffer.from([0xaf]), intBytes(n)]);
    objs.push(Buffer.concat([arrHead, Buffer.from(arr.map((_, i) => i + 1))]));
    arr.forEach(s => objs.push(strObj(s)));
    let pos = 8; const parts = [Buffer.from('bplist00')];
    for (const o of objs) { offsets.push(pos); parts.push(o); pos += o.length; }
    const offSize = pos < 256 ? 1 : 2;
    const table = Buffer.alloc(offsets.length * offSize);
    offsets.forEach((o, i) => (offSize === 1 ? table.writeUInt8(o, i) : table.writeUInt16BE(o, i * 2)));
    const trailer = Buffer.alloc(32);
    trailer.writeUInt8(offSize, 6); trailer.writeUInt8(1, 7);
    trailer.writeBigUInt64BE(BigInt(objs.length), 8); trailer.writeBigUInt64BE(0n, 16); trailer.writeBigUInt64BE(BigInt(pos), 24);
    return Buffer.concat([...parts, table, trailer]);
  }
  h('setTag', async (paths, tag, on) => {
    if (!isMac) return { error: 'As etiquetas só existem no Mac.' };
    const T = TAGS.find(t => t[0] === str(tag, 40)); if (!T) return null;
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(p => p && writable(p));
    const cur = await readTags(list);
    for (const p of list) {
      const names = (cur[p] || []).filter(n => n !== T[0]);
      if (on) names.push(T[0]);
      const withColor = names.map(n => { const k = TAGS.find(t => t[0] === n); return k ? `${n}\n${k[1]}` : n; });
      try {
        if (withColor.length) await run('/usr/bin/xattr', ['-wx', 'com.apple.metadata:_kMDItemUserTags', bplistStrings(withColor).toString('hex'), p]);
        else await run('/usr/bin/xattr', ['-d', 'com.apple.metadata:_kMDItemUserTags', p]).catch(() => {});
      } catch (e) { /* ok */ }
    }
    return true;
  });

  /* ---------- pesquisa (Spotlight: nomes e conteúdo) ---------- */
  let searchGen = 0;
  h('search', async (q, scope, filter) => {
    const gen = ++searchGen;
    q = str(q, 200).trim(); if (!q) return [];
    const where = abs(scope) || HOME;
    let paths = await mdfind(['-onlyin', where, q], 400, 5000);
    if (!paths) {   // sem Spotlight (testes): nomes e texto dos ficheiros pequenos
      paths = [];
      const words = q.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/\s+/).filter(Boolean);
      const fold = t => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      await walk(where, 4, async (p, de) => {
        const n = fold(path.basename(p));
        if (words.every(w => n.includes(w))) return true;
        if (!de.isFile() || !TEXT_EXT.has(extOf(p))) return false;
        try { const st = await fsp.stat(p); if (st.size > 2e6) return false; const t = fold(await fsp.readFile(p, 'utf8')); return words.every(w => t.includes(w)); } catch (e) { return false; }
      }, paths, 300);
    }
    if (gen !== searchGen) return null;
    let list = await entries(paths.filter(visible).slice(0, 400));
    const f = str(filter, 20);
    if (f === 'pdf') list = list.filter(i => i.kind === 'pdf');
    else if (f === 'image') list = list.filter(i => i.kind === 'image');
    else if (f === 'docs') list = list.filter(i => ['doc', 'sheet', 'slides', 'pdf'].includes(i.kind));
    else if (f === 'media') list = list.filter(i => i.kind === 'audio' || i.kind === 'video');
    else if (f === 'month') list = list.filter(i => Date.now() - i.mtime < 30 * 864e5);
    // nome primeiro, depois os mais recentes
    const ql = q.toLowerCase();
    list.sort((a, b) => (b.name.toLowerCase().includes(ql) - a.name.toLowerCase().includes(ql)) || b.mtime - a.mtime);
    return list.slice(0, 250);
  });
  // excerto com as palavras procuradas (texto, Word, RTF, HTML)
  h('snippet', async (p, q) => {
    p = abs(p); q = str(q, 200); if (!p || !q) return '';
    const e = extOf(p);
    let text = '';
    try {
      if (TEXT_EXT.has(e)) { const st = await fsp.stat(p); if (st.size < 3e6) text = await fsp.readFile(p, 'utf8'); }
      else if (isMac && ['doc', 'docx', 'rtf', 'odt', 'rtfd'].includes(e)) text = await run('/usr/bin/textutil', ['-convert', 'txt', '-stdout', p]);
    } catch (er) { return ''; }
    if (!text) return '';
    text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const fold = t => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const ft = fold(text), w = fold(q).split(/\s+/).filter(Boolean);
    const i = w.map(x2 => ft.indexOf(x2)).filter(k => k >= 0).sort((a, b) => a - b)[0];
    if (i == null) return '';
    return (i > 60 ? '…' : '') + text.slice(Math.max(0, i - 60), i + 160).trim() + '…';
  });

  /* ---------- pré-visualização ---------- */
  const ffBin = () => process.env.ZEUS_FFMPEG || (app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg') : path.join(__dirname, '..', 'vendor', `ffmpeg-${process.platform}-${process.arch}`, 'ffmpeg', 'ffmpeg'));
  const thumbKey = (p, st) => crypto.createHash('sha1').update(p + '|' + st.mtimeMs + '|' + st.size).digest('hex').slice(0, 16);
  async function quickLook(p, size) {
    const st = await fsp.stat(p);
    const out = path.join(UD, 'mini', thumbKey(p, st) + '-' + size + '.png');
    if (exists(out)) return out;
    const tmp = path.join(UD, 'mini', 'ql-' + process.pid + '-' + Date.now());
    await fsp.mkdir(tmp, { recursive: true });
    try {
      // imagens: lidas diretamente (o QuickLook às vezes não devolve miniatura de PNG); se falhar, sips no Mac
      if (kindOf(p) === 'image') {
        try {
          let img = nativeImage.createFromPath(p);
          if (img && !img.isEmpty()) {
            const sz = img.getSize();
            if (Math.max(sz.width, sz.height) > size) img = img.resize(sz.width >= sz.height ? { width: size, quality: 'good' } : { height: size, quality: 'good' });
            await fsp.writeFile(out, img.toPNG());
            if (exists(out)) return out;
          }
        } catch (e) { /* segue para o QuickLook */ }
        if (isMac) {
          try { await run('/usr/bin/sips', ['-Z', String(size), '-s', 'format', 'png', p, '--out', out], { timeout: 20000 }); if (exists(out)) return out; } catch (e) { /* segue */ }
        }
      }
      if (isMac) {
        await run('/usr/bin/qlmanage', ['-t', '-s', String(size), '-o', tmp, p], { timeout: 20000 });
        const f = (await fsp.readdir(tmp)).find(n => n.endsWith('.png'));
        if (f) { await fsp.rename(path.join(tmp, f), out); return out; }
      }
      if (['image', 'video'].includes(kindOf(p)) && exists(ffBin())) {
        await run(ffBin(), ['-y', '-v', 'error', ...(kindOf(p) === 'video' ? ['-ss', '1'] : []), '-i', p, '-frames:v', '1', '-vf', `scale=${size}:-2`, out], { timeout: 20000 });
        if (exists(out)) return out;
      }
    } catch (e) { /* sem miniatura */ } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
    return null;
  }
  h('thumb', async (p, size) => { p = abs(p); if (!p) return null; const t = await quickLook(p, Math.max(64, Math.min(1200, +size || 256))).catch(() => null); return t ? pathToFileURL(t).href : null; });
  // miniatura + duração (vídeos e áudio), para a vista Miniaturas
  const durs = new Map();
  async function durationOf(p) {
    const st = await fsp.stat(p); const key = p + '|' + st.mtimeMs;
    if (durs.has(key)) return durs.get(key);
    let d = 0;
    try {
      if (isMac) { const raw = await run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemDurationSeconds', p], { timeout: 5000 }); d = parseFloat(raw) || 0; }
      if (!d && exists(ffBin())) {
        const err = await new Promise(res => execFile(ffBin(), ['-hide_banner', '-i', p], { timeout: 8000 }, (e, o, er) => res(String(er || ''))));
        const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err); if (m) d = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
      }
    } catch (e) { /* sem duração */ }
    if (durs.size > 3000) durs.clear();
    durs.set(key, d); return d;
  }
  h('thumbInfo', async (p, size, wantDur) => {
    p = abs(p); if (!p) return null;
    const [t, dur] = await Promise.all([
      size ? quickLook(p, Math.max(64, Math.min(1200, +size || 256))).catch(() => null) : null,
      wantDur ? durationOf(p).catch(() => 0) : 0
    ]);
    return { url: t ? pathToFileURL(t).href : null, dur, src: kindOf(p) === 'video' ? pathToFileURL(p).href : '' };
  });
  h('preview', async p => {
    p = abs(p); if (!p) return null;
    let st; try { st = await fsp.stat(p); } catch (e) { return { error: 'O ficheiro já não existe.' }; }
    const isDir = st.isDirectory();
    const k = kindOf(p, isDir);
    const out = { path: p, name: path.basename(p), kind: k, size: isDir ? null : st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, url: pathToFileURL(p).href, where: path.dirname(p) };
    if (isDir) { try { out.count = (await fsp.readdir(p)).filter(n => !hidden(n)).length; } catch (e) { /* ok */ } }
    if (!isDir && TEXT_EXT.has(extOf(p)) && st.size < 5e6) { try { const fd = await fsp.open(p, 'r'); const b = Buffer.alloc(Math.min(st.size, 20000)); await fd.read(b, 0, b.length, 0); await fd.close(); out.text = b.toString('utf8'); } catch (e) { /* ok */ } }
    if (isMac) {
      try {
        const raw = await run('/usr/bin/mdls', ['-name', 'kMDItemNumberOfPages', '-name', 'kMDItemPixelWidth', '-name', 'kMDItemPixelHeight', '-name', 'kMDItemDurationSeconds', '-name', 'kMDItemUserTags', '-name', 'kMDItemWhereFroms', p]);
        const g = n => { const m = new RegExp(n + '\\s*=\\s*([^\\n]+)').exec(raw); return m && !/null/.test(m[1]) ? m[1].trim() : ''; };
        out.pages = +g('kMDItemNumberOfPages') || 0; out.w = +g('kMDItemPixelWidth') || 0; out.h = +g('kMDItemPixelHeight') || 0; out.duration = +g('kMDItemDurationSeconds') || 0;
        const wf = /kMDItemWhereFroms\s*=\s*\(\s*"([^"]+)"/.exec(raw); if (wf) out.from = wf[1];
      } catch (e) { /* ok */ }
      out.tags = (await readTags([p]))[p] || [];
    }
    if (!['audio', 'video', 'image', 'folder'].includes(k) && !out.text) { const t = await quickLook(p, 900).catch(() => null); if (t) out.ql = pathToFileURL(t).href; }
    if (k === 'image' && /heic|heif|tif|tiff|raw|cr2|nef|dng/.test(extOf(p))) { const t = await quickLook(p, 900).catch(() => null); if (t) out.ql = pathToFileURL(t).href; }
    return out;
  });

  /* ---------- abrir ---------- */
  h('openEditor', p => { p = abs(p); if (p && exists(p) && x.openInEditor) { x.openInEditor(p); return true; } return false; });
  h('open', async p => {
    p = abs(p); if (!p) return false;
    const k = kindOf(p);
    if ((k === 'audio' || k === 'video') && x.openInOrfeu) { x.openInOrfeu([p]); return true; }
    if (k === 'html') { try { const head = (await fsp.readFile(p, 'utf8')).slice(0, 2000); if (/name="zeus-id"/.test(head) && x.openInNotas) { x.openInNotas(p); return true; } } catch (e) { /* ok */ } }
    const r = await shell.openPath(p); return !r;
  });
  h('openWith', async paths => {
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(Boolean); if (!list.length) return false;
    const r = await dialog.showOpenDialog(x.getWin(), { title: 'Abrir com…', defaultPath: '/Applications', buttonLabel: 'Abrir', properties: ['openFile'], filters: [{ name: 'Aplicações', extensions: ['app'] }] });
    if (r.canceled || !r.filePaths[0]) return false;
    if (isMac) await run('/usr/bin/open', ['-a', r.filePaths[0], ...list]).catch(() => {});
    return true;
  });
  h('reveal', p => { p = abs(p); if (p) shell.showItemInFolder(p); });
  h('copyPath', paths => { x.clipboard.writeText((Array.isArray(paths) ? paths : []).map(str).join('\n')); return true; });

  /* ---------- arrumar ---------- */
  const okName = n => { n = str(n, 255).trim(); return n && !/[\/\u0000]/.test(n) && n !== '.' && n !== '..' && !n.startsWith('.') ? n : null; };
  function freeName(dir, name) {
    if (!exists(path.join(dir, name))) return path.join(dir, name);
    const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
    for (let k = 2; k < 1000; k++) { const c = path.join(dir, `${base} ${k}${ext}`); if (!exists(c)) return c; }
    return path.join(dir, `${base} ${Date.now()}${ext}`);
  }
  const changed = dirs => send('changed', [...new Set(dirs)]);
  h('rename', async (p, name) => {
    p = abs(p); name = okName(name);
    if (!p || !name || !writable(p)) return { error: 'Nome inválido.' };
    const dst = path.join(path.dirname(p), name);
    if (dst === p) return { path: p };
    if (exists(dst) && dst.toLowerCase() !== p.toLowerCase()) return { error: `Já existe "${name}" nesta pasta.` };
    try { await fsp.rename(p, dst); } catch (e) { return { error: 'Não foi possível mudar o nome.' }; }
    changed([path.dirname(p)]); return { path: dst };
  });
  h('mkdir', async (dir, name) => {
    dir = abs(dir); if (!dir || !writable(dir)) return { error: 'Não é possível criar pastas aqui.' };
    const p = freeName(dir, okName(name) || 'Pasta nova');
    try { await fsp.mkdir(p); } catch (e) { return { error: 'Não foi possível criar a pasta.' }; }
    changed([dir]); return { path: p };
  });
  // mover ou copiar (para a mesma pasta, copiar cria "nome 2")
  async function transfer(paths, dest, copy) {
    dest = abs(dest);
    if (!dest || !writable(dest)) return { error: 'Não é possível pôr ficheiros nesta pasta.' };
    const out = [], touched = [dest];
    for (const p0 of (Array.isArray(paths) ? paths : []).slice(0, 2000)) {
      const p = abs(p0); if (!p || !exists(p)) continue;
      if (!copy && !writable(p)) continue;
      if (dest === p || dest.startsWith(p + path.sep)) continue;           // pasta para dentro de si mesma
      if (!copy && path.dirname(p) === dest) continue;
      const dst = freeName(dest, path.basename(p));
      try {
        if (copy) await fsp.cp(p, dst, { recursive: true, preserveTimestamps: true, errorOnExist: true });
        else { try { await fsp.rename(p, dst); } catch (e) { if (e.code !== 'EXDEV') throw e; await fsp.cp(p, dst, { recursive: true, preserveTimestamps: true }); await fsp.rm(p, { recursive: true, force: true }); } }
        out.push(dst); touched.push(path.dirname(p));
      } catch (e) { /* passa ao seguinte */ }
    }
    changed(touched);
    return { paths: out };
  }
  h('move', (paths, dest) => transfer(paths, dest, false));
  h('copy', (paths, dest) => transfer(paths, dest, true));
  h('duplicate', async paths => { const list = (Array.isArray(paths) ? paths : []).map(abs).filter(Boolean); const res = []; for (const p of list) { const r = await transfer([p], path.dirname(p), true); res.push(...(r.paths || [])); } return { paths: res }; });
  h('chooseFolder', async title => { const r = await dialog.showOpenDialog(x.getWin(), { title: str(title, 80) || 'Escolher pasta', buttonLabel: 'Escolher', properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  h('trash', async paths => {
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(p => p && writable(p));
    let n = 0; const dirs = [];
    for (const p of list) { try { await shell.trashItem(p); n++; dirs.push(path.dirname(p)); } catch (e) { /* ok */ } }
    changed(dirs);
    if (n) toast(n === 1 ? 'Foi para o Lixo.' : `${n} itens foram para o Lixo.`);
    return { count: n };
  });
  h('compress', async paths => {
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(Boolean); if (!list.length) return null;
    const dir = path.dirname(list[0]);
    if (!writable(dir)) return { error: 'Não é possível criar o arquivo aqui.' };
    const out = freeName(dir, list.length === 1 ? path.basename(list[0]).replace(/\.[^.]+$/, '') + '.zip' : 'Arquivo.zip');
    try {
      if (isMac && list.length === 1) await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', list[0], out]);
      else await run('/usr/bin/zip', ['-r', '-q', '-X', out, ...list.map(p => path.basename(p)), '-x', '*/.DS_Store', '.DS_Store'], { cwd: dir });
    } catch (e) { return { error: 'Não foi possível comprimir.' }; }
    changed([dir]); return { path: out };
  });
  h('unzip', async p => {
    p = abs(p); if (!p || !/\.zip$/i.test(p) || !writable(p)) return null;
    const dest = freeName(path.dirname(p), path.basename(p).replace(/\.zip$/i, ''));
    try { if (isMac) await run('/usr/bin/ditto', ['-x', '-k', p, dest]); else await run('/usr/bin/unzip', ['-q', p, '-d', dest]); } catch (e) { return { error: 'Não foi possível abrir o arquivo.' }; }
    changed([path.dirname(p)]); return { path: dest };
  });
  // mudar nomes em série: substituir texto, ou numerar ("Nome 01", "Nome 02"…)
  h('batchRename', async (paths, opts) => {
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(p => p && writable(p));
    opts = opts || {};
    const plan = list.map((p, i) => {
      const ext = path.extname(p), base = path.basename(p, ext);
      let n;
      if (opts.mode === 'number') { const w = String(list.length).length < 2 ? 2 : String(list.length).length; n = `${str(opts.base, 200).trim() || base} ${String((+opts.start || 1) + i).padStart(w, '0')}${ext}`; }
      else { const find = str(opts.find, 200); if (!find) return null; n = base.split(find).join(str(opts.replace, 200)) + ext; }
      return okName(n) ? { from: p, to: path.join(path.dirname(p), okName(n)) } : null;
    }).filter(Boolean).filter(r => r.from !== r.to);
    if (opts.preview) return plan.map(r => ({ from: path.basename(r.from), to: path.basename(r.to) }));
    let n = 0;
    // passo intermédio: evita colisões quando os nomes novos coincidem com antigos
    const tmp = plan.map(r => ({ ...r, mid: r.from + '.zeus-' + process.pid }));
    for (const r of tmp) { try { await fsp.rename(r.from, r.mid); } catch (e) { r.fail = true; } }
    for (const r of tmp) { if (r.fail) continue; const dst = exists(r.to) ? freeName(path.dirname(r.to), path.basename(r.to)) : r.to; try { await fsp.rename(r.mid, dst); n++; } catch (e) { await fsp.rename(r.mid, r.from).catch(() => {}); } }
    changed(list.map(p => path.dirname(p)));
    return { count: n };
  });

  /* ---------- conversão rápida (ao lado do original) ---------- */
  const CONV = {
    image: [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['heic', 'HEIC'], ['pdf', 'PDF'], ['jpg-1920', 'JPG reduzido (1920 px)']],
    audio: [['mp3', 'MP3'], ['m4a', 'M4A (AAC)'], ['wav', 'WAV']],
    video: [['mp4', 'MP4 (H.264)'], ['m4a', 'Só o áudio (M4A)'], ['mp3', 'Só o áudio (MP3)'], ['mp4-720', 'MP4 mais leve (720p)']],
    doc: [['pdf', 'PDF'], ['docx', 'Word (.docx)'], ['txt', 'Texto (.txt)'], ['rtf', 'RTF']],
    html: [['pdf', 'PDF'], ['docx', 'Word (.docx)'], ['txt', 'Texto (.txt)']]
  };
  h('convertOptions', kind => CONV[str(kind, 20)] || []);
  let convJobs = 0;
  h('convert', async (paths, fmt) => {
    fmt = str(fmt, 20);
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(Boolean).slice(0, 200);
    const done = [], errors = [];
    convJobs++; send('busy', { on: true, label: `A converter ${list.length === 1 ? path.basename(list[0]) : list.length + ' ficheiros'}…` });
    try {
      for (const p of list) {
        const k = kindOf(p), dir = path.dirname(p);
        if (!writable(dir)) { errors.push(path.basename(p)); continue; }
        const [ext, variant] = fmt.split('-');
        const dst = freeName(dir, path.basename(p, path.extname(p)) + (variant ? ` (${variant}${k === 'video' ? 'p' : ' px'})` : '') + '.' + ext);
        try {
          if (k === 'image') {
            if (isMac && ext !== 'webp') await run('/usr/bin/sips', ['-s', 'format', ext === 'jpg' ? 'jpeg' : ext, ...(variant ? ['-Z', variant] : []), p, '--out', dst]);
            else await run(ffBin(), ['-y', '-v', 'error', '-i', p, ...(variant ? ['-vf', `scale='min(${variant},iw)':-2`] : []), dst]);
          } else if (k === 'audio' || k === 'video') {
            const a = ext === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ext === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '256k'];
            const v = ext === 'mp4' ? (isMac ? ['-c:v', 'h264_videotoolbox', '-b:v', variant ? '3M' : '8M', '-allow_sw', '1'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21']) : ['-vn'];
            await run(ffBin(), ['-y', '-v', 'error', '-i', p, ...v, ...(variant ? ['-vf', `scale=-2:${variant}`] : []), ...a, ...(ext === 'mp4' || ext === 'm4a' ? ['-movflags', '+faststart'] : []), dst]);
          } else if (k === 'doc' || k === 'html') {
            if (ext === 'pdf') await docToPdf(p, dst);
            else if (isMac) await run('/usr/bin/textutil', ['-convert', ext, p, '-output', dst]);
            else throw new Error('sem textutil');
          } else throw new Error('formato');
          done.push(dst);
        } catch (e) { errors.push(path.basename(p)); fsp.unlink(dst).catch(() => {}); }
      }
    } finally { convJobs--; if (!convJobs) send('busy', { on: false }); }
    changed(list.map(p => path.dirname(p)));
    if (done.length) toast(done.length === 1 ? `Convertido: ${path.basename(done[0])}` : `${done.length} ficheiros convertidos.`);
    return { paths: done, errors };
  });
  // Word, RTF, texto ou HTML para PDF: passa por HTML (textutil) e imprime-se com o motor do Zeus
  async function docToPdf(p, dst) {
    let html;
    if (['html', 'htm'].includes(extOf(p))) html = p;
    else if (isMac) { html = path.join(UD, 'conv-' + Date.now() + '.html'); await run('/usr/bin/textutil', ['-convert', 'html', p, '-output', html]); }
    else if (TEXT_EXT.has(extOf(p))) { html = path.join(UD, 'conv-' + Date.now() + '.html'); const t = await fsp.readFile(p, 'utf8'); await fsp.writeFile(html, '<meta charset="utf-8"><pre style="font:13px/1.5 Menlo,monospace;white-space:pre-wrap">' + t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</pre>'); }
    else throw new Error('sem textutil');
    // o título do PDF é o nome do ficheiro original (e não o do HTML temporário)
    if (html !== p) {
      const title = path.basename(p, path.extname(p)).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      let t = await fsp.readFile(html, 'utf8');
      t = /<title>[\s\S]*?<\/title>/i.test(t) ? t.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`) : /<head[^>]*>/i.test(t) ? t.replace(/<head[^>]*>/i, m => `${m}<title>${title}</title>`) : `<title>${title}</title>` + t;
      await fsp.writeFile(html, t);
    }
    const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
    try {
      w.webContents.on('will-navigate', e => e.preventDefault());
      await w.loadFile(html);
      await fsp.writeFile(dst, await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true }));
    } finally { w.destroy(); if (html !== p) fsp.unlink(html).catch(() => {}); }
  }

  /* ---------- arrastar para fora (páginas do Zeus, Finder, outras apps) ---------- */
  let dragIcon = null;
  try { dragIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 48, height: 48 }); } catch (e) { /* ok */ }
  ipcMain.on('hermes:drag', (e, paths) => {
    if (!from(e)) return;
    const files = (Array.isArray(paths) ? paths : []).map(abs).filter(p => p && exists(p)).slice(0, 200);
    if (!files.length) return;
    try { e.sender.startDrag({ files, file: files[0], icon: dragIcon && !dragIcon.isEmpty() ? dragIcon : nativeImage.createEmpty() }); } catch (er) { /* ok */ }
  });

  /* ---------- partilhar ---------- */
  // pôr ficheiros na área de transferência do Mac, como no Finder (⌘V cola-os no Gmail, WhatsApp, Finder…)
  function filesToClipboard(list) {
    if (isMac) {
      const plist = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array>' +
        list.map(p => '<string>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</string>').join('') + '</array></plist>';
      x.clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist, 'utf8'));
    } else x.clipboard.writeText(list.join('\n'));
  }
  h('copyFiles', paths => { const list = (Array.isArray(paths) ? paths : []).map(abs).filter(p => p && exists(p)); if (list.length) filesToClipboard(list); return list.length; });
  h('shareTargets', () => ({ sheet: isMac, wa: !!x.hasApp('wa'), mail: !!x.hasApp('mail') }));
  h('waChats', q => x.waChats(str(q, 80)));
  h('share', async (paths, how, at) => {
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(p => p && exists(p)).slice(0, 100);
    if (!list.length) return false;
    how = str(how, 10);
    if (how === 'sheet') {   // menu de partilha do Mac: Mail, Mensagens, AirDrop, Notas, WhatsApp (se estiver instalado)…
      if (!isMac || !x.ShareMenu) return false;
      const w = x.getWin(), v = x.getView(); const b = v ? v.getBounds() : { x: 0, y: 0 };
      try { new x.ShareMenu({ filePaths: list }).popup({ window: w, x: Math.round(b.x + (+at.x || 0)), y: Math.round(b.y + (+at.y || 0)) }); } catch (e) { return false; }
      return true;
    }
    if (how === 'copy') { filesToClipboard(list); toast(list.length === 1 ? 'Ficheiro copiado: cola-o com ⌘V onde quiseres.' : `${list.length} ficheiros copiados: cola-os com ⌘V onde quiseres.`); return true; }
    if (how === 'wa' || how === 'mail') {
      // abre o WhatsApp ou uma mensagem nova do Gmail, dentro do Zeus, e anexa os ficheiros (como se fossem arrastados)
      const chat = how === 'wa' && at && at.chat ? str(at.chat, 200) : '';
      if (how === 'wa' && !chat) toast('Escolhe a conversa no WhatsApp e confirma em baixo para quem vai.');
      const ok = await x.attachFiles(how, list, { chat });
      if (ok && chat) toast(list.length === 1 ? `Ficheiro pronto a enviar para ${chat}: confirma no WhatsApp.` : `${list.length} ficheiros prontos a enviar para ${chat}: confirma no WhatsApp.`);
      if (!ok) { filesToClipboard(list); toast('Não consegui anexar sozinho: os ficheiros ficaram copiados — cola com ⌘V ou arrasta do Disco.'); }
      else if (how === 'mail') toast(list.length === 1 ? 'Ficheiro anexado a uma mensagem nova no Gmail.' : `${list.length} ficheiros anexados a uma mensagem nova no Gmail.`);
      return ok;
    }
    return false;
  });

  /* ---------- menu de contexto (menu do sistema) ---------- */
  h('menu', async (paths, at) => {
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(Boolean);
    const cmd = (c, arg) => () => send('cmd', { cmd: c, paths: list, arg });
    const one = list.length === 1, p = list[0];
    const kinds = [...new Set(list.map(q => { try { return kindOf(q, fs.statSync(q).isDirectory()); } catch (e) { return 'file'; } }))];
    const conv = kinds.length === 1 ? CONV[kinds[0]] : null;
    const tpl = list.length ? [
      { label: 'Ver no Zeus', click: cmd('quickLook') },
      { label: 'Abrir', click: cmd('open') },
      { label: 'Abrir com…', click: cmd('openWith') },
      { type: 'separator' },
      ...(one ? [{ label: 'Mudar o nome', click: cmd('rename') }] : [{ label: `Mudar os nomes (${list.length})…`, click: cmd('batchRename') }]),
      { label: 'Duplicar', click: cmd('duplicate') },
      { label: 'Mover para…', click: cmd('moveTo') },
      { label: 'Copiar para…', click: cmd('copyTo') },
      { label: 'Comprimir', click: cmd('compress') },
      ...(one && /\.zip$/i.test(p) ? [{ label: 'Descomprimir', click: cmd('unzip') }] : []),
      ...(conv ? [{ label: 'Converter para', submenu: conv.map(([f, n]) => ({ label: n, click: cmd('convert', f) })) }] : []),
      ...(isMac ? [{ label: 'Etiqueta', submenu: TAGS.map(([n]) => ({ label: n, click: cmd('tag', n) })) }] : []),
      { type: 'separator' },
      ...(one && kinds[0] === 'folder' ? [{ label: C.pinned.includes(p) ? 'Tirar das fixadas' : 'Fixar na coluna da esquerda', click: cmd(C.pinned.includes(p) ? 'unpin' : 'pin') }, { label: 'Ver o espaço ocupado', click: cmd('space') }] : []),
      { label: 'Partilhar…', click: cmd('shareMenu') },
      { label: one ? 'Copiar o ficheiro' : 'Copiar os ficheiros', click: cmd('copyFiles') },
      { label: 'Mostrar no Finder', click: cmd('reveal') },
      { label: one ? 'Copiar o caminho' : 'Copiar os caminhos', click: cmd('copyPath') },
      { type: 'separator' },
      { label: 'Mover para o Lixo', click: cmd('trash') }
    ] : [
      { label: 'Nova pasta', click: () => send('cmd', { cmd: 'mkdir' }) },
      { label: 'Colar', click: () => send('cmd', { cmd: 'paste' }) },
      { label: 'Ver o espaço ocupado', click: () => send('cmd', { cmd: 'space' }) },
      { label: 'Mostrar no Finder', click: () => send('cmd', { cmd: 'revealHere' }) }
    ];
    const w = x.getWin(), v = x.getView(); const b = v ? v.getBounds() : { x: 0, y: 0 };
    Menu.buildFromTemplate(tpl).popup({ window: w, x: Math.round(b.x + (+at.x || 0)), y: Math.round(b.y + (+at.y || 0)) });
  });

  return {};
}

module.exports = { setupHermes };

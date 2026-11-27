'use strict';
/*
 * Espaço em disco: total e livre (fs.statfs), varrimento em segundo plano (scan-worker.js)
 * com cache em disco, e sugestões para libertar espaço. As sugestões só propõem:
 * a interface mostra o que vai sair e pede confirmação; remover = mandar para o Lixo.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Worker } = require('worker_threads');
const { isMac, HOME, expand, tilde, run } = require('./platform');
const { KIND_EXT } = require('./files');

class Space {
  constructor(dataDir, getCfg) {
    this.cacheFile = path.join(dataDir, 'espaco.json');
    this.getCfg = getCfg;
    this.result = null;
    this.progress = null;
    this.worker = null;
    this.listeners = new Set();
    try { this.result = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch (e) { /* ainda não houve varrimento */ }
  }
  on(fn) { this.listeners.add(fn); }
  emit(ev) { this.listeners.forEach(l => { try { l(ev); } catch (e) { console.error(e); } }); }

  async disk() {
    try {
      const st = await fsp.statfs(isMac ? '/System/Volumes/Data' : HOME);
      return { total: st.blocks * st.bsize, livre: st.bavail * st.bsize };
    } catch (e) {
      const st = await fsp.statfs('/');
      return { total: st.blocks * st.bsize, livre: st.bavail * st.bsize };
    }
  }

  roots() {
    const out = [];
    let names = [];
    try { names = fs.readdirSync(HOME); } catch (e) { /* ok */ }
    const PT = { Desktop: 'Secretária', Documents: 'Documentos', Downloads: 'Transferências', Pictures: 'Imagens', Movies: 'Vídeos', Videos: 'Vídeos', Music: 'Música', Library: 'Biblioteca (apps e caches)', Public: 'Público' };
    for (const n of names) {
      if (n.startsWith('.') && n !== '.Trash') continue;
      if (n === '.Trash') continue;
      const p = path.join(HOME, n);
      try { if (!fs.lstatSync(p).isDirectory()) continue; } catch (e) { continue; }
      out.push({ path: p, nome: PT[n] || n });
    }
    if (isMac) out.push({ path: '/Applications', nome: 'Aplicações' });
    return out;
  }

  scan() {
    if (this.worker) return;
    const cfg = this.getCfg();
    const davinci = (cfg.cacheDaVinci ? [expand(cfg.cacheDaVinci)] : []).concat([
      path.join(HOME, 'Movies', 'CacheClip'), path.join(HOME, 'Movies', 'DaVinci Resolve', 'CacheClip')
    ]);
    this.progress = { files: 0, bytes: 0, cur: '' };
    this.emit({ type: 'progress', progress: this.progress });
    this.worker = new Worker(path.join(__dirname, 'scan-worker.js'), {
      workerData: { roots: this.roots(), home: HOME, downloads: path.join(HOME, 'Downloads'), davinci, kindExt: KIND_EXT }
    });
    this.worker.on('message', async m => {
      if (m.type === 'progress') { this.progress = m; this.emit({ type: 'progress', progress: m }); return; }
      if (m.type === 'done') {
        const r = m.result;
        await this.lastUsed(r.bigFiles);
        this.result = r;
        this.progress = null;
        try { await fsp.writeFile(this.cacheFile, JSON.stringify(r)); } catch (e) { console.error(e); }
        this.emit({ type: 'done' });
      }
    });
    this.worker.on('error', e => { console.error('varrimento', e); this.progress = null; this.emit({ type: 'error', error: String(e.message || e) }); });
    this.worker.on('exit', () => { this.worker = null; });
  }

  /* Mac: data da última abertura (Spotlight). Noutros sistemas, o último acesso do ficheiro. */
  async lastUsed(list) {
    for (const f of list) f.usado = Math.max(f.atime || 0, f.mtime || 0);
    if (!isMac || !list.length) return;
    const vids = list.filter(f => f.kind === 'video').slice(0, 300);
    for (let i = 0; i < vids.length; i += 50) {
      const chunk = vids.slice(i, i + 50);
      try {
        const out = await run('/usr/bin/mdls', ['-name', 'kMDItemLastUsedDate', '-raw', ...chunk.map(f => f.p)], { timeout: 8000 });
        out.split('\0').forEach((v, j) => {
          if (!chunk[j]) return;
          const t = Date.parse(String(v).trim().replace(' +0000', 'Z').replace(' ', 'T'));
          // nunca aberto: fica a data de criação/modificação
          chunk[j].usado = isNaN(t) ? chunk[j].mtime : t;
        });
      } catch (e) { /* fica o atime */ }
    }
  }

  /* O Finder esvazia o Lixo ao fim de 30 dias só se essa opção estiver ligada. */
  async trashNote() {
    if (!isMac) return 'no Lixo, recuperáveis até o esvaziares';
    try {
      const v = (await run('/usr/bin/defaults', ['read', 'com.apple.finder', 'FXRemoveOldTrashItems'], { timeout: 3000 })).trim();
      if (v === '1') return 'no Lixo, recuperáveis durante 30 dias';
    } catch (e) { /* opção desligada */ }
    return 'no Lixo, recuperáveis até o esvaziares';
  }

  async exists(p) { try { await fsp.access(p); return true; } catch (e) { return false; } }

  async suggestions() {
    const r = this.result;
    if (!r) return [];
    const out = [];
    // 1. cache e renders do DaVinci
    const cachesSeen = new Set();
    const caches = [];
    for (const c of r.caches || []) { if (!cachesSeen.has(c.p) && c.size > 50e6 && await this.exists(c.p)) { cachesSeen.add(c.p); caches.push(c); } }
    if (caches.length) {
      out.push({
        id: 'davinci', nome: 'Cache e renders do DaVinci', porque: 'O DaVinci volta a criá-los quando precisar', cat: 'video', acao: 'Limpar cache',
        itens: caches.map(c => ({ path: c.p, nome: path.basename(c.p), onde: tilde(path.dirname(c.p)), size: c.size, conteudo: true }))
      });
    }
    // 2. vídeos sem abrir há mais de 1 ano
    const yearAgo = Date.now() - 365 * 86400000;
    const vids = [];
    for (const f of r.bigFiles || []) if (f.kind === 'video' && (f.usado || f.mtime) < yearAgo && !caches.some(c => f.p.startsWith(c.p + path.sep)) && await this.exists(f.p)) vids.push(f);
    if (vids.length) out.push({
      id: 'videos', nome: 'Vídeos sem abrir há mais de 1 ano', porque: vids.length + (vids.length === 1 ? ' ficheiro grande' : ' ficheiros grandes'), cat: 'video', acao: 'Mover para o Lixo',
      itens: vids.map(f => ({ path: f.p, nome: path.basename(f.p), onde: tilde(path.dirname(f.p)), size: f.size, usado: f.usado }))
    });
    // 3. transferências antigas
    const dl = [];
    for (const f of r.oldDownloads || []) if (await this.exists(f.p)) dl.push(f);
    if (dl.length) out.push({
      id: 'transferencias', nome: 'Transferências antigas', porque: 'Mais de 3 meses na pasta Transferências', cat: 'outros', acao: 'Mover para o Lixo',
      itens: dl.sort((a, b) => b.size - a.size).map(f => ({ path: f.p, nome: path.basename(f.p), onde: tilde(path.dirname(f.p)), size: f.size, mtime: f.mtime }))
    });
    // 4. duplicados: fica a cópia mais antiga (ou a de caminho mais curto); as outras saem
    const dupItems = [];
    let copies = 0;
    for (const g of r.dups || []) {
      const alive = [];
      for (const p of g.paths) if (await this.exists(p)) alive.push(p);
      if (alive.length < 2) continue;
      const stats = await Promise.all(alive.map(async p => ({ p, st: await fsp.stat(p).catch(() => null) })));
      stats.sort((a, b) => ((a.st && a.st.birthtimeMs) || 0) - ((b.st && b.st.birthtimeMs) || 0) || a.p.length - b.p.length);
      const keep = stats[0].p;
      for (const s of stats.slice(1)) { copies++; dupItems.push({ path: s.p, nome: path.basename(s.p), onde: tilde(path.dirname(s.p)), size: g.size, fica: tilde(keep) }); }
    }
    if (dupItems.length) out.push({
      id: 'duplicados', nome: 'Ficheiros duplicados', porque: copies + (copies === 1 ? ' cópia exata' : ' cópias exatas') + ' de ficheiros que já tens', cat: 'img', acao: 'Manter só um',
      itens: dupItems.sort((a, b) => b.size - a.size)
    });
    out.forEach(s => { s.size = s.itens.reduce((t, i) => t + (i.size || 0), 0); });
    return out.filter(s => s.size > 0);
  }

  async state() {
    const disk = await this.disk();
    const r = this.result;
    return {
      disk,
      progress: this.progress,
      scannedAt: r ? r.at : null,
      byKind: r ? r.byKind : null,
      roots: r ? r.roots.map(x => this.trim(x, 0)) : null,
      suggestions: r ? await this.suggestions() : [],
      trashNote: await this.trashNote()
    };
  }

  /* A interface só precisa de 3 níveis de cada vez (o resto pede-se ao clicar). */
  trim(n, d) {
    const o = { nome: n.nome, path: n.path, size: n.size, n: n.n, resto: !!n.resto };
    if (n.children && d < 3) o.children = n.children.filter(c => c.size > 0).map(c => this.trim(c, d + 1));
    else if (n.children) o.mais = true;
    return o;
  }
  node(p) {
    if (!this.result) return null;
    const find = n => { if (n.path === p && !n.resto) return n; for (const c of n.children || []) { if (p === c.path || p.startsWith(c.path + path.sep)) { const f = find(c); if (f) return f; } } return null; };
    for (const r of this.result.roots) { const f = find(r); if (f) return this.trim(f, 0); }
    return null;
  }
  biggestIn(p, limit = 30) {
    if (!this.result) return [];
    return (this.result.bigFiles || []).filter(f => f.p.startsWith(p + path.sep)).slice(0, limit)
      .map(f => ({ path: f.p, nome: path.basename(f.p), onde: tilde(path.dirname(f.p)), size: f.size, usado: f.usado }));
  }
  /* Depois de mandar coisas para o Lixo, tira-as do resultado guardado (sem novo varrimento). */
  forget(items) {
    if (!this.result) return;
    const gone = new Set(items.map(i => i.path));
    const under = p => [...gone].some(g => p === g || p.startsWith(g + path.sep));
    const r = this.result;
    r.bigFiles = (r.bigFiles || []).filter(f => !under(f.p));
    r.oldDownloads = (r.oldDownloads || []).filter(f => !under(f.p));
    r.caches = (r.caches || []).filter(c => !gone.has(c.p));
    r.dups = (r.dups || []).map(g => ({ size: g.size, paths: g.paths.filter(p => !gone.has(p)) })).filter(g => g.paths.length > 1);
    // descontar o tamanho em cada pasta que continha o que saiu
    const sub = (n, p, size) => {
      if (!(p === n.path || p.startsWith(n.path + path.sep))) return;
      n.size = Math.max(0, n.size - size);
      for (const c of n.children || []) if (!c.resto) sub(c, p, size);
      if (n.children) n.children = n.children.filter(c => !(c.path === p && !c.resto));
    };
    for (const it of items) for (const root of r.roots) sub(root, it.path, it.size || 0);
    fsp.writeFile(this.cacheFile, JSON.stringify(r)).catch(() => {});
  }
}

module.exports = { Space };

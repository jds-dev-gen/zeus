'use strict';
/*
 * Varrimento do disco em segundo plano (worker thread): nunca bloqueia a interface.
 * Recebe { roots: [{ path, nome }], home, downloads, davinci: [caminhos] } e devolve:
 *  - tree: árvore de pastas com tamanhos (até 4 níveis; o resto agrupado em "Outros")
 *  - byKind: bytes por tipo (vídeo, áudio, apps, documentos, imagens, outros)
 *  - bigFiles: ficheiros com mais de 100 MB
 *  - oldDownloads: ficheiros nas Transferências com mais de 3 meses
 *  - dups: grupos de cópias exatas (mesmo tamanho e mesmo conteúdo)
 *  - caches: pastas de cache do DaVinci encontradas
 */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KIND_EXT = workerData.kindExt;
const EXT_KIND = {};
for (const [k, list] of Object.entries(KIND_EXT)) for (const e of list) EXT_KIND[e] = k;
const kindOf = n => EXT_KIND[path.extname(n).slice(1).toLowerCase()] || 'outros';

const MAX_DEPTH = 4, KEEP = 40, BIG = 100 * 1024 * 1024, DUP_MIN = 1024 * 1024;
const SKIP = new Set(['.Trash', 'Containers', 'Group Containers', '.DocumentRevisions-V100', '.Spotlight-V100', '.fseventsd', 'node_modules_cache']);
const byKind = { video: 0, audio: 0, apps: 0, doc: 0, img: 0, outros: 0 };
const bigFiles = [], oldDownloads = [], caches = [];
const bySize = new Map();
let files = 0, bytes = 0, lastPost = 0;
const now = Date.now();
const oldLimit = now - 90 * 86400000;
const downloads = workerData.downloads;
const davinci = new Set(workerData.davinci || []);

const sizeOf = st => (st.blocks ? st.blocks * 512 : st.size);

function post(cur) {
  if (Date.now() - lastPost < 250) return;
  lastPost = Date.now();
  parentPort.postMessage({ type: 'progress', files, bytes, cur });
}

/* Devolve o nó { nome, path, size, n, kind?, children? } */
function walk(dir, depth, forceKind) {
  const node = { nome: path.basename(dir), path: dir, size: 0, n: 0 };
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { node.err = true; return node; }
  const kids = [];
  const isApp = dir.endsWith('.app');
  const kindHere = forceKind || (isApp ? 'apps' : null);
  const inDownloads = downloads && (dir === downloads);
  const isCache = davinci.has(dir) || /^(CacheClip|ProxyMedia|\.gallery)$/.test(node.nome) && /DaVinci|Resolve|Movies|CacheClip/i.test(dir);
  for (const ent of ents) {
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      const child = walk(p, depth + 1, kindHere);
      node.size += child.size; node.n += child.n;
      if (depth < MAX_DEPTH && !isApp) kids.push(child);
      if (inDownloads) { try { const st = fs.statSync(p); if (st.mtimeMs < oldLimit) oldDownloads.push({ p, size: child.size, mtime: st.mtimeMs }); } catch (e) { /* ok */ } }
      continue;
    }
    if (!ent.isFile()) continue;
    let st;
    try { st = fs.lstatSync(p); } catch (e) { continue; }
    const sz = sizeOf(st);
    node.size += sz; node.n++;
    files++; bytes += sz;
    const k = kindHere || kindOf(ent.name);
    byKind[k] = (byKind[k] || 0) + sz;
    if (!kindHere && sz >= BIG) bigFiles.push({ p, size: sz, mtime: st.mtimeMs, atime: st.atimeMs, kind: k });
    if (inDownloads && st.mtimeMs < oldLimit) oldDownloads.push({ p, size: sz, mtime: st.mtimeMs });
    if (!kindHere && st.size >= DUP_MIN) {
      const l = bySize.get(st.size);
      if (l) l.push(p); else bySize.set(st.size, [p]);
    }
  }
  if (isCache) caches.push({ p: dir, size: node.size });
  if (kids.length) {
    kids.sort((a, b) => b.size - a.size);
    const keep = kids.slice(0, KEEP), rest = kids.slice(KEEP);
    const looseFiles = node.size - kids.reduce((s, c) => s + c.size, 0);
    const restSize = rest.reduce((s, c) => s + c.size, 0) + looseFiles;
    node.children = keep;
    if (restSize > 0) node.children.push({ nome: 'Ficheiros soltos e outros', path: dir, size: restSize, n: 0, resto: true });
  }
  post(dir);
  return node;
}

function hashFile(p, partial) {
  const h = crypto.createHash('sha1');
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let pos = 0, n;
    const max = partial ? 64 * 1024 : Infinity;
    while (pos < max && (n = fs.readSync(fd, buf, 0, Math.min(buf.length, max - pos), pos)) > 0) { h.update(buf.subarray(0, n)); pos += n; }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function findDups() {
  const groups = [];
  let hashedBytes = 0;
  const LIMIT = 20 * 1024 * 1024 * 1024;   // no máximo 20 GB lidos para comparar
  const cands = [...bySize.entries()].filter(([, l]) => l.length > 1).sort((a, b) => b[0] * b[1].length - a[0] * a[1].length);
  for (const [size, list] of cands) {
    if (hashedBytes > LIMIT) break;
    const byPart = new Map();
    for (const p of list) { try { const k = hashFile(p, true); (byPart.get(k) || byPart.set(k, []).get(k)).push(p); } catch (e) { /* sem acesso */ } }
    for (const same of byPart.values()) {
      if (same.length < 2) continue;
      const byFull = new Map();
      for (const p of same) { try { hashedBytes += size; const k = hashFile(p, false); (byFull.get(k) || byFull.set(k, []).get(k)).push(p); } catch (e) { /* ok */ } }
      for (const g of byFull.values()) if (g.length > 1) groups.push({ size, paths: g });
    }
    parentPort.postMessage({ type: 'progress', files, bytes, cur: 'A comparar cópias…' });
  }
  return groups;
}

const roots = workerData.roots.map(r => {
  const t = walk(r.path, 1, null);
  t.nome = r.nome || t.nome;
  return t;
});
const dups = findDups();
bigFiles.sort((a, b) => b.size - a.size);
parentPort.postMessage({
  type: 'done',
  result: { at: Date.now(), roots, byKind, bigFiles: bigFiles.slice(0, 500), oldDownloads, dups, caches, files, bytes }
});

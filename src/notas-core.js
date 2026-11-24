/*
 * Núcleo das Notas para a sincronização Mac ⇄ tablet — o mesmo código no Zeus do Mac e no do tablet
 * (copiado para android/app/src/main/assets/app/ na compilação). Não usa nada do Node nem do browser.
 *
 * Documento "notas.json" na pasta escondida da app na Drive:
 *   { v: 1, notes: [{ id, title, folder, fav, created (ISO), updated (ms), html }],
 *     folders: [nome], foldersAt (ms), del: { id: ms } }
 * Regra: cada nota inteira — ganha a alteração mais recente; uma nota apagada não volta, a não ser que
 * tenha sido mexida depois de apagada; as pastas são as da cópia que as mudou por último, mais as que
 * alguma nota usa. Os apagados esquecem-se ao fim de 120 dias.
 */
(function (root) {
'use strict';
const DEL_KEEP = 120 * 24 * 3600 * 1000;

function normalizeNotas(j) {
  const d = j && typeof j === 'object' ? j : {};
  const obj = o => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  return {
    v: 1,
    notes: Array.isArray(d.notes) ? d.notes.filter(n => n && n.id).map(n => ({
      id: String(n.id), title: String(n.title || 'Nota sem título'), folder: String(n.folder || ''), fav: !!n.fav,
      created: String(n.created || ''), updated: +n.updated || 0, html: String(n.html || '')
    })) : [],
    folders: Array.isArray(d.folders) ? d.folders.filter(f => typeof f === 'string' && f) : [],
    foldersAt: +d.foldersAt || 0,
    del: obj(d.del)
  };
}

function mergeNotas(a, b, now) {
  now = now || Date.now();
  a = normalizeNotas(a); b = normalizeNotas(b);
  const del = {};
  for (const src of [a.del, b.del]) for (const [k, t] of Object.entries(src)) { const v = +t || 0; if (now - v < DEL_KEEP && v > (del[k] || 0)) del[k] = v; }
  const m = new Map();
  const better = (x, y) => (y.updated !== x.updated ? y.updated > x.updated : JSON.stringify(y) > JSON.stringify(x));
  for (const n of [...a.notes, ...b.notes]) { const o = m.get(n.id); if (!o || better(o, n)) m.set(n.id, n); }
  const notes = [...m.values()].filter(n => !(del[n.id] && del[n.id] >= n.updated))
    .sort((p, q) => (Date.parse(q.created) || 0) - (Date.parse(p.created) || 0) || (p.id < q.id ? -1 : 1));
  const first = b.foldersAt > a.foldersAt ? b : a;
  const folders = [...new Set([...first.folders, ...notes.map(n => n.folder).filter(Boolean)])].sort((x, y) => x.localeCompare(y, 'pt'));
  return { v: 1, notes, folders, foldersAt: Math.max(a.foldersAt, b.foldersAt), del };
}

const api = { mergeNotas, normalizeNotas };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NotasCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

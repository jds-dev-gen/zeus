/*
 * Núcleo do Zoom — o mesmo código no Zeus do Mac (src/zoom.js) e no Zeus do tablet (copiado para
 * android/app/src/main/assets/app/ na compilação). Não usa nada do Node nem do browser.
 */
(function (root) {
'use strict';
const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// endereço "limpo" para reconhecer a mesma página (sem #, sem utm_*, sem / no fim)
function keyOf(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    [...u.searchParams.keys()].forEach(k => { if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src|igshid|_ga)/i.test(k)) u.searchParams.delete(k); });
    let s = u.origin + u.pathname.replace(/\/+$/, '') + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
    return s.replace(/^https?:\/\/(www\.)?/i, '');
  } catch (e) { return String(url || ''); }
}
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

class ZoomStore {
  // data: o conteúdo guardado; persist(d, fromSync): grava (ficheiro no Mac, armazenamento da app no tablet)
  constructor(data, persist) {
    this.d = normalize(data || {});
    this.persist = persist || (() => {});
  }
  save(fromSync) { this.persist(this.d, !!fromSync); }
  /* a cópia juntada com a da Drive passa a ser a deste aparelho */
  replace(d) { this.d = normalize(d); this.save(true); }

  byUrl(url) { const k = keyOf(url); return this.d.items.find(i => i.key === k) || null; }
  byId(id) { return this.d.items.find(i => i.id === id) || null; }
  has(url) { return !!this.byUrl(url); }

  /* guardar (ou atualizar) uma página; meta = { url, title, image, excerpt, site } */
  add(meta, extra = {}) {
    if (!/^https?:\/\//i.test(meta.url || '')) return null;
    let it = this.byUrl(meta.url);
    const now = Date.now();
    if (!it) {
      it = { id: uid(), url: meta.url, key: keyOf(meta.url), title: '', site: '', image: '', excerpt: '', note: '', col: '', tags: [], highlights: [], createdAt: now, updatedAt: now };
      this.d.items.unshift(it);
    }
    if (meta.title) it.title = clip(meta.title, 300);
    if (!it.title) it.title = hostOf(meta.url);
    if (meta.site) it.site = clip(meta.site, 80);
    if (!it.site) it.site = hostOf(meta.url);
    if (meta.image && /^https?:\/\//i.test(meta.image)) it.image = String(meta.image).slice(0, 2000);
    if (meta.excerpt) it.excerpt = clip(meta.excerpt, 400);
    if ('col' in extra) it.col = this.colOk(extra.col);
    it.updatedAt = now;
    this.save();
    return it;
  }
  update(id, patch = {}) {
    const it = this.byId(id); if (!it) return null;
    if ('title' in patch) it.title = clip(patch.title, 300) || it.title;
    if ('note' in patch) it.note = String(patch.note || '').slice(0, 20000);
    if ('col' in patch) it.col = this.colOk(patch.col);
    if ('tags' in patch && Array.isArray(patch.tags)) it.tags = [...new Set(patch.tags.map(t => clip(t, 40).toLowerCase()).filter(Boolean))].slice(0, 30);
    it.updatedAt = Date.now();
    this.save();
    return it;
  }
  remove(id) { const n = this.d.items.length; this.d.items = this.d.items.filter(i => i.id !== id); if (this.d.items.length !== n) { this.d.del.items[id] = Date.now(); this.save(); } return true; }

  /* coleções */
  colOk(id) { return id && this.d.cols.some(c => c.id === id) ? id : ''; }
  addCol(name) { name = clip(name, 60); if (!name) return null; const now = Date.now(); const c = { id: uid(), name, updatedAt: now }; this.d.cols.push(c); this.d.colsAt = now; this.save(); return c; }
  renameCol(id, name) { const c = this.d.cols.find(x => x.id === id); name = clip(name, 60); if (c && name) { c.name = name; c.updatedAt = Date.now(); this.save(); } return c; }
  removeCol(id) {
    const now = Date.now();
    this.d.cols = this.d.cols.filter(c => c.id !== id); this.d.del.cols[id] = now;
    this.d.items.forEach(i => { if (i.col === id) { i.col = ''; i.updatedAt = now; } });
    this.save(); return true;
  }
  moveCol(id, dir) { const i = this.d.cols.findIndex(c => c.id === id), j = i + dir; if (i < 0 || j < 0 || j >= this.d.cols.length) return; [this.d.cols[i], this.d.cols[j]] = [this.d.cols[j], this.d.cols[i]]; this.d.colsAt = Date.now(); this.save(); }

  /* highlights: a página é guardada automaticamente no primeiro highlight */
  addHighlight(meta, h) {
    const text = String(h.text || '').slice(0, 5000);
    if (!text.trim()) return null;
    const it = this.add(meta);
    if (!it) return null;
    const now = Date.now();
    const hl = { id: uid(), text, prefix: String(h.prefix || '').slice(-60), suffix: String(h.suffix || '').slice(0, 60), color: COLORS.includes(h.color) ? h.color : 'yellow', comment: String(h.comment || '').slice(0, 5000), createdAt: now, updatedAt: now };
    it.highlights.push(hl);
    it.updatedAt = Date.now();
    this.save();
    return { item: it, hl };
  }
  updateHighlight(url, hid, patch = {}) {
    const it = this.byUrl(url) || this.d.items.find(i => i.highlights.some(h => h.id === hid));
    const hl = it && it.highlights.find(h => h.id === hid); if (!hl) return null;
    if ('color' in patch && COLORS.includes(patch.color)) hl.color = patch.color;
    if ('comment' in patch) hl.comment = String(patch.comment || '').slice(0, 5000);
    hl.updatedAt = it.updatedAt = Date.now();
    this.save();
    return hl;
  }
  removeHighlight(url, hid) {
    const it = this.byUrl(url) || this.d.items.find(i => i.highlights.some(h => h.id === hid));
    if (!it) return false;
    const n = it.highlights.length;
    it.highlights = it.highlights.filter(h => h.id !== hid);
    if (it.highlights.length !== n) { this.d.del.hls[hid] = it.updatedAt = Date.now(); }
    this.save();
    return true;
  }
  highlightsFor(url) { const it = this.byUrl(url); return it ? it.highlights : []; }

  data() { return this.d; }
}

/* ------------------------------------------------------------------ */
/* Junção de duas cópias (a do aparelho e a da Drive)                  */
/* ------------------------------------------------------------------ */
const DEL_KEEP = 120 * 24 * 3600 * 1000;
function normalize(j) {
  const d = j && typeof j === 'object' ? j : {};
  const del = d.del && typeof d.del === 'object' ? d.del : {};
  const obj = o => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  return {
    v: 1,
    cols: Array.isArray(d.cols) ? d.cols.filter(c => c && c.id) : [],
    colsAt: +d.colsAt || 0,
    items: Array.isArray(d.items) ? d.items.filter(i => i && i.id && i.url).map(i => Object.assign({ tags: [], highlights: [] }, i, { highlights: Array.isArray(i.highlights) ? i.highlights.filter(h => h && h.id) : [], key: i.key || keyOf(i.url) })) : [],
    del: { items: obj(del.items), hls: obj(del.hls), cols: obj(del.cols) }
  };
}
const ts = x => +(x && (x.updatedAt || x.createdAt)) || 0;
function mergeDel(a, b, now) {
  const out = {};
  for (const src of [a, b]) for (const [k, t] of Object.entries(src)) { const v = +t || 0; if (now - v < DEL_KEEP && v > (out[k] || 0)) out[k] = v; }
  return out;
}
function mergeHls(xs, ys, delHls) {
  const m = new Map();
  for (const h of [...xs, ...ys]) { const o = m.get(h.id); if (!o || ts(h) > ts(o)) m.set(h.id, h); }
  return [...m.values()].filter(h => !delHls[h.id]).sort((p, q) => (p.createdAt || 0) - (q.createdAt || 0) || (p.id < q.id ? -1 : 1));
}
const first = (x, y) => { const m = Math.min(x.createdAt || Infinity, y.createdAt || Infinity); return m === Infinity ? 0 : m; };
// o mesmo artigo em duas versões: os campos da mais recente, os destaques das duas
function combine(x, y, delHls) {
  const newer = ts(y) > ts(x) ? y : x;
  return Object.assign({}, newer, {
    createdAt: first(x, y),
    updatedAt: Math.max(ts(x), ts(y)),
    highlights: mergeHls(x.highlights || [], y.highlights || [], delHls)
  });
}
/* junta a cópia local (a) com a da Drive (b); o resultado é o mesmo seja qual for a ordem */
function mergeZoom(a, b, now = Date.now()) {
  a = normalize(a); b = normalize(b);
  const del = { items: mergeDel(a.del.items, b.del.items, now), hls: mergeDel(a.del.hls, b.del.hls, now), cols: mergeDel(a.del.cols, b.del.cols, now) };
  // artigos: primeiro pelo id; depois o mesmo endereço guardado nos dois aparelhos fica um só (o mais antigo dá o id)
  const byId = new Map();
  for (const it of [...a.items, ...b.items]) byId.set(it.id, byId.has(it.id) ? combine(byId.get(it.id), it, del.hls) : combine(it, it, del.hls));
  const byKey = new Map();
  const older = (p, q) => (p.createdAt || 0) - (q.createdAt || 0) || (p.id < q.id ? -1 : 1);
  for (const it of [...byId.values()].sort(older)) {
    if (del.items[it.id] && del.items[it.id] >= ts(it)) continue;            // apagado depois da última alteração
    const o = byKey.get(it.key);
    byKey.set(it.key, o ? Object.assign(combine(o, it, del.hls), { id: o.id }) : it);
  }
  // coleções: a alteração mais recente ganha; a ordem é a da cópia que a mudou por último
  const cm = new Map();
  for (const c of [...a.cols, ...b.cols]) { const o = cm.get(c.id); if (!o || ts(c) > ts(o)) cm.set(c.id, c); }
  const first = b.colsAt > a.colsAt ? b : a, second = first === a ? b : a;
  const seen = new Set(), cols = [];
  for (const c of [...first.cols, ...second.cols]) if (!seen.has(c.id) && !del.cols[c.id]) { seen.add(c.id); cols.push(cm.get(c.id)); }
  const colIds = new Set(cols.map(c => c.id));
  const items = [...byKey.values()].map(it => (it.col && !colIds.has(it.col) ? Object.assign({}, it, { col: '' }) : it))
    .sort((p, q) => (q.createdAt || 0) - (p.createdAt || 0) || (p.id < q.id ? -1 : 1));
  return { v: 1, cols, colsAt: Math.max(a.colsAt, b.colsAt), items, del };
}

const api = { ZoomStore, keyOf, COLORS, mergeZoom, normalize };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ZoomCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

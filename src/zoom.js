'use strict';
/*
 * Zoom — os artigos guardados do João (à maneira do Raindrop), com coleções, notas e highlights.
 * Tudo fica no ficheiro zoom.json da pasta do Zeus.
 *
 *  item: { id, url, key, title, site, image, excerpt, note, col, tags[], createdAt, updatedAt,
 *          highlights: [{ id, text, prefix, suffix, color, comment, createdAt }] }
 *  coleção: { id, name }
 */
const fs = require('fs');
const path = require('path');

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

class Zoom {
  constructor(dir, onChange) {
    this.file = path.join(dir, 'zoom.json');
    this.onChange = onChange || (() => {});
    this.d = { v: 1, cols: [], items: [] };
    try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (j && Array.isArray(j.items)) this.d = { v: 1, cols: j.cols || [], items: j.items }; } catch (e) { /* primeira vez */ }
    this.t = null;
  }
  save() {
    clearTimeout(this.t);
    this.t = setTimeout(() => {
      try { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.d)); fs.renameSync(tmp, this.file); } catch (e) { /* ok */ }
    }, 250);
    this.onChange();
  }
  flush() { if (this.t) { clearTimeout(this.t); try { fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch (e) { /* ok */ } } }

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
  remove(id) { const n = this.d.items.length; this.d.items = this.d.items.filter(i => i.id !== id); if (this.d.items.length !== n) this.save(); return true; }

  /* coleções */
  colOk(id) { return id && this.d.cols.some(c => c.id === id) ? id : ''; }
  addCol(name) { name = clip(name, 60); if (!name) return null; const c = { id: uid(), name }; this.d.cols.push(c); this.save(); return c; }
  renameCol(id, name) { const c = this.d.cols.find(x => x.id === id); name = clip(name, 60); if (c && name) { c.name = name; this.save(); } return c; }
  removeCol(id) { this.d.cols = this.d.cols.filter(c => c.id !== id); this.d.items.forEach(i => { if (i.col === id) i.col = ''; }); this.save(); return true; }
  moveCol(id, dir) { const i = this.d.cols.findIndex(c => c.id === id), j = i + dir; if (i < 0 || j < 0 || j >= this.d.cols.length) return; [this.d.cols[i], this.d.cols[j]] = [this.d.cols[j], this.d.cols[i]]; this.save(); }

  /* highlights: a página é guardada automaticamente no primeiro highlight */
  addHighlight(meta, h) {
    const text = String(h.text || '').slice(0, 5000);
    if (!text.trim()) return null;
    const it = this.add(meta);
    if (!it) return null;
    const hl = { id: uid(), text, prefix: String(h.prefix || '').slice(-60), suffix: String(h.suffix || '').slice(0, 60), color: COLORS.includes(h.color) ? h.color : 'yellow', comment: String(h.comment || '').slice(0, 5000), createdAt: Date.now() };
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
    it.updatedAt = Date.now();
    this.save();
    return hl;
  }
  removeHighlight(url, hid) {
    const it = this.byUrl(url) || this.d.items.find(i => i.highlights.some(h => h.id === hid));
    if (!it) return false;
    it.highlights = it.highlights.filter(h => h.id !== hid);
    this.save();
    return true;
  }
  highlightsFor(url) { const it = this.byUrl(url); return it ? it.highlights : []; }

  data() { return this.d; }
}

module.exports = { Zoom, keyOf, COLORS };

'use strict';
/*
 * Zoom — os artigos guardados do João (à maneira do Raindrop), com coleções, notas e highlights.
 * Tudo fica no ficheiro zoom.json da pasta do Zeus.
 *
 *  item: { id, url, key, title, site, image, excerpt, note, col, tags[], createdAt, updatedAt,
 *          highlights: [{ id, text, prefix, suffix, color, comment, createdAt }] }
 *  coleção: { id, name, updatedAt }
 *
 * Desde a 0.23.0 o Zoom sincroniza com o tablet pela Drive (ver sync.js). Para isso:
 *  - cada destaque e cada coleção têm updatedAt (a alteração mais recente ganha);
 *  - o que se apaga fica registado em d.del (artigos, destaques e coleções, com a hora), para não
 *    voltar a aparecer quando o outro aparelho ainda o tem; o registo esquece-se ao fim de 120 dias;
 *  - d.colsAt é a hora da última mudança na ordem das coleções.
 * A junção das duas cópias (mergeZoom) é a mesma no Mac e no tablet.
 */
const fs = require('fs');
const path = require('path');
const { ZoomStore, keyOf, COLORS, mergeZoom, normalize } = require('./zoom-core');

/* o Zoom do Mac: o núcleo (zoom-core.js) gravado em zoom.json na pasta do Zeus */
class Zoom extends ZoomStore {
  constructor(dir, onChange) {
    let j = {};
    const file = path.join(dir, 'zoom.json');
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); if (!j || !Array.isArray(j.items)) j = {}; } catch (e) { /* primeira vez */ }
    super(j, (d, fromSync) => this.write(fromSync));
    this.file = file;
    this.onChange = onChange || (() => {});
    this.t = null;
  }
  // fromSync: a mudança veio da Drive (não volta a pedir sincronização)
  write(fromSync) {
    clearTimeout(this.t);
    this.t = setTimeout(() => {
      try { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.d)); fs.renameSync(tmp, this.file); } catch (e) { /* ok */ }
    }, 250);
    this.onChange(!!fromSync);
  }
  flush() { if (this.t) { clearTimeout(this.t); try { fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch (e) { /* ok */ } } }
}

module.exports = { Zoom, keyOf, COLORS, mergeZoom, normalize };

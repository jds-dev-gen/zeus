'use strict';
/*
 * Cópia em Word de uma nota. A página das Notas descreve o texto em blocos (parágrafos, títulos, listas, citações)
 * com pedaços formatados (negrito, itálico, sublinhado, riscado, cor, destaque, tamanho, ligação); aqui passa-se a .docx.
 * Letra sempre Arial. Os destaques vão como sombreado (o "realce" do Word só tem 16 cores fixas).
 */
const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, LevelFormat, AlignmentType, ShadingType, BorderStyle } = require('docx');

const hex = c => {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s); if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s); if (m) return [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
};
const BASE_PX = 16;
const halfPt = px => Math.round(Math.max(6, Math.min(96, +px || BASE_PX)) * 0.75 * 2);   // px → meios-pontos

function runs(list, extra = {}) {
  const out = [];
  for (const r of list || []) {
    if (r.br) { out.push(new TextRun({ break: 1 })); continue; }
    const text = String(r.x || '');
    if (!text) continue;
    const o = Object.assign({ text, font: 'Arial' }, extra);
    if (r.b) o.bold = true;
    if (r.i) o.italics = true;
    if (r.u) o.underline = {};
    if (r.s) o.strike = true;
    if (r.sz) o.size = halfPt(r.sz);
    const c = hex(r.c); if (c) o.color = c;
    const bg = hex(r.bg); if (bg) o.shading = { type: ShadingType.CLEAR, color: 'auto', fill: bg };
    if (r.mono) { o.font = 'Menlo'; o.size = halfPt(12); o.color = '777777'; }
    if (r.a && /^https?:\/\//i.test(r.a)) {
      o.color = o.color || '1A5FB4'; o.underline = {};
      out.push(new ExternalHyperlink({ link: r.a, children: [new TextRun(o)] }));
    } else out.push(new TextRun(o));
  }
  return out;
}

async function buildDocx(title, blocks) {
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: String(title || 'Nota'), font: 'Arial', bold: true, size: halfPt(30) })], spacing: { after: 240 } })];
  let listN = 0, lastOl = null;
  for (const b of blocks || []) {
    const t = b.t;
    if (t === 'h1' || t === 'h2' || t === 'h3') {
      const size = t === 'h1' ? 29 : t === 'h2' ? 22.5 : 18;
      children.push(new Paragraph({ heading: t === 'h1' ? HeadingLevel.HEADING_1 : t === 'h2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, spacing: { before: 280, after: 100 }, children: runs(b.runs, { bold: true, size: halfPt(size), color: '1A1A1A' }) }));
    } else if (t === 'li') {
      const lvl = Math.max(0, Math.min(5, b.level | 0));
      if (b.list === 'ol') {
        if (lastOl !== b.listId) { listN++; lastOl = b.listId; }
        children.push(new Paragraph({ numbering: { reference: 'num', level: lvl, instance: listN }, children: runs(b.runs), spacing: { after: 60 } }));
      } else if (b.list === 'todo') {
        children.push(new Paragraph({ indent: { left: 360 + lvl * 360 }, spacing: { after: 60 }, children: [new TextRun({ text: b.done ? '☑  ' : '☐  ', font: 'Arial' }), ...runs(b.runs, b.done ? { strike: true, color: '888888' } : {})] }));
      } else {
        children.push(new Paragraph({ bullet: { level: lvl }, children: runs(b.runs), spacing: { after: 60 } }));
      }
    } else if (t === 'quote') {
      children.push(new Paragraph({
        indent: { left: 400 }, spacing: { before: 120, after: 120 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'D8B400', space: 10 } },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F6F6F4' },
        children: runs(b.runs)
      }));
    } else {
      children.push(new Paragraph({ spacing: { after: 140 }, children: runs(b.runs) }));
    }
  }
  const doc = new Document({
    creator: 'Zeus Notas', title: String(title || 'Nota'),
    styles: { default: { document: { run: { font: 'Arial', size: halfPt(BASE_PX) }, paragraph: { spacing: { line: 300 } } } } },
    numbering: { config: [{ reference: 'num', levels: [0, 1, 2, 3, 4, 5].map(l => ({ level: l, format: LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 + l * 360, hanging: 360 } } } })) }] },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocx };

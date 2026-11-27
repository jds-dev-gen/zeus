'use strict';
/*
 * Mapa de blocos: algoritmo "squarified treemap" (Bruls, Huizing e van Wijk).
 * Recebe itens com .size e devolve-os com x, y, w, h (em percentagem da área 100×100).
 */
(() => {
  function worst(row, side, total, area) {
    const s = row.reduce((t, r) => t + r, 0);
    if (!s) return Infinity;
    const max = Math.max(...row), min = Math.min(...row);
    const s2 = s * s, side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  }

  function squarify(items, W = 100, H = 100) {
    const list = items.filter(i => i.size > 0).sort((a, b) => b.size - a.size);
    const total = list.reduce((t, i) => t + i.size, 0);
    if (!total) return [];
    const scale = (W * H) / total;
    const areas = list.map(i => i.size * scale);
    const out = [];
    let x = 0, y = 0, w = W, h = H, i = 0;
    while (i < areas.length) {
      const side = Math.min(w, h);
      let row = [areas[i]], j = i + 1;
      while (j < areas.length && worst(row.concat(areas[j]), side) <= worst(row, side)) { row.push(areas[j]); j++; }
      const sum = row.reduce((t, a) => t + a, 0);
      if (w >= h) {
        // coluna à esquerda
        const cw = sum / h;
        let cy = y;
        row.forEach((a, k) => { const ch = a / cw; out.push(Object.assign({}, list[i + k], { x, y: cy, w: cw, h: ch })); cy += ch; });
        x += cw; w -= cw;
      } else {
        // linha em cima
        const rh = sum / w;
        let cx = x;
        row.forEach((a, k) => { const cw2 = a / rh; out.push(Object.assign({}, list[i + k], { x: cx, y, w: cw2, h: rh })); cx += cw2; });
        y += rh; h -= rh;
      }
      i = j;
    }
    return out;
  }

  if (typeof window !== 'undefined') { window.O = window.O || {}; window.O.squarify = squarify; }
  if (typeof module !== 'undefined') module.exports = { squarify };
})();

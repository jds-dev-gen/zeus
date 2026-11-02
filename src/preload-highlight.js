'use strict';
/*
 * Highlights do Zoom, em todas as páginas web abertas em separadores (e na pré-visualização do Radar).
 * Ao selecionar texto aparece uma pequena barra com cores e "Comentar"; o destaque fica guardado no Zoom
 * (a página é guardada automaticamente) e volta a aparecer quando a página é aberta outra vez.
 *
 * Corre no "mundo isolado" do preload: a página não vê nem consegue usar estas funções, e só cliques
 * verdadeiros (isTrusted) contam.
 */
const { ipcRenderer } = require('electron');

const COLORS = { yellow: '#fff1a6', green: '#c6f3cc', blue: '#c9e4ff', pink: '#ffd3e4', orange: '#ffe1bd' };
const NAMES = { yellow: 'Amarelo', green: 'Verde', blue: 'Azul', pink: 'Rosa', orange: 'Laranja' };
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'IFRAME']);

let enabled = false, host = null, root = null, list = [], applied = new Set();

function start() {
  if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
  ipcRenderer.invoke('zh:list').then(l => {
    if (l === null) return;            // não é um separador: sem highlights
    enabled = true;
    list = l || [];
    injectStyle();
    applyAll();
    // páginas que carregam o texto depois (sites modernos): mais duas tentativas
    setTimeout(applyAll, 1500); setTimeout(applyAll, 4500);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('mousedown', e => { if (host && !e.composedPath().includes(host)) hideBar(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideBar(); }, true);
    window.addEventListener('scroll', () => hideBar(true), true);
  }).catch(() => {});
}
ipcRenderer.on('zh:refresh', async () => {
  if (!enabled) return;
  list = (await ipcRenderer.invoke('zh:list').catch(() => null)) || [];
  removeAllMarks(); applied = new Set(); applyAll();
});

/* ---------- texto da página ---------- */
function textNodes() {
  const out = [];
  if (!document.body) return out;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      let p = n.parentNode;
      while (p && p !== document.body) { if (SKIP.has(p.nodeName.toUpperCase()) || p === host) return NodeFilter.FILTER_REJECT; p = p.parentNode; }
      return n.data.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  let n; while ((n = w.nextNode())) out.push(n);
  return out;
}
function snapshot() {
  const nodes = textNodes(), starts = []; let full = '';
  for (const n of nodes) { starts.push(full.length); full += n.data; }
  return { nodes, starts, full };
}
function rangeToOffsets(range, snap) {
  let gs = -1, ge = -1;
  snap.nodes.forEach((n, i) => {
    if (!range.intersectsNode(n)) return;
    const a = n === range.startContainer ? range.startOffset : 0;
    const b = n === range.endContainer ? range.endOffset : n.data.length;
    if (b <= a) return;
    if (gs < 0) gs = snap.starts[i] + a;
    ge = snap.starts[i] + b;
  });
  return gs < 0 ? null : [gs, ge];
}
function wrap(snap, gs, ge, id, color, comment) {
  const marks = [];
  for (let i = snap.nodes.length - 1; i >= 0; i--) {
    const n = snap.nodes[i], s0 = snap.starts[i], s1 = s0 + n.data.length;
    const a = Math.max(gs, s0), b = Math.min(ge, s1);
    if (b <= a) continue;
    if (!n.data.slice(a - s0, b - s0).trim()) continue;   // só espaços entre blocos: não se marca
    let mid = n;
    if (b - s0 < n.data.length) mid.splitText(b - s0);
    if (a - s0 > 0) mid = mid.splitText(a - s0);
    const m = document.createElement('mark');
    m.className = 'zh-mark' + (comment ? ' zh-has-comment' : '');
    m.dataset.zh = id; m.dataset.zhColor = color;
    // o site pode dar estilo próprio a <mark> (negrito, itálico…): o destaque só pinta o fundo
    for (const [k, v] of [['font', 'inherit'], ['font-style', 'inherit'], ['font-weight', 'inherit'], ['font-family', 'inherit'], ['font-size', 'inherit'], ['letter-spacing', 'inherit'], ['text-transform', 'inherit'], ['text-decoration', 'inherit'], ['line-height', 'inherit'], ['margin', '0'], ['box-shadow', 'none']]) m.style.setProperty(k, v, 'important');
    if (comment) m.title = comment;
    mid.parentNode.insertBefore(m, mid); m.appendChild(mid);
    marks.push(m);
  }
  return marks;
}
function unwrap(id) {
  document.querySelectorAll(`mark.zh-mark[data-zh="${CSS.escape(id)}"]`).forEach(m => {
    const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize();
  });
}
function removeAllMarks() { [...new Set([...document.querySelectorAll('mark.zh-mark')].map(m => m.dataset.zh))].forEach(unwrap); }
function applyAll() {
  for (const h of list) {
    if (applied.has(h.id)) continue;
    const snap = snapshot();
    let i = h.prefix || h.suffix ? snap.full.indexOf((h.prefix || '') + h.text + (h.suffix || '')) : -1;
    let gs = i >= 0 ? i + (h.prefix || '').length : snap.full.indexOf(h.text);
    if (gs < 0) continue;
    if (wrap(snap, gs, gs + h.text.length, h.id, h.color, h.comment).length) applied.add(h.id);
  }
}
function setMarkInfo(id, color, comment) {
  document.querySelectorAll(`mark.zh-mark[data-zh="${CSS.escape(id)}"]`).forEach(m => {
    if (color) m.dataset.zhColor = color;
    if (comment !== undefined) { m.classList.toggle('zh-has-comment', !!comment); if (comment) m.title = comment; else m.removeAttribute('title'); }
  });
}

/* ---------- estilo das marcas ---------- */
function injectStyle() {
  if (document.getElementById('zeus-zh-style')) return;
  const st = document.createElement('style');
  st.id = 'zeus-zh-style';
  st.textContent = Object.entries(COLORS).map(([k, v]) => `mark.zh-mark[data-zh-color="${k}"]{background:${v} !important;color:inherit !important;font:inherit !important;font-style:inherit !important;font-weight:inherit !important;}`).join('\n') +
    `\nmark.zh-mark{border-radius:2px;padding:0 1px;cursor:pointer;box-decoration-break:clone;-webkit-box-decoration-break:clone;}
mark.zh-mark.zh-has-comment{border-bottom:2px dotted rgba(0,0,0,.45);}`;
  (document.head || document.documentElement).appendChild(st);
}

/* ---------- barra flutuante ---------- */
let barState = null;   // { mode: 'new', range } | { mode: 'edit', id }
function ensureBar() {
  if (host && host.isConnected) return;
  host = document.createElement('zeus-highlight-bar');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;display:none;';
  root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .bar{font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1b1b1e;color:#f6f6f4;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);padding:6px;display:flex;flex-direction:column;gap:6px;min-width:0}
    .row{display:flex;align-items:center;gap:4px}
    .c{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
    .c:hover{transform:scale(1.12)} .c.on{border-color:#fff}
    .b{background:transparent;border:0;color:#f6f6f4;font:inherit;padding:4px 8px;border-radius:8px;cursor:pointer;white-space:nowrap}
    .b:hover{background:#2e2e33}
    .sep{width:1px;height:18px;background:#3a3a3f;margin:0 2px}
    textarea{width:260px;min-height:64px;resize:vertical;border-radius:8px;border:1px solid #3a3a3f;background:#121214;color:#f6f6f4;font:13px/1.4 -apple-system,sans-serif;padding:6px 8px;outline:none}
    .ok{background:#f6f6f4;color:#0b0b0c;font-weight:600}
    .ok:hover{background:#fff}
    .hint{font-size:11px;color:#9a9aa0;padding:0 4px}
  </style><div class="bar"></div>`;
  document.documentElement.appendChild(host);
  root.addEventListener('mousedown', e => e.stopPropagation());
}
function place(rect) {
  host.style.display = 'block';
  const bw = host.getBoundingClientRect().width || 220, bh = host.getBoundingClientRect().height || 40;
  let x = rect.left + rect.width / 2 - bw / 2, y = rect.top - bh - 10;
  if (y < 6) y = rect.bottom + 10;
  x = Math.max(6, Math.min(x, innerWidth - bw - 6));
  host.style.left = x + 'px'; host.style.top = y + 'px';
}
function hideBar(onlyIfNotEditing) {
  if (!host) return;
  if (onlyIfNotEditing && root.querySelector('textarea')) return;
  host.style.display = 'none'; barState = null;
}
function renderBar(rect, current) {
  ensureBar();
  const bar = root.querySelector('.bar');
  const editing = barState.mode === 'edit';
  bar.innerHTML = `<div class="row">${Object.entries(COLORS).map(([k, v]) => `<button class="c ${current && current.color === k ? 'on' : ''}" data-color="${k}" title="${NAMES[k]}" style="background:${v}"></button>`).join('')}
    <span class="sep"></span><button class="b" data-act="comment">${editing && current && current.comment ? 'Editar comentário' : 'Comentar'}</button>
    ${editing ? '<button class="b" data-act="remove" title="Tirar o destaque">Tirar</button>' : ''}</div>`;
  bar.onclick = e => onBarClick(e, rect);
  place(rect);
}
function renderComment(rect, current) {
  const bar = root.querySelector('.bar');
  bar.innerHTML = `<textarea placeholder="O teu comentário a esta passagem…"></textarea><div class="row" style="justify-content:space-between"><span class="hint">⌘↵ para guardar</span><span><button class="b" data-act="cancel">Cancelar</button><button class="b ok" data-act="save">Guardar</button></span></div>`;
  const ta = root.querySelector('textarea');
  ta.value = (current && current.comment) || '';
  ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) bar.querySelector('[data-act="save"]').click(); if (e.key === 'Escape') hideBar(); });
  bar.onclick = e => onBarClick(e, rect);
  place(rect);
  setTimeout(() => ta.focus(), 20);
}
async function onBarClick(e, rect) {
  if (!e.isTrusted) return;
  const btn = e.target.closest('button'); if (!btn || !barState) return;
  const color = btn.dataset.color, act = btn.dataset.act;
  if (barState.mode === 'new') {
    if (color) { await createFrom(barState.range, color, ''); hideBar(); }
    else if (act === 'comment') { barState.pendingColor = 'yellow'; renderComment(rect, null); }
    else if (act === 'save') { const c = root.querySelector('textarea').value.trim(); await createFrom(barState.range, barState.pendingColor || 'yellow', c); hideBar(); }
    else if (act === 'cancel') hideBar();
    return;
  }
  // a editar um destaque que já existe
  const id = barState.id, h = list.find(x => x.id === id);
  if (color) { await ipcRenderer.invoke('zh:update', id, { color }); if (h) h.color = color; setMarkInfo(id, color); hideBar(); }
  else if (act === 'comment') renderComment(rect, h);
  else if (act === 'save') { const c = root.querySelector('textarea').value.trim(); await ipcRenderer.invoke('zh:update', id, { comment: c }); if (h) h.comment = c; setMarkInfo(id, null, c); hideBar(); }
  else if (act === 'cancel') hideBar();
  else if (act === 'remove') { await ipcRenderer.invoke('zh:remove', id); unwrap(id); list = list.filter(x => x.id !== id); applied.delete(id); hideBar(); }
}
async function createFrom(range, color, comment) {
  const snap = snapshot();
  const off = rangeToOffsets(range, snap); if (!off) return;
  const [gs, ge] = off, text = snap.full.slice(gs, ge);
  if (!text.trim()) return;
  const h = await ipcRenderer.invoke('zh:add', { text, prefix: snap.full.slice(Math.max(0, gs - 40), gs), suffix: snap.full.slice(ge, ge + 40), color, comment }).catch(() => null);
  if (!h) return;
  window.getSelection().removeAllRanges();
  list.push(h);
  if (wrap(snapshot(), gs, ge, h.id, h.color, h.comment).length) applied.add(h.id);
}
function onMouseUp(e) {
  if (!e.isTrusted || !enabled) return;
  if (host && e.composedPath().includes(host)) return;
  setTimeout(() => {
    const mark = e.target && e.target.closest && e.target.closest('mark.zh-mark');
    const sel = window.getSelection();
    const text = sel && sel.rangeCount ? sel.toString() : '';
    if (text.trim().length >= 2) {
      const r = sel.getRangeAt(0);
      const anc = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode;
      if (anc && anc.closest && anc.closest('input,textarea,[contenteditable=""],[contenteditable="true"]')) return;
      barState = { mode: 'new', range: r.cloneRange() };
      renderBar(r.getBoundingClientRect(), null);
    } else if (mark) {
      const id = mark.dataset.zh;
      barState = { mode: 'edit', id };
      renderBar(mark.getBoundingClientRect(), list.find(x => x.id === id));
    }
  }, 10);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

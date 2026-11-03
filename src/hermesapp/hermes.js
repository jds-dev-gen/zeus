'use strict';
/* Hermes — ficheiros do Mac dentro do Zeus: encontrar, abrir e arrumar. */
const H = window.hermesApp;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const base = p => String(p).split('/').filter(Boolean).pop() || '/';
const dirOf = p => { const i = String(p).lastIndexOf('/'); return i > 0 ? p.slice(0, i) : '/'; };

let P = { home: '', main: [], cloud: [], pinned: [], tags: [], volumes: [] };
let loc = null;            // { type: 'dir'|'recent'|'tag'|'search', path, name, q, scope, filter }
let back = [], fwd = [];
let items = [], info = {};  // items da vista; info: { free, writable, error }
let sel = new Set(), anchor = -1, focusI = -1;
let mode = 'list';          // list | grid | space
let sort = { key: 'name', dir: 1 };
let sizes = {}, counts = {};
let renaming = null;
let clip = null;            // { paths, cut }
let dragging = null;
const TAGC = { Vermelho: '#ff453a', Laranja: '#ff9f0a', Amarelo: '#ffd60a', Verde: '#30d158', Azul: '#0a84ff', Roxo: '#bf5af2', Cinzento: '#8e8e93' };
try { mode = localStorage.getItem('hermes.mode') || 'list'; const s = JSON.parse(localStorage.getItem('hermes.sort') || 'null'); if (s) sort = s; } catch (e) { /* ok */ }

/* ---------- formatos ---------- */
function bytes(n) {
  if (n == null || !isFinite(n)) return '';
  if (n < 1000) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1000; i++; } while (n >= 1000 && i < 3);
  return (n >= 100 ? Math.round(n) : n.toFixed(1).replace('.', ',').replace(',0', '')) + ' ' + u[i];
}
function when(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const t = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'hoje, ' + t;
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'ontem, ' + t;
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).replace('.', '');
}
const KNAME = { folder: 'Pasta', image: 'Imagem', audio: 'Áudio', video: 'Vídeo', pdf: 'PDF', sheet: 'Folha de cálculo', slides: 'Apresentação', archive: 'Arquivo', code: 'Código', html: 'Página web', app: 'Aplicação', file: 'Ficheiro' };
const EXTNAME = { doc: 'Word', docx: 'Word', pages: 'Pages', txt: 'Texto', md: 'Markdown', rtf: 'RTF', odt: 'Documento', xls: 'Excel', xlsx: 'Excel', numbers: 'Numbers', csv: 'CSV', ppt: 'PowerPoint', pptx: 'PowerPoint', key: 'Keynote' };
const typeName = i => (i.dir ? 'Pasta' : EXTNAME[i.ext] || KNAME[i.kind] || (i.ext ? i.ext.toUpperCase() : 'Ficheiro'));
const FOLDER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const icon = (i, big) => i.dir ? `<span class="ic folder">${big ? FOLDER.replace(/20/g, '64') : FOLDER}</span>` : `<span class="ic ${i.kind === 'doc' ? 'doc' : i.kind}">${esc((i.ext || '').slice(0, 4).toUpperCase() || '·')}</span>`;
const tagDots = i => (i.tags || []).filter(t => TAGC[t]).length ? `<span class="tgs">${i.tags.filter(t => TAGC[t]).map(t => `<i class="tg" style="background:${TAGC[t]}" title="${esc(t)}"></i>`).join('')}</span>` : '';
const pretty = p => { const h = P.home; let s = p; for (const c of P.cloud) if (p.startsWith(c.path)) s = c.name + p.slice(c.path.length); if (s === p && h && p.startsWith(h)) s = '~' + p.slice(h.length); return s.split('/').filter(Boolean).join(' › '); };

/* ================================================================== */
/* Coluna da esquerda                                                   */
/* ================================================================== */
const SIC = {
  recent: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  desktop: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/></svg>',
  docs: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/></svg>',
  down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  home: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9H4z"/></svg>',
  gdrive: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M8 4h8l6 10-4 6H6l-4-6z"/></svg>',
  icloud: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/></svg>',
  folder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  disk: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="17" cy="12" r="1"/></svg>'
};
function renderSide() {
  const item = (pl, key) => {
    const on = pl.id === 'recent' ? loc && loc.type === 'recent' : loc && loc.type === 'dir' && loc.path === pl.path;
    return `<button class="f ${on ? 'on' : ''}" type="button" ${pl.id ? `data-go="${pl.id}"` : `data-path="${esc(pl.path)}" data-drop="${esc(pl.path)}"`} title="${esc(pl.path || '')}">${SIC[pl.icon] || SIC.folder}<span class="n">${esc(pl.name)}</span>${pl.badge ? `<span class="c">${pl.badge} nova${pl.badge > 1 ? 's' : ''}</span>` : ''}</button>`;
  };
  $('#side').innerHTML = P.main.map(p => item(p)).join('') +
    (P.cloud.length ? `<div class="lbl">Cloud</div>` + P.cloud.map(p => item(p)).join('') : '') +
    (P.volumes.length ? `<div class="lbl">Discos</div>` + P.volumes.map(p => item(p)).join('') : '') +
    `<div class="lbl">Fixadas</div>` + (P.pinned.length ? P.pinned.map(p => item(p)).join('') : `<div class="f" style="color:var(--faint);font-size:12px;cursor:default">Clique direito numa pasta › Fixar</div>`) +
    (P.tags.length ? `<div class="lbl">Etiquetas</div>` + P.tags.map(t => `<button class="f ${loc && loc.type === 'tag' && loc.name === t.name ? 'on' : ''}" type="button" data-tag="${esc(t.name)}"><span class="dot" style="background:${t.color}"></span><span class="n">${esc(t.name)}</span></button>`).join('') : '');
}
$('#side').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.go === 'recent') go({ type: 'recent' });
  else if (b.dataset.path) go({ type: 'dir', path: b.dataset.path });
  else if (b.dataset.tag) go({ type: 'tag', name: b.dataset.tag });
});
$('#side').addEventListener('contextmenu', e => { const b = e.target.closest('[data-path]'); if (b) { e.preventDefault(); H.menu([b.dataset.path], { x: e.clientX, y: e.clientY }); } });

/* ================================================================== */
/* Navegar                                                              */
/* ================================================================== */
let loadGen = 0;
async function go(l, opts = {}) {
  if (!opts.keepHistory && loc && JSON.stringify(loc) !== JSON.stringify(l)) { back.push(loc); fwd = []; }
  loc = l; renaming = null;
  if (!opts.keepSel) { sel.clear(); anchor = -1; focusI = -1; }
  if (l.type !== 'search') { $('#q').value = ''; $('#qInfo').textContent = '⌘K'; $('#qbox').classList.remove('on'); }
  try { localStorage.setItem('hermes.loc', JSON.stringify(l.type === 'dir' ? l : { type: 'dir', path: P.home })); } catch (e) { /* ok */ }
  renderSide(); renderPath();
  await load();
}
async function load() {
  const gen = ++loadGen;
  const l = loc;
  if (!opts.silent) $('#content').innerHTML = items.length && l === lastLoaded ? $('#content').innerHTML : `<div class="none">A abrir…</div>`;
  let r;
  if (l.type === 'dir') r = await H.list(l.path);
  else if (l.type === 'recent') r = { items: await H.recent() || [] };
  else if (l.type === 'tag') r = { items: await H.tagged(l.name) || [] };
  else if (l.type === 'search') { $('#content').innerHTML = '<div class="none">A procurar…</div>'; const res = await H.search(l.q, l.scope, l.filter); if (res === null) return; r = { items: res || [] }; }
  if (gen !== loadGen) return;
  lastLoaded = l;
  info = { free: r.free, writable: !!r.writable, error: r.error || '', parent: r.parent };
  items = r.items || [];
  // a seleção sobrevive se os ficheiros ainda lá estiverem
  const have = new Set(items.map(i => i.path)); for (const p of [...sel]) if (!have.has(p)) sel.delete(p);
  applySort();
  render();
  requestSizes();
  if (l.type === 'search') loadSnippets();
}
const opts = {};
let lastLoaded = null;
function applySort() {
  const k = sort.key, d = sort.dir;
  const val = i => k === 'name' ? fold(i.name) : k === 'mtime' ? i.mtime : k === 'size' ? (i.dir ? (sizes[i.path] != null ? sizes[i.path] : -1) : i.size) : k === 'kind' ? typeName(i) : 0;
  if (loc.type === 'search' && k === 'name' && !sort.user) return;   // na pesquisa fica a ordem de relevância
  items.sort((a, b) => {
    if (loc.type === 'dir' && a.dir !== b.dir && k === 'name') return a.dir ? -1 : 1;   // pastas primeiro, como no Finder
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : fold(a.name) < fold(b.name) ? -1 : 1) * d;
  });
}
function renderPath() {
  const canUp = loc.type === 'dir' && dirOf(loc.path) !== loc.path;
  let crumbs = '';
  if (loc.type === 'dir') {
    // começa no sítio conhecido mais próximo (Google Drive, pasta pessoal…)
    const roots = [...P.cloud, ...P.volumes, { path: P.home, name: base(P.home) }].filter(r => loc.path === r.path || loc.path.startsWith(r.path + '/')).sort((a, b) => b.path.length - a.path.length);
    const root = roots[0] || { path: '', name: '' };
    const rest = loc.path.slice(root.path.length).split('/').filter(Boolean);
    const parts = root.path ? [{ name: root.name, path: root.path }] : [{ name: '/', path: '/' }];
    let acc = root.path || '';
    rest.forEach(s => { acc += '/' + s; parts.push({ name: s, path: acc }); });
    crumbs = parts.map((p, i) => `${i ? '<span class="sep">›</span>' : ''}<button class="crumb ${i === parts.length - 1 ? 'last' : ''}" type="button" data-path="${esc(p.path)}" data-drop="${esc(p.path)}">${esc(p.name)}</button>`).join('');
  } else crumbs = `<button class="crumb last" type="button">${loc.type === 'recent' ? 'Recentes (últimos 7 dias)' : loc.type === 'tag' ? 'Etiqueta: ' + esc(loc.name) : 'Pesquisa: “' + esc(loc.q) + '”'}</button>`;
  $('#pathbar').innerHTML = `<button class="icon" type="button" id="bBack" title="Para trás (⌘[)" ${back.length ? '' : 'disabled'}>‹</button><button class="icon" type="button" id="bFwd" title="Para a frente (⌘])" ${fwd.length ? '' : 'disabled'}>›</button><button class="icon" type="button" id="bUp" title="Pasta acima (⌘↑)" ${canUp ? '' : 'disabled'}>↑</button>
    <div class="crumbs">${crumbs}</div>
    <select id="sortSel" title="Ordenar">${[['name', 'Nome'], ['mtime', 'Modificado'], ['size', 'Tamanho'], ['kind', 'Tipo']].map(([k, n]) => `<option value="${k}" ${sort.key === k ? 'selected' : ''}>Ordenar: ${n}</option>`).join('')}</select>`;
  const chips = $('#chips');
  if (loc.type === 'search') {
    const scopes = [[P.home, 'Todo o Mac'], ...(loc.from ? [[loc.from, 'Nesta pasta']] : []), ...P.cloud.map(c => [c.path, c.name]), ...P.main.filter(m => m.icon === 'docs').map(m => [m.path, m.name])];
    const filters = [['', 'Tudo'], ['docs', 'Texto, PDF e folhas'], ['pdf', 'PDF'], ['image', 'Imagens'], ['media', 'Áudio e vídeo'], ['month', 'Últimos 30 dias']];
    chips.innerHTML = scopes.map(([p, n]) => `<button class="chip ${loc.scope === p ? 'on' : ''}" type="button" data-scope="${esc(p)}">${esc(n)}</button>`).join('') + '<span class="chip sep">·</span>' + filters.map(([f, n]) => `<button class="chip ${(loc.filter || '') === f ? 'on' : ''}" type="button" data-filter="${f}">${n}</button>`).join('');
    chips.hidden = false;
  } else chips.hidden = true;
}
$('#pathbar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'bBack') return goBack();
  if (b.id === 'bFwd') return goFwd();
  if (b.id === 'bUp') return goUp();
  if (b.dataset.path) go({ type: 'dir', path: b.dataset.path });
});
$('#pathbar').addEventListener('change', e => { if (e.target.id === 'sortSel') { sort = { key: e.target.value, dir: e.target.value === 'mtime' || e.target.value === 'size' ? -1 : 1, user: true }; saveSort(); applySort(); render(); } });
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !loc || loc.type !== 'search') return;
  if (b.dataset.scope != null) go(Object.assign({}, loc, { scope: b.dataset.scope }), { keepHistory: true });
  if (b.dataset.filter != null) go(Object.assign({}, loc, { filter: b.dataset.filter }), { keepHistory: true });
});
const saveSort = () => { try { localStorage.setItem('hermes.sort', JSON.stringify(sort)); } catch (e) { /* ok */ } };
function goBack() { if (!back.length) return; fwd.push(loc); go(back.pop(), { keepHistory: true }); }
function goFwd() { if (!fwd.length) return; back.push(loc); go(fwd.pop(), { keepHistory: true }); }
function goUp() { if (loc.type !== 'dir') return; const up = dirOf(loc.path); if (up !== loc.path) { const from = loc.path; go({ type: 'dir', path: up }).then(() => selectPaths([from])); } }

/* ================================================================== */
/* Mostrar: lista, ícones, espaço                                       */
/* ================================================================== */
function render() {
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', (b.id === 'vList' && mode === 'list') || (b.id === 'vGrid' && mode === 'grid') || (b.id === 'vSpace' && mode === 'space')));
  const c = $('#content');
  if (info.error) { c.innerHTML = `<div class="none err">${esc(info.error)}</div>`; renderBulk(); renderStatus(); renderPreview(); return; }
  if (!items.length) {
    c.innerHTML = `<div class="none">${loc.type === 'search' ? `Nada encontrado para “${esc(loc.q)}”.` : loc.type === 'recent' ? 'Sem ficheiros alterados nos últimos 7 dias.' : loc.type === 'tag' ? 'Nenhum ficheiro com esta etiqueta.' : 'Esta pasta está vazia.'}</div>`;
  } else if (mode === 'space' && loc.type === 'dir') renderSpace();
  else if (mode === 'grid') renderGrid();
  else renderList();
  renderBulk(); renderStatus(); renderPreview();
}
const virt = () => loc.type !== 'dir';
function sizeCell(i) {
  if (!i.dir) return bytes(i.size);
  if (sizes[i.path] != null) return bytes(sizes[i.path]);
  return counts[i.path] != null ? `<span class="sub">${counts[i.path]} ite${counts[i.path] === 1 ? 'm' : 'ns'} · a calcular…</span>` : '<span class="sub">a calcular…</span>';
}
function renderList() {
  const w = virt();
  const h = (k, n) => `<span data-sort="${k}" class="${sort.key === k ? 'on' : ''}">${n}${sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</span>`;
  $('#content').innerHTML = `<div class="row h ${w ? 'wide' : ''}">${h('name', 'Nome')}${w ? '<span>Onde</span>' : ''}${h('mtime', 'Modificado')}${h('size', 'Tamanho')}${w ? '' : h('kind', 'Tipo')}</div>` +
    items.slice(0, 3000).map((i, k) => {
      const nm = renaming === i.path ? `<input data-ren="${esc(i.path)}" value="${esc(i.name)}">` : `<span class="t">${esc(i.name)}</span>`;
      const row = `<div class="row ${w ? 'wide' : ''} ${w ? '' : sel.has(i.path) ? 'sel' : ''} ${clip && clip.cut && clip.paths.includes(i.path) ? 'cut' : ''}" data-i="${k}" ${i.dir ? `data-drop="${esc(i.path)}"` : ''} draggable="true">
        <span class="n">${icon(i)}${nm}${tagDots(i)}</span>${w ? `<span class="sub" title="${esc(dirOf(i.path))}">${esc(pretty(dirOf(i.path)))}</span>` : ''}<span>${when(i.mtime)}</span><span class="num">${sizeCell(i)}</span>${w ? '' : `<span class="sub">${esc(typeName(i))}</span>`}</div>`;
      return w ? `<div class="rowwrap ${sel.has(i.path) ? 'sel' : ''}" data-wrap="${k}">${row}${i.snip ? `<div class="snip">${hl(i.snip, loc.q)}</div>` : ''}</div>` : row;
    }).join('');
  const inp = $('[data-ren]'); if (inp) { inp.focus(); const dot = inp.value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 && !items.find(i => i.path === inp.dataset.ren).dir ? dot : inp.value.length); }
}
const hl = (t, q) => { let s = esc(t); for (const w of String(q || '').split(/\s+/).filter(x => x.length > 1)) s = s.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`); return s; };
function renderGrid() {
  $('#content').innerHTML = `<div class="grid">${items.slice(0, 2000).map((i, k) => `<div class="cell ${sel.has(i.path) ? 'sel' : ''}" data-i="${k}" ${i.dir ? `data-drop="${esc(i.path)}"` : ''} draggable="true">
    <div class="im" data-thumb="${['image', 'video', 'pdf'].includes(i.kind) || ['docx', 'doc', 'pages', 'xlsx', 'pptx', 'key', 'numbers'].includes(i.ext) ? esc(i.path) : ''}">${icon(i, true)}</div>
    <div class="nm">${renaming === i.path ? `<input data-ren="${esc(i.path)}" value="${esc(i.name)}">` : esc(i.name)}</div>${tagDots(i)}<small>${i.dir ? sizeCell(i) : bytes(i.size)}</small></div>`).join('')}</div>`;
  const inp = $('[data-ren]'); if (inp) { inp.focus(); inp.select(); }
  observeThumbs();
}
const thumbs = new Map();
let io = null;
function observeThumbs() {
  if (io) io.disconnect();
  io = new IntersectionObserver(ents => ents.forEach(async en => {
    if (!en.isIntersecting) return;
    const el = en.target, p = el.dataset.thumb; io.unobserve(el);
    let u = thumbs.get(p);
    if (u === undefined) { u = await H.thumb(p, 256); thumbs.set(p, u); }
    if (u && el.isConnected) el.innerHTML = `<img src="${esc(u)}" alt="" draggable="false">`;
  }), { root: $('#content'), rootMargin: '200px' });
  document.querySelectorAll('[data-thumb]').forEach(el => { if (el.dataset.thumb) io.observe(el); });
}
// espaço: o que ocupa mais nesta pasta
function renderSpace() {
  const list = items.map(i => ({ i, s: i.dir ? sizes[i.path] : i.size })).sort((a, b) => (b.s == null ? -1 : b.s) - (a.s == null ? -1 : a.s));
  const total = list.reduce((t, x) => t + (x.s || 0), 0);
  const pending = list.filter(x => x.s == null).length;
  const max = Math.max(1, ...list.map(x => x.s || 0));
  const disk = info.free ? `<div class="disk"><div class="bar"><i style="width:${Math.round((1 - info.free.free / info.free.total) * 100)}%"></i></div><small>Disco: ${bytes(info.free.total - info.free.free)} usados · ${bytes(info.free.free)} livres de ${bytes(info.free.total)}</small></div>` : '';
  $('#content').innerHTML = `<div class="space"><div class="head"><b>${bytes(total)}</b><span>em “${esc(base(loc.path))}”${pending ? ` · a calcular ${pending} pasta${pending > 1 ? 's' : ''}…` : ''}</span></div>${disk}
    ${list.slice(0, 400).map(({ i, s }) => `<div class="sp ${sel.has(i.path) ? 'sel' : ''}" data-i="${items.indexOf(i)}" ${i.dir ? `data-drop="${esc(i.path)}"` : ''} draggable="true"><span class="n">${icon(i)}<span class="t">${esc(i.name)}</span></span><span class="num">${s == null ? '…' : bytes(s)}</span><span class="pc">${s != null && total ? (s / total * 100 < 1 ? '<1' : Math.round(s / total * 100)) + '%' : ''}</span><span class="bar"><i style="width:${s ? Math.max(0.5, s / max * 100) : 0}%"></i></span></div>`).join('')}</div>`;
}
function requestSizes() {
  if (loc.type !== 'dir') return;
  const dirs = items.filter(i => i.dir).map(i => i.path);
  if (!dirs.length) return;
  H.counts(dirs.slice(0, 300)).then(c => { Object.assign(counts, c || {}); render(); });
  H.sizes(dirs).then(s => { Object.assign(sizes, s || {}); if (Object.keys(s || {}).length) render(); });
}
let sizeT = null;
H.onSize(({ dir, size }) => { sizes[dir] = size; clearTimeout(sizeT); sizeT = setTimeout(() => { if (sort.key === 'size') applySort(); render(); }, 150); });

/* ---------- barra de seleção e estado ---------- */
function selected() { return items.filter(i => sel.has(i.path)); }
function selBytes() { return selected().reduce((t, i) => t + (i.dir ? (sizes[i.path] || 0) : (i.size || 0)), 0); }
function renderBulk() {
  const s = selected();
  const b = $('#bulk');
  if (s.length < 2) { b.hidden = true; return; }
  const kinds = new Set(s.map(i => i.dir ? 'folder' : (i.kind === 'html' ? 'html' : i.kind)));
  const canConv = kinds.size === 1 && ['image', 'audio', 'video', 'doc', 'html'].includes([...kinds][0]);
  b.hidden = false;
  b.innerHTML = `<b>${s.length} selecionados</b><button class="btn" type="button" data-b="shareMenu">Partilhar ▾</button><button class="btn" type="button" data-b="moveTo">Mover para…</button><button class="btn" type="button" data-b="copyTo">Copiar para…</button><button class="btn" type="button" data-b="compress">Comprimir</button>${canConv ? `<button class="btn" type="button" data-b="convertMenu">Converter ▾</button>` : ''}${P.tags.length ? `<button class="btn" type="button" data-b="tagMenu">Etiqueta ▾</button>` : ''}<button class="btn" type="button" data-b="batchRename">Mudar nomes…</button><span class="spacer"></span><button class="btn" type="button" data-b="trash">Mover para o Lixo</button>`;
}
$('#bulk').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) action(b.dataset.b, selected().map(i => i.path), null, b); });
function renderStatus() {
  const s = selected();
  const parts = [];
  if (loc.type !== 'dir') parts.push(`${items.length} resultado${items.length === 1 ? '' : 's'}`);
  else parts.push(`${items.length} ite${items.length === 1 ? 'm' : 'ns'}`);
  if (s.length) parts.push(`${s.length} selecionado${s.length > 1 ? 's' : ''}${selBytes() ? ' (' + bytes(selBytes()) + ')' : ''}`);
  const free = info.free ? `Livre: ${bytes(info.free.free)} de ${bytes(info.free.total)}` : '';
  $('#status').innerHTML = `<span>${parts.join(' · ')}</span><span class="spacer"></span><span>${loc.type === 'search' ? 'Pesquisa do Spotlight · nomes e conteúdo dos documentos' : free}</span>`;
}

/* ---------- pré-visualização ---------- */
let pvGen = 0, convOpts = {};
async function renderPreview() {
  const s = selected();
  const el = $('#prev');
  if (s.length > 1) {
    el.innerHTML = `<div class="pv"><span class="big">${FOLDER.replace(/20/g, '56')}</span></div><h3>${s.length} itens selecionados</h3><div class="kv"><span>Tamanho</span><div>${bytes(selBytes()) || '—'}</div></div><div class="acts"><button class="btn small primary" type="button" data-a="shareMenu">Partilhar ▾</button><button class="btn small" type="button" data-a="quickLook">Ver</button></div><div class="hint">Arrasta-os para uma página do Zeus (Gmail, WhatsApp, Notion…) para os anexar, ou para uma pasta.</div>`;
    return;
  }
  if (!s.length) {
    const here = loc.type === 'dir' ? `<h3>${esc(base(loc.path))}</h3><div class="kv"><span>Itens</span><div>${items.length}</div>${info.free ? `<span>Livre</span><div>${bytes(info.free.free)}</div>` : ''}<span>Onde</span><div>${esc(pretty(loc.path))}</div></div><div class="acts"><button class="btn small" type="button" data-a="space">Ver o espaço ocupado</button><button class="btn small" type="button" data-a="revealHere">Mostrar no Finder</button></div>` : '';
    el.innerHTML = here + `<div class="hint">Escolhe um ficheiro para o ver aqui. Dois cliques abrem-no (áudio e vídeo no Orfeu, notas nas Notas). Arrasta ficheiros para as páginas do Zeus para os anexar.</div>`;
    return;
  }
  const i = s[0], gen = ++pvGen;
  el.innerHTML = `<div class="pv">${i.dir ? `<span class="big">${FOLDER.replace(/20/g, '64')}</span>` : `<span class="ic ${i.kind === 'doc' ? 'doc' : i.kind} bigic">${esc((i.ext || '').toUpperCase().slice(0, 4))}</span>`}</div><h3>${esc(i.name)}</h3>`;
  const d = await H.preview(i.path);
  if (gen !== pvGen || !d) return;
  if (d.error) { el.innerHTML = `<div class="none">${esc(d.error)}</div>`; return; }
  let pv = '';
  if (d.kind === 'image') pv = `<img src="${esc(d.ql || d.url)}" alt="">`;
  else if (d.kind === 'video') pv = `<video src="${esc(d.url)}" controls preload="metadata"></video>`;
  else if (d.kind === 'audio') pv = `<audio src="${esc(d.url)}" controls preload="metadata"></audio>`;
  else if (d.text != null) pv = `<pre>${esc(d.text.slice(0, 20000))}</pre>`;
  else if (d.ql) pv = `<img src="${esc(d.ql)}" alt="">`;
  else pv = i.dir ? `<span class="big">${FOLDER.replace(/20/g, '64')}</span>` : `<span class="ic ${i.kind === 'doc' ? 'doc' : i.kind} bigic">${esc((i.ext || '').toUpperCase().slice(0, 4))}</span>`;
  const kv = [['Tipo', typeName(i) + (d.pages ? ` · ${d.pages} página${d.pages > 1 ? 's' : ''}` : '') + (d.w ? ` · ${d.w}×${d.h}` : '')]];
  if (i.dir) kv.push(['Contém', (d.count != null ? d.count + ' ite' + (d.count === 1 ? 'm' : 'ns') : '—')], ['Tamanho', sizes[i.path] != null ? bytes(sizes[i.path]) : '<span id="pvSize">a calcular…</span>']);
  else kv.push(['Tamanho', bytes(d.size)]);
  if (d.duration) kv.push(['Duração', new Date(d.duration * 1000).toISOString().slice(d.duration >= 3600 ? 11 : 14, 19)]);
  kv.push(['Modificado', when(d.mtime)], ['Criado', when(d.ctime)], ['Onde', esc(pretty(d.where))]);
  if ((d.tags || []).length) kv.push(['Etiquetas', d.tags.map(t => `<i class="tg" style="display:inline-block;background:${TAGC[t] || 'var(--muted)'}"></i> ${esc(t)}`).join(' ')]);
  if (d.from) kv.push(['Veio de', `<span title="${esc(d.from)}">${esc(d.from.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</span>`]);
  const ck = i.dir ? '' : i.kind === 'doc' && ['pages', 'md'].includes(i.ext) ? '' : i.kind;
  if (ck && !convOpts[ck]) convOpts[ck] = await H.convertOptions(ck) || [];
  if (gen !== pvGen) return;
  el.innerHTML = `<div class="pv">${pv}</div><h3>${esc(i.name)}</h3><div class="kv">${kv.map(([k, v]) => `<span>${k}</span><div>${v}</div>`).join('')}</div>
    <div class="acts">${i.dir ? '<button class="btn small primary" type="button" data-a="open">Abrir</button>' : '<button class="btn small primary" type="button" data-a="quickLook" title="Ver dentro do Zeus (espaço)">Ver</button><button class="btn small" type="button" data-a="open">Abrir</button><button class="btn small" type="button" data-a="shareMenu">Partilhar ▾</button><button class="btn small" type="button" data-a="openWith">Abrir com…</button>'}<button class="btn small" type="button" data-a="reveal">Mostrar no Finder</button><button class="btn small" type="button" data-a="copyPath">Copiar caminho</button>${ck && (convOpts[ck] || []).length ? '<button class="btn small" type="button" data-a="convertMenu">Converter ▾</button>' : ''}${i.dir ? '<button class="btn small" type="button" data-a="space">Ver o espaço</button>' : ''}</div>
    <div class="hint">Arrasta ${i.dir ? 'esta pasta' : 'este ficheiro'} para o Gmail, WhatsApp ou Notion para ${i.dir ? 'a' : 'o'} anexar${['audio', 'video'].includes(i.kind) ? ' · abre no Orfeu' : ''}.</div>`;
  if (i.dir && sizes[i.path] == null) H.folderSize(i.path).then(sz => { if (sz != null) { sizes[i.path] = sz; const e2 = $('#pvSize'); if (e2) e2.textContent = bytes(sz); } });
}
$('#prev').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (b) return action(b.dataset.a, selected().map(i => i.path), null, b);
  const s = selected(); if (e.target.closest('.pv') && s.length === 1 && !s[0].dir) openQL(s[0].path);
});

/* ---------- partilhar ---------- */
let targets = null;
async function shareMenu(paths, anchorEl) {
  if (!paths.length) return;
  targets = targets || await H.shareTargets() || {};
  const r = anchorEl ? anchorEl.getBoundingClientRect() : { left: 300, bottom: 300 };
  const n = paths.length === 1 ? 'o ficheiro' : `os ${paths.length} ficheiros`;
  const entries = [];
  if (targets.sheet) entries.push(['<b>Partilhar…</b>&nbsp;<span style="color:var(--muted)">Mail, Mensagens, AirDrop, WhatsApp…</span>', () => H.share(paths, 'sheet', { x: r.left, y: r.bottom + 4 })]);
  if (targets.wa) entries.push(['WhatsApp, aqui no Zeus', () => H.share(paths, 'wa')]);
  if (targets.mail) entries.push(['Gmail, aqui no Zeus (mensagem nova)', () => H.share(paths, 'mail')]);
  entries.push([`Copiar ${n} (para colar com ⌘V)`, () => H.share(paths, 'copy')]);
  entries.push(['Copiar o caminho', () => action('copyPath', paths)]);
  popMenu(anchorEl, entries);
}

/* ---------- ver no Zeus (barra de espaço) ---------- */
let qlI = -1, qlGen = 0;
const qlList = () => items.filter(i => !i.dir);
async function openQL(p) {
  const list = qlList(); const k = list.findIndex(i => i.path === p); if (k < 0) return;
  qlI = k; $('#ql').hidden = false; renderQL();
}
function closeQL() { $('#ql').hidden = true; $('#qlBody').innerHTML = ''; qlI = -1; C.focus(); }
async function renderQL() {
  const list = qlList(); const i = list[qlI]; if (!i) return closeQL();
  const gen = ++qlGen;
  if (!sel.has(i.path)) { sel = new Set([i.path]); anchor = focusI = items.indexOf(i); render(); }
  $('#qlName').textContent = i.name;
  $('#qlMeta').textContent = [typeName(i), bytes(i.size), when(i.mtime), `${qlI + 1} de ${list.length}`].filter(Boolean).join(' · ');
  $('#qlPrev').disabled = qlI <= 0; $('#qlNext').disabled = qlI >= list.length - 1;
  const body = $('#qlBody');
  body.innerHTML = '<div class="none">A abrir…</div>';
  const d = await H.preview(i.path);
  if (gen !== qlGen || !d) return;
  const big = `<span class="ic ${i.kind === 'doc' ? 'doc' : i.kind}">${esc((i.ext || '').toUpperCase().slice(0, 4))}</span>`;
  if (d.kind === 'image') body.innerHTML = `<img src="${esc(d.ql || d.url)}" alt="">`;
  else if (d.kind === 'video') body.innerHTML = `<video src="${esc(d.url)}" controls preload="metadata"></video>`;
  else if (d.kind === 'audio') body.innerHTML = `<div class="aud">${big}<b>${esc(i.name)}</b><audio src="${esc(d.url)}" controls preload="metadata"></audio></div>`;
  else if (d.kind === 'pdf') body.innerHTML = `<iframe src="${esc(d.url)}" title="${esc(i.name)}"></iframe>`;
  else if (d.kind === 'html') body.innerHTML = `<iframe src="${esc(d.url)}" sandbox="" title="${esc(i.name)}"></iframe>`;
  else if (d.text != null) body.innerHTML = `<pre>${esc(d.text)}${d.size > 20000 ? '\n\n…' : ''}</pre>`;
  else {
    const u = await H.thumb(i.path, 1600);
    if (gen !== qlGen) return;
    body.innerHTML = u ? `<img src="${esc(u)}" alt="">` : `<div class="none">${big}Sem pré-visualização para este tipo de ficheiro.<br><button class="btn small primary" type="button" id="qlOpen2" style="margin-top:12px">Abrir na app habitual</button></div>`;
    const o2 = $('#qlOpen2'); if (o2) o2.onclick = () => H.open(i.path);
  }
}
const qlStep = d => { const n = qlList().length; const k = Math.max(0, Math.min(n - 1, qlI + d)); if (k !== qlI) { qlI = k; renderQL(); } };
$('#qlPrev').addEventListener('click', () => qlStep(-1));
$('#qlNext').addEventListener('click', () => qlStep(1));
$('#qlClose').addEventListener('click', closeQL);
$('#qlOpen').addEventListener('click', () => { const i = qlList()[qlI]; if (i) H.open(i.path); });
$('#qlReveal').addEventListener('click', () => { const i = qlList()[qlI]; if (i) H.reveal(i.path); });
$('#qlShare').addEventListener('click', e => { const i = qlList()[qlI]; if (i) shareMenu([i.path], e.currentTarget); });
document.addEventListener('keydown', e => {
  if ($('#ql').hidden) return;
  const inMedia = document.activeElement && /^(VIDEO|AUDIO|IFRAME)$/.test(document.activeElement.tagName);
  if (e.key === 'Escape' || (e.key === ' ' && !inMedia)) { e.preventDefault(); e.stopImmediatePropagation(); closeQL(); }
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && !inMedia) { e.preventDefault(); e.stopImmediatePropagation(); qlStep(-1); }
  else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && !inMedia) { e.preventDefault(); e.stopImmediatePropagation(); qlStep(1); }
  else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); $('#qlOpen').click(); }
  else e.stopImmediatePropagation();
}, true);

/* ================================================================== */
/* Seleção, rato e teclado                                              */
/* ================================================================== */
function idxOf(el) { const r = el.closest('[data-i]'); return r ? +r.dataset.i : -1; }
function selectIndex(k, e) {
  if (k < 0 || k >= items.length) return;
  const p = items[k].path;
  if (e && (e.metaKey || e.ctrlKey)) { if (sel.has(p)) sel.delete(p); else sel.add(p); anchor = k; }
  else if (e && e.shiftKey && anchor >= 0) { sel.clear(); const [a, b] = [Math.min(anchor, k), Math.max(anchor, k)]; for (let j = a; j <= b; j++) sel.add(items[j].path); }
  else { sel.clear(); sel.add(p); anchor = k; }
  focusI = k;
  render();
  const el = document.querySelector(`[data-i="${k}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
}
function selectPaths(paths) { sel = new Set(paths.filter(p => items.some(i => i.path === p))); const k = items.findIndex(i => sel.has(i.path)); anchor = focusI = k; render(); const el = document.querySelector(`[data-i="${k}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
const C = $('#content');
C.addEventListener('mousedown', e => {
  if (e.target.closest('[data-ren]')) return;
  const hd = e.target.closest('[data-sort]');
  if (hd) { const k = hd.dataset.sort; sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'mtime' || k === 'size' ? -1 : 1), user: true }; saveSort(); applySort(); render(); return; }
  const k = idxOf(e.target);
  // duplo clique contado à mão: o primeiro clique redesenha a lista e o "dblclick" do sistema perdia-se
  if (e.button === 0 && e.detail >= 2 && k >= 0 && lastDown.k === k && Date.now() - lastDown.t < 700 && !e.metaKey && !e.shiftKey) { lastDown = { k: -1, t: 0 }; openItem(items[k]); return; }
  if (e.button === 0) lastDown = { k, t: Date.now() };
  if (k < 0) { if (e.button === 0) { sel.clear(); anchor = -1; render(); } return; }
  if (e.button === 2 && sel.has(items[k].path)) return;   // clique direito numa seleção: mantém-na
  if (e.button === 0 && sel.has(items[k].path) && !e.metaKey && !e.shiftKey && sel.size > 1) return;   // pode ser o início de arrastar vários
  selectIndex(k, e);
});
C.addEventListener('click', e => { const k = idxOf(e.target); if (k >= 0 && sel.size > 1 && !e.metaKey && !e.shiftKey && sel.has(items[k].path) && !dragging) selectIndex(k); });
let lastDown = { k: -1, t: 0 };
C.addEventListener('contextmenu', e => { e.preventDefault(); const k = idxOf(e.target); H.menu(k >= 0 ? selected().map(i => i.path) : [], { x: e.clientX, y: e.clientY }); });
function openItem(i) {
  if (i.dir) { go({ type: 'dir', path: i.path }); return; }
  H.open(i.path);
}
// mudar o nome no sítio
C.addEventListener('keydown', async e => {
  const inp = e.target.closest('[data-ren]'); if (!inp) return;
  e.stopPropagation();
  if (e.key === 'Escape') { renaming = null; render(); C.focus(); }
  if (e.key === 'Enter') {
    const name = inp.value.trim(), p = inp.dataset.ren;
    renaming = null;
    if (name && name !== base(p)) { const r = await H.rename(p, name); if (r && r.error) flash(r.error); else if (r && r.path) { await load(); selectPaths([r.path]); } }
    else render();
    C.focus();
  }
}, true);
C.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('[data-ren]') && renaming) setTimeout(() => { if (renaming && !document.activeElement.closest('[data-ren]')) { const inp = e.target; const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }); inp.dispatchEvent(ev); } }, 100); });

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  const k = e.key, cmd = e.metaKey || e.ctrlKey;
  if (cmd && k.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
  if (typing) return;
  if (!$('#modal').hidden) { if (k === 'Escape') closeModal(); return; }
  const cols = mode === 'grid' ? Math.max(1, Math.floor(($('.grid') || C).clientWidth / 130)) : 1;
  if (k === 'ArrowDown' && cmd) { e.preventDefault(); const s = selected(); if (s.length === 1) openItem(s[0]); }
  else if (k === 'ArrowUp' && cmd) { e.preventDefault(); goUp(); }
  else if (k === 'ArrowDown' || (mode === 'grid' && k === 'ArrowRight')) { e.preventDefault(); selectIndex(Math.min(items.length - 1, (focusI < 0 ? -1 : focusI) + (k === 'ArrowDown' ? cols : 1)), e.shiftKey ? { shiftKey: true } : null); }
  else if (k === 'ArrowUp' || (mode === 'grid' && k === 'ArrowLeft')) { e.preventDefault(); selectIndex(Math.max(0, focusI - (k === 'ArrowUp' ? cols : 1)), e.shiftKey ? { shiftKey: true } : null); }
  else if (k === ' ') { e.preventDefault(); const s = selected(); if (s.length && !s[0].dir) openQL(s[0].path); }
  else if (k === 'Enter') { const s = selected(); if (s.length === 1 && loc.type === 'dir') { renaming = s[0].path; render(); } else if (s.length === 1) openItem(s[0]); }
  else if (cmd && (k === 'Backspace' || k === 'Delete')) { e.preventDefault(); action('trash', selected().map(i => i.path)); }
  else if (cmd && k.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(items.map(i => i.path)); render(); }
  else if (cmd && k.toLowerCase() === 'c') { e.preventDefault(); const s = selected().map(i => i.path); if (s.length) { clip = { paths: s, cut: false }; H.copyFiles(s); flash(`${s.length} copiado${s.length > 1 ? 's' : ''} — ⌘V cola, ⌥⌘V move`); } }
  else if (cmd && k.toLowerCase() === 'v') { e.preventDefault(); paste(e.altKey); }
  else if (cmd && k.toLowerCase() === 'd') { e.preventDefault(); action('duplicate', selected().map(i => i.path)); }
  else if (cmd && e.shiftKey && k.toLowerCase() === 'n') { e.preventDefault(); newFolder(); }
  else if (cmd && k === '[') { e.preventDefault(); goBack(); }
  else if (cmd && k === ']') { e.preventDefault(); goFwd(); }
  else if (k === 'Escape') { if (loc.type === 'search') goBack(); else { sel.clear(); render(); } }
  else if (!cmd && k.length === 1 && /\S/.test(k)) typeAhead(k);
});
let taBuf = '', taT = null;
function typeAhead(ch) {
  clearTimeout(taT); taBuf += fold(ch); taT = setTimeout(() => { taBuf = ''; }, 800);
  const k = items.findIndex(i => fold(i.name).startsWith(taBuf));
  if (k >= 0) selectIndex(k);
}
async function paste(move) {
  if (!clip || loc.type !== 'dir') return;
  const r = await (move ? H.move(clip.paths, loc.path) : H.copy(clip.paths, loc.path));
  if (r && r.error) flash(r.error);
  if (move) clip = null;
  await load(); if (r && r.paths) selectPaths(r.paths);
}

/* ---------- ações ---------- */
async function action(a, paths, arg, anchorEl) {
  const one = paths.length === 1 ? paths[0] : null;
  switch (a) {
    case 'open': for (const p of paths.slice(0, 20)) { const i = items.find(x => x.path === p); if (i && i.dir && paths.length === 1) return go({ type: 'dir', path: p }); H.open(p); } return;
    case 'openWith': return H.openWith(paths);
    case 'reveal': return one ? H.reveal(one) : null;
    case 'revealHere': return loc.type === 'dir' ? H.reveal(loc.path) : null;
    case 'copyPath': await H.copyPath(paths); return flash('Caminho copiado.');
    case 'rename': if (one && loc.type === 'dir') { renaming = one; render(); } return;
    case 'batchRename': return openBatchRename(paths);
    case 'duplicate': { const r = await H.duplicate(paths); await load(); if (r && r.paths) selectPaths(r.paths); return; }
    case 'moveTo': case 'copyTo': { const d = await H.chooseFolder(a === 'moveTo' ? 'Mover para' : 'Copiar para'); if (!d) return; const r = await (a === 'moveTo' ? H.move(paths, d) : H.copy(paths, d)); if (r && r.error) flash(r.error); else flash(`${(r.paths || []).length} ${a === 'moveTo' ? 'movido' : 'copiado'}${(r.paths || []).length === 1 ? '' : 's'} para ${base(d)}.`); return load(); }
    case 'compress': { busy('A comprimir…'); const r = await H.compress(paths); busy(''); if (r && r.error) flash(r.error); await load(); if (r && r.path) selectPaths([r.path]); return; }
    case 'unzip': { busy('A descomprimir…'); const r = await H.unzip(one); busy(''); if (r && r.error) flash(r.error); await load(); if (r && r.path) selectPaths([r.path]); return; }
    case 'trash': if (paths.length) { await H.trash(paths); sel.clear(); return load(); } return;
    case 'tag': await H.setTag(paths, arg, !(items.find(i => i.path === paths[0]) || {}).tags || !(items.find(i => i.path === paths[0]).tags || []).includes(arg)); return load();
    case 'pin': P = await H.pin(one); return renderSide();
    case 'unpin': P = await H.unpin(one); return renderSide();
    case 'space': if (one && (items.find(i => i.path === one) || {}).dir) { await go({ type: 'dir', path: one }); } setMode('space'); return;
    case 'convert': { const r = await H.convert(paths, arg); if (r && r.errors && r.errors.length) flash('Não foi possível converter: ' + r.errors.join(', ')); await load(); if (r && r.paths && r.paths.length) selectPaths(r.paths); return; }
    case 'convertMenu': {
      const s = items.filter(i => paths.includes(i.path)); const k = s[0] && (s[0].kind === 'html' ? 'html' : s[0].kind);
      const opts2 = convOpts[k] || (convOpts[k] = await H.convertOptions(k) || []);
      return popMenu(anchorEl, opts2.map(([f, n]) => [n, () => action('convert', paths, f)]));
    }
    case 'tagMenu': return popMenu(anchorEl, P.tags.map(t => [`<i class="tg" style="background:${t.color}"></i> ${esc(t.name)}`, () => action('tag', paths, t.name)]));
    case 'shareMenu': return shareMenu(paths, anchorEl);
    case 'copyFiles': return H.share(paths, 'copy');
    case 'quickLook': return openQL(one || paths[0]);
    case 'mkdir': return newFolder();
    case 'paste': return paste(false);
  }
}
H.onCmd(({ cmd, paths, arg }) => action(cmd, paths || selected().map(i => i.path), arg));
async function newFolder() {
  if (loc.type !== 'dir') return;
  const r = await H.mkdir(loc.path, 'Pasta nova');
  if (r && r.error) return flash(r.error);
  await load(); selectPaths([r.path]); renaming = r.path; render();
}
$('#newFolder').addEventListener('click', newFolder);
function popMenu(anchorEl, entries) {
  const pop = $('#pop');
  pop.innerHTML = entries.map(([n], k) => `<button type="button" data-k="${k}">${n}</button>`).join('');
  pop.hidden = false;
  const r = anchorEl ? anchorEl.getBoundingClientRect() : { left: 200, bottom: 200, top: 200 };
  const h = pop.offsetHeight;
  pop.style.left = Math.min(innerWidth - pop.offsetWidth - 8, r.left) + 'px';
  pop.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  pop.onclick = e => { const b = e.target.closest('[data-k]'); if (b) { pop.hidden = true; entries[+b.dataset.k][1](); } };
}
document.addEventListener('mousedown', e => { if (!$('#pop').hidden && !e.target.closest('#pop')) $('#pop').hidden = true; });

/* ---------- mudar nomes em série ---------- */
function openBatchRename(paths) {
  const m = { mode: 'replace', find: '', replace: '', base: '', start: 1 };
  const draw = async () => {
    const plan = await H.batchRename(paths, Object.assign({ preview: true }, m)) || [];
    $('#sheet').innerHTML = `<h2>Mudar o nome de ${paths.length} itens</h2>
      <div class="tabs"><button class="chip ${m.mode === 'replace' ? 'on' : ''}" type="button" data-m="replace">Substituir texto</button><button class="chip ${m.mode === 'number' ? 'on' : ''}" type="button" data-m="number">Numerar</button></div>
      ${m.mode === 'replace' ? `<div class="row2">Procurar <input type="text" id="bFind" value="${esc(m.find)}" style="flex:1"></div><div class="row2">Substituir por <input type="text" id="bRep" value="${esc(m.replace)}" style="flex:1"></div>`
        : `<div class="row2">Nome <input type="text" id="bBase" value="${esc(m.base)}" placeholder="ex.: Entrevista ministra" style="flex:1"> a começar em <input type="number" id="bStart" value="${m.start}" min="0" style="width:70px"></div>`}
      <div class="prevlist">${plan.length ? plan.slice(0, 60).map(r => `<div>${esc(r.from)} <span>→</span> <b>${esc(r.to)}</b></div>`).join('') : '<span>Os nomes novos aparecem aqui.</span>'}</div>
      <div class="foot"><button class="btn" type="button" data-m="cancel">Cancelar</button><button class="btn primary" type="button" data-m="go" ${plan.length ? '' : 'disabled'}>Mudar ${plan.length || ''} nome${plan.length === 1 ? '' : 's'}</button></div>`;
    const f = $('#bFind') || $('#bBase'); if (f && !f.dataset.done) { f.focus(); f.dataset.done = 1; f.setSelectionRange(f.value.length, f.value.length); }
  };
  let t = null;
  $('#sheet').oninput = e => { if (e.target.id === 'bFind') m.find = e.target.value; if (e.target.id === 'bRep') m.replace = e.target.value; if (e.target.id === 'bBase') m.base = e.target.value; if (e.target.id === 'bStart') m.start = +e.target.value || 1; clearTimeout(t); t = setTimeout(async () => { const plan = await H.batchRename(paths, Object.assign({ preview: true }, m)) || []; const pl = $('.prevlist'); if (pl) pl.innerHTML = plan.length ? plan.slice(0, 60).map(r => `<div>${esc(r.from)} <span>→</span> <b>${esc(r.to)}</b></div>`).join('') : '<span>Os nomes novos aparecem aqui.</span>'; const g = $('[data-m="go"]'); if (g) { g.disabled = !plan.length; g.textContent = `Mudar ${plan.length || ''} nome${plan.length === 1 ? '' : 's'}`; } }, 150); };
  $('#sheet').onclick = async e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'cancel') return closeModal();
    if (b.dataset.m === 'go') { const r = await H.batchRename(paths, m); closeModal(); flash(`${(r && r.count) || 0} nome${r && r.count === 1 ? '' : 's'} mudado${r && r.count === 1 ? '' : 's'}.`); return load(); }
    m.mode = b.dataset.m; draw();
  };
  $('#modal').hidden = false; draw();
}
function closeModal() { $('#modal').hidden = true; C.focus(); }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });

/* ---------- arrastar ---------- */
// para fora: o Zeus faz um arrastar "a sério" de ficheiros (serve para as páginas do Zeus, o Finder e outras apps)
C.addEventListener('dragstart', e => {
  const k = idxOf(e.target); if (k < 0) return;
  e.preventDefault();
  if (!sel.has(items[k].path)) selectIndex(k);
  dragging = selected().map(i => i.path);
  H.drag(dragging);
  setTimeout(() => { dragging = null; }, 60000);
});
// para dentro: ficheiros de fora (Finder) são copiados; de dentro do Hermes são movidos (⌥ copia)
const dropTarget = el => { const d = el && el.closest && el.closest('[data-drop]'); return d ? d.dataset.drop : null; };
let overEl = null;
const clearOver = () => { if (overEl) overEl.classList.remove('drop'); overEl = null; C.classList.remove('drop'); };
document.addEventListener('dragover', e => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  const t = dropTarget(e.target);
  const inContent = e.target.closest && e.target.closest('#content');
  if (!t && !(inContent && loc.type === 'dir' && info.writable)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = dragging && !e.altKey ? 'move' : 'copy';
  const el = t ? e.target.closest('[data-drop]') : C;
  if (overEl !== el) { clearOver(); overEl = el; el.classList.add('drop'); }
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget || !document.contains(e.relatedTarget)) clearOver(); });
document.addEventListener('drop', async e => {
  e.preventDefault();
  const t = dropTarget(e.target) || (e.target.closest && e.target.closest('#content') && loc.type === 'dir' ? loc.path : null);
  clearOver();
  if (!t) return;
  const paths = [...(e.dataTransfer.files || [])].map(f => H.pathFor(f)).filter(Boolean);
  if (!paths.length) return;
  const move = !!dragging && !e.altKey && paths.every(p => dragging.includes(p));
  dragging = null;
  if (paths.every(p => dirOf(p) === t) && move) return;
  const r = await (move ? H.move(paths, t) : H.copy(paths, t));
  if (r && r.error) flash(r.error); else flash(`${(r.paths || []).length} ${move ? 'movido' : 'copiado'}${(r.paths || []).length === 1 ? '' : 's'} para ${base(t)}.`);
  await load();
});

/* ---------- pesquisa ---------- */
let qT = null;
$('#q').addEventListener('input', e => {
  clearTimeout(qT);
  const v = e.target.value.trim();
  if (!v) { if (loc && loc.type === 'search') goBack(); return; }
  qT = setTimeout(() => {
    const from = loc.type === 'dir' ? loc.path : loc.from;
    const scope = loc.type === 'search' ? loc.scope : P.home;
    $('#qbox').classList.add('on');
    go({ type: 'search', q: v, scope, filter: loc.type === 'search' ? loc.filter : '', from }, { keepHistory: loc.type === 'search' });
  }, 350);
});
$('#q').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); if (loc.type === 'search') goBack(); } if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); e.target.blur(); C.focus(); if (items.length) selectIndex(0); } });
async function loadSnippets() {
  const l = loc;
  $('#qInfo').textContent = `${items.length} resultado${items.length === 1 ? '' : 's'}`;
  const wanted = items.filter(i => !i.dir && (['doc', 'html', 'code'].includes(i.kind) || ['txt', 'md', 'csv'].includes(i.ext))).slice(0, 25);
  for (const i of wanted) { const s = await H.snippet(i.path, l.q); if (loc !== l) return; if (s) { i.snip = s; render(); } }
}

/* ---------- vistas e mensagens ---------- */
function setMode(m) {
  if (m === 'space' && loc.type !== 'dir') return flash('O espaço ocupado vê-se numa pasta.');
  mode = m; try { localStorage.setItem('hermes.mode', m === 'space' ? 'list' : m); } catch (e) { /* ok */ }
  render();
}
$('#vList').addEventListener('click', () => setMode('list'));
$('#vGrid').addEventListener('click', () => setMode('grid'));
$('#vSpace').addEventListener('click', () => setMode(mode === 'space' ? 'list' : 'space'));
let flashT = null;
function flash(t) { const s = $('#status'); const keep = s.innerHTML; s.innerHTML = `<span style="color:var(--fg)">${esc(t)}</span>`; clearTimeout(flashT); flashT = setTimeout(renderStatus, 3500); }
function busy(t) { $('#busy').hidden = !t; $('#busy').textContent = t || ''; }
H.onBusy(b => busy(b && b.on ? b.label : ''));
// algo mudou nas pastas (por uma ação do Hermes): recarrega se for a pasta aberta
H.onChanged(dirs => { if (loc && loc.type === 'dir' && (dirs || []).includes(loc.path)) load(); });
document.addEventListener('visibilitychange', async () => { if (!document.hidden && loc) { P = await H.places() || P; renderSide(); if (loc.type === 'dir') load(); } });
const setTheme = t => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; };
H.onTheme(setTheme);

(async () => {
  setTheme(await H.theme());
  P = await H.places() || P;
  let start = null; try { start = JSON.parse(localStorage.getItem('hermes.loc') || 'null'); } catch (e) { /* ok */ }
  const docs = P.main.find(m => m.icon === 'docs');
  await go(start && start.path ? start : { type: 'dir', path: (P.cloud[0] || docs || { path: P.home }).path }, { keepHistory: true });
  C.focus();
})();

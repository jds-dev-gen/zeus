'use strict';
/* Notas do Zeus — pastas, favoritas, editor (sempre Arial), cópia em Word, gravação e transcrição de reuniões. */
const Z = window.notasApp;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const HL = { yellow: '#fff1a6', green: '#c6f3cc', blue: '#c9e4ff', pink: '#ffd3e4', orange: '#ffe1bd' };
const HL_NAMES = { yellow: 'Amarelo', green: 'Verde', blue: 'Azul', pink: 'Rosa', orange: 'Laranja' };
const COLORS = [['', 'Automática'], ['#c62828', 'Vermelho'], ['#e65100', 'Laranja'], ['#2e7d32', 'Verde'], ['#1a5fb4', 'Azul'], ['#6a1b9a', 'Roxo'], ['#757575', 'Cinzento']];
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40];
const BASE = 16;
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

let L = { where: {}, folders: [], notes: [] };
let view = 'all';            // all | fav | recent | f:<pasta>
let cur = null;              // nota aberta { id, title, html, fav, folder, audioUrl… }
let q = '', qIds = null;
let jobs = [];
let dirty = false, saveT = null, savedAt = 0, saving = false;
let addingFolder = false, editingFolder = null, confirmDel = null;
let lastColor = '#c62828', lastHl = 'yellow';

function when(ms) {
  const d = new Date(ms), now = new Date(), diff = (now - d) / 60000;
  if (diff < 1) return 'agora';
  if (diff < 60) return `há ${Math.floor(diff)} min`;
  if (d.toDateString() === now.toDateString()) return 'hoje, ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'ontem';
  if (now - d < 6 * 864e5) return d.toLocaleDateString('pt-PT', { weekday: 'long' });
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).replace('.', '');
}

/* ================================================================== */
/* Limpeza do HTML: só ficam as formatações que o editor sabe fazer      */
/* ================================================================== */
const KEEP = { P: 'p', DIV: 'p', H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote', BR: 'br', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', A: 'a', SPAN: 'span', FONT: 'span', MARK: 'span' };
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'META', 'LINK', 'TITLE', 'HEAD']);
const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote']);
const okColor = c => { c = String(c || '').trim(); return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(c) && !/rgba\([^)]*,\s*0\s*\)/i.test(c) ? c : ''; };
const NAMED_SIZE = { 'x-small': 12, small: 14, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 40 };
function okSize(v) {
  v = String(v || '').trim();
  if (NAMED_SIZE[v]) return NAMED_SIZE[v];
  const m = /^([\d.]+)(px|pt)$/.exec(v); if (!m) return 0;
  const px = m[2] === 'pt' ? +m[1] / 0.75 : +m[1];
  return px >= 8 && px <= 96 ? Math.round(px) : 0;
}
function cleanStyle(el, tag) {
  const st = el.style, out = [];
  if (!st) return '';
  const c = okColor(st.color || (tag === 'FONT' ? el.getAttribute('color') : ''));
  if (c) out.push('color:' + c);
  const bg = okColor(st.backgroundColor || (tag === 'MARK' ? HL.yellow : ''));
  if (bg && !/^(#fff(fff)?|rgb\(255,\s*255,\s*255\))$/i.test(bg)) out.push('background-color:' + bg);
  const sz = okSize(st.fontSize); if (sz) out.push('font-size:' + sz + 'px');
  if (/^(bold|[6-9]00)$/.test(st.fontWeight)) out.push('font-weight:bold');
  if (st.fontStyle === 'italic') out.push('font-style:italic');
  const td = st.textDecorationLine || st.textDecoration || '';
  if (/underline/.test(td)) out.push('text-decoration:underline');
  if (/line-through/.test(td)) out.push((/underline/.test(td) ? 'text-decoration:underline line-through' : 'text-decoration:line-through'));
  return out.join(';');
}
function cleanInto(src, dst, doc) {
  for (const n of [...src.childNodes]) {
    if (n.nodeType === 3) { dst.appendChild(doc.createTextNode(n.nodeValue)); continue; }
    if (n.nodeType !== 1) continue;
    const T = n.tagName;
    if (DROP.has(T)) continue;
    const tag = KEEP[T];
    if (!tag) { cleanInto(n, dst, doc); continue; }          // elemento desconhecido: fica só o conteúdo
    const el = doc.createElement(tag);
    if (tag === 'a') {
      const href = n.getAttribute('href') || '';
      if (/^(https?:|mailto:)/i.test(href)) el.setAttribute('href', href); else { cleanInto(n, dst, doc); continue; }
    }
    if (tag === 'span') {
      const cls = n.getAttribute('class') || '';
      if (/\bts\b/.test(cls) && /^\d+$/.test(n.getAttribute('data-t') || '')) { el.className = 'ts'; el.setAttribute('data-t', n.getAttribute('data-t')); el.setAttribute('contenteditable', 'false'); }
      else if (/\bsrc\b/.test(cls)) el.className = 'src';
      const st = cleanStyle(n, T);
      if (st) el.setAttribute('style', st);
      if (!el.className && !st) { cleanInto(n, dst, doc); continue; }   // <span> sem nada: desfaz-se
    }
    if (tag === 'ul' && /\btodo\b/.test(n.getAttribute('class') || '')) el.className = 'todo';
    if (tag === 'li' && n.hasAttribute('data-done')) el.setAttribute('data-done', '');
    if ((tag === 'p' || /^h/.test(tag)) && n.style && okSize(n.style.fontSize)) el.setAttribute('style', 'font-size:' + okSize(n.style.fontSize) + 'px');
    cleanInto(n, el, doc);
    // <div> com blocos lá dentro: desfaz-se em vez de criar parágrafos dentro de parágrafos
    if ((T === 'DIV' || BLOCK.has(tag) && tag !== 'li' && tag !== 'blockquote' && tag !== 'ul' && tag !== 'ol') && [...el.children].some(c => BLOCK.has(c.tagName.toLowerCase()))) { while (el.firstChild) dst.appendChild(el.firstChild); continue; }
    dst.appendChild(el);
  }
}
function sanitize(html) {
  const d = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
  const box = document.createElement('div');
  cleanInto(d.body, box, document);
  // texto solto no topo vai para dentro de parágrafos
  const out = document.createElement('div');
  let p = null;
  for (const n of [...box.childNodes]) {
    const isBlock = n.nodeType === 1 && BLOCK.has(n.tagName.toLowerCase());
    if (isBlock) { p = null; out.appendChild(n); continue; }
    if (n.nodeType === 3 && !n.nodeValue.trim() && !p) continue;
    if (!p) { p = document.createElement('p'); out.appendChild(p); }
    p.appendChild(n);
  }
  return out.innerHTML;
}

/* ================================================================== */
/* Texto → blocos para a cópia em Word                                  */
/* ================================================================== */
function runsOf(node, stopAt) {
  const out = [];
  const walk = n => {
    if (n.nodeType === 3) {
      if (!n.nodeValue) return;
      const r = { x: n.nodeValue.replace(/\s+/g, ' ') };
      for (let a = n.parentNode; a && a !== stopAt; a = a.parentNode) {
        if (a.nodeType !== 1) continue;
        const T = a.tagName;
        if (T === 'B' || T === 'STRONG') r.b = true;
        if (T === 'I' || T === 'EM') r.i = true;
        if (T === 'U') r.u = true;
        if (T === 'S') r.s = true;
        if (T === 'A' && !r.a) r.a = a.getAttribute('href');
        if (a.classList && a.classList.contains('ts')) r.mono = true;
        const st = a.style;
        if (st) {
          if (!r.c && st.color) r.c = st.color;
          if (!r.bg && st.backgroundColor) r.bg = st.backgroundColor;
          if (!r.sz && st.fontSize) r.sz = okSize(st.fontSize);
          if (/bold|[6-9]00/.test(st.fontWeight)) r.b = true;
          if (st.fontStyle === 'italic') r.i = true;
          const td = st.textDecorationLine || '';
          if (/underline/.test(td)) r.u = true;
          if (/line-through/.test(td)) r.s = true;
        }
      }
      out.push(r);
      return;
    }
    if (n.nodeType !== 1) return;
    if (n.tagName === 'BR') { out.push({ br: true }); return; }
    if (n.tagName === 'UL' || n.tagName === 'OL') return;     // listas dentro de listas tratam-se à parte
    for (const c of n.childNodes) walk(c);
  };
  for (const c of node.childNodes) walk(c);
  // tira o espaço do princípio e do fim
  while (out.length && out[0].x != null && !out[0].x.trim()) out.shift();
  if (out.length && out[0].x) out[0].x = out[0].x.replace(/^\s+/, '');
  if (out.length && out[out.length - 1].x) out[out.length - 1].x = out[out.length - 1].x.replace(/\s+$/, '');
  return out;
}
function toBlocks(root) {
  const out = []; let listId = 0;
  const list = (el, level) => {
    const kind = el.tagName === 'OL' ? 'ol' : el.classList.contains('todo') ? 'todo' : 'ul';
    const id = ++listId;
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      out.push({ t: 'li', list: kind, listId: id, level, done: li.hasAttribute('data-done'), runs: runsOf(li, li) });
      for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') list(sub, level + 1);
    }
  };
  for (const el of root.children) {
    const T = el.tagName;
    if (T === 'UL' || T === 'OL') list(el, 0);
    else if (T === 'H1' || T === 'H2' || T === 'H3') out.push({ t: T.toLowerCase(), runs: runsOf(el, el) });
    else if (T === 'BLOCKQUOTE') {
      const kids = [...el.children].filter(c => BLOCK.has(c.tagName.toLowerCase()));
      if (kids.length) kids.forEach(k => out.push({ t: 'quote', runs: runsOf(k, k) }));
      else out.push({ t: 'quote', runs: runsOf(el, el) });
    } else out.push({ t: 'p', runs: runsOf(el, el) });
  }
  return out;
}

/* ================================================================== */
/* Lista e pastas                                                       */
/* ================================================================== */
async function load(keepCur = true) {
  L = (await Z.list()) || L;
  if (cur && !L.notes.some(n => n.id === cur.id)) { cur = null; showNote(null); }
  else if (cur) { const n = L.notes.find(x => x.id === cur.id); cur.folder = n.folder; cur.fav = n.fav; renderMeta(); }
  renderSide(); renderList(); renderSync();
  if (!keepCur && !cur && filtered().length) openNote(filtered()[0].id);
}
function filtered() {
  let ns = L.notes;
  if (view === 'fav') ns = ns.filter(n => n.fav);
  else if (view === 'recent') ns = ns.filter(n => Date.now() - n.updated < 7 * 864e5);
  else if (view === 'root') ns = ns.filter(n => !n.folder);
  else if (view.startsWith('f:')) ns = ns.filter(n => n.folder === view.slice(2));
  if (q) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    ns = ns.filter(n => (qIds && qIds.has(n.id)) || words.every(w => fold(n.title + ' ' + n.excerpt).includes(w)));
  }
  return ns;
}
const FOLDER_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
function renderSide() {
  const n = L.notes, recent = n.filter(x => Date.now() - x.updated < 7 * 864e5).length, rootN = n.filter(x => !x.folder).length;
  const item = (id, icon, name, count, own) => {
    if (own && editingFolder === name) return `<div class="newf"><input id="renF" value="${esc(name)}" maxlength="80" data-old="${esc(name)}"></div>`;
    const del = confirmDel === 'folder:' + name;
    return `<div class="f ${view === id ? 'on' : ''}" role="button" tabindex="0" data-view="${esc(id)}" ${own ? `data-drop="${esc(name)}"` : id === 'root' ? 'data-drop=""' : ''}>${icon}<span class="n">${esc(name)}</span>
      ${own ? `<span class="ops"><button class="ico" type="button" data-ren="${esc(name)}" title="Mudar o nome">✎</button><button class="ico ${del ? 'warn' : ''}" type="button" data-delf="${esc(name)}" title="${del ? 'Carrega outra vez para apagar a pasta (as notas passam para Sem pasta)' : 'Apagar a pasta'}">✕</button></span>` : ''}
      <span class="c">${count || ''}</span></div>`;
  };
  $('#side').innerHTML =
    item('all', '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>', 'Todas', n.length) +
    item('fav', '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6 .6-4.5 4 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.5-4 6-.6z"/></svg>', 'Favoritas', n.filter(x => x.fav).length) +
    item('recent', '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', 'Recentes', recent) +
    `<div class="lbl">Pastas</div>` +
    L.folders.map(f => item('f:' + f.name, FOLDER_SVG, f.name, f.count, true)).join('') +
    (rootN && L.folders.length ? item('root', FOLDER_SVG.replace('stroke-linejoin', 'stroke-dasharray="2 2" stroke-linejoin'), 'Sem pasta', rootN) : '') +
    (addingFolder ? `<div class="newf"><input id="newF" placeholder="Nome da pasta" maxlength="80"></div>` : `<button class="addf" type="button" id="addF">+ Nova pasta</button>`) +
    `<div class="foot"><div><b>Pasta das notas</b>${esc(L.where.nice || '')}${L.where.wordCopy ? '<br>Com cópia em Word de cada nota' : ''}</div><button class="ico" type="button" id="settings" title="Definições das Notas">⚙</button></div>`;
  const nf = $('#newF'); if (nf) nf.focus();
  const rf = $('#renF'); if (rf) { rf.focus(); rf.select(); }
}
$('#side').addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('#settings')) return openSettings();
  if (t.closest('#addF')) { addingFolder = true; return renderSide(); }
  const ren = t.closest('[data-ren]'); if (ren) { e.stopPropagation(); editingFolder = ren.dataset.ren; return renderSide(); }
  const del = t.closest('[data-delf]');
  if (del) {
    e.stopPropagation();
    const k = 'folder:' + del.dataset.delf;
    if (confirmDel !== k) { confirmDel = k; renderSide(); setTimeout(() => { if (confirmDel === k) { confirmDel = null; renderSide(); } }, 4000); return; }
    confirmDel = null; await flush();
    await Z.removeFolder(del.dataset.delf); if (view === 'f:' + del.dataset.delf) view = 'all';
    return load();
  }
  const v = t.closest('[data-view]'); if (v) { view = v.dataset.view; renderSide(); renderList(); }
});
$('#side').addEventListener('keydown', async e => {
  if (e.target.id === 'newF') {
    if (e.key === 'Enter') { const name = e.target.value.trim(); addingFolder = false; if (name) { const f = await Z.addFolder(name); if (f) view = 'f:' + f; } load(); }
    if (e.key === 'Escape') { addingFolder = false; renderSide(); }
  }
  if (e.target.id === 'renF') {
    if (e.key === 'Enter') { const old = e.target.dataset.old, name = e.target.value.trim(); editingFolder = null; await flush(); const f = name && name !== old ? await Z.renameFolder(old, name) : null; if (f && view === 'f:' + old) view = 'f:' + f; load(); }
    if (e.key === 'Escape') { editingFolder = null; renderSide(); }
  }
});
$('#side').addEventListener('focusout', e => {
  if (e.target.id === 'newF' && addingFolder) { setTimeout(() => { if (addingFolder && document.activeElement && document.activeElement.id !== 'newF') { addingFolder = false; renderSide(); } }, 150); }
  if (e.target.id === 'renF' && editingFolder) { setTimeout(() => { if (editingFolder && (!document.activeElement || document.activeElement.id !== 'renF')) { editingFolder = null; renderSide(); } }, 150); }
});
// arrastar uma nota para uma pasta
$('#side').addEventListener('dragover', e => { const d = e.target.closest('[data-drop]'); if (d && e.dataTransfer.types.includes('text/zeus-nota')) { e.preventDefault(); d.classList.add('drop'); } });
$('#side').addEventListener('dragleave', e => { const d = e.target.closest('[data-drop]'); if (d) d.classList.remove('drop'); });
$('#side').addEventListener('drop', async e => {
  const d = e.target.closest('[data-drop]'); if (!d) return;
  e.preventDefault(); d.classList.remove('drop');
  const id = e.dataTransfer.getData('text/zeus-nota'); if (!id) return;
  await moveNote(id, d.dataset.drop);
});

function renderList() {
  const ns = filtered();
  const busy = new Map(jobs.map(j => [j.id, j]));
  if (!ns.length) {
    $('#list').innerHTML = `<div class="none">${q ? `Nada encontrado para “${esc(q)}”.` : L.notes.length ? 'Não há notas aqui.' : 'Ainda não há notas.<br>Carrega em <b>+ Nova nota</b> ou em <b>Gravar reunião</b>.'}</div>`;
    return;
  }
  $('#list').innerHTML = ns.map(n => {
    const j = busy.get(n.id);
    const jb = j ? `<span class="busy">${j.stage === 'erro' ? 'erro na transcrição' : j.stage === 'resumir' ? 'a resumir' : j.stage === 'espera-modelo' ? 'à espera do modelo' : j.stage === 'pronto' ? 'transcrição pronta' : 'a transcrever'}</span>` : '';
    return `<button class="n ${cur && cur.id === n.id ? 'on' : ''}" type="button" data-id="${esc(n.id)}" draggable="true">
      <h3>${n.fav ? '★ ' : ''}${esc(n.title)}</h3>
      ${n.excerpt ? `<p>${esc(n.excerpt)}</p>` : ''}
      <small>${when(n.updated)}${n.folder && !view.startsWith('f:') ? ` · <span class="tag">${esc(n.folder)}</span>` : ''}${n.audio ? ' · 🎙' : ''}${jb}</small></button>`;
  }).join('');
}
$('#list').addEventListener('click', e => { const c = e.target.closest('[data-id]'); if (c && (!cur || c.dataset.id !== cur.id)) openNote(c.dataset.id); });
$('#list').addEventListener('dragstart', e => { const c = e.target.closest('[data-id]'); if (c) { e.dataTransfer.setData('text/zeus-nota', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; } });
$('#list').addEventListener('contextmenu', e => { const c = e.target.closest('[data-id]'); if (c) { e.preventDefault(); Z.noteMenu(c.dataset.id, { x: e.clientX, y: e.clientY }); } });

function renderSync() {
  const w = L.where || {};
  $('#sync').innerHTML = w.drive ? `<i></i>${esc(w.drive)}` : `<i style="background:var(--muted)"></i>No Mac`;
  $('#sync').title = w.root || '';
}

/* ================================================================== */
/* Abrir, editar e gravar uma nota                                      */
/* ================================================================== */
const doc = $('#doc'), titleEl = $('#title');
async function openNote(id) {
  await flush();
  const n = await Z.read(id);
  if (!n) { cur = null; showNote(null); return; }
  cur = n;
  showNote(n);
  renderList();
  applyResults();
}
function showNote(n) {
  const has = !!n;
  $('#ed').classList.toggle('off', !has);
  $('#empty').hidden = has;
  $('#empty').innerHTML = has ? '' : `<div><b>${L.notes.length ? 'Escolhe uma nota' : 'As tuas notas ficam aqui'}</b>${L.notes.length ? 'ou começa uma nova.' : 'Cada nota é um ficheiro na pasta do ' + esc(L.where.drive || 'Mac') + '.'}
    <div class="emptybtns"><button class="btn primary" type="button" data-empty="new">+ Nova nota</button><button class="btn" type="button" data-empty="rec"><span class="rd"></span>Gravar reunião</button></div></div>`;
  if (!has) { doc.innerHTML = ''; titleEl.value = ''; $('#player').hidden = true; renderJob(); return; }
  titleEl.value = n.title; requestAnimationFrame(fitTitle);
  doc.innerHTML = sanitize(n.html) || '<p><br></p>';
  doc.scrollTop = 0; $('#page').scrollTop = 0;
  const a = $('#audio');
  if (n.audioUrl) { if (a.getAttribute('src') !== n.audioUrl) a.src = n.audioUrl; $('#player').hidden = false; } else { a.removeAttribute('src'); $('#player').hidden = true; }
  dirty = false;
  renderMeta(); renderStatus(); renderJob();
}
function renderMeta() {
  if (!cur) return;
  const parts = [`<button class="star ${cur.fav ? 'on' : ''}" type="button" id="star" title="${cur.fav ? 'Tirar das favoritas' : 'Marcar como favorita'}">${cur.fav ? '★' : '☆'}</button>`];
  parts.push(esc(cur.folder || 'Sem pasta'));
  parts.push(`editada ${when(cur.updated || Date.now())}`);
  $('#meta').innerHTML = parts.join(' · ').replace(' · ', ' ');
}
$('#meta').addEventListener('click', e => { if (e.target.closest('#star') && cur) setFav(cur.id, !cur.fav); });
function wordCount() { return (doc.innerText.match(/\S+/g) || []).length; }
function renderStatus() {
  if (!cur) return;
  const w = wordCount();
  $('#words').textContent = `${w} palavra${w === 1 ? '' : 's'}${w > 200 ? ' · ' + Math.max(1, Math.round(w / 220)) + ' min de leitura' : ''}`;
  const where = L.where.drive ? `no ${L.where.drive}` : 'no Mac';
  $('#saved').innerHTML = saving ? 'A guardar…' : dirty ? 'Por guardar…' : `<span class="ok">✓ Guardado ${esc(where)}${L.where.wordCopy ? ', com cópia em Word' : ''}</span>`;
}
function touch() { if (!cur) return; dirty = true; renderStatus(); clearTimeout(saveT); saveT = setTimeout(save, 900); }
async function save() {
  clearTimeout(saveT);
  if (!cur || !dirty) return;
  const id = cur.id;
  const html = sanitize(doc.innerHTML);
  const title = titleEl.value.trim() || 'Nota sem título';
  const blocks = toBlocks(doc);
  dirty = false; saving = true; renderStatus();
  const r = await Z.save(id, { title, html }, blocks);
  saving = false;
  if (r && cur && cur.id === id) { cur.title = r.title; cur.updated = r.updated; cur.folder = r.folder; }
  renderStatus();
  load();
}
async function flush() { if (dirty) await save(); }
doc.addEventListener('input', () => { fixNesting(); touch(); syncTools(); });
const fitTitle = () => { titleEl.style.height = 'auto'; titleEl.style.height = titleEl.scrollHeight + 'px'; };
titleEl.addEventListener('input', () => { titleEl.value = titleEl.value.replace(/\n/g, ' '); fitTitle(); touch(); });
window.addEventListener('resize', fitTitle);
titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); placeCaretStart(); } });
function placeCaretStart() { doc.focus(); const r = document.createRange(); r.setStart(doc.firstChild || doc, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
window.addEventListener('beforeunload', () => { if (dirty) save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else load(); });

async function newNote(title, html) {
  await flush();
  const folder = view.startsWith('f:') ? view.slice(2) : '';
  const id = await Z.create(folder, title || '', html || '');
  if (view === 'fav' || view === 'recent') view = 'all';
  await load();
  await openNote(id);
  if (!title) { titleEl.select(); titleEl.focus(); }
  return id;
}
$('#newNote').addEventListener('click', () => newNote());
$('#empty').addEventListener('click', e => { const b = e.target.closest('[data-empty]'); if (!b) return; if (b.dataset.empty === 'new') newNote(); else $('#recMeeting').click(); });
async function setFav(id, on) {
  if (cur && cur.id === id) { await flush(); cur.fav = on; renderMeta(); }
  await Z.save(id, { fav: on });
  load();
}
async function moveNote(id, folder) {
  if (cur && cur.id === id) await flush();
  await Z.save(id, { folder });
  load();
}

/* ================================================================== */
/* Barra de formatação                                                  */
/* ================================================================== */
let savedRange = null;
const inDoc = r => r && doc.contains(r.commonAncestorContainer);
function keepRange() { const s = getSelection(); if (s.rangeCount && inDoc(s.getRangeAt(0))) savedRange = s.getRangeAt(0).cloneRange(); }
function restoreRange() { doc.focus(); if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); } }
document.addEventListener('selectionchange', () => { keepRange(); syncTools(); });
const exec = (cmd, val = null) => document.execCommand(cmd, false, val);
const css = on => exec('styleWithCSS', on);
exec('defaultParagraphSeparator', 'p');
// listas feitas à mão (o execCommand do Chrome junta listas vizinhas e mete listas dentro de parágrafos)
function caretIn(el, end) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(!end ? true : false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function blockToList(blk, kind) {
  const list = document.createElement(kind === 'ol' ? 'ol' : 'ul');
  if (kind === 'todo') list.className = 'todo';
  const li = document.createElement('li');
  while (blk.firstChild) li.appendChild(blk.firstChild);
  if (!li.textContent && !li.querySelector('br')) li.innerHTML = '<br>';
  list.appendChild(li); blk.replaceWith(list);
  const prev = list.previousElementSibling;
  if (prev && prev.tagName === list.tagName && prev.className === list.className) { prev.appendChild(li); list.remove(); }
  caretIn(li, true);
  return li;
}
function listToParas(list) {
  const frag = document.createDocumentFragment(); let first = null;
  for (const li of [...list.children]) { const p = document.createElement('p'); [...li.childNodes].forEach(c => { if (!/^(UL|OL)$/.test(c.nodeName)) p.appendChild(c); }); if (!p.firstChild) p.innerHTML = '<br>'; frag.appendChild(p); first = first || p; }
  list.replaceWith(frag);
  if (first) caretIn(first, true);
}
// parágrafos com blocos lá dentro (acontece com algumas operações do Chrome): desfazem-se
function fixNesting() {
  doc.querySelectorAll('p, h1, h2, h3').forEach(p => {
    if (![...p.children].some(c => /^(P|H1|H2|H3|UL|OL|BLOCKQUOTE)$/.test(c.tagName))) return;
    const frag = document.createDocumentFragment(); let run = null;
    for (const c of [...p.childNodes]) {
      if (c.nodeType === 1 && /^(P|H1|H2|H3|UL|OL|BLOCKQUOTE)$/.test(c.tagName)) { run = null; frag.appendChild(c); }
      else { if (c.nodeType === 3 && !c.nodeValue.trim() && !run) continue; if (!run) { run = document.createElement(p.tagName.toLowerCase()); frag.appendChild(run); } run.appendChild(c); }
    }
    p.replaceWith(frag);
  });
}
function blockOf(n) { for (let a = n && (n.nodeType === 1 ? n : n.parentNode); a && a !== doc; a = a.parentNode) if (/^(P|H1|H2|H3|LI|BLOCKQUOTE)$/.test(a.tagName)) return a; return null; }
function closestIn(n, sel) { const e = n && (n.nodeType === 1 ? n : n.parentElement); const r = e && e.closest(sel); return r && doc.contains(r) ? r : null; }
function curSize() {
  const s = getSelection(); if (!s.rangeCount) return BASE;
  const n = s.anchorNode; const e = n && (n.nodeType === 1 ? n : n.parentElement);
  if (!e || !doc.contains(e)) return BASE;
  return Math.round(parseFloat(getComputedStyle(e).fontSize)) || BASE;
}
function syncTools() {
  const s = getSelection();
  if (!s.rangeCount || !inDoc(s.getRangeAt(0))) return;
  $('#tSizeV').textContent = curSize();
  const st = c => { try { return document.queryCommandState(c); } catch (e) { return false; } };
  document.querySelectorAll('#tools [data-cmd]').forEach(b => {
    const c = b.dataset.cmd;
    let on = false;
    if (['bold', 'italic', 'underline', 'strikeThrough'].includes(c)) on = st(c);
    else if (c === 'h1' || c === 'h2') on = !!closestIn(s.anchorNode, c);
    else if (c === 'ul') on = !!closestIn(s.anchorNode, 'ul:not(.todo)');
    else if (c === 'ol') on = !!closestIn(s.anchorNode, 'ol');
    else if (c === 'todo') on = !!closestIn(s.anchorNode, 'ul.todo');
    else if (c === 'quote') on = !!closestIn(s.anchorNode, 'blockquote');
    b.classList.toggle('on', on);
  });
}
// os botões não roubam a seleção do texto
$('#tools').addEventListener('mousedown', e => { if (e.target.closest('button') && !e.target.closest('.mode')) e.preventDefault(); });
$('#tools').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !cur) return;
  if (b.id === 'tSize') return sizePop(b);
  if (b.id === 'tColor') return colorPop(b);
  if (b.id === 'tHl') return hlPop(b);
  if (b.id === 'tLink') return linkPop(b);
  if (b.id === 'tZoom') return zoomPop(b);
  if (b.id === 'tMic') return rec ? null : startRec(cur.id);
  if (b.id === 'tMore') { const r = b.getBoundingClientRect(); return Z.noteMenu(cur.id, { x: r.left, y: r.bottom + 4 }); }
  if (b.id === 'mFocus') return setFocusMode(!document.body.classList.contains('focus'));
  const c = b.dataset.cmd; if (!c) return;
  restoreRange();
  if (['bold', 'italic', 'underline', 'strikeThrough'].includes(c)) { css(false); exec(c); }
  else if (c === 'h1' || c === 'h2') { const blk = closestIn(getSelection().anchorNode, c); exec('formatBlock', blk ? 'p' : c); }
  else if (c === 'quote') { const blk = closestIn(getSelection().anchorNode, 'blockquote'); exec('formatBlock', blk ? 'p' : 'blockquote'); }
  else if (c === 'ul' || c === 'ol' || c === 'todo') {
    const a = getSelection().anchorNode, s0 = getSelection();
    const list = closestIn(a, 'ul, ol');
    const kindOf = l => l.tagName === 'OL' ? 'ol' : l.classList.contains('todo') ? 'todo' : 'ul';
    if (list && kindOf(list) === c) listToParas(list);                         // carregar outra vez tira a lista
    else if (list && c !== 'ol' && list.tagName === 'UL') list.classList.toggle('todo', c === 'todo');
    else if (list) { const nl = document.createElement(c === 'ol' ? 'ol' : 'ul'); if (c === 'todo') nl.className = 'todo'; while (list.firstChild) nl.appendChild(list.firstChild); list.replaceWith(nl); caretIn(nl.lastElementChild || nl, true); }
    else {
      const blk = blockOf(a);
      const single = s0.isCollapsed || (blockOf(s0.focusNode) === blk);
      if (blk && single && blk.tagName === 'P') blockToList(blk, c);
      else { exec(c === 'ol' ? 'insertOrderedList' : 'insertUnorderedList'); fixNesting(); if (c === 'todo') { const ul = closestIn(getSelection().anchorNode, 'ul'); if (ul) ul.classList.add('todo'); } }
    }
  }
  else if (c === 'clear') { exec('removeFormat'); exec('unlink'); }
  else if (c === 'bigger' || c === 'smaller') {
    const now = curSize();
    const next = c === 'bigger' ? SIZES.find(v => v > now) || 48 : [...SIZES].reverse().find(v => v < now) || 10;
    applySize(next);
  }
  fixNesting(); touch(); syncTools(); keepRange();
});
function applySize(px) {
  restoreRange();
  const s = getSelection(); if (!s.rangeCount || s.isCollapsed) return;
  css(false); exec('fontSize', '7');
  doc.querySelectorAll('font[size="7"]').forEach(f => {
    const sp = document.createElement('span');
    sp.style.fontSize = px + 'px';
    while (f.firstChild) sp.appendChild(f.firstChild);
    sp.querySelectorAll('[style*="font-size"]').forEach(x => { x.style.fontSize = ''; if (!x.getAttribute('style')) x.removeAttribute('style'); });
    f.replaceWith(sp);
    const r = document.createRange(); r.selectNodeContents(sp); s.removeAllRanges(); s.addRange(r);
  });
  touch(); keepRange(); syncTools();
}
// cor "automática" e "sem destaque": aplica-se uma cor marcadora e depois tira-se o estilo
function stripMarked(prop, marker) {
  doc.querySelectorAll('span[style], font[color]').forEach(el => {
    const v = el.tagName === 'FONT' ? el.getAttribute('color') : el.style[prop];
    if (!v || !sameColor(v, marker)) return;
    if (el.tagName === 'FONT') el.removeAttribute('color'); else el.style[prop] = '';
    const empty = el.tagName === 'FONT' ? !el.attributes.length : (!el.getAttribute('style') && !el.className);
    if (empty) el.replaceWith(...el.childNodes);
  });
}
const sameColor = (a, b) => { const t = document.createElement('i'); t.style.color = a; const x = t.style.color; t.style.color = b; return x === t.style.color; };
function applyColor(c) {
  restoreRange(); css(true);
  if (c) { exec('foreColor', c); lastColor = c; $('#tColorBar').style.background = c; }
  else { exec('foreColor', '#010203'); stripMarked('color', '#010203'); }
  css(false); touch();
}
function applyHl(k) {
  restoreRange(); css(true);
  if (k) { exec('hiliteColor', HL[k]); lastHl = k; $('#tHlBar').style.background = HL[k]; }
  else { exec('hiliteColor', '#010203'); stripMarked('backgroundColor', '#010203'); }
  css(false); touch();
}

/* janelas pequenas */
const pop = $('#pop');
let popFor = null;
function openPop(anchor, html, cls = '') {
  pop.className = 'pop ' + cls; pop.innerHTML = html; pop.hidden = false; popFor = anchor;
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left - 6)) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
}
function closePop() { pop.hidden = true; popFor = null; }
document.addEventListener('mousedown', e => { if (!pop.hidden && !pop.contains(e.target) && !(popFor && popFor.contains(e.target))) closePop(); });
pop.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
function sizePop(b) {
  if (popFor === b) return closePop();
  const now = curSize();
  openPop(b, `<div class="sizes">${SIZES.map(s => `<button type="button" data-size="${s}" class="${s === now ? 'on' : ''}" style="font-size:${Math.min(s, 22)}px;font-family:Arial">${s} px${s === BASE ? ' <span style="color:var(--muted);font-size:11px">normal</span>' : ''}</button>`).join('')}</div>`);
}
function colorPop(b) {
  if (popFor === b) return closePop();
  openPop(b, `<div class="sws">${COLORS.map(([c, n]) => `<button type="button" class="swc ${c ? '' : 'auto'}" data-color="${c}" title="${n}" style="${c ? 'background:' + c : ''}"></button>`).join('')}</div>`);
}
function hlPop(b) {
  if (popFor === b) return closePop();
  openPop(b, `<div class="sws">${Object.keys(HL).map(k => `<button type="button" class="swc" data-hl="${k}" title="${HL_NAMES[k]}" style="background:${HL[k]}"></button>`).join('')}<button type="button" class="lnk" data-hl="">Tirar</button></div>`);
}
function linkPop(b) {
  if (popFor === b) return closePop();
  const a = savedRange && closestIn(savedRange.startContainer, 'a');
  openPop(b, `<form id="linkF"><input type="url" id="linkU" placeholder="https://…" value="${esc(a ? a.getAttribute('href') : '')}" style="width:300px"><button class="btn small primary" type="submit">${a ? 'Mudar' : 'Pôr ligação'}</button>${a ? '<button class="btn small" type="button" id="unlink">Tirar</button>' : ''}</form>`);
  setTimeout(() => $('#linkU').focus(), 0);
}
pop.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.size) { applySize(+b.dataset.size); closePop(); }
  else if ('color' in b.dataset) { applyColor(b.dataset.color); closePop(); }
  else if ('hl' in b.dataset) { applyHl(b.dataset.hl); closePop(); }
  else if (b.id === 'unlink') { restoreRange(); const a = closestIn(getSelection().anchorNode, 'a'); if (a) { const r = document.createRange(); r.selectNodeContents(a); getSelection().removeAllRanges(); getSelection().addRange(r); } exec('unlink'); touch(); closePop(); }
  else if (b.dataset.zi) { insertZoom(+b.dataset.zi); closePop(); }
});
pop.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'linkF') {
    let u = $('#linkU').value.trim();
    if (u && !/^(https?:|mailto:)/i.test(u)) u = 'https://' + u;
    restoreRange();
    const s = getSelection();
    if (u) {
      if (s.isCollapsed) exec('insertHTML', `<a href="${esc(u)}">${esc(u)}</a>`);
      else exec('createLink', u);
    }
    touch(); closePop();
  }
});
pop.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); restoreRange(); } });

/* destaques do Zoom */
let ZH = [];
async function zoomPop(b) {
  if (popFor === b) return closePop();
  ZH = await Z.zoomHighlights() || [];
  openPop(b, `<input type="search" id="zq" placeholder="Procurar nos destaques do Zoom…"><div class="hls" id="zl"></div>`, 'zoomhl');
  renderZoomList('');
  $('#zq').focus();
  $('#zq').addEventListener('input', e => renderZoomList(e.target.value));
}
function renderZoomList(qq) {
  const w = fold(qq).split(/\s+/).filter(Boolean);
  const list = ZH.map((h, i) => [h, i]).filter(([h]) => w.every(x => fold(h.text + ' ' + h.title + ' ' + h.comment).includes(x))).slice(0, 60);
  $('#zl').innerHTML = list.length ? list.map(([h, i]) => `<button class="hl" type="button" data-zi="${i + 1}"><q style="background:${HL[h.color] || HL.yellow}">${esc(h.text)}</q><small>${esc(h.site || '')} · ${esc(h.title)}</small></button>`).join('')
    : `<div class="hint">${ZH.length ? 'Nenhum destaque com estas palavras.' : 'Ainda não há destaques no Zoom. Seleciona texto numa página e escolhe uma cor para criar um.'}</div>`;
}
function insertZoom(i) {
  const h = ZH[i - 1]; if (!h) return;
  restoreRange();
  const html = `<blockquote><p><span style="background-color:${HL[h.color] || HL.yellow}">${esc(h.text)}</span></p>${h.comment ? `<p>${esc(h.comment)}</p>` : ''}<p><span class="src">Destaque do Zoom · <a href="${esc(h.url)}">${esc(h.title || h.site)}</a>${h.site ? ' · ' + esc(h.site) : ''}</span></p></blockquote><p><br></p>`;
  insertBlocks(html);
}
// insere blocos inteiros a seguir ao parágrafo onde está o cursor (o insertHTML do Chrome colava-os dentro dele)
function insertBlocks(html) {
  restoreRange();
  const s = getSelection();
  let blk = s.rangeCount ? blockOf(s.anchorNode) : null;
  if (blk && blk.tagName === 'LI') blk = blk.closest('ul, ol');
  while (blk && blk.parentNode !== doc) blk = blk.parentNode;
  const box = document.createElement('div'); box.innerHTML = sanitize(html);
  const nodes = [...box.childNodes];
  if (blk && blk.tagName === 'P' && !blk.textContent.trim()) blk.replaceWith(...nodes);
  else if (blk) blk.after(...nodes);
  else doc.append(...nodes);
  const last = nodes[nodes.length - 1];
  if (last) caretIn(last, true);
  touch();
}

/* colar: só formatações conhecidas */
doc.addEventListener('paste', e => {
  const cd = e.clipboardData; if (!cd) return;
  e.preventDefault();
  const html = cd.getData('text/html');
  if (html) exec('insertHTML', sanitize(html));
  else exec('insertText', cd.getData('text/plain'));
  touch();
});
doc.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault(); });

/* atalhos ao escrever: "# ", "## ", "- ", "1. ", "[] ", "> " no início de uma linha */
doc.addEventListener('keydown', e => {
  if (e.key === ' ' && !e.metaKey && !e.ctrlKey) {
    const s = getSelection(); if (!s.isCollapsed) return;
    const blk = blockOf(s.anchorNode); if (!blk || blk.tagName !== 'P') return;
    const r = document.createRange(); r.setStart(blk, 0); r.setEnd(s.anchorNode, s.anchorOffset);
    const before = r.toString();
    const map = { '#': 'h1', '##': 'h2', '-': 'ul', '*': 'ul', '1.': 'ol', '[]': 'todo', '>': 'quote' };
    const c = map[before]; if (!c) return;
    e.preventDefault();
    r.deleteContents();
    if (!blk.textContent) blk.innerHTML = '<br>';
    const rr = document.createRange(); rr.setStart(blk, 0); rr.collapse(true); s.removeAllRanges(); s.addRange(rr);
    if (c === 'h1' || c === 'h2') exec('formatBlock', c);
    else if (c === 'quote') exec('formatBlock', 'blockquote');
    else blockToList(blk, c);
    touch(); syncTools();
  }
  // Enter numa tarefa feita: a nova tarefa começa por fazer
  if (e.key === 'Enter') setTimeout(() => { const li = closestIn(getSelection().anchorNode, 'ul.todo > li'); if (li && li.hasAttribute('data-done') && !li.textContent.trim()) li.removeAttribute('data-done'); }, 0);
  if (e.metaKey && e.key.toLowerCase() === 'k') { e.preventDefault(); keepRange(); linkPop($('#tLink')); }
});
/* cliques no texto: caixas das tarefas, marcas de tempo, ligações com ⌘ */
doc.addEventListener('mousedown', e => {
  const li = e.target.closest('ul.todo > li');
  if (li && e.target === li && e.clientX - li.getBoundingClientRect().left < 22) {
    e.preventDefault();
    li.toggleAttribute('data-done'); touch();
    return;
  }
  const ts = e.target.closest('.ts');
  if (ts) { e.preventDefault(); const a = $('#audio'); if (a.src) { a.currentTime = +ts.dataset.t || 0; a.play().catch(() => {}); } return; }
  const a = e.target.closest('a');
  if (a && (e.metaKey || e.ctrlKey)) { e.preventDefault(); Z.openLink(a.getAttribute('href')); }
});
doc.addEventListener('mouseover', e => { const a = e.target.closest('a'); if (a && !a.title) a.title = a.getAttribute('href') + '\n⌘ + clique para abrir'; });

function setFocusMode(on) {
  document.body.classList.toggle('focus', on);
  $('#mFocus').classList.toggle('on', on);
  try { localStorage.setItem('notas.focus', on ? '1' : ''); } catch (e) { /* ok */ }
}

/* ================================================================== */
/* Menu da nota (vem do processo principal)                             */
/* ================================================================== */
Z.onCmd(async ({ cmd, id, arg }) => {
  if (cmd === 'open') { await load(); view = 'all'; renderSide(); return openNote(id); }
  if (cmd === 'fav') return setFav(id, !!arg);
  if (cmd === 'move') return moveNote(id, arg || '');
  if (cmd === 'removed') { if (cur && cur.id === id) { cur = null; dirty = false; showNote(null); } return load(); }
  if (cmd === 'exportWord') { await flushIf(id); return Z.exportWord(id, await blocksFor(id)); }
  if (cmd === 'exportPdf') { await flushIf(id); return Z.exportPdf(id); }
  if (cmd === 'summarize') return summarizeNote(id);
});
async function flushIf(id) { if (cur && cur.id === id) await flush(); }
async function blocksFor(id) {
  if (cur && cur.id === id) return toBlocks(doc);
  const n = await Z.read(id); const box = document.createElement('div'); box.innerHTML = sanitize(n ? n.html : ''); return toBlocks(box);
}
async function summarizeNote(id) {
  if (!(await Z.hasKey())) return openSettings('Para fazer resumos, guarda primeiro a chave da API da Anthropic.');
  if (cur && cur.id === id) await flush();
  const n = await Z.read(id); if (!n) return;
  const box = document.createElement('div'); box.innerHTML = sanitize(n.html);
  box.querySelectorAll('.ts').forEach(t => { t.textContent = '[' + t.textContent + '] '; });
  const text = box.innerText.trim();
  if (text.length < 40) return flash('A nota tem pouco texto para resumir.');
  showJobBar({ txt: 'A fazer o resumo com o Claude…', ind: true });
  const r = await Z.summarize(id, text);
  if (!r || !r.ok) { showJobBar({ txt: 'O resumo falhou: ' + ((r && r.error) || 'erro desconhecido') + '.', err: true, close: true }); return; }
  await appendTo(id, r.html, '');
  renderJob();
}
function flash(msg) { showJobBar({ txt: msg, close: true }); setTimeout(renderJob, 4000); }

/* ================================================================== */
/* Gravar reuniões                                                      */
/* ================================================================== */
let rec = null;   // { id, stream, ctx, node, mr, started, pausedMs, pauseAt, timer }
function meetingTitle() { const d = new Date(); return `Reunião — ${d.getDate()} de ${MONTHS[d.getMonth()]}, ${d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`; }
$('#recMeeting').addEventListener('click', async () => {
  if (rec) return;
  const id = await newNote(meetingTitle(), '');
  doc.focus();
  startRec(id);
});
async function startRec(id) {
  if (rec) return;
  const access = await Z.micAccess();
  if (access !== 'granted') return showJobBar({ txt: 'O Zeus não tem acesso ao microfone. Abre Definições do Sistema › Privacidade e segurança › Microfone e ativa o Zeus.', err: true, close: true });
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { return showJobBar({ txt: 'Não foi possível usar o microfone: ' + (e.message || e.name) + '.', err: true, close: true }); }
  const mime = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  const st = await Z.recStart(id, mime);
  if (!st || !st.ok) { stream.getTracks().forEach(t => t.stop()); return showJobBar({ txt: (st && st.error) || 'Não foi possível começar a gravar.', err: true, close: true }); }
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('rec-worklet.js');
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'zeus-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  let flushed = null;
  node.port.onmessage = e => {
    const d = e.data;
    if (d.pcm) Z.recPcm(d.pcm);
    if (d.level != null) $('#recLevel').style.width = Math.min(100, Math.round(Math.sqrt(d.level) * 160)) + '%';
    if (d.done && flushed) flushed();
  };
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
  mr.ondataavailable = async e => { if (e.data && e.data.size) Z.recAud(await e.data.arrayBuffer()); };
  mr.start(3000);
  rec = { id, stream, ctx, node, mr, started: Date.now(), pausedMs: 0, pauseAt: 0, waitFlush: () => new Promise(r => { flushed = r; node.port.postMessage('flush'); setTimeout(r, 1500); }) };
  rec.timer = setInterval(tick, 500); tick();
  $('#recbar').hidden = false; $('#recbar').classList.remove('paused'); $('#recPause').textContent = 'Pausar';
  $('#recReminder').hidden = false;
  $('#tMic').classList.add('rec');
  const n = L.notes.find(x => x.id === id);
  $('#recNote').textContent = 'A gravar para: ' + (n ? n.title : 'nota');
}
function recElapsed() { if (!rec) return 0; const now = rec.pauseAt || Date.now(); return Math.max(0, now - rec.started - rec.pausedMs); }
function clock(ms) { const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0'); }
function tick() { $('#recTime').textContent = clock(recElapsed()); }
$('#recPause').addEventListener('click', () => {
  if (!rec) return;
  if (rec.pauseAt) { rec.pausedMs += Date.now() - rec.pauseAt; rec.pauseAt = 0; rec.node.port.postMessage('resume'); rec.mr.resume(); $('#recPause').textContent = 'Pausar'; $('#recbar').classList.remove('paused'); }
  else { rec.pauseAt = Date.now(); rec.node.port.postMessage('pause'); rec.mr.pause(); $('#recPause').textContent = 'Continuar'; $('#recbar').classList.add('paused'); $('#recLevel').style.width = '0'; }
});
async function endRec() {
  const r = rec; rec = null;
  clearInterval(r.timer);
  const mrDone = new Promise(res => { r.mr.onstop = () => setTimeout(res, 300); });
  try { if (r.mr.state !== 'inactive') r.mr.stop(); } catch (e) { /* ok */ }
  await Promise.race([mrDone, new Promise(res => setTimeout(res, 2500))]);
  await r.waitFlush();
  r.stream.getTracks().forEach(t => t.stop());
  r.ctx.close().catch(() => {});
  $('#recbar').hidden = true; $('#recReminder').hidden = true; $('#tMic').classList.remove('rec');
  return r;
}
$('#recStop').addEventListener('click', async () => {
  if (!rec) return;
  $('#recStop').disabled = true;
  const r = await endRec();
  $('#recStop').disabled = false;
  const res = await Z.recStop();
  if (cur && cur.id === r.id && res && res.audioUrl) { $('#audio').src = res.audioUrl; $('#player').hidden = false; cur.audioUrl = res.audioUrl; }
  load();
});
let cancelArmed = false;
$('#recCancel').addEventListener('click', async () => {
  if (!rec) return;
  if (!cancelArmed) { cancelArmed = true; $('#recCancel').textContent = 'Apagar a gravação?'; $('#recCancel').style.width = 'auto'; $('#recCancel').style.padding = '0 8px'; $('#recCancel').style.color = 'var(--danger)'; setTimeout(resetCancel, 4000); return; }
  resetCancel();
  await endRec();
  await Z.recCancel();
});
function resetCancel() { cancelArmed = false; const b = $('#recCancel'); b.textContent = '✕'; b.style.cssText = ''; }
$('#recReminderX').addEventListener('click', () => { $('#recReminder').hidden = true; });

/* ---------- trabalhos (transcrição, resumo) ---------- */
let model = { state: 'none' };
function showJobBar({ txt, pct, ind, err, close, action }) {
  const b = $('#jobbar');
  b.hidden = false; b.classList.toggle('err', !!err);
  b.innerHTML = `${pct != null || ind ? `<span class="bar ${ind ? 'ind' : ''}"><i style="width:${pct || 0}%"></i></span>` : ''}<span class="txt">${txt}</span>${action || ''}${close ? '<button class="icon" type="button" data-job="close">✕</button>' : ''}`;
}
function renderJob() {
  const b = $('#jobbar');
  const j = cur && jobs.find(x => x.id === cur.id);
  if (!j) { if (!b.classList.contains('err') || !cur) b.hidden = true; return; }
  if (j.stage === 'transcrever') showJobBar({ txt: `A transcrever a gravação no Mac (${clock(j.secs * 1000)})… ${j.pct}% — podes continuar a trabalhar.`, pct: j.pct, ind: !j.pct });
  else if (j.stage === 'resumir') showJobBar({ txt: 'A fazer o resumo com o Claude…', ind: true });
  else if (j.stage === 'pronto') showJobBar({ txt: 'Transcrição pronta.', pct: 100 });
  else if (j.stage === 'espera-modelo') {
    if (model.state === 'downloading') showJobBar({ txt: `A descarregar o modelo de transcrição… ${model.pct}% (${(model.got / 1e9).toFixed(2)} de ${(model.total / 1e9).toFixed(1)} GB)`, pct: model.pct });
    else showJobBar({ txt: 'A gravação está guardada. Para a transcrever no Mac, é preciso descarregar uma vez o modelo do Whisper (1,6 GB).' + (model.error ? ` <span style="color:var(--danger)">${esc(model.error)}</span>` : ''), action: '<button class="btn small primary" type="button" data-job="download">Descarregar agora</button>' });
  }
  else if (j.stage === 'erro') showJobBar({ txt: esc(j.error), err: true, action: `<button class="btn small" type="button" data-job="retry">Tentar outra vez</button><button class="btn small" type="button" data-job="dismiss">Ignorar</button>` });
}
$('#jobbar').addEventListener('click', async e => {
  const b = e.target.closest('[data-job]'); if (!b) return;
  const a = b.dataset.job;
  if (a === 'close') { $('#jobbar').hidden = true; $('#jobbar').classList.remove('err'); }
  if (a === 'download') { model = await Z.modelDownload(); renderJob(); }
  if (a === 'retry' && cur) Z.retryJob(cur.id);
  if (a === 'dismiss' && cur) { await Z.dismissJob(cur.id); $('#jobbar').hidden = true; }
});
Z.onJobs(j => { jobs = j || []; renderJob(); renderList(); });
Z.onModel(m => { model = m || model; renderJob(); if (!$('#modal').hidden) renderSettingsModel(); });
Z.onResults(() => applyResults());
// junta à nota o resumo e a transcrição que ficaram prontos
async function applyResults() {
  const res = await Z.takeResults();
  for (const r of res || []) await appendTo(r.id, r.html, r.title);
  if (res && res.length) renderJob();
}
async function appendTo(id, html, newTitle) {
  const clean = sanitize(html);
  if (cur && cur.id === id) {
    const box = document.createElement('div'); box.innerHTML = clean;
    // tira parágrafos vazios do fim antes de juntar
    while (doc.lastElementChild && doc.lastElementChild.tagName === 'P' && !doc.lastElementChild.textContent.trim() && doc.children.length > 1) doc.lastElementChild.remove();
    if (doc.children.length === 1 && !doc.textContent.trim()) doc.innerHTML = '';
    doc.append(...box.childNodes);
    if (newTitle && /^Reunião — /.test(titleEl.value)) titleEl.value = `${newTitle} — ${titleEl.value.replace(/^Reunião — /, '').replace(/,.*$/, '')}`;
    fitTitle();
    dirty = true; await save();
    return;
  }
  const n = await Z.read(id); if (!n) return;
  const box = document.createElement('div'); box.innerHTML = sanitize(n.html) + clean;
  const title = newTitle && /^Reunião — /.test(n.title) ? `${newTitle} — ${n.title.replace(/^Reunião — /, '').replace(/,.*$/, '')}` : n.title;
  await Z.save(id, { html: box.innerHTML, title }, toBlocks(box));
  load();
}

/* ================================================================== */
/* Definições                                                           */
/* ================================================================== */
async function openSettings(msg) {
  const w = await Z.where(), hasKey = await Z.hasKey();
  model = await Z.modelState();
  $('#sheet').innerHTML = `<div class="hd"><h2>Definições das Notas</h2><button class="icon" type="button" data-s="close">✕</button></div>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    <section><span class="lbl">Pasta das notas</span>
      <div class="path">${esc(w.root)}</div>
      <p class="small">${w.drive ? `Está dentro do ${esc(w.drive)}: a app do ${esc(w.drive)} envia as notas para a cloud sozinha.` : 'Esta pasta não está numa cloud. Para ter cópia no Google Drive, escolhe uma pasta dentro do Google Drive.'}</p>
      <div class="row"><button class="btn small" type="button" data-s="choose">Escolher outra pasta…</button>${w.custom ? '<button class="btn small" type="button" data-s="reset">Usar a pasta automática</button>' : ''}<button class="btn small" type="button" data-s="reveal">Abrir no Finder</button></div>
      <label class="chk"><input type="checkbox" id="sWord" ${w.wordCopy ? 'checked' : ''}> Guardar também uma cópia em Word (.docx) ao lado de cada nota</label>
    </section>
    <section><span class="lbl">Transcrição das reuniões (Whisper, no Mac)</span><div id="sModel"></div></section>
    <section><span class="lbl">Resumos (Claude)</span>
      ${hasKey ? `<div class="row"><span class="okt">✓ Chave da API guardada no Porta-chaves do Mac</span><button class="btn small danger" type="button" data-s="delkey">Apagar a chave</button></div>`
        : `<p>As reuniões gravadas são resumidas pelo Claude (decisões, tarefas e próximos passos). É preciso uma chave da API da Anthropic, paga à parte da assinatura do Claude.</p>
           <form class="row" id="keyF"><input type="password" id="sKey" placeholder="sk-ant-…" autocomplete="off"><button class="btn small primary" type="submit">Guardar</button></form>
           <p class="small">Cria a chave em <a href="#" data-s="console">console.anthropic.com</a> › API Keys.</p><p class="err" id="keyErr"></p>`}
    </section>`;
  renderSettingsModel();
  $('#modal').hidden = false;
}
function renderSettingsModel() {
  const el = $('#sModel'); if (!el) return;
  const m = model;
  if (!m.bin) { el.innerHTML = '<p class="small">O programa de transcrição não está incluído nesta versão.</p>'; return; }
  if (m.state === 'ready') el.innerHTML = `<div class="row"><span class="okt">✓ Modelo pronto (large-v3-turbo, 1,6 GB). A transcrição é feita no Mac; o áudio não sai do computador.</span><button class="btn small" type="button" data-s="delmodel">Apagar o modelo</button></div>`;
  else if (m.state === 'downloading') el.innerHTML = `<div class="row"><span class="bar"><i style="width:${m.pct}%"></i></span><span class="small">${m.pct}% · ${(m.got / 1e9).toFixed(2)} de ${(m.total / 1e9).toFixed(1)} GB</span><button class="btn small" type="button" data-s="cancelmodel">Cancelar</button></div>`;
  else el.innerHTML = `<p>Para transcrever, o Zeus usa o Whisper no próprio Mac. Precisa de descarregar uma vez o modelo (1,6 GB).</p>${m.error ? `<p class="err">${esc(m.error)}</p>` : ''}<div class="row"><button class="btn small primary" type="button" data-s="getmodel">Descarregar o modelo</button></div>`;
}
$('#modal').addEventListener('click', async e => {
  if (e.target === $('#modal')) return closeSettings();
  const b = e.target.closest('[data-s]'); if (!b) return;
  const a = b.dataset.s;
  if (a === 'close') return closeSettings();
  if (a === 'choose') { const w = await Z.chooseRoot(); if (w) { await load(false); openSettings(); } }
  if (a === 'reset') { await Z.resetRoot(); await load(false); openSettings(); }
  if (a === 'reveal') Z.reveal(null);
  if (a === 'delkey') { await Z.setKey(''); openSettings(); }
  if (a === 'console') { e.preventDefault(); Z.openLink('https://console.anthropic.com/settings/keys'); }
  if (a === 'getmodel') { model = await Z.modelDownload(); renderSettingsModel(); }
  if (a === 'cancelmodel') { await Z.modelCancel(); }
  if (a === 'delmodel') { await Z.modelRemove(); model = await Z.modelState(); renderSettingsModel(); }
});
$('#modal').addEventListener('change', async e => { if (e.target.id === 'sWord') { await Z.setWordCopy(e.target.checked); load(); } });
$('#modal').addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id !== 'keyF') return;
  const k = $('#sKey').value.trim(); if (!k) return;
  $('#keyErr').textContent = 'A verificar a chave…';
  const r = await Z.setKey(k);
  if (r && r.ok) openSettings(); else $('#keyErr').textContent = (r && r.error) || 'Não foi possível guardar a chave.';
});
function closeSettings() { $('#modal').hidden = true; }

/* ================================================================== */
/* Procurar, atalhos, tema, arranque                                    */
/* ================================================================== */
let searchT = null;
$('#q').addEventListener('input', e => {
  q = e.target.value.trim(); qIds = null; renderList();
  clearTimeout(searchT);
  if (q) searchT = setTimeout(async () => { const ids = await Z.search(q); qIds = ids ? new Set(ids) : null; renderList(); }, 250);
});
$('#q').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; q = ''; qIds = null; renderList(); e.target.blur(); } if (e.key === 'Enter') { const f = filtered()[0]; if (f) openNote(f.id); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!pop.hidden) closePop(); else if (!$('#modal').hidden) closeSettings(); else if (document.body.classList.contains('focus')) setFocusMode(false); }
  if (e.metaKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
  if (e.metaKey && e.key.toLowerCase() === 's') { e.preventDefault(); dirty = true; save(); }
  if (e.metaKey && e.key.toLowerCase() === 'k' && !doc.contains(document.activeElement) && document.activeElement !== doc) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
});
const setTheme = t => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; };
Z.onTheme(setTheme);
Z.onChanged(() => { clearTimeout(window.__lt); window.__lt = setTimeout(() => load(), 200); });

(async () => {
  setTheme(await Z.theme());
  try { if (localStorage.getItem('notas.focus')) setFocusMode(true); } catch (e) { /* ok */ }
  jobs = await Z.jobs() || [];
  model = await Z.modelState() || model;
  await load(false);
  if (!cur) showNote(null);
  applyResults();
})();

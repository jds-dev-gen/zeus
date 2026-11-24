'use strict';
/*
 * Zeus para Android — interface.
 * Ecrãs: Início, Zoom, Separadores, Definições; a página de um separador é uma WebView da app,
 * posta por cima de #page (ZN.call('layout')). Os dados do Zoom são os mesmos do Mac (zoom-core.js)
 * e sincronizam pela Drive com a mesma regra de junção.
 */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const { ZoomStore, mergeZoom, COLORS } = window.ZoomCore;
const COLOR_NAMES = { yellow: 'Amarelo', green: 'Verde', blue: 'Azul', pink: 'Rosa', orange: 'Laranja' };

/* ---------- ponte com a app ---------- */
const ZN = window.ZN = {
  seq: 0, waits: {}, handlers: {},
  call(method, args) {
    return new Promise((res, rej) => {
      const id = 'c' + (++this.seq);
      this.waits[id] = { res, rej };
      try { window.ZeusNative.call(id, method, JSON.stringify(args || {})); } catch (e) { delete this.waits[id]; rej(e); }
    });
  },
  _r(id, ok, v) { const w = this.waits[id]; if (!w) return; delete this.waits[id]; if (ok) w.res(v); else w.rej(new Error(v || 'erro')); },
  _ev(type, d) { (this.handlers[type] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); },
  on(type, f) { (this.handlers[type] = this.handlers[type] || []).push(f); },
  back() { return onBack(); }
};

/* ---------- ícones ---------- */
const I = {
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
  zoom: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>',
  sync: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>',
  settings: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 5-7 7 7 7"/></svg>',
  reload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  mark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = I[el.dataset.icon] || ''; });

/* ---------- estado ---------- */
const S = {
  view: 'home', tabs: [], current: null, hl: false, overlay: null,
  zoomFilter: 'all', zoomQ: '', zoomOpen: null, delArmed: null,
  macTabs: [], macAt: 0, version: '', update: null,
  spaces: [{ id: 'leitura', name: 'Leitura' }, { id: 'obs', name: 'Observador' }, { id: 'pessoal', name: 'Pessoal' }],
  space: 'leitura', moveTab: null,
  reader: { size: 20, theme: 'claro' }
};
const spaceTabs = () => S.tabs.filter(t => t.space === S.space);
const spaceName = id => (S.spaces.find(x => x.id === id) || {}).name || '';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cur = () => S.tabs.find(t => t.id === S.current) || null;

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2400); }

/* ---------- Zoom (mesmo núcleo do Mac) ---------- */
let zoom = new ZoomStore({}, () => {});
let zoomSaveT = null;
async function loadZoom() {
  let j = {};
  try { const t = await ZN.call('storeRead', { name: 'zoom.json' }); if (t) j = JSON.parse(t); } catch (e) { /* primeira vez */ }
  zoom = new ZoomStore(j, (d, fromSync) => {
    clearTimeout(zoomSaveT);
    zoomSaveT = setTimeout(() => ZN.call('storeWrite', { name: 'zoom.json', text: JSON.stringify(zoom.data()) }).catch(() => {}), 300);
    if (!fromSync) Sync.touch(); else refreshPages();
    renderSoon();
  });
}
// as páginas abertas voltam a pintar os destaques (mudaram na Drive ou no painel)
function refreshPages() { S.tabs.forEach(t => ZN.call('toPage', { id: t.id, json: JSON.stringify({ type: 'refresh' }) }).catch(() => {})); }

/* pedidos das páginas (hl.js) */
ZN.on('page', async d => {
  let m; try { m = JSON.parse(d.msg); } catch (e) { return; }
  const url = d.url, a = Array.isArray(m.args) ? m.args : [];
  let value = null;
  try {
    if (m.type === 'list') value = zoom.highlightsFor(url);
    else if (m.type === 'add') {
      const had = zoom.has(url);
      let meta = { url };
      if (!had) { const mm = await ZN.call('pageMeta', { id: d.id }).catch(() => null); meta = Object.assign({}, mm || {}, { url }); }
      const r = zoom.addHighlight(meta, a[0] || {});
      value = r && r.hl;
      if (r && !had) toast('Página guardada no Zoom, com o destaque.');
    } else if (m.type === 'update') value = zoom.updateHighlight(url, String(a[0]), a[1] || {});
    else if (m.type === 'remove') value = zoom.removeHighlight(url, String(a[0]));
    else if (m.type === 'copy') { await ZN.call('copy', { text: String(a[0] || '') }); toast('Copiado'); value = true; }
  } catch (e) { value = null; }
  ZN.call('toPage', { id: d.id, json: JSON.stringify({ type: 'reply', id: m.id, value }) }).catch(() => {});
  renderSoon();
});

/* ---------- sincronização pela Drive (a mesma do Mac: sync.js) ---------- */
const D = (op, a) => ZN.call('drive', Object.assign({ op }, a || {}));
const Sync = {
  st: { connected: false, email: '', state: 'idle', lastOk: 0, error: '' },
  timer: null, soonT: null, running: null, again: false,
  async init() {
    try { const t = await ZN.call('storeRead', { name: 'sync.json' }); if (t) Object.assign(this.st, JSON.parse(t)); } catch (e) { /* ok */ }
    this.st.state = 'idle'; this.st.error = '';
    if (this.st.connected) this.start();
  },
  persist() { ZN.call('storeWrite', { name: 'sync.json', text: JSON.stringify({ connected: this.st.connected, email: this.st.email, lastOk: this.st.lastOk }) }).catch(() => {}); },
  set(state, error = '') { this.st.state = state; this.st.error = error; if (state === 'ok') { this.st.lastOk = Date.now(); this.persist(); } renderSoon(); },
  async signIn() {
    this.set('syncing');
    try {
      await ZN.call('signIn');
      this.st.connected = true;
      this.st.email = await D('about').catch(() => '') || '';
      this.persist(); this.start();
      await this.now();
      toast('Zeus ligado à Drive');
    } catch (e) { this.set('error', e.message === 'needs-signin' ? 'Não foi possível entrar.' : e.message); }
  },
  signOut() { ZN.call('signOut').catch(() => {}); this.st.connected = false; this.st.email = ''; this.persist(); clearInterval(this.timer); this.timer = null; this.set('idle'); },
  start() { if (this.timer) return; this.timer = setInterval(() => this.now(), 120000); setTimeout(() => this.now(), 1500); },
  touch() { if (!this.st.connected) return; clearTimeout(this.soonT); this.soonT = setTimeout(() => this.now(), 4000); },
  async doc(name, get, merge, apply) {
    const file = name + '.json';
    const fid = await D('find', { name: file });
    if (!fid) { await D('upload', { name: file, text: JSON.stringify(get()) }); return; }
    const txt = await D('download', { fid });
    let remote = null; try { remote = JSON.parse(txt); } catch (e) { /* ficheiro estragado: fica o deste aparelho */ }
    const local = get();
    const merged = remote ? merge(local, remote) : local;
    if (JSON.stringify(merged) !== JSON.stringify(local)) apply(merged);
    if (!remote || JSON.stringify(merged) !== JSON.stringify(remote)) await D('upload', { name: file, text: JSON.stringify(merged), fid });
  },
  now() {
    if (!this.st.connected) return Promise.resolve(false);
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      this.set('syncing');
      try {
        await this.doc('zoom', () => zoom.data(), mergeZoom, d => zoom.replace(d));
        // separadores abertos no Mac (só leitura)
        try {
          const fid = await D('find', { name: 'mac-tabs.json' });
          if (fid) { const j = JSON.parse(await D('download', { fid })); S.macTabs = Array.isArray(j.tabs) ? j.tabs : []; S.macAt = j.at || 0; }
        } catch (e) { /* ok */ }
        this.set('ok');
        return true;
      } catch (e) {
        if (e.message === 'needs-signin') { this.st.connected = false; this.persist(); this.set('error', 'A Google pediu para voltares a entrar.'); }
        else this.set('error', e.message);
        return false;
      } finally {
        this.running = null;
        if (this.again) { this.again = false; setTimeout(() => this.now(), 500); }
      }
    })();
    return this.running;
  }
};

/* ---------- separadores ---------- */
let tabsSaveT = null;
function saveTabs() {
  clearTimeout(tabsSaveT);
  tabsSaveT = setTimeout(() => {
    const cu = S.tabs.findIndex(t => t.id === S.current);
    ZN.call('storeWrite', { name: 'tabs.json', text: JSON.stringify({ current: cu, space: S.space, spaces: S.spaces, reader: S.reader, tabs: S.tabs.filter(t => t.url).map(t => ({ url: t.url, title: t.title, space: t.space })) }) }).catch(() => {});
  }, 400);
}
async function restoreTabs() {
  let j = null;
  try { const t = await ZN.call('storeRead', { name: 'tabs.json' }); if (t) j = JSON.parse(t); } catch (e) { /* ok */ }
  if (!j || !Array.isArray(j.tabs)) return;
  if (Array.isArray(j.spaces) && j.spaces.length) S.spaces = j.spaces.filter(x => x && x.id && x.name);
  if (j.reader) S.reader = Object.assign(S.reader, j.reader);
  const first = S.spaces[0].id;
  S.space = S.spaces.some(x => x.id === j.space) ? j.space : first;
  for (const t of j.tabs.slice(0, 60)) {
    const r = await ZN.call('tabNew', { url: t.url, lazy: true });
    S.tabs.push({ id: r.id, url: t.url, title: t.title || hostOf(t.url), space: S.spaces.some(x => x.id === t.space) ? t.space : first });
  }
}
function toURL(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}
async function newTab(url, show = true) {
  url = toURL(url);
  if (!url) return;
  await thumbNow();
  const r = await ZN.call('tabNew', { url, show: false });
  const t = { id: r.id, url, title: hostOf(url), loading: true, space: S.space };
  S.tabs.unshift(t);
  saveTabs();
  if (show) await openTab(t.id); else render();
}
async function openTab(id) {
  if (S.view === 'tab' && S.current !== id) await thumbNow();
  S.current = id;
  S.view = 'tab';
  const tt = cur(); if (tt && tt.space) S.space = tt.space;
  render();
  const info = await ZN.call('tabOpen', { id }).catch(() => null);
  const t = cur();
  if (t && info) { t.back = info.back; if (info.title) t.title = info.title; }
  saveTabs();
  renderTop();
}
async function closeTab(id) {
  const i = S.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  S.tabs.splice(i, 1);
  await ZN.call('tabClose', { id }).catch(() => {});
  if (S.current === id) { const rest = spaceTabs(); S.current = rest.length ? rest[0].id : null; if (S.view === 'tab') { if (S.current) openTab(S.current); else go('home'); } }
  saveTabs(); render();
}
async function thumbNow() {
  const t = cur();
  if (S.view !== 'tab' || !t) return;
  const th = await ZN.call('tabThumb', { id: t.id }).catch(() => null);
  if (th) t.thumb = th;
}
async function go(view) {
  if (view === 'tab' && !cur()) view = 'home';
  if (S.view === 'tab' && view !== 'tab') await thumbNow();
  S.view = view; S.overlay = null;
  if (view === 'tab') return openTab(S.current);
  render();
  $('#screen').scrollTop = 0;
}

ZN.on('tab', d => {
  const t = S.tabs.find(x => x.id === d.id); if (!t) return;
  if (d.url) t.url = d.url;
  if (d.title) t.title = d.title;
  if ('back' in d) t.back = d.back;
  if ('loading' in d) t.loading = d.loading;
  if (d.loading === true) t.reader = false;
  if (d.crashed) { t.loading = false; if (S.current === t.id && S.view === 'tab') ZN.call('tabOpen', { id: t.id }); }
  saveTabs();
  if (t.id === S.current) renderTop();
});
ZN.on('progress', d => { if (d.id !== S.current) return; const p = $('#prog'); p.style.width = (d.p >= 100 ? 0 : d.p) + '%'; });
ZN.on('tabCreated', async d => {
  await thumbNow();
  S.tabs.unshift({ id: d.id, url: '', title: 'A abrir…', space: (S.tabs.find(x => x.id === d.opener) || {}).space || S.space });
  S.current = d.id; S.view = 'tab';
  render(); saveTabs();
});
ZN.on('tabClosedByPage', d => closeTab(d.id));
ZN.on('openUrl', d => newTab(d.url));
ZN.on('resume', () => { Sync.now(); renderSoon(); });

/* ---------- desenho ---------- */
let renderT = null;
function renderSoon() { if (!renderT) renderT = requestAnimationFrame(() => { renderT = null; render(); }); }
function render(force) {
  const app = $('#app');
  // não apagar o que se está a escrever numa caixa do ecrã (a não ser a pedido)
  const typing = !force && document.activeElement && document.activeElement.tagName === 'INPUT' && $('#screen').contains(document.activeElement);
  app.className = 'v-' + S.view + (S.view === 'tab' && S.hl ? ' hl' : '');
  document.querySelectorAll('[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === S.view));
  document.querySelectorAll('.tabsN').forEach(el => el.dataset.n = S.tabs.length);
  const dot = $('.syncDot'); dot.className = 'dot syncDot ' + syncClass();
  renderTop();
  if (S.view !== 'tab' && !typing) $('#screen').innerHTML = SCREENS[S.view] ? SCREENS[S.view]() : '';
  if (S.view === 'tab' && S.hl) renderHlPanel();
  renderOverlay();
  layoutSoon();
}
function syncClass() { const s = Sync.st; return !s.connected ? '' : s.state === 'error' ? 'err' : s.state === 'syncing' ? 'busy' : s.lastOk ? 'ok' : ''; }
function renderTop() {
  const t = cur(), onTab = S.view === 'tab' && t;
  const addr = $('#addr');
  if (document.activeElement !== addr) addr.value = onTab ? (t.title && t.title !== hostOf(t.url) ? `${hostOf(t.url)} · ${t.title}` : t.url) : '';
  $('#bBack').classList.toggle('off', !(onTab && t.back));
  $('#bReload').hidden = !onTab;
  $('#bRead').hidden = !onTab;
  $('#bRead').classList.toggle('on', !!(onTab && t.reader));
  $('#bSave').hidden = !onTab;
  $('#bHl').hidden = !onTab;
  const it = onTab && t.url ? zoom.byUrl(t.url) : null;
  $('#bSave').classList.toggle('saved', !!it);
  $('#hlN').textContent = it ? it.highlights.length : 0;
  $('#bHl').classList.toggle('on', S.hl);
}

/* a página do separador fica por cima de #page; escondida quando há janelas por cima */
let layoutT = null;
function layoutSoon() { cancelAnimationFrame(layoutT); layoutT = requestAnimationFrame(sendLayout); }
let lastLayout = '';
function sendLayout() {
  const r = $('#page').getBoundingClientRect();
  const show = S.view === 'tab' && !!cur() && !S.overlay;
  const l = { x: r.left, y: r.top, w: r.width, h: r.height, show };
  const k = JSON.stringify(l);
  if (k === lastLayout) return;
  lastLayout = k;
  ZN.call('layout', l).catch(() => {});
}
new ResizeObserver(layoutSoon).observe($('#page'));
window.addEventListener('resize', layoutSoon);

const fmtTime = t => new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const fmtDay = t => new Date(t).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
function syncLine() {
  const s = Sync.st;
  if (!s.connected) return `<div class="syncline"><i></i><span>Ainda sem ligação à Drive</span><button class="btn ghost" data-act="signin" style="height:38px">Entrar com o Google</button></div>`;
  const txt = s.state === 'syncing' ? 'A sincronizar…' : s.state === 'error' ? s.error : s.lastOk ? `Sincronizado com o Zeus do Mac às ${fmtTime(s.lastOk)}` : 'Ligado à Drive';
  return `<div class="syncline"><i class="${syncClass()}"></i><span>${esc(txt)}</span><small>Drive</small></div>`;
}
function hlColors(it) { const cs = [...new Set(it.highlights.map(h => h.color))]; return cs.map(c => `<i class="c-${c}"></i>`).join(''); }
function articleCard(it) {
  const n = it.highlights.length;
  return `<button class="acard" data-act="openUrl" data-url="${esc(it.url)}">
    <div class="im" style="${it.image ? `background-image:url('${esc(it.image).replace(/'/g, '%27')}')` : ''}"></div>
    <div class="tx"><small>${esc(it.site || hostOf(it.url))}</small><b>${esc(it.title)}</b>
    <span class="cols">${n ? hlColors(it) + ` ${n} destaque${n === 1 ? '' : 's'}` : 'Sem destaques'}</span></div></button>`;
}
function recentHls(n) {
  const all = [];
  zoom.data().items.forEach(it => it.highlights.forEach(h => all.push({ h, it })));
  return all.sort((a, b) => (b.h.updatedAt || b.h.createdAt || 0) - (a.h.updatedAt || a.h.createdAt || 0)).slice(0, n);
}

const SCREENS = {
  home() {
    const now = new Date();
    const items = zoom.data().items.slice(0, 6);
    const hls = recentHls(4);
    return `<div class="scr">
      ${S.update ? `<div class="banner"><span>Há uma versão nova do Zeus para Android: ${esc(S.update.version)}</span><button class="btn" data-act="update">Descarregar</button></div>` : ''}
      <div class="home-head"><div><div class="clock" id="clock">${fmtTime(now)}</div><div class="date">${esc(now.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div></div>
      <form id="homeSearch" autocomplete="off"><input class="inp" id="homeQ" type="text" enterkeyhint="go" placeholder="Pesquisar ou escrever um endereço" autocapitalize="off" spellcheck="false"></form>
      ${syncLine()}
      <div style="display:flex;flex-direction:column;gap:12px"><div class="lbl">Continuar a ler · Zoom<button data-go="zoom">Ver tudo</button></div>
        ${items.length ? `<div class="cards">${items.map(articleCard).join('')}</div>` : '<p class="empty">Os artigos que guardares (ou destacares) aparecem aqui — também os do Mac.</p>'}</div>
      ${hls.length ? `<div style="display:flex;flex-direction:column"><div class="lbl" style="margin-bottom:8px">Destaques recentes</div>
        ${hls.map(({ h, it }) => `<button class="hlrow" data-act="openUrl" data-url="${esc(it.url)}"><span><mark class="c-${h.color}">${esc(h.text)}</mark></span><small>${esc(it.title)}${h.comment ? ' · 1 comentário' : ''}</small></button>`).join('')}</div>` : ''}
      <div class="shorts">${[['O', 'Observador', 'https://observador.pt'], ['P', 'Público', 'https://www.publico.pt'], ['E', 'Expresso', 'https://expresso.pt'], ['G', 'Gmail', 'https://mail.google.com'], ['N', 'Notion', 'https://www.notion.so'], ['Y', 'YouTube', 'https://www.youtube.com']].map(([l, n, u]) => `<button class="short" data-act="openUrl" data-url="${u}"><span>${l}</span>${n}</button>`).join('')}</div>
    </div>`;
  },
  zoom() {
    const d = zoom.data();
    const q = S.zoomQ.toLowerCase();
    const list = d.items.filter(it => {
      if (S.zoomFilter === 'hl' && !it.highlights.length) return false;
      if (S.zoomFilter.startsWith('col:') && it.col !== S.zoomFilter.slice(4)) return false;
      if (!q) return true;
      return [it.title, it.site, it.note, ...(it.tags || []), ...it.highlights.map(h => h.text + ' ' + (h.comment || ''))].join(' ').toLowerCase().includes(q);
    });
    const chip = (id, name, n) => `<button class="chip ${S.zoomFilter === id ? 'on' : ''}" data-act="zfilter" data-f="${esc(id)}">${esc(name)}${n != null ? ' · ' + n : ''}</button>`;
    return `<div class="scr">
      <div style="display:flex;align-items:center;gap:12px"><h1 style="flex:1">Zoom</h1><small class="hint">${esc(Sync.st.connected && Sync.st.lastOk ? 'Sincronizado às ' + fmtTime(Sync.st.lastOk) : '')}</small></div>
      <input class="inp" id="zq" type="search" placeholder="Pesquisar nos artigos e destaques" value="${esc(S.zoomQ)}">
      <div class="chips">${chip('all', 'Todos', d.items.length)}${chip('hl', 'Com destaques', d.items.filter(i => i.highlights.length).length)}${d.cols.map(c => chip('col:' + c.id, c.name, d.items.filter(i => i.col === c.id).length)).join('')}</div>
      <div class="zl">${list.length ? list.map(zoomRow).join('') : '<p class="empty">Nada aqui.</p>'}</div>
    </div>`;
  },
  tabs() {
    const mac = S.macTabs || [], list = spaceTabs();
    const macBy = {}; mac.forEach(t => { (macBy[t.space || ''] = macBy[t.space || ''] || []).push(t); });
    return `<div class="scr">
      <div class="tabs-head"><h1>Separadores</h1><button class="btn" data-act="newTab">+ Novo separador</button></div>
      <div class="sp-chips">${S.spaces.map(x => `<button class="chip ${x.id === S.space ? 'on' : ''}" data-act="space" data-s="${esc(x.id)}">${esc(x.name)} · ${S.tabs.filter(t => t.space === x.id).length}</button>`).join('')}<button class="chip add" data-act="spaceAdd">+ Espaço</button>${S.spaces.length > 1 ? `<button class="chip add" data-act="spaceEdit">Mudar o nome…</button>` : ''}</div>
      ${list.length ? `<div class="tgrid" id="tgrid">${list.map(t => `<div class="tcard ${t.id === S.current ? 'cur' : ''}" data-tab="${t.id}">
        <button class="th" data-act="openTab" data-id="${t.id}" style="${t.thumb ? `background-image:url('${t.thumb}')` : ''}">${t.thumb ? '' : esc((hostOf(t.url)[0] || '·').toUpperCase())}</button>
        <div class="cap"><span>${esc(t.title || hostOf(t.url) || 'Página nova')}</span><button data-act="closeTab" data-id="${t.id}" aria-label="Fechar">${I.x}</button></div></div>`).join('')}</div>
        <p class="hint">Desliza um cartão para o lado para o fechar · toca sem largar para o mudar de espaço.</p>` : `<p class="empty">Não há separadores em ${esc(spaceName(S.space))}.</p>`}
      <div class="mac"><div class="lbl" style="margin-bottom:4px">Do Mac${S.macAt ? ' · ' + fmtDay(S.macAt) + ' ' + fmtTime(S.macAt) : ''}</div>
        ${mac.length ? Object.keys(macBy).map(sp => `${sp ? `<div class="mac-sp">${esc(sp)}</div>` : ''}${macBy[sp].map(t => `<button data-act="openUrl" data-url="${esc(t.url)}"><span>${esc(t.title || hostOf(t.url))}</span><small>${esc(hostOf(t.url))}</small></button>`).join('')}`).join('') : `<p class="empty">${Sync.st.connected ? 'Ainda não chegaram os separadores do Mac (precisa do Zeus 0.24 ou mais recente no Mac).' : 'Liga a Drive nas Definições para ver aqui os separadores abertos no Mac.'}</p>`}</div>
    </div>`;
  },
  settings() {
    const s = Sync.st;
    return `<div class="scr" style="max-width:720px">
      <h1>Definições</h1>
      <div class="card-box"><div class="lbl">Sincronização com o Zeus do Mac</div>
        ${s.connected ? `<div class="set-row"><span>Ligado à Drive${s.email ? ' de <b>' + esc(s.email) + '</b>' : ''}</span><small class="hint">${esc(s.state === 'syncing' ? 'A sincronizar…' : s.lastOk ? 'Última sincronização às ' + fmtTime(s.lastOk) : '')}</small></div>
          ${s.state === 'error' ? `<p class="err">${esc(s.error)}</p>` : ''}
          <p class="hint">O Zoom (artigos, coleções e destaques) sincroniza de 2 em 2 minutos, logo a seguir a cada alteração e ao voltares à app.</p>
          <div class="row-btns"><button class="btn ghost" data-act="syncNow">Sincronizar agora</button><button class="btn danger" data-act="signout">${S.delArmed === 'signout' ? 'Confirmar: desligar' : 'Desligar'}</button></div>`
        : `<p class="hint">Entra com a mesma conta Google que ligaste no Zeus do Mac. O Zeus só tem acesso à sua pasta escondida na Drive.</p>
          ${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
          <div class="row-btns"><button class="btn" data-act="signin">Entrar com o Google</button></div>`}
      </div>
      <div class="card-box"><div class="lbl">Atualizações</div>
        <div class="set-row"><span>Versão instalada: ${esc(S.version)}</span><button class="btn ghost" data-act="checkUpdate">Procurar agora</button></div>
        ${S.update ? `<div class="banner"><span>Versão nova: ${esc(S.update.version)}</span><button class="btn" data-act="update">Descarregar</button></div><p class="hint">Depois de descarregar, abre o ficheiro e carrega em "Atualizar".</p>` : ''}
      </div>
      <div class="card-box"><div class="lbl">Abrir links no Zeus</div>
        <p class="hint">Para os links de outras apps abrirem aqui: Definições do Android › Aplicações › Escolher aplicações predefinidas › Aplicação de browser › Zeus.</p></div>
    </div>`;
  }
};
function zoomRow(it) {
  const n = it.highlights.length, open = S.zoomOpen === it.id, d = zoom.data();
  return `<div class="zi"><button class="zi-main" data-act="openUrl" data-url="${esc(it.url)}">
      <div class="t"><small>${esc(it.site || hostOf(it.url))} · ${fmtDay(it.createdAt || Date.now())}</small><b>${esc(it.title)}</b>
      <span class="cols">${n ? hlColors(it) + ` ${n} destaque${n === 1 ? '' : 's'}` : ''}${it.note ? (n ? ' · ' : '') + 'nota' : ''}</span></div>
      ${it.image ? `<div class="im" style="background-image:url('${esc(it.image).replace(/'/g, '%27')}')"></div>` : ''}</button>
    <div class="zi-acts">
      ${n ? `<button data-act="zopen" data-id="${it.id}">${open ? 'Esconder destaques' : 'Ver destaques'}</button>` : ''}
      <select data-act="zcol" data-id="${it.id}" aria-label="Coleção"><option value="">Sem coleção</option>${d.cols.map(c => `<option value="${esc(c.id)}" ${it.col === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="del ${S.delArmed === it.id ? 'armed' : ''}" data-act="zdel" data-id="${it.id}">${S.delArmed === it.id ? 'Apagar do Zoom?' : 'Apagar'}</button>
    </div>
    ${open ? `<div class="zhl">${it.highlights.map(h => `<div class="zhl-i"><div class="tx"><mark class="c-${h.color}" style="color:inherit;padding:1px 2px;border-radius:2px">${esc(h.text)}</mark>${h.comment ? `<em>${esc(h.comment)}</em>` : ''}</div><button class="x" data-act="zhldel" data-id="${it.id}" data-h="${h.id}" aria-label="Tirar o destaque">${I.x}</button></div>`).join('')}</div>` : ''}
  </div>`;
}
function renderHlPanel() {
  const t = cur(), it = t && t.url ? zoom.byUrl(t.url) : null, hs = it ? it.highlights : [];
  $('#hlpanel').innerHTML = `<div class="hp-head"><b>Destaques · ${hs.length}</b><button class="tb" data-act="hlClose" aria-label="Fechar">${I.x}</button></div>
    <div class="hp-list">${hs.length ? hs.map(h => `<div class="hp-i"><span class="q c-${h.color}">${esc(h.text)}</span>${h.comment ? `<em>${esc(h.comment)}</em>` : ''}
      <div class="hp-acts">${COLORS.map(c => `<button class="sw c-${c} ${h.color === c ? 'on' : ''}" data-act="hlColor" data-h="${h.id}" data-c="${c}" aria-label="${COLOR_NAMES[c]}"></button>`).join('')}<span class="sp"></span>
      <button class="t" data-act="hlCopy" data-h="${h.id}">Copiar</button><button class="t" data-act="hlDel" data-h="${h.id}">Tirar</button></div></div>`).join('')
      : '<p class="hint">Seleciona texto na página e escolhe uma cor para criar um destaque.</p>'}</div>
    ${hs.length ? `<div class="hp-foot"><button class="btn ghost" data-act="hlCopyAll">Copiar todos</button></div>` : ''}`;
}
function renderOverlay() {
  const ov = $('#overlay');
  if (S.overlay === 'reader') {
    const r = S.reader, th = [['claro', 'Claro', '#fff', '#1d1d20'], ['sepia', 'Sépia', '#f6efe1', '#3b3127'], ['escuro', 'Escuro', '#141416', '#e4e4e6']];
    ov.innerHTML = `<div class="sheet" role="dialog" aria-label="Modo de leitura"><h2>Modo de leitura</h2>
      <div class="set-row"><span>Tamanho da letra</span><div class="stepper"><button data-act="rsize" data-d="-1" aria-label="Mais pequena">A−</button><b>${r.size}</b><button data-act="rsize" data-d="1" aria-label="Maior">A+</button></div></div>
      <div class="themes">${th.map(([id, n, bg, fg]) => `<button class="${r.theme === id ? 'on' : ''}" data-act="rtheme" data-t="${id}" style="background:${bg};color:${fg}">${n}</button>`).join('')}</div>
      <div class="row-btns"><button class="btn" data-act="sclose">Feito</button><button class="btn ghost" data-act="rexit">Ver a página original</button></div></div>`;
    ov.classList.add('on'); return;
  }
  if (S.overlay === 'move') {
    const t = S.tabs.find(x => x.id === S.moveTab);
    if (!t) { S.overlay = null; ov.classList.remove('on'); return; }
    ov.innerHTML = `<div class="sheet" role="dialog" aria-label="Mudar de espaço"><h2>Mover para…</h2><p class="hint">${esc(t.title || hostOf(t.url))}</p>
      <div class="list">${S.spaces.map(x => `<button class="${t.space === x.id ? 'on' : ''}" data-act="moveTo" data-s="${esc(x.id)}">${esc(x.name)}${t.space === x.id ? '<span>✓</span>' : ''}</button>`).join('')}<button data-act="moveNew">+ Espaço novo…</button></div>
      <div class="row-btns"><button class="btn ghost" data-act="sclose">Cancelar</button></div></div>`;
    ov.classList.add('on'); return;
  }
  if (S.overlay !== 'save') { ov.classList.remove('on'); ov.innerHTML = ''; return; }
  const t = cur(), it = t && zoom.byUrl(t.url);
  if (!it) { S.overlay = null; ov.classList.remove('on'); return; }
  const d = zoom.data();
  ov.innerHTML = `<div class="sheet" role="dialog" aria-label="Guardado no Zoom"><h2>Guardado no Zoom</h2>
    <div class="meta">${it.image ? `<div class="im" style="background-image:url('${esc(it.image).replace(/'/g, '%27')}')"></div>` : ''}<div><b>${esc(it.title)}</b><small>${esc(it.site || hostOf(it.url))}</small></div></div>
    <div class="lbl">Coleção</div>
    <div class="chips"><button class="chip ${!it.col ? 'on' : ''}" data-act="scol" data-c="">Sem coleção</button>${d.cols.map(c => `<button class="chip ${it.col === c.id ? 'on' : ''}" data-act="scol" data-c="${esc(c.id)}">${esc(c.name)}</button>`).join('')}<button class="chip" data-act="snewcol">+ Nova coleção</button></div>
    <div class="row-btns"><button class="btn" data-act="sclose">Feito</button><button class="btn danger" data-act="sremove">${S.delArmed === 'save' ? 'Tirar mesmo?' : 'Tirar do Zoom'}</button></div></div>`;
  ov.classList.add('on');
}

/* ---------- toques ---------- */
document.addEventListener('click', async e => {
  if (Date.now() - (S.longAt || 0) < 800 && !e.target.closest('#overlay .sheet')) return;   // o toque longo não abre o separador
  const g = e.target.closest('[data-go]');
  if (g) { go(g.dataset.go); return; }
  const b = e.target.closest('[data-act]');
  if (!b) { if (e.target === $('#overlay')) { S.overlay = null; S.delArmed = null; render(); } return; }
  const act = b.dataset.act;
  if (act !== 'zdel' && act !== 'signout' && act !== 'sremove') S.delArmed = null;
  switch (act) {
    case 'openUrl': {
      const u = b.dataset.url, k = window.ZoomCore.keyOf(u), open = S.tabs.find(t => t.url && window.ZoomCore.keyOf(t.url) === k);
      if (open) openTab(open.id); else newTab(u);
      break;
    }
    case 'openTab': openTab(+b.dataset.id); break;
    case 'closeTab': closeTab(+b.dataset.id); break;
    case 'newTab': S.view = 'home'; render(); setTimeout(() => { const q = $('#homeQ'); if (q) q.focus(); }, 50); break;
    case 'signin': Sync.signIn(); break;
    case 'signout': if (S.delArmed !== 'signout') { S.delArmed = 'signout'; render(); } else { S.delArmed = null; Sync.signOut(); } break;
    case 'syncNow': Sync.now(); break;
    case 'checkUpdate': checkUpdate(true); break;
    case 'update': if (S.update) ZN.call('openExternal', { url: S.update.url }); break;
    case 'zfilter': S.zoomFilter = b.dataset.f; render(); break;
    case 'zopen': S.zoomOpen = S.zoomOpen === b.dataset.id ? null : b.dataset.id; render(); break;
    case 'zdel': if (S.delArmed !== b.dataset.id) { S.delArmed = b.dataset.id; render(); setTimeout(() => { if (S.delArmed === b.dataset.id) { S.delArmed = null; render(); } }, 4000); } else { S.delArmed = null; zoom.remove(b.dataset.id); refreshPages(); } break;
    case 'zhldel': { const it = zoom.byId(b.dataset.id); if (it) { zoom.removeHighlight(it.url, b.dataset.h); refreshPages(); } break; }
    case 'hlClose': S.hl = false; render(); break;
    case 'hlColor': { const t = cur(); zoom.updateHighlight(t.url, b.dataset.h, { color: b.dataset.c }); refreshPages(); break; }
    case 'hlCopy': { const t = cur(), it = zoom.byUrl(t.url), h = it && it.highlights.find(x => x.id === b.dataset.h); if (h) { await ZN.call('copy', { text: `“${h.text}”${h.comment ? '\n— ' + h.comment : ''}\n${it.url}` }); toast('Destaque copiado'); } break; }
    case 'hlDel': { const t = cur(); zoom.removeHighlight(t.url, b.dataset.h); refreshPages(); break; }
    case 'hlCopyAll': { const t = cur(), it = zoom.byUrl(t.url); if (it) { await ZN.call('copy', { text: `${it.title}\n${it.url}\n\n` + it.highlights.map(h => `“${h.text}”${h.comment ? '\n— ' + h.comment : ''}`).join('\n\n') }); toast('Destaques copiados'); } break; }
    case 'scol': { const it = zoom.byUrl(cur().url); if (it) zoom.update(it.id, { col: b.dataset.c }); break; }
    case 'snewcol': { const name = prompt('Nome da coleção nova'); if (name) { const c = zoom.addCol(name); const it = zoom.byUrl(cur().url); if (c && it) zoom.update(it.id, { col: c.id }); } break; }
    case 'sclose': S.overlay = null; S.moveTab = null; render(); break;
    case 'space': S.space = b.dataset.s; render(); break;
    case 'spaceAdd': { const n = prompt('Nome do espaço novo'); if (n && n.trim()) { const x = { id: uid(), name: n.trim().slice(0, 40) }; S.spaces.push(x); S.space = x.id; saveTabs(); render(); } break; }
    case 'spaceEdit': {
      const x = S.spaces.find(y => y.id === S.space); if (!x) break;
      const n = prompt(`Novo nome para "${x.name}" (deixa vazio para apagar o espaço; os separadores passam para "${S.spaces.find(y => y.id !== x.id).name}")`, x.name);
      if (n === null) break;
      if (n.trim()) x.name = n.trim().slice(0, 40);
      else if (S.spaces.length > 1) { const to = S.spaces.find(y => y.id !== x.id).id; S.tabs.forEach(t => { if (t.space === x.id) t.space = to; }); S.spaces = S.spaces.filter(y => y.id !== x.id); S.space = to; }
      saveTabs(); render(); break;
    }
    case 'moveTo': { const t = S.tabs.find(x => x.id === S.moveTab); if (t) { t.space = b.dataset.s; toast('Movido para ' + spaceName(t.space)); } S.overlay = null; S.moveTab = null; saveTabs(); render(); break; }
    case 'moveNew': { const n = prompt('Nome do espaço novo'); const t = S.tabs.find(x => x.id === S.moveTab); if (n && n.trim() && t) { const x = { id: uid(), name: n.trim().slice(0, 40) }; S.spaces.push(x); t.space = x.id; toast('Movido para ' + x.name); } S.overlay = null; S.moveTab = null; saveTabs(); render(); break; }
    case 'rsize': S.reader.size = Math.max(14, Math.min(30, S.reader.size + (+b.dataset.d) * 2)); readerStyle(); render(); break;
    case 'rtheme': S.reader.theme = b.dataset.t; readerStyle(); render(); break;
    case 'rexit': { const t = cur(); S.overlay = null; if (t) { t.reader = false; ZN.call('tabDo', { id: t.id, what: 'reload' }); } render(); break; }
    case 'sremove': {
      if (S.delArmed !== 'save') { S.delArmed = 'save'; render(); break; }
      S.delArmed = null; const it = zoom.byUrl(cur().url); if (it) zoom.remove(it.id); S.overlay = null; refreshPages(); render(); toast('Tirado do Zoom'); break;
    }
  }
});
document.addEventListener('change', e => {
  const s = e.target.closest('[data-act="zcol"]');
  if (s) zoom.update(s.dataset.id, { col: s.value });
});
document.addEventListener('input', e => {
  if (e.target.id === 'zq') { S.zoomQ = e.target.value; clearTimeout(document.zqT); document.zqT = setTimeout(() => { const pos = e.target.selectionStart; render(true); const z = $('#zq'); if (z) { z.focus(); z.setSelectionRange(pos, pos); } }, 250); }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'homeSearch') { const v = $('#homeQ').value; if (v.trim()) newTab(v); }
  if (e.target.id === 'addrForm') {
    const v = $('#addr').value; $('#addr').blur();
    const t = cur();
    if (!v.trim()) return;
    if (S.view === 'tab' && t) { const u = toURL(v); t.url = u; ZN.call('tabNav', { id: t.id, url: u }); renderTop(); }
    else newTab(v);
  }
});
$('#addr').addEventListener('focus', () => { const t = cur(); if (S.view === 'tab' && t) $('#addr').value = t.url; setTimeout(() => $('#addr').select(), 30); });
$('#addr').addEventListener('blur', () => setTimeout(renderTop, 100));
$('#bBack').addEventListener('click', () => { const t = cur(); if (t) ZN.call('tabDo', { id: t.id, what: 'back' }); });
$('#bReload').addEventListener('click', () => { const t = cur(); if (t) ZN.call('tabDo', { id: t.id, what: t.loading ? 'stop' : 'reload' }); });
$('#bTabs').addEventListener('click', () => go('tabs'));
function readerStyle() { const t = cur(); saveTabs(); if (t && t.reader) ZN.call('reader', { id: t.id, opts: S.reader, styleOnly: true }).catch(() => {}); }
$('#bRead').addEventListener('click', async () => {
  const t = cur(); if (!t) return;
  if (t.reader) { S.overlay = 'reader'; render(); return; }
  const r = await ZN.call('reader', { id: t.id, opts: S.reader }).catch(() => 'none');
  if (r === 'ok') { t.reader = true; renderTop(); } else toast('Não encontrei um artigo para ler nesta página.');
});
$('#bHl').addEventListener('click', () => { S.hl = !S.hl; render(); });
$('#bbHl').addEventListener('click', () => { if (S.view !== 'tab' && cur()) { S.hl = true; go('tab'); } else if (cur()) { S.hl = !S.hl; render(); } else toast('Abre um artigo para ver os destaques.'); });
$('#bSave').addEventListener('click', async () => {
  const t = cur(); if (!t || !/^https?:/.test(t.url)) return;
  if (!zoom.byUrl(t.url)) {
    const m = await ZN.call('pageMeta', { id: t.id }).catch(() => null);
    zoom.add(Object.assign({}, m || {}, { url: t.url, title: (m && m.title) || t.title }));
    toast('Guardado no Zoom');
  }
  S.overlay = 'save'; render();
});

/* barra de baixo (ao alto): deslizar para o lado muda de separador; para cima abre os separadores */
(() => {
  let sx = 0, sy = 0, st = 0, moved = false;
  const bar = $('#bottom');
  bar.addEventListener('touchstart', e => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; st = Date.now(); moved = false; }, { passive: true });
  bar.addEventListener('touchmove', e => { const p = e.touches[0]; if (Math.abs(p.clientX - sx) > 24 || Math.abs(p.clientY - sy) > 24) moved = true; }, { passive: true });
  bar.addEventListener('touchend', e => {
    if (!moved) return;
    const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy;
    e.preventDefault();
    if (dy < -50 && Math.abs(dy) > Math.abs(dx)) { go('tabs'); return; }
    const list = spaceTabs();
    if (Math.abs(dx) > 60 && list.length) {
      const i = Math.max(0, list.findIndex(t => t.id === S.current));
      const j = dx < 0 ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      if (S.view !== 'tab' || j !== i) { openTab(list[j].id); toast(list[j].title || hostOf(list[j].url)); }
    }
  });
})();
/* cartões dos separadores: deslizar para o lado fecha */
(() => {
  let card = null, sx = 0, sy = 0, dx = 0, horiz = null;
  document.addEventListener('touchstart', e => { card = e.target.closest('.tcard'); if (!card) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; horiz = null; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!card) return;
    const p = e.touches[0]; dx = p.clientX - sx;
    if (horiz === null && (Math.abs(dx) > 12 || Math.abs(p.clientY - sy) > 12)) horiz = Math.abs(dx) > Math.abs(p.clientY - sy);
    if (horiz) { card.style.transition = 'none'; card.style.transform = `translateX(${dx}px)`; card.style.opacity = String(Math.max(.2, 1 - Math.abs(dx) / 300)); }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!card) return;
    const c = card; card = null;
    c.style.transition = '';
    if (horiz && Math.abs(dx) > 120) { c.style.transform = `translateX(${dx > 0 ? 600 : -600}px)`; c.style.opacity = '0'; setTimeout(() => closeTab(+c.dataset.tab), 150); }
    else { c.style.transform = ''; c.style.opacity = ''; }
  });
})();

/* toque longo num cartão de separador: mudar de espaço */
(() => {
  let lt = null, sx = 0, sy = 0;
  document.addEventListener('touchstart', e => {
    const c = e.target.closest('.tcard'); if (!c) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    clearTimeout(lt);
    lt = setTimeout(() => { S.longAt = Date.now(); S.moveTab = +c.dataset.tab; S.overlay = 'move'; render(); }, 550);
  }, { passive: true });
  document.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10) clearTimeout(lt); }, { passive: true });
  document.addEventListener('touchend', () => clearTimeout(lt));
  document.addEventListener('contextmenu', e => { if (e.target.closest('.tcard')) e.preventDefault(); });
})();

/* voltar atrás (botão do Android) */
function onBack() {
  if (S.overlay) { S.overlay = null; render(); return 'handled'; }
  if (document.activeElement && document.activeElement.tagName === 'INPUT') { document.activeElement.blur(); return 'handled'; }
  if (S.view === 'tab') {
    if (S.hl) { S.hl = false; render(); return 'handled'; }
    const t = cur();
    if (t && t.back) return 'page';
    go('home'); return 'handled';
  }
  if (S.view !== 'home') { go(cur() ? 'tab' : 'home'); return 'handled'; }
  return 'exit';
}

/* ---------- atualizações (versões android-v… no GitHub) ---------- */
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate(manual) {
  try {
    const rels = JSON.parse(await ZN.call('httpGet', { url: 'https://api.github.com/repos/jds-dev-gen/zeus/releases?per_page=30' }));
    const r = rels.find(x => /^android-v/.test(x.tag_name) && !x.draft);
    const v = r ? r.tag_name.replace(/^android-v/, '') : '';
    if (r && newer(v, S.version)) { const a = (r.assets || []).find(x => /\.apk$/.test(x.name)); S.update = { version: v, url: a ? a.browser_download_url : r.html_url }; }
    else S.update = null;
    if (manual) toast(S.update ? `Há uma versão nova: ${v}` : 'Tens a versão mais recente.');
    render();
  } catch (e) { if (manual) toast('Não consegui procurar atualizações.'); }
}

/* ---------- arranque ---------- */
(async () => {
  render();
  const info = await ZN.call('ready').catch(() => ({}));
  S.version = (info && info.version) || '';
  await loadZoom();
  await restoreTabs();
  await Sync.init();
  render();
  setTimeout(() => checkUpdate(false), 4000);
  setInterval(() => { const c = $('#clock'); if (c) c.textContent = fmtTime(new Date()); }, 15000);
})();

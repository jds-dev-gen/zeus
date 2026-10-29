(function () {
'use strict';
/* Zeus — interface. Fala com o processo principal através de window.zeus. */
const Z = window.zeus;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isMac = Z.platform === 'darwin';
document.documentElement.classList.add(isMac ? 'is-mac' : (Z.platform === 'win32' ? 'is-win' : 'is-linux'));
const KEY = isMac ? '⌥' : 'Alt';
const KEYNAME = isMac ? 'Option (⌥)' : 'Alt';
const NEWTAB = 'zeus://nova';

const ICON = {
  apolo: '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  wa: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12z"/><path d="M9 9.5c.3 2.4 2.2 4.4 4.6 4.9" stroke-linecap="round"/></svg>',
  mail: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6" stroke-linecap="round"/></svg>',
  pmail: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l9 6 9-6" stroke-linecap="round"/><rect x="3" y="5" width="18" height="14" rx="3"/><rect x="14.5" y="13.5" width="6" height="5" rx="1.2" fill="currentColor" stroke="none"/></svg>',
  notion: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/></svg>',
  pluto: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="10" ry="3.5" transform="rotate(-20 12 12)"/></svg>',
  work: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" stroke-linecap="round"/></svg>',
  globe: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/></svg>',
  star: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  mic: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  play: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  x: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  full: '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 15v5h-5"/></svg>',
  snd: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/></svg>',
  moon: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>`,
  drop: '<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5s-7 7.6-7 12.5a7 7 0 0 0 14 0c0-4.9-7-12.5-7-12.5z"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
  search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  sun: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  part: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="9" r="3"/><path d="M9 2.5v1.5M2.5 9H4M4.4 4.4l1 1M13.6 4.4l-1 1"/><path d="M9 19a3.5 3.5 0 0 1 .4-7 4.5 4.5 0 0 1 8.6 1.3A2.9 2.9 0 0 1 18 19z"/></svg>`,
  cloud: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M7 17a4 4 0 0 1 .5-8 5 5 0 0 1 9.6 1.5A3.3 3.3 0 0 1 17 17z"/></svg>`,
  fog: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 9h16M3 13h18M5 17h14"/></svg>`,
  rain: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 15a4 4 0 0 1 .5-8 5 5 0 0 1 9.6 1.5A3.3 3.3 0 0 1 17 15z"/><path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2"/></svg>`,
  snow: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 14a4 4 0 0 1 .5-8 5 5 0 0 1 9.6 1.5A3.3 3.3 0 0 1 17 14z"/><path d="M9 18h.01M13 18h.01M11 21h.01M15 21h.01"/></svg>`,
  storm: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 15a4 4 0 0 1 .5-8 5 5 0 0 1 9.6 1.5A3.3 3.3 0 0 1 17 15z"/><path d="M12 15l-2 4h3l-2 3"/></svg>`
};

let S = null;               // estado vindo do processo principal
const ov = { open: false, hold: false, sel: null, bg: '', thumbs: {}, addingSpace: false, renaming: null };
let modal = null;           // nome da janela aberta
let addrOpen = false;

const tabById = id => S && S.tabs.find(t => t.id === id);
const curTab = () => S && tabById(S.currentId);
const appById = id => S && S.apps.find(a => a.id === id);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const favHTML = (t, size) => t.favicon ? `<img src="${esc(t.favicon)}" alt="" width="${size || 14}" height="${size || 14}" data-fav>` : esc((t.title || hostOf(t.url) || '·').trim().charAt(0).toUpperCase());

document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.hasAttribute('data-fav')) t.remove(); }, true);

/* ------------------------------------------------------------------ */
/* Disposição: a interface diz ao processo principal onde pôr as páginas */
/* ------------------------------------------------------------------ */
function rectOf(el) {
  if (!el) return null;
  for (let n = el; n; n = n.parentElement) if (n.hidden) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}
let lastLayout = '';
function sendLayout() {
  const lay = { page: rectOf($('#pageSlot')), panel: rectOf($('#panelSlot')), claude: rectOf($('#claudeSlot')), overlay: ov.open || !!modal, cover: !!sendLayout.cover };
  const k = JSON.stringify(lay);
  if (k === lastLayout) return;
  lastLayout = k;
  Z.invoke('layout', lay);
}
const ro = new ResizeObserver(() => sendLayout());
['#pageSlot', '#panelSlot', '#claudeSlot'].forEach(s => ro.observe($(s)));
window.addEventListener('resize', sendLayout);

/* ------------------------------------------------------------------ */
/* Relógio                                                              */
/* ------------------------------------------------------------------ */
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const DABR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
function tick() {
  const d = new Date();
  document.querySelectorAll('[data-clock]').forEach(e => { e.textContent = hm(d); });
  document.querySelectorAll('[data-dshort]').forEach(e => { e.textContent = DABR[d.getDay()] + ', ' + d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3); });
  document.querySelectorAll('[data-dlong]').forEach(e => { e.textContent = DIAS[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()]; });
  document.querySelectorAll('[data-dnum]').forEach(e => { e.textContent = d.getDate(); });
  document.querySelectorAll('[data-dday]').forEach(e => { e.textContent = DABR[d.getDay()].toUpperCase(); });
}
setInterval(tick, 5000);

/* ------------------------------------------------------------------ */
/* Avisos                                                               */
/* ------------------------------------------------------------------ */
let toastT = null;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3200); }
Z.on('toast', toast);

/* ------------------------------------------------------------------ */
/* Tema                                                                 */
/* ------------------------------------------------------------------ */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = S ? S.settings.theme : 'dark';
  document.documentElement.setAttribute('data-zeus', t === 'system' ? (mq.matches ? 'dark' : 'light') : t);
}
mq.addEventListener('change', applyTheme);

/* ------------------------------------------------------------------ */
/* Desenho                                                              */
/* ------------------------------------------------------------------ */
Z.on('state', st => {
  S = st;
  applyTheme();
  renderRail(); renderTop(); renderPanels(); renderPage(); renderRight();
  if (ov.open) renderZones();
  if (modal === 'settings') refreshSettingsApps();
  requestAnimationFrame(sendLayout);
});

let railKey = '';
function renderRail() {
  const key = JSON.stringify([S.apps, S.openPanel, S.fullApp]);
  if (key === railKey) return;
  railKey = key;
  // em cima: hora e data (fixas); no meio: as apps (fazem scroll); em baixo: definições
  let h = `<div class="rail-head"><div class="clock" aria-label="Hora"><b data-clock></b><span data-dshort></span></div></div>`;
  h += '<div class="rail-apps" id="railApps">';
  S.apps.forEach((a, i) => {
    const on = S.openPanel === a.id || S.fullApp === a.id;
    let inner = a.icon === 'cal' ? '<span class="cal"><small data-dday></small><b data-dnum></b></span>'
      : (ICON[a.icon] && typeof ICON[a.icon] === 'string' ? ICON[a.icon] : `<span class="letter">${esc((a.name || '?').charAt(0).toUpperCase())}</span>`);
    const tag = '';
    const label = `${a.name}${a.badge ? ', ' + a.badge + ' por ler' : ''}${a.mode === 'full' ? ', abre em página inteira' : ''}`;
    h += `<div class="app-item ${a.id === 'apolo' ? 'apolo' : ''} ${on ? 'on' : ''}" data-appid="${esc(a.id)}"><button class="app-btn" type="button" data-app="${esc(a.id)}" aria-label="${esc(label)}" title="${esc(a.name)} — clique direito para opções">${inner}${tag}</button>${a.badge ? `<span class="badge">${a.badge > 99 ? '99+' : a.badge}</span>` : ''}<span class="lbl">${esc(a.name)}</span></div>`;
    if (i === 0) h += '<span class="rail-sep" aria-hidden="true"></span>';
  });
  h += `<div class="app-item"><button class="app-btn add" type="button" data-add-app aria-label="Juntar site como app ou extensão" title="Juntar">${ICON.plus}</button><span class="lbl">Juntar</span></div>`;
  h += '</div><div class="rail-foot">';
  h += `<button class="icon-btn" type="button" data-settings aria-label="Definições" title="Definições (⌘,)">${ICON.gear}</button></div>`;
  const keepScroll = $('#railApps') ? $('#railApps').scrollTop : 0;
  $('#rail').innerHTML = h;
  $('#railApps').scrollTop = keepScroll;
  tick();
}
$('#rail').addEventListener('click', e => {
  const b = e.target.closest('[data-app],[data-add-app],[data-settings]');
  if (!b) return;
  if (b.dataset.app) {
    const a = appById(b.dataset.app);
    if (a && !a.url) { if (ov.open) closeMosaic(); openSetupApp(a.id); return; }
    if (ov.open) {
      // no mosaico: fecha-o e mostra logo a app (se já estava aberta, fica aberta)
      closeMosaic();
      if (S.fullApp === b.dataset.app || S.openPanel === b.dataset.app) return;
    }
    Z.invoke('app:open', b.dataset.app);
  } else if (b.hasAttribute('data-add-app')) openAddApp();
  else openSettings();
});
/* Arrastar os ícones para mudar a ordem (com o rato, sem depender do arrastar do sistema) */
let railDrag = null, suppressClick = false;
const clearDrop = () => document.querySelectorAll('.app-item.drop-before,.app-item.drop-after,.app-item.dragging').forEach(x => x.classList.remove('drop-before', 'drop-after', 'dragging'));
function railTarget(y) {
  const items = [...document.querySelectorAll('.app-item[data-appid]')];
  for (const it of items) { const r = it.getBoundingClientRect(); if (y < r.top + r.height / 2) return { it, after: false }; }
  return items.length ? { it: items[items.length - 1], after: true } : null;
}
$('#rail').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const it = e.target.closest('.app-item[data-appid]'); if (!it) return;
  railDrag = { id: it.dataset.appid, el: it, y0: e.clientY, active: false, pid: e.pointerId };
});
window.addEventListener('pointermove', e => {
  if (!railDrag) return;
  if (!railDrag.active) {
    if (Math.abs(e.clientY - railDrag.y0) < 6) return;
    railDrag.active = true; railDrag.el.classList.add('dragging');
    try { $('#rail').setPointerCapture(railDrag.pid); } catch (_) { /* ok */ }
  }
  const t = railTarget(e.clientY);
  document.querySelectorAll('.app-item.drop-before,.app-item.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (t && t.it !== railDrag.el) t.it.classList.add(t.after ? 'drop-after' : 'drop-before');
});
window.addEventListener('pointerup', e => {
  if (!railDrag) return;
  const d = railDrag; railDrag = null;
  if (!d.active) return;
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
  const t = railTarget(e.clientY);
  clearDrop();
  if (!t || t.it === d.el) return;
  const ids = S.apps.map(a => a.id).filter(id => id !== d.id);
  let i = ids.indexOf(t.it.dataset.appid);
  if (i < 0) i = ids.length; else if (t.after) i += 1;
  ids.splice(i, 0, d.id);
  Z.invoke('app:reorder', ids);
});
$('#rail').addEventListener('click', e => { if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
$('#rail').addEventListener('dragstart', e => e.preventDefault());
$('#rail').addEventListener('contextmenu', e => {
  const b = e.target.closest('[data-app]');
  if (b) { e.preventDefault(); Z.invoke('app:menu', b.dataset.app); }
});

function renderTop() {
  const t = curTab();
  const full = S.fullApp && appById(S.fullApp);
  const onWeb = full ? true : (t && t.url !== NEWTAB && !t.error);
  $('#btnBack').disabled = !onWeb || !S.canGoBack;
  $('#btnFwd').disabled = !onWeb || !S.canGoForward;
  $('#btnReload').disabled = !(onWeb || (t && t.error));
  const away = full && S.fullAppURL && hostOf(S.fullAppURL) && hostOf(S.fullAppURL) !== hostOf(full.url) ? hostOf(S.fullAppURL) : '';
  $('#fullHome').hidden = !full || !away;
  $('#pipBtn').hidden = !!full || !(t && t.media);
  $('#shareBtn').disabled = full ? !/^https?:/.test(S.fullAppURL || '') : !(t && /^https?:/.test(t.url || ''));
  $('#fullBtns').hidden = !full;
  $('#claudeBtn').classList.toggle('on', S.claudeOpen);
  $('#mosaicBtn').classList.toggle('on', ov.open);
  $('#progress').hidden = !(t && t.loading && !full && t.url !== NEWTAB);
  const mode = S.settings.tabMode;
  const tb = $('#titleBtn');
  if (full) tb.innerHTML = `<span class="t">${esc(full.name)}</span><span class="dom">${away ? esc(away) : 'app'}</span>`;
  else if (t) tb.innerHTML = `${t.url !== NEWTAB && t.favicon ? `<img src="${esc(t.favicon)}" alt="" data-fav>` : ''}<span class="t">${esc(t.url === NEWTAB ? 'Página nova' : t.title)}</span><span class="dom">${t.url === NEWTAB ? '' : esc(hostOf(t.url))}${t.sessionLabel ? ' · sessão ' + esc(t.sessionLabel) : ''}</span>`;
  tb.hidden = addrOpen || mode === 'top';
  $('#topTabs').hidden = addrOpen || mode !== 'top';
  if (mode === 'top' && !addrOpen) renderTopTabs();
  document.title = full ? full.name + ' — Zeus' : (t && t.url !== NEWTAB ? t.title + ' — Zeus' : 'Zeus');
}

let topKey = '';
function renderTopTabs() {
  const t = curTab(); if (!t) return;
  const list = S.tabs.filter(x => x.space === t.space);
  const key = JSON.stringify([list.map(x => [x.id, x.title, x.favicon]), S.currentId]);
  if (key === topKey) return; topKey = key;
  $('#topTabs').innerHTML = list.map(x => `<div class="top-tab ${x.id === S.currentId ? 'on' : ''}" role="button" tabindex="0" data-open="${x.id}" title="${esc(x.title)}"><span class="fav">${favHTML(x)}</span><span>${esc(x.url === NEWTAB ? 'Página nova' : x.title)}</span><button class="x" type="button" data-close="${x.id}" aria-label="Fechar ${esc(x.title)}">${ICON.x}</button></div>`).join('')
    + `<button class="top-tab" type="button" data-newtab aria-label="Separador novo" style="min-width:0">${ICON.plus}</button>`;
}

let rightKey = '';
function renderRight() {
  const r = $('#right');
  r.hidden = S.settings.tabMode !== 'right';
  if (r.hidden) return;
  const key = JSON.stringify([S.tabs.map(x => [x.id, x.title, x.favicon, x.space]), S.currentId, S.spaces]);
  if (key === rightKey) return; rightKey = key;
  r.innerHTML = S.spaces.map(s => {
    const list = S.tabs.filter(t => t.space === s.id);
    if (!list.length) return '';
    return `<div style="display:flex;flex-direction:column;gap:2px"><span class="lbl-mono" style="padding:0 8px 6px">${esc(s.name)}</span>${list.map(t => `<div class="rt ${t.id === S.currentId ? 'on' : ''}" role="button" tabindex="0" data-open="${t.id}"><span class="fav">${favHTML(t)}</span><span class="t">${esc(t.url === NEWTAB ? 'Página nova' : t.title)}</span><button class="nb x" type="button" data-close="${t.id}" aria-label="Fechar">${ICON.x}</button></div>`).join('')}</div>`;
  }).join('') + `<button class="rt" type="button" data-newtab>${ICON.plus}<span class="t">Separador novo</span></button>`;
}

function onTabListClick(e) {
  const x = e.target.closest('[data-close]');
  if (x) { e.stopPropagation(); Z.invoke('tab:close', +x.dataset.close); return; }
  const o = e.target.closest('[data-open]');
  if (o) { Z.invoke('tab:open', +o.dataset.open); return; }
  if (e.target.closest('[data-newtab]')) Z.invoke('tab:new', {});
}
$('#topTabs').addEventListener('click', onTabListClick);
$('#right').addEventListener('click', onTabListClick);

function renderPanels() {
  const a = S.openPanel && appById(S.openPanel);
  const p = $('#panel');
  if (a) {
    p.hidden = false; $('#panelTitle').textContent = a.name;
    const html = a.error ? appErrorHTML(a) : (a.loaded ? '' : '<div class="slot-wait">A abrir…</div>');
    if ($('#panelSlot').dataset.k !== html) { $('#panelSlot').innerHTML = html; $('#panelSlot').dataset.k = html; }
  }
  else p.hidden = true;
  $('#claude').hidden = !S.claudeOpen;
  if (!resizing) {
    $('#panel').style.width = (S.settings.panelWidth || 420) + 'px';
    $('#claude').style.width = (S.settings.claudeWidth || 420) + 'px';
  }
}

/* Arrastar a margem dos painéis para mudar a largura */
let resizing = false;
function makeResizer(handle, panel, side, key) {
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    resizing = true; handle.classList.add('drag'); document.body.classList.add('resizing');
    const startX = e.clientX, startW = panel.getBoundingClientRect().width;
    const move = ev => {
      let w = side === 'right' ? startW + (ev.clientX - startX) : startW - (ev.clientX - startX);
      const max = Math.max(320, window.innerWidth - 84 - 380);
      w = Math.max(300, Math.min(max, w));
      panel.style.width = Math.round(w) + 'px';
      sendLayout();
    };
    const up = ev => {
      try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* ok */ }
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      resizing = false; handle.classList.remove('drag'); document.body.classList.remove('resizing');
      Z.invoke('settings:set', { [key]: Math.round(panel.getBoundingClientRect().width) });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => { panel.style.width = '420px'; sendLayout(); Z.invoke('settings:set', { [key]: 420 }); });
}
makeResizer($('#panelResizer'), $('#panel'), 'right', 'panelWidth');
makeResizer($('#claudeResizer'), $('#claude'), 'left', 'claudeWidth');

/* ------------------------------------------------------------------ */
/* Página: página nova, erro                                            */
/* ------------------------------------------------------------------ */
let pageKey = '';
function renderPage() {
  const t = curTab();
  const slot = $('#pageSlot');
  let key;
  const fa = S.fullApp && appById(S.fullApp);
  if (fa && fa.error) key = 'apperr:' + fa.id + ':' + fa.error.code;
  else if (S.fullApp) key = 'app';
  else if (!t) key = 'none';
  else if (t.url === NEWTAB) key = 'newtab:' + t.id;
  else if (t.error) key = 'error:' + t.id + ':' + t.error.code + ':' + t.error.url;
  else key = 'web';
  if (key !== pageKey) {
    pageKey = key;
    if (key.startsWith('newtab')) { slot.innerHTML = newtabHTML(); mountNewtab(); }
    else if (key.startsWith('error')) slot.innerHTML = errorHTML(t);
    else if (key.startsWith('apperr')) slot.innerHTML = appErrorHTML(fa);
    else slot.innerHTML = '';
  } else if (key.startsWith('newtab')) fillNewtabLists();
}

function errorHTML(t) {
  const e = t.error; const c = e.code;
  let title = 'Não foi possível abrir esta página';
  let why = e.desc || '';
  if (c === 'crash') { title = 'Esta página deixou de responder'; why = 'Recarrega para tentar de novo.'; }
  else if (c === -105 || c === -137) why = 'O endereço não existe ou não há ligação à internet.';
  else if (c === -106) why = 'O computador está sem ligação à internet.';
  else if (c === -102 || c === -118 || c === -7) why = 'O site não respondeu. Pode estar em baixo.';
  else if (c <= -200 && c > -300) { title = 'Ligação bloqueada'; why = 'O certificado de segurança deste site não é válido, por isso o Zeus bloqueou a ligação para te proteger.'; }
  return `<div class="state-page"><h1>${esc(title)}</h1><p>${esc(why)}</p><p><code>${esc(e.url || t.url)}</code></p><div class="row-btns"><button class="btn" type="button" data-nav="retry">Tentar de novo</button><button class="btn ghost" type="button" data-nav="back">Voltar</button></div></div>`;
}

function appErrorHTML(a) {
  const off = a.error.code === -106 || a.error.code === -105;
  return `<div class="state-page" style="padding-top:64px"><h1>Não foi possível abrir ${esc(a.name)}</h1><p>${off ? 'Verifica a ligação à internet.' : esc(a.error.desc || 'O site não respondeu.')}</p><div class="row-btns"><button class="btn" type="button" data-appretry="${esc(a.id)}">Tentar de novo</button><button class="btn ghost" type="button" data-appedit="${esc(a.id)}">Mudar o endereço</button></div></div>`;
}
document.addEventListener('click', e => {
  const r = e.target.closest('[data-appretry]'); if (r) { Z.invoke('app:reload', r.dataset.appretry); return; }
  const ed = e.target.closest('[data-appedit]'); if (ed) openEditApp(ed.dataset.appedit);
});
const DEFAULT_SITES = [
  { url: 'https://observador.pt/', title: 'Observador' },
  { url: 'https://www.youtube.com/', title: 'YouTube' },
  { url: 'https://elevenlabs.io/', title: 'ElevenLabs' },
  { url: 'https://app.netlify.com/', title: 'Netlify' },
  { url: 'https://github.com/', title: 'GitHub' },
  { url: 'https://drive.proton.me/', title: 'Proton Drive' }
];
function newtabHTML() {
  return `<div class="nt">
    <div class="nt-head"><div><div class="nt-time" data-clock></div><div class="nt-date" data-dlong></div></div><div class="wx" id="wxNow"></div></div>
    <div id="wxFc"></div>
    <form class="ask" id="askForm" autocomplete="off">
      <div class="seg" id="askSeg"><button type="button" class="on" data-mode="web">Web</button><button type="button" data-mode="claude">Claude</button></div>
      <input id="askInput" type="text" placeholder="Pesquisar na web ou escrever um endereço" aria-label="Pesquisa ou endereço" spellcheck="false">
      <button class="go" type="submit" aria-label="Ir">${ICON.arrow}</button>
      <div class="sugg" id="askSugg" role="listbox" aria-label="Sugestões" hidden></div>
    </form>
    <div class="section"><span class="lbl-mono">Atalhos</span><div class="shorts" id="shorts"></div></div>
    <div class="section" id="contSec"><span class="lbl-mono">Continuar onde ficaste</span><div class="cont" id="cont"></div></div>
  </div>`;
}
function mountNewtab() {
  tick();
  fillNewtabLists();
  loadWeather();
  const input = $('#askInput');
  if (input && !ov.open && !modal) setTimeout(() => input.focus(), 30);
}
let ntKey = '';
function fillNewtabLists() {
  const shorts = $('#shorts'); if (!shorts) return;
  const key = JSON.stringify([S.topSites, S.later.slice(0, 6), S.closed.slice(0, 4)]);
  if (key === ntKey && shorts.childElementCount) return; ntKey = key;
  const seen = new Set(); const list = [];
  [...(S.topSites || []), ...DEFAULT_SITES].forEach(s => { const h = hostOf(s.url); if (h && !seen.has(h) && list.length < 6) { seen.add(h); list.push(s); } });
  shorts.innerHTML = list.map(s => `<button class="short" type="button" data-go="${esc(s.url)}" title="${esc(s.url)}"><span>${esc((s.title || hostOf(s.url)).charAt(0).toUpperCase())}</span><em>${esc(s.title || hostOf(s.url))}</em></button>`).join('');
  const items = [...S.later.slice(0, 6).map((x, i) => ({ x, i, list: 'later' })), ...S.closed.slice(0, 4).map((x, i) => ({ x, i, list: 'closed' }))];
  $('#contSec').hidden = !items.length;
  $('#cont').innerHTML = items.map(it => `<button class="chip" type="button" data-restore="${it.list}:${it.i}" title="${esc(it.x.url)}">${it.list === 'later' ? '' : '↺ '}${esc(it.x.title || hostOf(it.x.url))}</button>`).join('');
}
$('#pageSlot').addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]'); if (nav) { Z.invoke('nav', nav.dataset.nav); return; }
  const go = e.target.closest('[data-go]'); if (go) { Z.invoke('navigate', go.dataset.go); return; }
  const r = e.target.closest('[data-restore]'); if (r) { const [l, i] = r.dataset.restore.split(':'); Z.invoke('tab:restore', l, +i); return; }
  const seg = e.target.closest('#askSeg button');
  if (seg) {
    $('#askSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === seg));
    $('#askInput').placeholder = seg.dataset.mode === 'claude' ? 'Pergunta ao Claude' : 'Pesquisar na web ou escrever um endereço';
    $('#askInput').focus(); return;
  }
  if (e.target.closest('[data-city]')) openCity();
});
// roda do rato na barra hora a hora: desliza na horizontal
$('#pageSlot').addEventListener('wheel', e => {
  const h = e.target.closest('.hourly'); if (!h || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault(); h.scrollLeft += e.deltaY;
}, { passive: false });
$('#pageSlot').addEventListener('input', e => { if (e.target.id === 'askInput') suggInput(e, e.target, $('#askSugg')); });
$('#pageSlot').addEventListener('keydown', e => { if (e.target.id === 'askInput' && suggKey(e, e.target)) e.stopPropagation(); }, true);
$('#pageSlot').addEventListener('focusout', e => { if (e.target.id === 'askInput' && sug.input === e.target) closeSugg(); });
$('#pageSlot').addEventListener('submit', e => {
  if (e.target.id !== 'askForm') return;
  e.preventDefault();
  if (sug.open) { pickSugg(sug.sel); return; }
  const v = $('#askInput').value.trim(); if (!v) return;
  const claude = $('#askSeg .on') && $('#askSeg .on').dataset.mode === 'claude';
  if (claude) { Z.invoke('claude:ask', v); $('#askInput').value = ''; }
  else Z.invoke('navigate', v);
});

/* Meteorologia (Open-Meteo, sem chave nem registo) */
const WX = c => {
  if (c === 0) return ['Céu limpo', 'sun'];
  if (c === 1 || c === 2) return ['Pouco nublado', 'part'];
  if (c === 3) return ['Nublado', 'cloud'];
  if (c === 45 || c === 48) return ['Nevoeiro', 'fog'];
  if (c >= 51 && c <= 57) return ['Chuvisco', 'rain'];
  if (c >= 61 && c <= 67) return ['Chuva', 'rain'];
  if (c >= 71 && c <= 77) return ['Neve', 'snow'];
  if (c >= 80 && c <= 82) return ['Aguaceiros', 'rain'];
  if (c === 85 || c === 86) return ['Aguaceiros de neve', 'snow'];
  if (c >= 95) return ['Trovoada', 'storm'];
  return ['—', 'cloud'];
};
async function loadWeather() {
  const city = S.settings.city || { name: 'Lisboa', lat: 38.7223, lon: -9.1393 };
  const ck = 'wx2:' + city.lat + ',' + city.lon;
  let data = null;
  try { const c = JSON.parse(localStorage.getItem(ck) || 'null'); if (c && Date.now() - c.t < 30 * 60 * 1000) data = c.d; } catch (e) { /* sem cache */ }
  if (!data) {
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code,is_day`
        + `&hourly=temperature_2m,weather_code,precipitation_probability,is_day`
        + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=6`;
      const r = await fetch(u); if (!r.ok) throw new Error(r.status);
      data = await r.json();
      try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: data })); } catch (e) { /* ok */ }
    } catch (e) { data = null; }
  }
  const now = $('#wxNow'), fc = $('#wxFc'); if (!now || !fc) return;
  if (!data || !data.current) {
    now.innerHTML = `<div><span>Meteorologia indisponível · <button class="wx-city" type="button" data-city>${esc(city.name)}</button></span></div>`;
    fc.innerHTML = ''; return;
  }
  const icFor = (code, day) => { const [, ic] = WX(code); return ic === 'sun' && day === 0 ? 'moon' : ic; };
  const [desc] = WX(data.current.weather_code);
  const d = data.daily;
  const rainToday = d.precipitation_probability_max ? d.precipitation_probability_max[0] : null;
  const today = d.temperature_2m_max ? `<span class="wx-today">Hoje: máx. ${Math.round(d.temperature_2m_max[0])}° · mín. ${Math.round(d.temperature_2m_min[0])}°${rainToday != null ? ` · chuva ${rainToday}%` : ''}</span>` : '';
  now.innerHTML = `${ICON[icFor(data.current.weather_code, data.current.is_day)](40)}<div><b>${Math.round(data.current.temperature_2m)}°</b><span><button class="wx-city" type="button" data-city title="Mudar de cidade">${esc(city.name)}</button> · ${esc(desc)}</span>${today}</div>`;
  let h = '<div class="fc">';
  // hoje em destaque (primeira coluna), seguido dos 5 dias seguintes
  for (let i = 0; i <= 5 && i < d.time.length; i++) {
    const day = new Date(d.time[i] + 'T12:00:00');
    const lab = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : DABR[day.getDay()].charAt(0).toUpperCase() + DABR[day.getDay()].slice(1);
    const [, ic2] = WX(d.weather_code[i]);
    h += `<div><span>${lab}</span>${ICON[ic2](20)}<span>${Math.round(d.temperature_2m_max[i])}° <em>${Math.round(d.temperature_2m_min[i])}°</em></span></div>`;
  }
  h += '</div>';
  // hora a hora: do momento atual até ao fim do dia (pelo menos 8 horas)
  const H = data.hourly;
  if (H && H.time) {
    const nowIso = (data.current.time || '').slice(0, 13);
    let start = H.time.findIndex(t => t.slice(0, 13) === nowIso); if (start < 0) start = 0;
    const todayDate = H.time[start].slice(0, 10);
    let end = start; while (end < H.time.length && H.time[end].slice(0, 10) === todayDate) end++;
    end = Math.min(H.time.length, Math.max(end, start + 8));
    let row = '';
    for (let i = start; i < end; i++) {
      const p = H.precipitation_probability ? H.precipitation_probability[i] : null;
      const hour = H.time[i].slice(11, 13) + 'h';
      row += `<div class="${i === start ? 'now' : ''}" title="${hour}: ${Math.round(H.temperature_2m[i])}°, ${esc(WX(H.weather_code[i])[0])}${p != null ? ', ' + p + '% de probabilidade de chuva' : ''}"><span class="h">${i === start ? 'Agora' : hour}</span>${ICON[icFor(H.weather_code[i], H.is_day ? H.is_day[i] : 1)](20)}<span>${Math.round(H.temperature_2m[i])}°</span>${p != null ? `<span class="p ${p >= 40 ? 'wet' : ''}">${ICON.drop}${p}%</span><span class="bar"><i style="width:${p}%"></i></span>` : ''}</div>`;
    }
    h += `<div class="hourly" aria-label="Previsão hora a hora">${row}</div>`;
  }
  fc.innerHTML = h;
}

/* ------------------------------------------------------------------ */
/* Faixa de cima: navegação, endereço, procurar                         */
/* ------------------------------------------------------------------ */
$('#btnBack').addEventListener('click', () => Z.invoke('nav', 'back'));
$('#fullHome').addEventListener('click', () => Z.invoke('nav', 'apphome'));
$('#btnHome').addEventListener('click', () => { goHomeUI(); Z.invoke('nav', 'home'); });
// casa: fecha o que estiver por cima (mosaico/espaços, menus, janelas) e mostra a página principal
function goHomeUI() {
  if (ov.open) closeMosaic();
  if (shareOpen) closeShare();
  if (addrOpen) closeAddr();
  if (modal) closeModal();
  setTimeout(() => { const i = $('#askInput'); if (i) { i.focus(); i.select(); } }, 80);
}
$('#pipBtn').addEventListener('click', () => Z.invoke('pip:toggle'));
$('#shareBtn').addEventListener('click', () => { shareOpen ? closeShare() : openShare(); });
$('#btnFwd').addEventListener('click', () => Z.invoke('nav', 'forward'));
$('#btnReload').addEventListener('click', () => { const t = curTab(); Z.invoke('nav', t && t.error ? 'retry' : 'reload'); });
$('#titleBtn').addEventListener('click', openAddr);
$('#claudeBtn').addEventListener('click', () => Z.invoke('claude:toggle'));
$('#mosaicBtn').addEventListener('click', () => { ov.open ? closeMosaic() : openMosaic(false); });
$('#fullSide').addEventListener('click', () => S.fullApp && Z.invoke('app:mode', S.fullApp, 'side'));
$('#fullClose').addEventListener('click', () => S.fullApp && Z.invoke('app:open', S.fullApp));
$('#panelFull').addEventListener('click', () => { if (S.openPanel) { Z.invoke('app:mode', S.openPanel, 'full'); toast('Esta app passa a abrir em página inteira'); } });
$('#panelReload').addEventListener('click', () => S.openPanel && Z.invoke('app:reload', S.openPanel));
$('#panelClose').addEventListener('click', () => S.openPanel && Z.invoke('app:open', S.openPanel));
$('#claudeSend').addEventListener('click', () => Z.invoke('claude:sendPage'));
$('#claudeNew').addEventListener('click', () => Z.invoke('claude:new'));
$('#claudeClose').addEventListener('click', () => Z.invoke('claude:toggle', false));

function openAddr() {
  const t = curTab();
  if (!S.fullApp && t && t.url === NEWTAB && $('#askInput')) { $('#askInput').focus(); return; }
  addrOpen = true;
  const a = $('#addr');
  a.value = S.fullApp ? (S.fullAppURL || '') : (t && t.url !== NEWTAB ? t.url : '');
  renderTop(); a.hidden = false; a.focus(); a.select();
  // imagem da página por baixo das sugestões (as páginas web ficam sempre por cima da interface)
  coverShot = null;
  Z.invoke('page:snapshot').then(img => { coverShot = img || ''; if (sug.open) showCover(true); });
}
function closeAddr() { addrOpen = false; $('#addr').hidden = true; closeSugg(); renderTop(); }
$('#addr').addEventListener('keydown', e => {
  if (suggKey(e, $('#addr'))) return;
  if (e.key === 'Enter') { const v = e.target.value.trim(); closeAddr(); if (v) Z.invoke('navigate', v); }
  if (e.key === 'Escape') { closeAddr(); Z.invoke('ui:focusPage'); }
});
$('#addr').addEventListener('blur', () => { if (addrOpen) closeAddr(); });
$('#addr').addEventListener('input', e => suggInput(e, $('#addr'), $('#addrSugg')));

/* Partilhar: menu próprio com as apps da barra (Gmail, Proton Mail, WhatsApp…) e outras opções */
let shareOpen = false;
const SHARE_IC = {
  mail: () => ICON.mail, pmail: () => ICON.pmail, wa: () => ICON.wa,
  claude: () => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M5.6 18.4l3.2-3.2M15.2 8.8l3.2-3.2"/></svg>',
  send: () => '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="m10 13 4.5-4.5" stroke-linecap="round"/></svg>',
  in: () => '<span class="lt">in</span>', x2: () => '<span class="lt">X</span>', sky: () => '<span class="lt">B</span>', fb: () => '<span class="lt">f</span>'
};
async function openShare() {
  if (shareOpen) return;
  const info = await Z.invoke('share:info');
  if (!info) { toast('Abre uma página para a partilhares.'); return; }
  if (addrOpen) closeAddr();
  shareOpen = true;
  const pop = $('#sharePop');
  pop.innerHTML = `<div class="sp-head"><b>${esc(info.title)}</b><span>${esc(info.url.replace(/^https?:\/\/(www\.)?/, ''))}</span></div>
    <div class="sp-grid">${info.targets.map(t => `<button type="button" data-share="${esc(t.id)}" title="${esc(t.label)} · ${esc(t.sub)}"><span class="sp-ic">${(SHARE_IC[t.icon] || SHARE_IC.send)()}</span><span class="sp-l">${esc(t.label)}</span></button>`).join('')}</div>
    <div class="sp-list">
      <button type="button" data-share="copy">${ICON.link}<span>Copiar endereço</span></button>
      <button type="button" data-share="copyboth">${ICON.link}<span>Copiar título e endereço</span></button>
      ${info.mac ? `<button type="button" data-share="native">${ICON.plus}<span>Mais opções do Mac (AirDrop, Mensagens, Notas…)</span></button>` : ''}
      <button type="button" data-share="browser">${ICON.search}<span>Abrir no browser do sistema</span></button>
    </div>`;
  pop.hidden = false;
  // à direita, alinhado com o botão, sem passar por cima do painel do Claude
  const b = $('#shareBtn').getBoundingClientRect(), page = $('#pageSlot').getBoundingClientRect();
  const w = pop.offsetWidth;
  let left = Math.min(b.right, page.right - 8) - w; left = Math.max(page.left + 8, left);
  pop.style.left = left + 'px';
  coverShot = null;
  showCover(true);
  Z.invoke('page:snapshot').then(img => { coverShot = img || ''; if (shareOpen) showCover(true); });
}
function closeShare() {
  if (!shareOpen) return;
  shareOpen = false; $('#sharePop').hidden = true; $('#sharePop').innerHTML = '';
  showCover(false);
}
$('#sharePop').addEventListener('click', e => {
  const b = e.target.closest('[data-share]'); if (!b) return;
  const id = b.dataset.share;
  const r = $('#shareBtn').getBoundingClientRect();
  closeShare();
  Z.invoke('share:do', id, { x: r.left, y: r.bottom + 4 });
});
document.addEventListener('mousedown', e => { if (shareOpen && !e.target.closest('#sharePop') && !e.target.closest('#shareBtn')) closeShare(); });
document.addEventListener('keydown', e => { if (shareOpen && e.key === 'Escape') { e.preventDefault(); closeShare(); Z.invoke('ui:focusPage'); } });

/* Sugestões de endereços já visitados (campo de endereço e pesquisa da página nova) */
const sug = { open: false, list: [], sel: -1, input: null, box: null, typed: '', seq: 0 };
let coverShot = null;
function showCover(on) {
  on = on || shareOpen;
  const slot = $('#pageSlot'); let img = $('#coverImg');
  if (on && coverShot) {
    if (!img) { img = document.createElement('img'); img.id = 'coverImg'; img.className = 'cover'; img.alt = ''; slot.appendChild(img); }
    img.src = coverShot;
  } else if (img) img.remove();
  const cover = on && (shareOpen || sug.input === $('#addr')) && coverShot !== null;
  if (cover !== sendLayout.cover) { sendLayout.cover = cover; lastLayout = ''; sendLayout(); }
}
function closeSugg() {
  sug.open = false; sug.list = []; sug.sel = -1;
  if (sug.box) { sug.box.hidden = true; sug.box.innerHTML = ''; }
  showCover(false);
}
async function suggInput(e, input, box) {
  sug.input = input; sug.box = box;
  const v = input.value;
  const typed = input.selectionStart === v.length ? v : v.slice(0, input.selectionStart);
  sug.typed = typed;
  const q = typed.trim();
  if (!q || (input.id === 'askInput' && $('#askSeg .on') && $('#askSeg .on').dataset.mode === 'claude')) { closeSugg(); return; }
  const seq = ++sug.seq;
  const list = await Z.invoke('history:suggest', q);
  if (seq !== sug.seq || document.activeElement !== input) return;
  sug.list = list || []; sug.sel = -1;
  // completar o endereço enquanto se escreve ("obs" → "observador.pt"), exceto quando se está a apagar
  const deleting = e && e.inputType && e.inputType.startsWith('delete');
  const first = sug.list[0];
  if (first && !deleting && !/\s/.test(q)) {
    const b = first.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    if (b.toLowerCase().startsWith(q.toLowerCase()) && b.length > q.length) {
      input.value = q + b.slice(q.length);
      input.setSelectionRange(q.length, input.value.length);
      sug.sel = 0;
    }
  }
  renderSugg();
}
function renderSugg() {
  const box = sug.box; if (!box) return;
  if (!sug.list.length) { closeSugg(); return; }
  const q = sug.typed.trim();
  const looksURL = /^[^\s]+\.[a-z]{2,}/i.test(q) || /^https?:/i.test(q);
  const head = `<button type="button" data-sg="-1" class="${sug.sel === -1 ? 'sel' : ''}"><span class="ic">${looksURL ? ICON.link : ICON.search}</span><span class="u">${esc(q)}</span><span class="ti">${looksURL ? 'abrir este endereço' : 'pesquisar na web'}</span></button>`;
  box.innerHTML = head + sug.list.map((x, i) => `<button type="button" data-sg="${i}" class="${i === sug.sel ? 'sel' : ''}" title="${esc(x.url)}"><span class="ic">${ICON.link}</span><span class="u">${esc(x.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span><span class="ti">${esc(x.title || '')}</span></button>`).join('');
  box.hidden = false; sug.open = true;
  showCover(true);
}
function pickSugg(i) {
  const input = sug.input; const x = sug.list[i];
  const v = x ? x.url : sug.typed.trim();
  closeSugg();
  if (input === $('#addr')) { closeAddr(); if (v) Z.invoke('navigate', v); }
  else if (v) Z.invoke('navigate', v);
}
// devolve true se a tecla foi tratada pelas sugestões
function suggKey(e, input) {
  if (!sug.open || sug.input !== input) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = sug.list.length;
    sug.sel = e.key === 'ArrowDown' ? Math.min(n - 1, sug.sel + 1) : Math.max(-1, sug.sel - 1);
    const x = sug.list[sug.sel];
    input.value = x ? x.url : sug.typed;
    renderSugg(); return true;
  }
  if (e.key === 'Enter') { e.preventDefault(); pickSugg(sug.sel); return true; }
  if (e.key === 'Escape') { e.preventDefault(); input.value = sug.typed; closeSugg(); return true; }
  return false;
}
document.addEventListener('mousedown', e => {
  const b = e.target.closest('[data-sg]');
  if (b) { e.preventDefault(); pickSugg(+b.dataset.sg); }
}, true);

function openFind() { $('#findbox').hidden = false; const i = $('#findInput'); i.focus(); i.select(); }
function closeFind() { $('#findbox').hidden = true; $('#findCount').textContent = ''; Z.invoke('find', ''); Z.invoke('ui:focusPage'); }
$('#findInput').addEventListener('input', e => { const q = e.target.value; if (q) Z.invoke('find', q, { findNext: false }); else { Z.invoke('find', ''); $('#findCount').textContent = ''; } });
$('#findInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value) Z.invoke('find', e.target.value, { findNext: true, forward: !e.shiftKey });
  if (e.key === 'Escape') closeFind();
});
$('#findClose').addEventListener('click', closeFind);
Z.on('find-result', r => { $('#findCount').textContent = r.total ? `${r.active}/${r.total}` : '0'; });

Z.on('ui-command', c => {
  if (c.cmd === 'settings') openSettings();
  if (c.cmd === 'address') openAddr();
  if (c.cmd === 'find') openFind();
  if (c.cmd === 'mosaic') ov.open ? closeMosaic() : openMosaic(false);
  if (c.cmd === 'edit-app') openEditApp(c.id);
  if (c.cmd === 'share') { shareOpen ? closeShare() : openShare(); }
  if (c.cmd === 'focus-ask' || c.cmd === 'home') goHomeUI();
});

/* ------------------------------------------------------------------ */
/* Mosaico de separadores                                               */
/* ------------------------------------------------------------------ */
async function openMosaic(hold) {
  if (ov.open || modal || !S) return;
  ov.open = true; ov.hold = hold; ov.addingSpace = false; ov.renaming = null;
  ov.sel = S.mru.find(x => x !== S.currentId && tabById(x)) || S.currentId;
  $('#mfilter').value = ''; $('#msugg').hidden = true; $('#msugg').innerHTML = ''; msug.list = [];
  let prep = { bg: '', thumbs: {} };
  try { prep = await Z.invoke('mosaic:prepare'); } catch (e) { /* sem miniaturas */ }
  if (!ov.open) return;
  ov.bg = prep.bg; ov.thumbs = prep.thumbs || {};
  const bg = $('#mosaicBg');
  if (ov.bg) bg.src = ov.bg; else bg.removeAttribute('src');
  $('#mosaic').hidden = false;
  $('#pageSlot').style.visibility = 'hidden';
  $('#mosaicBtn').classList.add('on');
  renderZones(); renderKeys();
  sendLayout();
  if (hold) $('.m-inner').focus(); else $('#mfilter').focus();
}
$('.m-inner').tabIndex = -1;
function closeMosaic() {
  if (!ov.open) return;
  ov.open = false; ov.hold = false;
  $('#mosaic').hidden = true;
  $('#pageSlot').style.visibility = '';
  $('#mosaicBtn').classList.remove('on');
  sendLayout();
}
async function openSel(id) {
  ov.open = false; ov.hold = false;
  $('#mosaic').hidden = true; $('#pageSlot').style.visibility = ''; $('#mosaicBtn').classList.remove('on');
  await Z.invoke('tab:open', id);
  sendLayout();
}
const filterText = () => $('#mfilter').value.trim().toLowerCase();
const matches = (t, f) => !f || (t.title || '').toLowerCase().includes(f) || (t.url || '').toLowerCase().includes(f);
function visible() {
  const f = filterText(); const out = [];
  S.spaces.forEach(s => S.tabs.forEach(t => { if (t.space === s.id && matches(t, f)) out.push(t); }));
  return out;
}
function thumbHTML(t) {
  if (t.url === NEWTAB) return '<div class="ph newt" data-clock></div>';
  const img = ov.thumbs[t.id];
  if (img) return `<img class="shot" src="${img}" alt="">`;
  return `<div class="ph"><span>${t.favicon ? `<img src="${esc(t.favicon)}" alt="" data-fav>` : esc((t.title || hostOf(t.url) || '·').charAt(0).toUpperCase())}</span></div>`;
}
function renderZones() {
  const f = filterText();
  const vis = visible();
  if (!vis.find(t => t.id === ov.sel)) ov.sel = vis[0] && vis[0].id;
  let n = 0;
  let html = S.spaces.map(s => {
    const list = S.tabs.filter(t => t.space === s.id && matches(t, f));
    if (!list.length && f) return '';
    const basis = Math.max(1, list.length + (f ? 0 : 1));
    const cards = list.map(t => {
      n++;
      const isCur = t.id === S.currentId;
      return `<div class="card ${isCur ? 'cur' : ''} ${t.id === ov.sel ? 'sel' : ''}" role="button" tabindex="-1" data-card="${t.id}" title="${esc(t.url === NEWTAB ? 'Página nova' : t.url)}">
        <div class="thumb">${thumbHTML(t)}${isCur ? '<span class="num"><span class="now">Atual</span></span>' : ''}${t.audible ? `<span class="snd">${ICON.snd}a tocar</span>` : ''}<button class="cx" type="button" data-cx="${t.id}" aria-label="Fechar">${ICON.x}</button></div>
        <div class="cap"><span class="fav">${favHTML(t)}</span><span class="ttl">${esc(t.url === NEWTAB ? 'Página nova' : t.title)}</span>${t.sessionLabel ? `<span class="sess" title="Sessão de ${esc(t.sessionLabel)}">${esc(t.sessionLabel)}</span>` : ''}</div></div>`;
    }).join('');
    const head = ov.renaming === s.id
      ? `<input id="renameInput" value="${esc(s.name)}" aria-label="Nome do espaço">`
      : `<span data-rename="${s.id}" title="Duplo clique para mudar o nome">${esc(s.name)}</span><em>· ${list.length}</em>${S.spaces.length < 2 ? '' : ov.confirmRm === s.id
        ? `<span class="zconf">${S.tabs.filter(t => t.space === s.id).length} separador(es) passam para “${esc((S.spaces.find(x => x.id !== s.id) || {}).name || '')}”<button type="button" class="danger" data-rmspace-ok="${s.id}">Apagar</button><button type="button" data-rmspace-no>Cancelar</button></span>`
        : `<button class="zx" type="button" data-rmspace="${s.id}" aria-label="Apagar o espaço ${esc(s.name)}" title="Apagar o espaço">${ICON.x}</button>`}`;
    const isCurZone = curTab() && curTab().space === s.id;
    return `<section class="zone ${isCurZone ? 'cur' : ''}" data-zone="${s.id}" style="flex:1 1 240px"><div class="zone-h"><i></i>${head}</div><div class="grid">${cards}${f ? '' : `<button class="card newc" type="button" data-newin="${s.id}">${ICON.plus}Separador neste espaço</button>`}</div></section>`;
  }).join('');
  if (ov.addingSpace) html += `<section class="zone" style="flex:1 1 230px"><div class="zone-h"><i></i><input id="spaceInput" placeholder="Nome do espaço" aria-label="Nome do espaço novo"></div></section>`;
  $('#zones').innerHTML = html || `<div class="empty">Nenhum separador com “${esc($('#mfilter').value.trim())}”. Carrega em Enter para o abrir como endereço ou pesquisa.</div>`;
  $('#mcount').textContent = S.tabs.length + (S.tabs.length === 1 ? ' aberto' : ' abertos');
  $('#shelf').innerHTML = `<div><span class="lbl-mono">Mais tarde</span>${S.later.length ? S.later.slice(0, 8).map((t, i) => `<button class="chip" type="button" data-restore="later:${i}" title="${esc(t.url)}">${esc(t.title || hostOf(t.url))}</button>`).join('') : '<span class="hint">Vazio</span>'}</div><div><span class="lbl-mono">Fechados há pouco</span>${S.closed.length ? S.closed.slice(0, 5).map((t, i) => `<button class="chip" type="button" data-restore="closed:${i}" title="${esc(t.url)}">${esc(t.title || hostOf(t.url))}</button>`).join('') : '<span class="hint">Nada</span>'}</div>`;
  tick();
  const ri = $('#renameInput'); if (ri) { ri.focus(); ri.select(); }
  const si = $('#spaceInput'); if (si) si.focus();
}
function renderKeys() {
  $('#keys').innerHTML = ov.hold
    ? `<span><b>${KEY}</b>largar para abrir</span><span><b>← → ↑ ↓</b>escolher</span><span><b>Esc</b>cancelar</span>`
    : `<span><b>Enter</b>abrir</span><span><b>Esc</b>fechar</span><span><b>← → ↑ ↓</b>navegar</span><span><b>${isMac ? 'delete' : 'Backspace'}</b>fechar separador</span><span><b>${KEY} L</b>mais tarde</span><span>arrastar para reordenar</span>`;
}
function moveZone(d) {
  const v = visible(); if (!v.length) return;
  const cur = tabById(ov.sel) || v[0];
  const spaces = S.spaces.filter(sp => v.some(t => t.space === sp.id));
  let zi = spaces.findIndex(sp => sp.id === cur.space);
  const inZone = id => v.filter(t => t.space === id);
  const row = inZone(cur.space).findIndex(t => t.id === cur.id);
  zi = Math.max(0, Math.min(spaces.length - 1, zi + d));
  const list = inZone(spaces[zi].id);
  ov.sel = list[Math.min(row, list.length - 1)].id; renderZones();
  const el = document.querySelector('.card.sel'); if (el) el.scrollIntoView({ block: 'nearest' });
}
function moveSel(d) {
  const v = visible(); if (!v.length) return;
  let i = v.findIndex(t => t.id === ov.sel);
  i = i < 0 ? 0 : Math.max(0, Math.min(v.length - 1, i + d));
  ov.sel = v[i].id; renderZones();
  const el = document.querySelector('.card.sel'); if (el) el.scrollIntoView({ block: 'nearest' });
}
function selNeighbor(id) {
  const v = visible(); const i = v.findIndex(t => t.id === id);
  const n = v[i + 1] || v[i - 1]; ov.sel = n ? n.id : null;
}
$('#mfilter').addEventListener('input', () => { renderZones(); mosaicSugg(); });
/* Sites visitados que correspondem ao que se escreve na caixa do mosaico */
let msug = { list: [], seq: 0 };
async function mosaicSugg() {
  const q = $('#mfilter').value.trim(); const box = $('#msugg');
  if (!q) { msug.list = []; box.hidden = true; box.innerHTML = ''; return; }
  const seq = ++msug.seq;
  const list = await Z.invoke('history:suggest', q);
  if (seq !== msug.seq) return;
  msug.list = (list || []).slice(0, 5);
  if (!msug.list.length) { box.hidden = true; box.innerHTML = ''; return; }
  const short = u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  box.innerHTML = `<span class="lbl-mono">Sites visitados</span>` + msug.list.map((x, i) => `<button type="button" data-msug="${i}" class="${i === 0 && !visible().length ? 'sel' : ''}" title="${esc(x.url)}"><span>${esc(short(x.url))}</span>${x.title && x.title !== hostOf(x.url) ? `<em>${esc(x.title)}</em>` : ''}</button>`).join('');
  box.hidden = false;
}
$('#msugg').addEventListener('click', e => {
  const b = e.target.closest('[data-msug]'); if (!b) return;
  const x = msug.list[+b.dataset.msug]; if (!x) return;
  closeMosaic(); Z.invoke('tab:new', { url: x.url });
});
$('#mNew').addEventListener('click', () => { closeMosaic(); Z.invoke('tab:new', {}); });
$('#mSpace').addEventListener('click', () => { ov.addingSpace = true; renderZones(); });
$('#zones').addEventListener('click', e => {
  const cx = e.target.closest('[data-cx]');
  if (cx) { e.stopPropagation(); const id = +cx.dataset.cx; selNeighbor(id); Z.invoke('tab:close', id); return; }
  const c = e.target.closest('[data-card]'); if (c) { openSel(+c.dataset.card); return; }
  const nw = e.target.closest('[data-newin]'); if (nw) { closeMosaic(); Z.invoke('tab:new', { space: nw.dataset.newin }); return; }
  const rm = e.target.closest('[data-rmspace]');
  if (rm) {
    const id = rm.dataset.rmspace;
    if (!S.tabs.some(t => t.space === id)) Z.invoke('space:remove', id);
    else { ov.confirmRm = id; renderZones(); }
    return;
  }
  const ok = e.target.closest('[data-rmspace-ok]'); if (ok) { ov.confirmRm = null; Z.invoke('space:remove', ok.dataset.rmspaceOk); return; }
  if (e.target.closest('[data-rmspace-no]')) { ov.confirmRm = null; renderZones(); }
});
$('#zones').addEventListener('dblclick', e => { const r = e.target.closest('[data-rename]'); if (r) { ov.renaming = r.dataset.rename; renderZones(); } });
$('#zones').addEventListener('keydown', e => {
  if (e.target.id === 'renameInput') {
    e.stopPropagation();
    if (e.key === 'Enter') { const id = ov.renaming; ov.renaming = null; Z.invoke('space:rename', id, e.target.value); renderZones(); }
    if (e.key === 'Escape') { ov.renaming = null; renderZones(); }
  }
  if (e.target.id === 'spaceInput') {
    e.stopPropagation();
    if (e.key === 'Enter') { ov.addingSpace = false; Z.invoke('space:add', e.target.value); renderZones(); }
    if (e.key === 'Escape') { ov.addingSpace = false; renderZones(); }
  }
}, true);
$('#shelf').addEventListener('click', e => {
  const r = e.target.closest('[data-restore]'); if (!r) return;
  const [l, i] = r.dataset.restore.split(':'); closeMosaic(); Z.invoke('tab:restore', l, +i);
});
/* Arrastar cartões: mudar a ordem dentro do espaço ou passar para outro espaço (com o rato, sem o arrastar do sistema) */
let cardDrag = null, cardDragged = false;
const clearCardDrop = () => document.querySelectorAll('.card.drop-before,.card.drop-after,.zone.drop').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop'));
function cardTarget(x, y, dragId) {
  const el = document.elementFromPoint(x, y);
  const z = el && el.closest('[data-zone]'); if (!z) return null;
  const cards = [...z.querySelectorAll('[data-card]')].filter(c => +c.dataset.card !== dragId);
  // o cartão mais próximo do ponteiro, e se fica por cima ou por baixo dele (lista de cima para baixo)
  let best = null, bd = Infinity;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = dx * dx * 4 + dy * dy;
    if (d < bd) { bd = d; best = { c, after: y > r.top + r.height / 2 }; }
  }
  return { zone: z.dataset.zone, z, card: best && best.c, after: best && best.after };
}
$('#zones').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('[data-cx]')) return;
  const c = e.target.closest('[data-card]'); if (!c) return;
  cardDrag = { id: +c.dataset.card, el: c, x: e.clientX, y: e.clientY, on: false };
  cardDragged = false;
});
window.addEventListener('pointermove', e => {
  if (!cardDrag) return;
  if (!cardDrag.on) {
    if (Math.hypot(e.clientX - cardDrag.x, e.clientY - cardDrag.y) < 6) return;
    cardDrag.on = true; cardDrag.el.classList.add('drag'); document.body.classList.add('dragging-card');
  }
  clearCardDrop();
  const t = cardTarget(e.clientX, e.clientY, cardDrag.id); if (!t) return;
  t.z.classList.add('drop');
  if (t.card) t.card.classList.add(t.after ? 'drop-after' : 'drop-before');
});
window.addEventListener('pointerup', e => {
  if (!cardDrag) return;
  const d = cardDrag; cardDrag = null;
  if (!d.on) return;
  cardDragged = true; setTimeout(() => { cardDragged = false; }, 50);
  d.el.classList.remove('drag'); document.body.classList.remove('dragging-card');
  const t = cardTarget(e.clientX, e.clientY, d.id);
  clearCardDrop();
  if (!t) return;
  // posição: antes de um cartão, ou depois dele (= antes do seguinte nesse espaço)
  let before = null;
  if (t.card) {
    if (!t.after) before = +t.card.dataset.card;
    else {
      const list = S.tabs.filter(x => x.space === t.zone && x.id !== d.id);
      const i = list.findIndex(x => x.id === +t.card.dataset.card);
      before = list[i + 1] ? list[i + 1].id : null;
    }
  }
  const from = (tabById(d.id) || {}).space;
  Z.invoke('tab:move', d.id, t.zone, before);
  if (from !== t.zone) { const sp = S.spaces.find(s => s.id === t.zone); if (sp) toast('Movido para ' + sp.name); }
});
// sem o arrastar nativo das imagens (cancelaria o arrasto dos cartões)
$('#zones').addEventListener('dragstart', e => e.preventDefault());
window.addEventListener('pointercancel', () => { if (cardDrag) { cardDrag.el.classList.remove('drag'); document.body.classList.remove('dragging-card'); cardDrag = null; clearCardDrop(); } });
// o clique que termina um arrasto não abre o separador
$('#zones').addEventListener('click', e => { if (cardDragged) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

/* ------------------------------------------------------------------ */
/* Teclado: Option/Alt e atalhos do mosaico                             */
/* ------------------------------------------------------------------ */
// Option premido sozinho abre o mosaico; Option + outra tecla (ex.: @ no teclado português) não.
// Se o mosaico chegar a abrir e a seguir vier um carácter (quem segura o Option mais tempo antes
// de carregar no 2), o mosaico fecha e o carácter é escrito na página, para nunca se perder o @.
let altTimer = null, altAt = 0, altChord = false, ignoreUp = false, altFromWeb = false;
const HOLD_MS = 400;
function editingInUI() {
  const el = document.activeElement;
  if (!el || el.id === 'mfilter') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}
function altDown(fromWeb) {
  if (modal || !S) return;
  if (ov.open) { if (!ov.hold) { ignoreUp = true; closeMosaic(); } return; }
  // a escrever num campo do próprio Zeus (endereço, pesquisa…): o Option é só para escrever
  if (!fromWeb && editingInUI()) { altChord = true; return; }
  altFromWeb = !!fromWeb;
  altChord = false; altAt = Date.now();
  clearTimeout(altTimer);
  altTimer = setTimeout(() => { altTimer = null; if (!altChord) openMosaic(true); }, HOLD_MS);
}
function altUp() {
  if (ignoreUp) { ignoreUp = false; return; }
  if (altTimer) {
    clearTimeout(altTimer); altTimer = null;
    if (!altChord && Date.now() - altAt < HOLD_MS) openMosaic(false);
    return;
  }
  if (ov.open && ov.hold) {
    ov.hold = false;
    if (ov.sel) openSel(ov.sel); else closeMosaic();
  }
}
function altChordFn() { altChord = true; if (altTimer) { clearTimeout(altTimer); altTimer = null; } }
// estava a escrever: fecha o mosaico e devolve o carácter à página
function giveBackKey(ch) {
  const fromWeb = altFromWeb;
  ov.hold = false; ignoreUp = true;
  closeMosaic();
  if (ch && fromWeb) Z.invoke('page:insertText', ch);
}
function onBlur() {
  if (altTimer) { clearTimeout(altTimer); altTimer = null; }
  if (ov.open && ov.hold) { ov.hold = false; renderKeys(); $('#mfilter').focus(); }
}
Z.on('alt', ev => { if (ev === 'down') altDown(true); else if (ev === 'up') altUp(); else if (ev === 'chord') altChordFn(); else if (ev === 'blur') onBlur(); });
window.addEventListener('blur', onBlur);

window.addEventListener('keydown', e => {
  if (e.key === 'Alt') { if (!e.repeat) altDown(false); if (ov.open) e.preventDefault(); return; }
  if (e.altKey && !ov.open) altChordFn();
  if (modal) { if (e.key === 'Escape') { e.preventDefault(); closeModal(); } return; }
  if (!ov.open) return;
  const f = $('#mfilter'); const empty = !f.value;
  const inField = e.target && (e.target.id === 'renameInput' || e.target.id === 'spaceInput');
  if (inField) return;
  if (e.key === 'Escape') { e.preventDefault(); if (ov.hold) giveBackKey(''); else closeMosaic(); return; }
  // cada espaço é uma lista: ↑ ↓ dentro do espaço, ← → para o espaço ao lado
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); moveZone(1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); moveZone(-1); return; }
  if (ov.hold) {
    // com o Option ainda premido, qualquer outra tecla quer dizer que se estava a escrever
    if (e.key === 'Enter') { e.preventDefault(); ov.hold = false; ignoreUp = true; if (ov.sel) openSel(ov.sel); return; }
    if (e.key.length === 1 || e.key === 'Dead' || e.key === 'Backspace') { e.preventDefault(); giveBackKey(e.key.length === 1 ? e.key : ''); }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const v = visible(); const val = f.value.trim();
    if (val && !v.length) { const x = msug.list[0]; closeMosaic(); Z.invoke('tab:new', { url: x ? x.url : val }); }
    else if (ov.sel) openSel(ov.sel);
    return;
  }
  const dm = /^Digit([1-9])$/.exec(e.code);
  if (dm && empty && !e.altKey) { e.preventDefault(); const t = visible()[+dm[1] - 1]; if (t) openSel(t.id); return; }
  if (e.key === 'Backspace' && empty) { e.preventDefault(); if (ov.sel) { const id = ov.sel; selNeighbor(id); Z.invoke('tab:close', id); } return; }
  if (e.code === 'KeyL' && e.altKey && !e.metaKey) { e.preventDefault(); if (ov.sel) { const id = ov.sel; selNeighbor(id); Z.invoke('tab:later', id); toast('Guardado em “Mais tarde”'); } return; }
});
window.addEventListener('keyup', e => { if (e.key === 'Alt') { if (ov.open) e.preventDefault(); altUp(); } });

/* ------------------------------------------------------------------ */
/* Janelas: definições, juntar app, editar app                          */
/* ------------------------------------------------------------------ */
function openModal(name, html, cls) {
  if (ov.open) closeMosaic();
  modal = name;
  const m = $('#modal');
  m.className = 'modal ' + (cls || '');
  m.innerHTML = html;
  $('#modalWrap').hidden = false;
  sendLayout();
  const first = m.querySelector('input,button.btn'); if (first) setTimeout(() => first.focus(), 20);
}
function closeModal() {
  modal = null;
  $('#modalWrap').hidden = true;
  $('#modal').innerHTML = '';
  sendLayout();
}
$('#modalWrap').addEventListener('mousedown', e => { if (e.target.id === 'modalWrap') closeModal(); });
const modalHead = t => `<div class="m-head"><h2>${esc(t)}</h2><button class="nb" type="button" data-mclose aria-label="Fechar">${ICON.x}</button></div>`;
$('#modal').addEventListener('click', e => { if (e.target.closest('[data-mclose]')) closeModal(); });

const ICON_CHOICES = [['', 'Letra'], ['mail', 'Email'], ['pmail', 'Email seguro'], ['wa', 'Conversa'], ['cal', 'Calendário'], ['notion', 'Documento'], ['work', 'Trabalho'], ['globe', 'Web'], ['star', 'Favorito'], ['mic', 'Áudio'], ['play', 'Vídeo'], ['pluto', 'Planeta'], ['apolo', 'Sol']];
function iconPickerHTML(cur, name) {
  return `<div class="field"><span class="lab">Ícone</span><div class="icon-pick" id="iconPick" role="radiogroup" aria-label="Ícone">${ICON_CHOICES.map(([k, l]) => `<button type="button" role="radio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}" data-icon="${k}" title="${l}" aria-label="${l}">${k === '' ? `<span class="letter">${esc((name || 'A').charAt(0).toUpperCase())}</span>` : k === 'cal' ? '<span class="cal"><small data-dday></small><b data-dnum></b></span>' : ICON[k]}</button>`).join('')}</div></div>`;
}
function wireIconPicker() {
  const box = $('#iconPick'); if (!box) return;
  box.addEventListener('click', e => { const b = e.target.closest('[data-icon]'); if (!b) return; box.querySelectorAll('[data-icon]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); });
  tick();
}
const pickedIcon = () => { const b = $('#iconPick .on'); return b ? b.dataset.icon : ''; };
function sessionFieldHTML(isolated, editing) {
  return `<div class="field"><span class="lab">Sessão</span><div class="seg" id="sessSeg"><button type="button" data-s="1" class="${isolated ? 'on' : ''}">Separada</button><button type="button" data-s="0" class="${isolated ? '' : 'on'}">Partilhada</button></div>
    <p class="hint">Separada: a app tem contas e cookies só seus, como se estivesse noutro browser. Serve, por exemplo, para teres o Gmail pessoal e o do Observador lado a lado.${editing ? ' Se mudares, vais ter de voltar a entrar na conta dentro desta app.' : ''}</p></div>`;
}
function wireSessionSeg() {
  const seg = $('#sessSeg'); if (!seg) return;
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
}
const pickedIsolated = () => { const b = $('#sessSeg .on'); return b ? b.dataset.s === '1' : true; };

function openAddApp() {
  openModal('add', `${modalHead('Juntar ao Zeus')}
    <form id="addAppForm" class="section" autocomplete="off">
      <span class="lbl-mono">Site como app</span>
      <div class="field"><label for="aaUrl">Endereço</label><input class="inp" id="aaUrl" type="text" placeholder="drive.proton.me" required spellcheck="false"></div>
      <div class="field"><label for="aaName">Nome na barra</label><input class="inp" id="aaName" type="text" placeholder="Proton Drive"></div>
      <div class="field"><span class="lab">Abrir</span><div class="seg" id="aaMode"><button type="button" class="on" data-m="full">Página inteira</button><button type="button" data-m="side">Ao lado</button></div></div>
      ${sessionFieldHTML(true, false)}
      ${iconPickerHTML('', 'A')}
      <p class="err" id="aaErr" hidden></p>
      <div class="row-btns"><button class="btn" type="submit">Juntar à barra</button></div>
    </form>
    <div class="set-sec"><h3>Extensões do Chrome</h3>
      <p class="hint">Instala-as diretamente da Chrome Web Store, com o botão “Adicionar ao Chrome”. Nem todas funcionam no Zeus; as mais comuns costumam funcionar.</p>
      <div class="row-btns"><button class="btn ghost" type="button" id="aaStore">Abrir a Chrome Web Store</button><button class="btn ghost" type="button" id="aaLoadExt">Carregar de uma pasta ou .zip…</button></div>
    </div>`);
  $('#aaMode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) $('#aaMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#aaStore').addEventListener('click', () => { closeModal(); Z.invoke('ext:store'); });
  $('#aaLoadExt').addEventListener('click', loadExtFromFolder);
  wireSessionSeg(); wireIconPicker();
  $('#aaName').addEventListener('input', e => { const l = document.querySelector('#iconPick [data-icon=""] .letter'); if (l) l.textContent = (e.target.value.trim() || 'A').charAt(0).toUpperCase(); });
  $('#addAppForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await Z.invoke('app:add', { url: $('#aaUrl').value, name: $('#aaName').value.trim(), mode: $('#aaMode .on').dataset.m, isolated: pickedIsolated(), icon: pickedIcon() });
    if (!r.ok) { const er = $('#aaErr'); er.textContent = r.error; er.hidden = false; return; }
    closeModal(); toast('Juntaste uma app à barra'); Z.invoke('app:open', r.id);
  });
}

function openSetupApp(id) {
  const a = appById(id); if (!a) return;
  const ex = id === 'apolo' ? 'o endereço onde tens o Apolo alojado, por exemplo na Netlify' : 'o endereço da app';
  openModal('setup', `${modalHead('Onde está o ' + a.name + '?')}
    <form id="setupForm" class="section" autocomplete="off">
      <p class="hint">Escreve ${esc(ex)}. Só precisas de fazer isto uma vez.</p>
      <div class="field"><label for="suUrl">Endereço</label><input class="inp" id="suUrl" type="text" placeholder="exemplo.netlify.app" required spellcheck="false"></div>
      <p class="err" id="suErr" hidden></p>
      <div class="row-btns"><button class="btn" type="submit">Guardar e abrir</button></div>
    </form>`);
  $('#setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await Z.invoke('app:update', id, { url: $('#suUrl').value });
    if (!r.ok) { const er = $('#suErr'); er.textContent = r.error; er.hidden = false; return; }
    closeModal(); Z.invoke('app:open', id);
  });
}

function openEditApp(id) {
  const a = appById(id); if (!a) return;
  openModal('edit', `${modalHead('Editar app')}
    <form id="editForm" class="section" autocomplete="off">
      <div class="field"><label for="edName">Nome</label><input class="inp" id="edName" type="text" value="${esc(a.name)}"></div>
      <div class="field"><label for="edUrl">Endereço</label><input class="inp" id="edUrl" type="text" value="${esc(a.url)}" spellcheck="false"></div>
      ${sessionFieldHTML(!!a.isolated, true)}
      ${iconPickerHTML(a.icon || '', a.name)}
      <p class="err" id="edErr" hidden></p>
      <div class="row-btns"><button class="btn" type="submit">Guardar</button></div>
    </form>`);
  wireSessionSeg(); wireIconPicker();
  $('#editForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await Z.invoke('app:update', id, { name: $('#edName').value.trim(), url: $('#edUrl').value, icon: pickedIcon(), isolated: pickedIsolated() });
    if (!r.ok) { const er = $('#edErr'); er.textContent = r.error; er.hidden = false; return; }
    closeModal(); toast('App atualizada');
  });
}

function openCity() {
  openModal('city', `${modalHead('Cidade da meteorologia')}
    <form id="cityForm" class="section" autocomplete="off">
      <div class="field"><label for="ctName">Cidade</label><input class="inp" id="ctName" type="text" value="${esc((S.settings.city || {}).name || '')}"></div>
      <p class="err" id="ctErr" hidden></p>
      <div class="row-btns"><button class="btn" type="submit">Guardar</button></div>
    </form>`);
  $('#cityForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#ctName').value.trim(); if (!q) return;
    try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=' + encodeURIComponent(q));
      const j = await r.json();
      const g = j.results && j.results[0];
      if (!g) throw new Error('none');
      await Z.invoke('settings:set', { city: { name: g.name, lat: g.latitude, lon: g.longitude } });
      closeModal(); pageKey = ''; renderPage();
    } catch (err) { const er = $('#ctErr'); er.textContent = 'Não encontrei essa cidade. Experimenta só o nome, por exemplo “Leiria”.'; er.hidden = false; }
  });
}

const segHTML = (key, cur, opts) => `<div class="seg" data-setting="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
async function openSettings() {
  const st = S.settings;
  openModal('settings', `${modalHead('Definições')}
    <div class="set-sec" style="border-top:0;padding-top:0"><h3>Aspeto</h3>
      <div class="set-row"><span>Separadores</span>${segHTML('tabMode', st.tabMode, [['mosaic', 'Mosaico'], ['top', 'Em cima'], ['right', 'À direita']])}</div>
      <div class="set-row"><span>Tema</span>${segHTML('theme', st.theme, [['dark', 'Escuro'], ['light', 'Claro'], ['system', 'Sistema']])}</div>
      <div class="set-row"><span>Vídeo ao mudar de separador</span>${segHTML('autoPip', String(st.autoPip !== false), [['true', 'Fica a flutuar'], ['false', 'Não']])}</div>
      <div class="set-row"><span>Ao abrir o Zeus</span>${segHTML('restoreTabs', String(st.restoreTabs !== false), [['true', 'Retomar separadores'], ['false', 'Página nova']])}</div>
      <p class="hint">Mosaico: mantém ${esc(KEYNAME)} premido para ver os separadores e larga para abrir o escolhido. Um toque rápido deixa-o aberto. Também abre com ⌘E.</p>
    </div>
    <div class="set-sec"><h3>Pesquisa</h3>
      <div class="set-row"><span>Motor de pesquisa</span>${segHTML('search', st.search, [['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['startpage', 'Startpage'], ['brave', 'Brave']])}</div>
      <div class="set-row"><span>Meteorologia: ${esc((st.city || {}).name || '—')}</span><button class="linkbtn" type="button" id="setCity">Mudar de cidade</button></div>
    </div>
    <div class="set-sec"><h3>Apps na barra</h3><div class="list" id="setApps"></div>
      <div class="row-btns"><button class="btn ghost" type="button" id="setAddApp">Juntar app</button></div></div>
    <div class="set-sec"><h3>Extensões do Chrome</h3><div class="list" id="setExt"><p class="hint">A carregar…</p></div>
      <div class="row-btns"><button class="btn ghost" type="button" id="setStore">Abrir a Chrome Web Store</button><button class="btn ghost" type="button" id="setLoadExt">Carregar de uma pasta ou .zip…</button></div>
      <p class="hint">Para extensões tuas que não estão na loja (como as que usas no modo de programador do Chrome ou do Vivaldi). Ficam ativas nos separadores e em todas as apps da barra.</p></div>
    <div class="set-sec"><h3>Permissões dadas a sites</h3><div class="list" id="setPerm"><p class="hint">A carregar…</p></div></div>
    <div class="set-sec"><h3>Histórico</h3>
      <p class="hint" id="histLine">Ao escrever um endereço, o Zeus sugere os sites que já visitaste e os que mais visitas.</p>
      <div class="row-btns" id="histImport"></div></div>
    <div class="set-sec"><h3>Privacidade</h3>
      <p class="hint">Apagar todos os dados termina as sessões em todos os sites e apps (WhatsApp, Email, etc.).</p>
      <div class="row-btns"><button class="btn ghost" type="button" id="clrHist">Apagar o histórico</button><button class="btn ghost" type="button" id="clrCache">Limpar a cache</button><button class="btn danger" type="button" id="clrAll">Apagar todos os dados</button></div></div>
    <div class="set-sec"><h3>Atualizações</h3>
      <div class="set-row"><span>Versão instalada: ${esc(S.versions.zeus)}</span>${segHTML('autoUpdate', String(st.autoUpdate !== false), [['true', 'Automáticas'], ['false', 'Desligadas']])}</div>
      <p class="hint" id="updLine"></p>
      <form class="field" id="repoForm" autocomplete="off"><label for="repoInput">Repositório das versões (GitHub)</label>
        <div style="display:flex;gap:8px"><input class="inp" id="repoInput" style="flex:1" placeholder="utilizador/zeus" value="${esc(st.updateRepo || '')}" spellcheck="false"><button class="btn ghost" type="submit">Guardar</button></div></form>
      <div class="row-btns"><button class="btn ghost" type="button" id="updCheck">Procurar agora</button><button class="btn" type="button" id="updInstall" hidden>Reiniciar e instalar</button></div>
    </div>
    <div class="set-sec"><h3>Acerca</h3><p class="hint">Zeus ${esc(S.versions.zeus)} · Electron ${esc(S.versions.electron)} · Chromium ${esc(S.versions.chrome)}</p></div>`, 'wide');
  refreshSettingsApps();
  $('#modal').querySelectorAll('[data-setting]').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    const v = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v;
    Z.invoke('settings:set', { [seg.dataset.setting]: v });
  }));
  $('#setCity').addEventListener('click', openCity);
  renderUpdate();
  $('#updCheck').addEventListener('click', async () => { U = await Z.invoke('update:check'); renderUpdate(); });
  $('#updInstall').addEventListener('click', installUpdate);
  $('#repoForm').addEventListener('submit', e => { e.preventDefault(); Z.invoke('settings:set', { updateRepo: $('#repoInput').value }); toast('Repositório guardado'); });
  $('#setAddApp').addEventListener('click', openAddApp);
  $('#setStore').addEventListener('click', () => { closeModal(); Z.invoke('ext:store'); });
  $('#setLoadExt').addEventListener('click', loadExtFromFolder);
  $('#clrHist').addEventListener('click', async () => { await Z.invoke('data:clear', 'history'); toast('Histórico apagado'); });
  $('#clrCache').addEventListener('click', async () => { await Z.invoke('data:clear', 'cache'); toast('Cache limpa'); });
  $('#clrAll').addEventListener('click', async e => {
    const b = e.currentTarget;
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Confirmar: apagar tudo'; return; }
    await Z.invoke('data:clear', 'all'); b.textContent = 'Dados apagados'; b.disabled = true;
  });
  renderHistSection();
  renderExtList(await Z.invoke('ext:list'));
  renderPermList(await Z.invoke('permissions:list'));
}
function refreshSettingsApps() {
  const box = $('#setApps'); if (!box) return;
  box.innerHTML = S.apps.map(a => `<div class="li"><div class="grow"><span>${esc(a.name)}</span><small>${esc(a.url || 'Endereço por definir')}${a.isolated ? ' · sessão separada' : ''}</small></div>
    <div class="seg" data-appmode="${esc(a.id)}"><button type="button" data-v="side" class="${a.mode === 'side' ? 'on' : ''}">Ao lado</button><button type="button" data-v="full" class="${a.mode === 'full' ? 'on' : ''}">Inteira</button></div>
    <button class="linkbtn" type="button" data-editapp="${esc(a.id)}">Editar</button><button class="linkbtn" type="button" data-rmapp="${esc(a.id)}">Remover</button></div>`).join('');
}
$('#modal').addEventListener('click', e => {
  const m = e.target.closest('[data-appmode] button'); if (m) { Z.invoke('app:mode', m.parentElement.dataset.appmode, m.dataset.v); return; }
  const ed = e.target.closest('[data-editapp]'); if (ed) { openEditApp(ed.dataset.editapp); return; }
  const iso = e.target.closest('[data-isoapp]'); if (iso) { const a = appById(iso.dataset.isoapp); if (a) Z.invoke('app:update', a.id, { isolated: !a.isolated }); return; }
  const rm = e.target.closest('[data-rmapp]'); if (rm) { Z.invoke('app:remove', rm.dataset.rmapp); return; }
  const rx = e.target.closest('[data-rmext]'); if (rx) { Z.invoke('ext:remove', rx.dataset.rmext); return; }
  const fp = e.target.closest('[data-forget]'); if (fp) { Z.invoke('permissions:forget', fp.dataset.forget); fp.closest('.li').remove(); }
});
async function renderHistSection() {
  const n = await Z.invoke('history:count');
  const line = $('#histLine'); if (!line) return;
  line.textContent = `Ao escrever um endereço (em cima, na página principal ou no mosaico), o Zeus sugere os sites que já visitaste e os que mais visitas. Tem ${n.toLocaleString('pt-PT')} endereços guardados.`;
  const list = await Z.invoke('history:browsers');
  const box = $('#histImport'); if (!box) return;
  box.innerHTML = list.length
    ? list.map(b => `<button class="btn ghost" type="button" data-histimp="${esc(b.id)}">Importar do ${esc(b.name)}</button>`).join('')
    : '<span class="hint">Não encontrei outros browsers (Vivaldi, Chrome, Brave, Edge, Arc) neste computador para importar o histórico.</span>';
  box.querySelectorAll('[data-histimp]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'A importar…';
    const r = await Z.invoke('history:import', btn.dataset.histimp);
    if (r && r.ok) { btn.textContent = `Importado do ${r.name}`; toast(`${r.added.toLocaleString('pt-PT')} endereços novos do ${r.name}`); renderHistSection(); }
    else { btn.disabled = false; btn.textContent = 'Tentar de novo'; toast((r && r.error) || 'Não foi possível importar.'); }
  }));
}
async function loadExtFromFolder() {
  const r = await Z.invoke('ext:load');
  if (r && r.ok) { toast(`Extensão “${r.name}” carregada`); renderExtList(await Z.invoke('ext:list')); }
  else if (r && r.error) toast(r.error);
}
function renderExtList(list) {
  const box = $('#setExt'); if (!box) return;
  box.innerHTML = list && list.length ? list.map(x => `<div class="li"><div class="grow"><span>${esc(x.name)}</span><small>Versão ${esc(x.version)}${x.unpacked ? ' · da pasta' : ''}</small></div><button class="linkbtn" type="button" data-rmext="${esc(x.id)}">Remover</button></div>`).join('') : '<p class="hint">Nenhuma extensão instalada.</p>';
}
Z.on('extensions', list => renderExtList(list));
const PERM = { media: 'Câmara/microfone', geolocation: 'Localização', 'display-capture': 'Gravar o ecrã', 'clipboard-read': 'Ler a área de transferência', 'storage-access': 'Cookies noutros sites', 'top-level-storage-access': 'Cookies noutros sites', midi: 'MIDI', midiSysex: 'MIDI', 'idle-detection': 'Inatividade', 'window-management': 'Janelas', 'local-fonts': 'Tipos de letra', keyboardLock: 'Teclado', 'screen-wake-lock': 'Ecrã ligado' };
function renderPermList(list) {
  const box = $('#setPerm'); if (!box) return;
  box.innerHTML = list && list.length ? list.map(p => `<div class="li"><div class="grow"><span>${esc(hostOf(p.origin) || p.origin)}</span><small>${esc(PERM[p.permission] || p.permission)} · ${p.allowed ? 'permitido' : 'bloqueado'}</small></div><button class="linkbtn" type="button" data-forget="${esc(p.origin + '|' + p.permission)}">Esquecer</button></div>`).join('') : '<p class="hint">Ainda não deste nem recusaste permissões.</p>';
}

/* ------------------------------------------------------------------ */
/* Atualizações                                                         */
/* ------------------------------------------------------------------ */
let U = null;
function updText(u) {
  if (!u) return '';
  switch (u.state) {
    case 'checking': return 'A procurar atualizações…';
    case 'downloading': return `A descarregar a versão ${u.version}${u.progress ? ' (' + u.progress + '%)' : ''}…`;
    case 'ready': return u.message || `A versão ${u.version} está pronta. Instala-se quando reiniciares ou fechares o Zeus.`;
    case 'uptodate': return 'Tens a versão mais recente.';
    case 'error': return 'Não foi possível atualizar: ' + (u.message || 'erro desconhecido');
    case 'norepo': case 'unsupported': return u.message || '';
    default: return 'As atualizações são verificadas ao abrir o Zeus e de 4 em 4 horas.';
  }
}
function renderUpdate() {
  const b = $('#updBtn');
  if (U && U.state === 'ready') { b.hidden = false; b.textContent = `Atualização ${U.version} · Reiniciar`; }
  else b.hidden = true;
  const line = $('#updLine'); if (line) line.textContent = updText(U);
  const inst = $('#updInstall'); if (inst) inst.hidden = !(U && U.state === 'ready');
}
let readyShown = '';
Z.on('update', st => {
  U = st; renderUpdate();
  if (st.state === 'ready' && readyShown !== st.version) { readyShown = st.version; toast(`A versão ${st.version} do Zeus está pronta. Reinicia quando quiseres.`); }
});
async function installUpdate() {
  const r = await Z.invoke('update:install');
  if (r && !r.ok && r.error) toast(r.error);
}
$('#updBtn').addEventListener('click', installUpdate);
Z.invoke('update:status').then(st => { if (st) { U = st; renderUpdate(); } });

/* ------------------------------------------------------------------ */
/* Arranque                                                             */
/* ------------------------------------------------------------------ */
$('#keyLbl').textContent = KEY;
$('#mosaicBtn').title = `Separadores — mantém ${KEYNAME} premido (ou ⌘E)`;
Z.invoke('ready');
})();

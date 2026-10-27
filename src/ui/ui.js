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
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  x: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  full: '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 15v5h-5"/></svg>',
  snd: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/></svg>',
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
  const lay = { page: rectOf($('#pageSlot')), panel: rectOf($('#panelSlot')), claude: rectOf($('#claudeSlot')), overlay: ov.open || !!modal };
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
  let h = '';
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
  h += `<div class="clock" aria-label="Hora"><b data-clock></b><span data-dshort></span></div>`;
  h += `<button class="icon-btn" type="button" data-settings aria-label="Definições" title="Definições (⌘,)">${ICON.gear}</button>`;
  $('#rail').innerHTML = h;
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
  const onWeb = !full && t && t.url !== NEWTAB && !t.error;
  $('#btnBack').disabled = !onWeb || !S.canGoBack;
  $('#btnFwd').disabled = !onWeb || !S.canGoForward;
  $('#btnReload').disabled = !(onWeb || (t && t.error));
  $('#fullBtns').hidden = !full;
  $('#claudeBtn').classList.toggle('on', S.claudeOpen);
  $('#mosaicBtn').classList.toggle('on', ov.open);
  $('#progress').hidden = !(t && t.loading && !full && t.url !== NEWTAB);
  const mode = S.settings.tabMode;
  const tb = $('#titleBtn');
  if (full) tb.innerHTML = `<span class="t">${esc(full.name)}</span><span class="dom">app</span>`;
  else if (t) tb.innerHTML = `${t.url !== NEWTAB && t.favicon ? `<img src="${esc(t.favicon)}" alt="" data-fav>` : ''}<span class="t">${esc(t.url === NEWTAB ? 'Página nova' : t.title)}</span><span class="dom">${t.url === NEWTAB ? '' : esc(hostOf(t.url))}</span>`;
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
$('#pageSlot').addEventListener('submit', e => {
  if (e.target.id !== 'askForm') return;
  e.preventDefault();
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
  const ck = 'wx:' + city.lat + ',' + city.lon;
  let data = null;
  try { const c = JSON.parse(localStorage.getItem(ck) || 'null'); if (c && Date.now() - c.t < 30 * 60 * 1000) data = c.d; } catch (e) { /* sem cache */ }
  if (!data) {
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=6`;
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
  const [desc, ic] = WX(data.current.weather_code);
  now.innerHTML = `${ICON[ic](40)}<div><b>${Math.round(data.current.temperature_2m)}°</b><span><button class="wx-city" type="button" data-city title="Mudar de cidade">${esc(city.name)}</button> · ${esc(desc)}</span></div>`;
  const d = data.daily;
  let h = '<div class="fc">';
  for (let i = 1; i <= 5 && i < d.time.length; i++) {
    const day = new Date(d.time[i] + 'T12:00:00');
    const lab = i === 1 ? 'Amanhã' : DABR[day.getDay()].charAt(0).toUpperCase() + DABR[day.getDay()].slice(1);
    const [, ic2] = WX(d.weather_code[i]);
    h += `<div><span>${lab}</span>${ICON[ic2](20)}<span>${Math.round(d.temperature_2m_max[i])}° <em>${Math.round(d.temperature_2m_min[i])}°</em></span></div>`;
  }
  fc.innerHTML = h + '</div>';
}

/* ------------------------------------------------------------------ */
/* Faixa de cima: navegação, endereço, procurar                         */
/* ------------------------------------------------------------------ */
$('#btnBack').addEventListener('click', () => Z.invoke('nav', 'back'));
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
  a.value = S.fullApp ? '' : (t && t.url !== NEWTAB ? t.url : '');
  renderTop(); a.hidden = false; a.focus(); a.select();
}
function closeAddr() { addrOpen = false; $('#addr').hidden = true; renderTop(); }
$('#addr').addEventListener('keydown', e => {
  if (e.key === 'Enter') { const v = e.target.value.trim(); closeAddr(); if (v) Z.invoke('navigate', v); }
  if (e.key === 'Escape') { closeAddr(); Z.invoke('ui:focusPage'); }
});
$('#addr').addEventListener('blur', () => { if (addrOpen) closeAddr(); });

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
});

/* ------------------------------------------------------------------ */
/* Mosaico de separadores                                               */
/* ------------------------------------------------------------------ */
async function openMosaic(hold) {
  if (ov.open || modal || !S) return;
  ov.open = true; ov.hold = hold; ov.addingSpace = false; ov.renaming = null;
  ov.sel = S.mru.find(x => x !== S.currentId && tabById(x)) || S.currentId;
  $('#mfilter').value = '';
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
      const big = isCur && list.length >= 3 && !f;
      return `<div class="card ${big ? 'big' : ''} ${t.id === ov.sel ? 'sel' : ''}" role="button" tabindex="-1" draggable="true" data-card="${t.id}" title="${esc(t.url === NEWTAB ? 'Página nova' : t.url)}">
        <div class="thumb">${thumbHTML(t)}${n <= 9 ? `<span class="num">${n}${isCur ? '<span class="now">Atual</span>' : ''}</span>` : ''}${t.audible ? `<span class="snd">${ICON.snd}a tocar</span>` : ''}<button class="cx" type="button" data-cx="${t.id}" aria-label="Fechar">${ICON.x}</button></div>
        <div class="cap"><span class="fav">${favHTML(t)}</span><span class="ttl">${esc(t.url === NEWTAB ? 'Página nova' : t.title)}</span></div></div>`;
    }).join('');
    const head = ov.renaming === s.id
      ? `<input id="renameInput" value="${esc(s.name)}" aria-label="Nome do espaço">`
      : `<span data-rename="${s.id}" title="Duplo clique para mudar o nome">${esc(s.name)}</span><em>· ${list.length}</em>${!list.length && S.spaces.length > 1 ? `<button class="zx" type="button" data-rmspace="${s.id}" aria-label="Apagar o espaço ${esc(s.name)}">${ICON.x}</button>` : ''}`;
    const isCurZone = curTab() && curTab().space === s.id;
    return `<section class="zone ${isCurZone ? 'cur' : ''}" data-zone="${s.id}" style="flex:${basis} 1 ${basis >= 4 ? 460 : 230}px"><div class="zone-h"><i></i>${head}</div><div class="grid">${cards}${f ? '' : `<button class="card newc" type="button" data-newin="${s.id}">${ICON.plus}Separador neste espaço</button>`}</div></section>`;
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
    : `<span><b>Enter</b>abrir</span><span><b>Esc</b>fechar</span><span><b>1–9</b>saltar direto</span><span><b>← → ↑ ↓</b>navegar</span><span><b>${isMac ? 'delete' : 'Backspace'}</b>fechar separador</span><span><b>${KEY} L</b>mais tarde</span><span>arrastar entre espaços</span>`;
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
$('#mfilter').addEventListener('input', () => renderZones());
$('#mNew').addEventListener('click', () => { closeMosaic(); Z.invoke('tab:new', {}); });
$('#mSpace').addEventListener('click', () => { ov.addingSpace = true; renderZones(); });
$('#zones').addEventListener('click', e => {
  const cx = e.target.closest('[data-cx]');
  if (cx) { e.stopPropagation(); const id = +cx.dataset.cx; selNeighbor(id); Z.invoke('tab:close', id); return; }
  const c = e.target.closest('[data-card]'); if (c) { openSel(+c.dataset.card); return; }
  const nw = e.target.closest('[data-newin]'); if (nw) { closeMosaic(); Z.invoke('tab:new', { space: nw.dataset.newin }); return; }
  const rm = e.target.closest('[data-rmspace]'); if (rm) { Z.invoke('space:remove', rm.dataset.rmspace); }
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
let dragId = null;
$('#zones').addEventListener('dragstart', e => { const c = e.target.closest('[data-card]'); if (!c) return; dragId = +c.dataset.card; c.classList.add('drag'); try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (_) { /* ok */ } });
$('#zones').addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.zone.drop').forEach(z => z.classList.remove('drop')); });
$('#zones').addEventListener('dragover', e => { const z = e.target.closest('[data-zone]'); if (!z || dragId == null) return; e.preventDefault(); document.querySelectorAll('.zone.drop').forEach(x => x !== z && x.classList.remove('drop')); z.classList.add('drop'); });
$('#zones').addEventListener('drop', e => {
  const z = e.target.closest('[data-zone]'); if (!z || dragId == null) return;
  e.preventDefault(); const sp = S.spaces.find(s => s.id === z.dataset.zone);
  Z.invoke('tab:move', dragId, z.dataset.zone); if (sp) toast('Movido para ' + sp.name); dragId = null;
});

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
  if (e.key === 'ArrowRight') { e.preventDefault(); moveSel(1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); moveSel(-1); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(3); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-3); return; }
  if (ov.hold) {
    // com o Option ainda premido, qualquer outra tecla quer dizer que se estava a escrever
    if (e.key === 'Enter') { e.preventDefault(); ov.hold = false; ignoreUp = true; if (ov.sel) openSel(ov.sel); return; }
    if (e.key.length === 1 || e.key === 'Dead' || e.key === 'Backspace') { e.preventDefault(); giveBackKey(e.key.length === 1 ? e.key : ''); }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const v = visible(); const val = f.value.trim();
    if (val && !v.length) { closeMosaic(); Z.invoke('tab:new', { url: val }); }
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

function openAddApp() {
  openModal('add', `${modalHead('Juntar ao Zeus')}
    <form id="addAppForm" class="section" autocomplete="off">
      <span class="lbl-mono">Site como app</span>
      <div class="field"><label for="aaUrl">Endereço</label><input class="inp" id="aaUrl" type="text" placeholder="drive.proton.me" required spellcheck="false"></div>
      <div class="field"><label for="aaName">Nome na barra</label><input class="inp" id="aaName" type="text" placeholder="Proton Drive"></div>
      <div class="field"><span class="lab">Abrir</span><div class="seg" id="aaMode"><button type="button" class="on" data-m="full">Página inteira</button><button type="button" data-m="side">Ao lado</button></div></div>
      <p class="err" id="aaErr" hidden></p>
      <div class="row-btns"><button class="btn" type="submit">Juntar à barra</button></div>
    </form>
    <div class="set-sec"><h3>Extensões do Chrome</h3>
      <p class="hint">Instala-as diretamente da Chrome Web Store, com o botão “Adicionar ao Chrome”. Nem todas funcionam no Zeus; as mais comuns costumam funcionar.</p>
      <div class="row-btns"><button class="btn ghost" type="button" id="aaStore">Abrir a Chrome Web Store</button></div>
    </div>`);
  $('#aaMode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) $('#aaMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#aaStore').addEventListener('click', () => { closeModal(); Z.invoke('ext:store'); });
  $('#addAppForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await Z.invoke('app:add', { url: $('#aaUrl').value, name: $('#aaName').value.trim(), mode: $('#aaMode .on').dataset.m });
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
      <p class="err" id="edErr" hidden></p>
      <div class="row-btns"><button class="btn" type="submit">Guardar</button></div>
    </form>`);
  $('#editForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await Z.invoke('app:update', id, { name: $('#edName').value.trim(), url: $('#edUrl').value });
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
      <div class="row-btns"><button class="btn ghost" type="button" id="setStore">Abrir a Chrome Web Store</button></div></div>
    <div class="set-sec"><h3>Permissões dadas a sites</h3><div class="list" id="setPerm"><p class="hint">A carregar…</p></div></div>
    <div class="set-sec"><h3>Privacidade</h3>
      <p class="hint">Apagar todos os dados termina as sessões em todos os sites e apps (WhatsApp, Email, etc.).</p>
      <div class="row-btns"><button class="btn ghost" type="button" id="clrCache">Limpar a cache</button><button class="btn danger" type="button" id="clrAll">Apagar todos os dados</button></div></div>
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
  $('#clrCache').addEventListener('click', async () => { await Z.invoke('data:clear', 'cache'); toast('Cache limpa'); });
  $('#clrAll').addEventListener('click', async e => {
    const b = e.currentTarget;
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Confirmar: apagar tudo'; return; }
    await Z.invoke('data:clear', 'all'); b.textContent = 'Dados apagados'; b.disabled = true;
  });
  renderExtList(await Z.invoke('ext:list'));
  renderPermList(await Z.invoke('permissions:list'));
}
function refreshSettingsApps() {
  const box = $('#setApps'); if (!box) return;
  box.innerHTML = S.apps.map(a => `<div class="li"><div class="grow"><span>${esc(a.name)}</span><small>${esc(a.url || 'Endereço por definir')}</small></div>
    <div class="seg" data-appmode="${esc(a.id)}"><button type="button" data-v="side" class="${a.mode === 'side' ? 'on' : ''}">Ao lado</button><button type="button" data-v="full" class="${a.mode === 'full' ? 'on' : ''}">Inteira</button></div>
    <button class="linkbtn" type="button" data-editapp="${esc(a.id)}">Editar</button><button class="linkbtn" type="button" data-rmapp="${esc(a.id)}">Remover</button></div>`).join('');
}
$('#modal').addEventListener('click', e => {
  const m = e.target.closest('[data-appmode] button'); if (m) { Z.invoke('app:mode', m.parentElement.dataset.appmode, m.dataset.v); return; }
  const ed = e.target.closest('[data-editapp]'); if (ed) { openEditApp(ed.dataset.editapp); return; }
  const rm = e.target.closest('[data-rmapp]'); if (rm) { Z.invoke('app:remove', rm.dataset.rmapp); return; }
  const rx = e.target.closest('[data-rmext]'); if (rx) { Z.invoke('ext:remove', rx.dataset.rmext); return; }
  const fp = e.target.closest('[data-forget]'); if (fp) { Z.invoke('permissions:forget', fp.dataset.forget); fp.closest('.li').remove(); }
});
function renderExtList(list) {
  const box = $('#setExt'); if (!box) return;
  box.innerHTML = list && list.length ? list.map(x => `<div class="li"><div class="grow"><span>${esc(x.name)}</span><small>Versão ${esc(x.version)}</small></div><button class="linkbtn" type="button" data-rmext="${esc(x.id)}">Remover</button></div>`).join('') : '<p class="hint">Nenhuma extensão instalada.</p>';
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

'use strict';
/*
 * Painéis web dentro do Olimpo: o Zeus (browser com separadores), o Apolo e as apps web.
 * Cada página é uma WebContentsView colocada por cima da interface, no retângulo que a
 * interface indica (o "vidro" do painel é desenhado pela interface; a página encaixa no meio).
 * Vem da base do Zeus: sessão persistente, início de sessão da Google, sandbox em todas as páginas.
 */
const { WebContentsView, session, Menu, clipboard, shell } = require('electron');
const path = require('path');
const { isMac } = require('./platform');

const PARTITION = 'persist:olimpo';
const GOOGLE_LOGIN = /^https:\/\/accounts\.google\.com(\/|$)/i;
const SEARCH = 'https://www.google.com/search?q=';

function firefoxUA() {
  const v = 140 + Math.max(0, Math.floor((Date.now() - Date.UTC(2025, 5, 24)) / (28 * 86400000)) - 1);
  const plat = isMac ? 'Macintosh; Intel Mac OS X 10.15' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${plat}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
}
const chromeUA = () => session.defaultSession.getUserAgent().replace(/\s?Electron\/\S+/i, '').replace(/\s?(Olimpo|olimpo)\/\S+/i, '');
function googleUA(wc, url) {
  try { const want = GOOGLE_LOGIN.test(url || '') ? firefoxUA() : chromeUA(); if (wc.getUserAgent() !== want) wc.setUserAgent(want); } catch (e) { /* ok */ }
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

function toURL(input) {
  const s = String(input || '').trim();
  if (!s) return 'about:blank';
  if (/^(https?|file|about):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return SEARCH + encodeURIComponent(s);
}

let uid = 0;
const newId = () => 't' + Date.now().toString(36) + (uid++).toString(36);

class Web {
  constructor({ win, store, onState, onActivity, openExternalApp }) {
    this.win = win;
    this.store = store;
    this.onState = onState;
    this.onActivity = onActivity;
    this.openExternalApp = openExternalApp;
    this.views = new Map();        // chave ('tab:<id>' | 'app:<id>') -> WebContentsView
    this.shown = new Map();        // chave -> "x,y,w,h"
    this.ses = session.fromPartition(PARTITION);
    this.setupSession();
    this.pushTimer = null;
  }

  setupSession() {
    const ses = this.ses;
    const ff = firefoxUA();
    ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (d, cb) => {
      const h = Object.assign({}, d.requestHeaders);
      h['User-Agent'] = ff;
      for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
      cb({ requestHeaders: h });
    });
    try { ses.registerPreloadScript({ type: 'frame', id: 'olimpo-pages', filePath: path.join(__dirname, '..', 'preload', 'pages.js') }); }
    catch (e) { console.error('preload das páginas', e); }
    ses.setUserAgent(chromeUA());
    // permissões: câmara/microfone (videochamadas, WhatsApp), notificações, copiar e ecrã inteiro; o resto, não
    ses.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock'].includes(perm)));
  }

  /* ---------- separadores do Zeus ---------- */
  S() { return this.store.get(); }
  tabs(espaco = this.S().espacoAtual) { return this.S().zeus.tabs.filter(t => t.espaco === espaco); }
  current(espaco = this.S().espacoAtual) {
    const id = this.S().zeus.atual[espaco];
    return this.tabs(espaco).find(t => t.id === id) || this.tabs(espaco)[0] || null;
  }

  newTab({ url = '', espaco, activate = true } = {}) {
    const S = this.S();
    espaco = espaco || S.espacoAtual;
    const tab = { id: newId(), url: url ? toURL(url) : 'about:blank', title: '', favicon: '', espaco };
    this.store.change(s => { s.zeus.tabs.push(tab); if (activate) s.zeus.atual[espaco] = tab.id; });
    if (tab.url !== 'about:blank') this.ensure('tab:' + tab.id, tab.url);
    this.push();
    return tab;
  }
  selectTab(id) {
    const t = this.S().zeus.tabs.find(x => x.id === id); if (!t) return;
    this.store.change(s => { s.zeus.atual[t.espaco] = id; });
    this.push();
  }
  closeTab(id) {
    const S = this.S();
    const t = S.zeus.tabs.find(x => x.id === id); if (!t) return;
    const list = this.tabs(t.espaco);
    const i = list.findIndex(x => x.id === id);
    const next = list[i + 1] || list[i - 1] || null;
    this.destroy('tab:' + id);
    this.store.change(s => {
      s.zeus.tabs = s.zeus.tabs.filter(x => x.id !== id);
      if (s.zeus.atual[t.espaco] === id) s.zeus.atual[t.espaco] = next ? next.id : null;
    });
    this.push();
  }
  navigate(input, key) {
    const url = toURL(input);
    if (!key || key === 'tab') {
      let t = this.current();
      if (!t) t = this.newTab({ url });
      else {
        this.store.change(() => { t.url = url; });
        const v = this.ensure('tab:' + t.id, url);
        v.webContents.loadURL(url).catch(() => {});
      }
    } else {
      const v = this.views.get(key); if (v) v.webContents.loadURL(url).catch(() => {});
    }
    this.push();
  }
  wcFor(key) {
    if (key === 'tab') { const t = this.current(); key = t ? 'tab:' + t.id : null; }
    const v = key && this.views.get(key);
    return v && !v.webContents.isDestroyed() ? v.webContents : null;
  }
  nav(key, what) {
    const wc = this.wcFor(key); if (!wc) return;
    const h = wc.navigationHistory;
    if (what === 'back' && h.canGoBack()) h.goBack();
    else if (what === 'forward' && h.canGoForward()) h.goForward();
    else if (what === 'reload') wc.reload();
    else if (what === 'stop') wc.stop();
  }

  /* ---------- vistas ---------- */
  ensure(key, url) {
    if (this.views.has(key)) return this.views.get(key);
    const view = new WebContentsView({
      webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, safeDialogs: true, spellcheck: true }
    });
    view.setBackgroundColor('#ffffff');
    try { view.setBorderRadius(0); } catch (e) { /* versões antigas */ }
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(key, view);
    this.wire(view.webContents, key);
    if (url) { googleUA(view.webContents, url); view.webContents.loadURL(url).catch(() => {}); }
    return view;
  }
  destroy(key) {
    const v = this.views.get(key); if (!v) return;
    this.views.delete(key); this.shown.delete(key);
    try { this.win.contentView.removeChildView(v); } catch (e) { /* ok */ }
    try { v.webContents.close(); } catch (e) { /* ok */ }
  }

  /* Abre (ou reaproveita) a vista de uma app web: Apolo, WhatsApp, apps acrescentadas. */
  app(id, url) {
    const key = 'app:' + id;
    const v = this.views.get(key);
    if (v && url && v.__baseURL !== url) { v.__baseURL = url; v.webContents.loadURL(url).catch(() => {}); }
    if (!v && url) { const nv = this.ensure(key, url); nv.__baseURL = url; }
    this.push();
    return key;
  }

  /*
   * Mostra as vistas pedidas nos retângulos indicados e esconde as outras.
   * layout: [{ key: 'tab' | 'app:<id>', rect: {x,y,width,height}, radius }]
   */
  layout(list) {
    const want = new Map();
    for (const it of list || []) {
      let key = it.key;
      if (key === 'tab') {
        const t = this.current();
        if (!t || t.url === 'about:blank') continue;
        key = 'tab:' + t.id;
        this.ensure(key, t.url);
      }
      if (this.views.has(key) && it.rect && it.rect.width > 10 && it.rect.height > 10) want.set(key, it);
    }
    for (const [key, view] of this.views) {
      const it = want.get(key);
      if (!it) { if (view.getVisible()) view.setVisible(false); this.shown.delete(key); continue; }
      const r = { x: Math.round(it.rect.x), y: Math.round(it.rect.y), width: Math.round(it.rect.width), height: Math.round(it.rect.height) };
      const sig = r.x + ',' + r.y + ',' + r.width + ',' + r.height;
      if (this.shown.get(key) === sig && view.getVisible()) continue;
      view.setVisible(true);
      view.setBounds(r);
      try { view.setBorderRadius(it.radius || 0); } catch (e) { /* ok */ }
      // abanão de 1 px: a página volta a medir a janela (vem do Zeus)
      const wc = view.webContents;
      setTimeout(() => { if (wc.isDestroyed() || this.shown.get(key) !== sig) return; view.setBounds({ ...r, width: Math.max(1, r.width - 1) }); view.setBounds(r); }, 60);
      this.shown.set(key, sig);
    }
  }
  hideAll() { this.layout([]); }

  wire(wc, key) {
    const isTab = key.startsWith('tab:');
    const tabId = isTab ? key.slice(4) : null;
    const T = () => tabId && this.S().zeus.tabs.find(t => t.id === tabId);
    wc.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(wc, d.url); });
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (/^(mailto|tel):/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
      if (/^(blob|data):/i.test(url)) { try { wc.downloadURL(url); } catch (e) { /* ok */ } return { action: 'deny' }; }
      if (!/^(https?:|about:blank)/i.test(url)) return { action: 'deny' };
      const popup = disposition === 'new-window' || (features && /width|height|popup/i.test(features));
      if (popup) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, parent: this.win, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { session: wc.session, sandbox: true, contextIsolation: true } } };
      }
      // links das apps e dos separadores abrem num separador novo do Zeus
      this.newTab({ url, activate: disposition !== 'background-tab' });
      this.onState({ type: 'open-zeus' });
      return { action: 'deny' };
    });
    wc.on('did-create-window', child => { child.webContents.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(child.webContents, d.url); }); });
    wc.on('will-attach-webview', e => e.preventDefault());
    wc.on('will-navigate', (e, url) => { if (/^(blob|data):/i.test(url)) { e.preventDefault(); try { wc.downloadURL(url); } catch (x) { /* ok */ } } });
    wc.on('context-menu', (e, p) => this.menu(wc, p));
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown' || !(input.meta || input.control)) return;
      const k = input.key.toLowerCase();
      if (k === 't') { e.preventDefault(); this.onState({ type: 'focus-address', newTab: true }); }
      else if (k === 'l') { e.preventDefault(); this.onState({ type: 'focus-address' }); }
      else if (k === 'w' && isTab) { e.preventDefault(); this.closeTab(tabId); }
      else if (k === 'r') { e.preventDefault(); wc.reload(); }
      else if (k === '[' ) { e.preventDefault(); this.nav(key, 'back'); }
      else if (k === ']') { e.preventDefault(); this.nav(key, 'forward'); }
    });
    const update = () => {
      const t = T();
      if (t) {
        const url = wc.getURL(), title = wc.getTitle();
        if (t.url !== url || t.title !== title) {
          this.store.change(() => { t.url = url; t.title = title && title !== url ? title : hostOf(url); });
          if (/^https?:/.test(url)) this.onActivity({ tipo: 'zeus', id: 'zeus:' + hostOf(url), titulo: t.title || hostOf(url), sub: hostOf(url), alvo: { url }, espaco: t.espaco });
        }
      }
      this.push();
    };
    wc.on('page-title-updated', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) update(); });
    wc.on('page-favicon-updated', (e, fav) => { const t = T(); if (t) { t.favicon = fav[0] || ''; this.store.save(); this.push(); } });
    wc.on('did-start-loading', () => this.push());
    wc.on('did-stop-loading', () => this.push());
    wc.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) { wc.__err = { code, desc, url }; this.push(); } });
    wc.on('did-start-navigation', d => { if (d.isMainFrame && !d.isSameDocument && wc.__err) { wc.__err = null; this.push(); } });
  }

  menu(wc, p) {
    const items = [];
    if (p.linkURL) {
      items.push({ label: 'Abrir num separador novo', click: () => { this.newTab({ url: p.linkURL, activate: false }); } });
      items.push({ label: 'Copiar endereço do link', click: () => clipboard.writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.selectionText) items.push({ label: 'Copiar', role: 'copy' });
    if (p.isEditable) items.push({ label: 'Cortar', role: 'cut' }, { label: 'Colar', role: 'paste' });
    if (p.mediaType === 'image' && p.srcURL) items.push({ label: 'Copiar imagem', click: () => wc.copyImageAt(p.x, p.y) }, { label: 'Guardar imagem…', click: () => wc.downloadURL(p.srcURL) });
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { label: 'Voltar', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Recarregar', click: () => wc.reload() },
      { label: 'Abrir no browser do sistema', click: () => shell.openExternal(wc.getURL()) }
    );
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  /* Texto da página aberta, para o Claude resumir ou responder sobre ela. */
  async pageText(key = 'tab') {
    const wc = this.wcFor(key); if (!wc) return null;
    try {
      const text = await wc.executeJavaScript('(document.body && document.body.innerText || "").slice(0, 60000)', true);
      return { url: wc.getURL(), titulo: wc.getTitle(), texto: text };
    } catch (e) { return { url: wc.getURL(), titulo: wc.getTitle(), texto: '' }; }
  }

  push() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; this.onState({ type: 'state', state: this.state() }); }, 50);
  }
  state() {
    const S = this.S();
    const cur = this.current();
    const info = key => {
      const v = this.views.get(key);
      if (!v || v.webContents.isDestroyed()) return null;
      const wc = v.webContents;
      return { url: wc.getURL(), titulo: wc.getTitle(), loading: wc.isLoading(), back: wc.navigationHistory.canGoBack(), fwd: wc.navigationHistory.canGoForward(), erro: wc.__err || null };
    };
    const apps = {};
    for (const key of this.views.keys()) if (key.startsWith('app:')) apps[key.slice(4)] = info(key);
    return {
      tabs: this.tabs().map(t => ({ id: t.id, url: t.url, titulo: t.title || hostOf(t.url) || 'Separador novo', favicon: t.favicon || '' })),
      atual: cur ? cur.id : null,
      pagina: cur ? (info('tab:' + cur.id) || { url: cur.url === 'about:blank' ? '' : cur.url, titulo: cur.title, loading: false, back: false, fwd: false }) : null,
      apps,
      espaco: S.espacoAtual
    };
  }
}

module.exports = { Web, toURL, hostOf };

'use strict';
/*
 * Zeus — processo principal.
 * A janela tem uma vista de interface (src/ui) por baixo e, por cima, vistas
 * Chromium para cada separador, para cada app da barra e para o Claude.
 * Todas as páginas web correm em sandbox, sem acesso ao Node nem ao sistema.
 */
const {
  app, BrowserWindow, WebContentsView, session, ipcMain, Menu, dialog,
  clipboard, shell, nativeTheme, Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, uninstallExtension } = require('electron-chrome-web-store');
const { Updater } = require('./updater');
const PKG = require('../package.json');

const isMac = process.platform === 'darwin';
const PARTITION = 'persist:zeus';
const NEWTAB = 'zeus://nova';
const WEBSTORE = 'https://chromewebstore.google.com/';

app.setName('Zeus');
if (!app.requestSingleInstanceLock()) { app.quit(); }

/* ------------------------------------------------------------------ */
/* Estado guardado                                                     */
/* ------------------------------------------------------------------ */
const DEFAULT_APPS = [
  { id: 'apolo', name: 'Apolo', url: '', mode: 'full', icon: 'apolo', preload: false },
  { id: 'wa', name: 'WhatsApp', url: 'https://web.whatsapp.com/', mode: 'full', icon: 'wa', preload: true },
  { id: 'mail', name: 'Email', url: 'https://mail.google.com/', mode: 'full', icon: 'mail', preload: true },
  { id: 'cal', name: 'Calendário', url: 'https://calendar.google.com/', mode: 'full', icon: 'cal', preload: false },
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so/', mode: 'full', icon: 'notion', preload: false },
  { id: 'pmail', name: 'Proton Mail', url: 'https://mail.proton.me/', mode: 'full', icon: 'pmail', preload: true },
  { id: 'pluto', name: 'Pluto', url: '', mode: 'full', icon: 'pluto', preload: false }
];
const DEFAULT_SPACES = [
  { id: 'obs', name: 'Observador' },
  { id: 'pod', name: 'Podcasts' },
  { id: 'pes', name: 'Pessoal' }
];
const DEFAULT_SETTINGS = {
  tabMode: 'mosaic',          // mosaic | top | right
  theme: 'dark',              // dark | light | system
  search: 'google',           // google | duckduckgo | startpage | brave
  city: { name: 'Lisboa', lat: 38.7223, lon: -9.1393 },
  newtabMode: 'web',          // web | claude
  restoreTabs: true,          // ao abrir, retomar os separadores da última vez
  panelWidth: 420,            // largura do painel das apps ao lado
  claudeWidth: 420,
  autoUpdate: true,
  updateRepo: ''              // utilizador/repositório no GitHub com as versões do Zeus
};
const SCHEMA = 2;
const SEARCH = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  startpage: 'https://www.startpage.com/do/search?q=',
  brave: 'https://search.brave.com/search?q='
};

let S = {
  tabs: [],               // {id, url, title, favicon, space}
  currentId: null,
  mru: [],
  spaces: DEFAULT_SPACES,
  later: [],              // {url, title, space}
  closed: [],
  apps: DEFAULT_APPS,
  settings: DEFAULT_SETTINGS,
  permissions: {},        // "origem|permissão" -> true/false
  visits: {},             // origem -> {n, title, url}
  bounds: null,
  claudeOpen: false
};
let nextId = 1;

const stateFile = () => path.join(app.getPath('userData'), 'zeus-state.json');
function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    S = Object.assign(S, saved);
    S.settings = Object.assign({}, DEFAULT_SETTINGS, saved.settings || {});
    // versão 0.2: todas as apps passam a abrir em página inteira por defeito
    if (!saved.schema || saved.schema < 2) (S.apps || []).forEach(a => { a.mode = 'full'; });
    // apps novas por defeito entram sem apagar as do João
    const ids = new Set(S.apps.map(a => a.id));
    DEFAULT_APPS.forEach(a => { if (!ids.has(a.id) && !(saved.removedApps || []).includes(a.id)) S.apps.push(a); });
  } catch (e) { /* primeiro arranque */ }
  if (!S.settings.updateRepo && PKG.zeus && PKG.zeus.updateRepo) S.settings.updateRepo = PKG.zeus.updateRepo;
  S.tabs = (S.tabs || []).filter(t => t && t.url);
  if (!S.settings.restoreTabs && S.tabs.length) {
    // começa limpo, mas os separadores da última vez ficam em "Fechados há pouco"
    S.closed = [...S.tabs.filter(t => t.url !== NEWTAB).map(t => ({ url: t.url, title: t.title, space: t.space, favicon: t.favicon })), ...(S.closed || [])].slice(0, 15);
    S.tabs = [];
  }
  S.tabs.forEach(t => { t.id = nextId++; delete t.loading; delete t.error; delete t.audible; });
  const curIdx = typeof S.currentIndex === 'number' ? S.currentIndex : 0;
  if (!S.tabs.length) S.tabs.push({ id: nextId++, url: NEWTAB, title: 'Página nova', space: S.spaces[0].id });
  S.currentId = (S.tabs[curIdx] || S.tabs[0]).id;
  S.mru = [S.currentId];
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  try {
    const out = {
      schema: SCHEMA,
      tabs: S.tabs.map(t => ({ url: t.url, title: t.title, favicon: t.favicon, space: t.space })),
      currentIndex: Math.max(0, S.tabs.findIndex(t => t.id === S.currentId)),
      spaces: S.spaces, later: S.later.slice(0, 40), closed: S.closed.slice(0, 15),
      apps: S.apps, removedApps: S.removedApps || [], settings: S.settings, permissions: S.permissions,
      visits: S.visits, bounds: win && !win.isDestroyed() ? win.getNormalBounds() : S.bounds,
      claudeOpen: S.claudeOpen
    };
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(out, null, 1));
  } catch (e) { console.error('Falha a gravar o estado', e); }
}

/* ------------------------------------------------------------------ */
/* Janela, vistas e disposição                                         */
/* ------------------------------------------------------------------ */
let win = null;
let ui = null;
let zeusSession = null;
let extensions = null;
const tabViews = new Map();   // id do separador -> WebContentsView
const appViews = new Map();   // id da app -> WebContentsView
let claudeView = null;
const thumbs = new Map();     // id do separador -> dataURL
const badges = {};            // id da app -> número
const appErrors = {};         // id da app -> erro de carregamento
let openPanel = null;         // app aberta ao lado
let fullApp = null;           // app aberta em página inteira
let fullscreenView = null;    // vista em ecrã inteiro (vídeo)
let L = { page: null, panel: null, claude: null, overlay: false };

const cur = () => S.tabs.find(t => t.id === S.currentId);
const tabById = id => S.tabs.find(t => t.id === id);
const appById = id => S.apps.find(a => a.id === id);

/*
 * Início de sessão da Google: a Google bloqueia browsers feitos com Electron.
 * Só na página accounts.google.com o Zeus apresenta-se como Firefox (cabeçalhos,
 * navigator.userAgent e sem as "client hints" do Chromium). O resto da web vê o Zeus como Chrome.
 */
const GOOGLE_LOGIN = /^https:\/\/accounts\.google\.com(\/|$)/i;
function firefoxUA() {
  // versão atual aproximada do Firefox (sai uma a cada 4 semanas desde a 140, de 24/06/2025), menos uma por prudência
  const v = 140 + Math.max(0, Math.floor((Date.now() - Date.UTC(2025, 5, 24)) / (28 * 86400000)) - 1);
  const plat = isMac ? 'Macintosh; Intel Mac OS X 10.15' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${plat}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
}
function setupGoogleSignin(ses) {
  const ff = firefoxUA();
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (d, cb) => {
    const h = Object.assign({}, d.requestHeaders);
    h['User-Agent'] = ff;
    for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
    cb({ requestHeaders: h });
  });
  try { ses.registerPreloadScript({ type: 'frame', id: 'zeus-google-signin', filePath: path.join(__dirname, 'preload-google.js') }); }
  catch (e) { console.error('preload da Google', e); }
}
function googleUA(wc, url) {
  try {
    const want = GOOGLE_LOGIN.test(url || '') ? firefoxUA() : chromeUA();
    if (wc.getUserAgent() !== want) wc.setUserAgent(want);
  } catch (e) { /* ok */ }
}

function chromeUA() {
  return session.defaultSession.getUserAgent()
    .replace(/\s?Electron\/\S+/i, '')
    .replace(/\s?Zeus\/\S+/i, '');
}

const WEB_PREFS = () => ({
  session: zeusSession,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  safeDialogs: true,
  spellcheck: true
});

function createWindow() {
  const b = S.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1440, height: b.height || 900, x: b.x, y: b.y,
    minWidth: 900, minHeight: 600,
    title: 'Zeus',
    backgroundColor: '#0b0b0c',
    show: false,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: '#0b0b0c', symbolColor: '#f6f6f4', height: 40 } }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'build', 'preload-ui.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  ui = win.webContents;
  ui.on('will-navigate', e => e.preventDefault());
  ui.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) newTab({ url }); return { action: 'deny' }; });
  ui.on('before-input-event', (e, input) => {
    // atalhos vindos da interface; o Option é tratado pela própria interface
    if (input.type === 'keyDown' && (input.meta || input.control) && /^[1-9]$/.test(input.key) && !input.alt) {
      e.preventDefault(); jumpInSpace(+input.key);
    }
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { win.show(); });
  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('close', saveNow);
  win.on('closed', () => { win = null; });
  win.on('blur', () => ui && ui.send('alt', 'blur'));
}

function applyLayout() {
  if (!win) return;
  const ov = L.overlay;
  const t = cur();
  // separadores
  for (const [id, view] of tabViews) {
    const tab = tabById(id);
    const show = !ov && !fullApp && id === S.currentId && tab && !tab.error && tab.url !== NEWTAB && L.page;
    if (show) view.setBounds(L.page);
    view.setVisible(!!show);
  }
  // apps
  for (const [id, view] of appViews) {
    let rect = null;
    if (!ov && !appErrors[id] && fullApp === id && L.page) rect = L.page;
    else if (!ov && !appErrors[id] && openPanel === id && L.panel) rect = L.panel;
    if (rect) view.setBounds(rect);
    view.setVisible(!!rect);
  }
  // Claude
  if (claudeView) {
    const show = !ov && S.claudeOpen && L.claude;
    if (show) claudeView.setBounds(L.claude);
    claudeView.setVisible(!!show);
  }
  // vídeo em ecrã inteiro por cima de tudo
  if (fullscreenView) {
    const [w, h] = win.getContentSize();
    fullscreenView.setBounds({ x: 0, y: 0, width: w, height: h });
    fullscreenView.setVisible(true);
  }
  void t;
}

let pushTimer = null;
function pushState(now) {
  if (!ui || ui.isDestroyed()) return;
  const send = () => {
    pushTimer = null;
    const view = cur() && tabViews.get(S.currentId);
    const wc = view && view.webContents;
    ui.send('state', {
      tabs: S.tabs.map(t => ({
        id: t.id, url: t.url, title: t.title || hostOf(t.url) || 'Página nova', favicon: t.favicon || '',
        space: t.space, loading: !!t.loading, error: t.error || null, audible: !!t.audible
      })),
      currentId: S.currentId,
      mru: S.mru,
      canGoBack: !!(wc && wc.navigationHistory.canGoBack()),
      canGoForward: !!(wc && wc.navigationHistory.canGoForward()),
      spaces: S.spaces, later: S.later, closed: S.closed,
      apps: S.apps.map(a => Object.assign({}, a, { badge: badges[a.id] || 0, loaded: appViews.has(a.id), error: appErrors[a.id] || null })),
      openPanel, fullApp, claudeOpen: S.claudeOpen,
      settings: S.settings,
      topSites: topSites(),
      platform: process.platform,
      versions: { zeus: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome }
    });
  };
  if (now) { clearTimeout(pushTimer); send(); }
  else if (!pushTimer) pushTimer = setTimeout(send, 60);
}

/* ------------------------------------------------------------------ */
/* Comportamento comum às vistas web                                   */
/* ------------------------------------------------------------------ */
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }

function toURL(input) {
  const s = String(input || '').trim();
  if (!s) return NEWTAB;
  if (/^(https?|file|about|chrome-extension):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return (SEARCH[S.settings.search] || SEARCH.google) + encodeURIComponent(s);
}

function wireWeb(wc, kind) {
  wc.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(wc, d.url); });
  // Option (Mac) / Alt (Windows): a interface decide se é o mosaico ou uma combinação de teclas
  wc.on('before-input-event', (e, input) => {
    if (input.key === 'Alt') { lastAltWC = wc; ui && ui.send('alt', input.type === 'keyDown' ? 'down' : 'up'); return; }
    if (input.type === 'keyDown' && input.alt) ui && ui.send('alt', 'chord');
    if (input.type === 'keyDown' && (input.meta || input.control) && !input.alt && /^[1-9]$/.test(input.key)) {
      e.preventDefault(); jumpInSpace(+input.key);
    }
  });

  wc.setWindowOpenHandler(({ url, disposition, features }) => {
    if (/^(mailto|tel):/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    if (!/^(https?:|about:blank|chrome-extension:)/i.test(url)) return { action: 'deny' };
    const isPopup = disposition === 'new-window' || (features && /width|height|popup/i.test(features));
    if (isPopup) {
      // janelas de início de sessão (Google, Microsoft…) precisam do window.opener
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 700, parent: win, autoHideMenuBar: true, backgroundColor: '#ffffff',
          webPreferences: WEB_PREFS()
        }
      };
    }
    newTab({ url, activate: disposition !== 'background-tab', space: spaceForOpener(kind) });
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child, details) => {
    const cw = child.webContents;
    cw.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) newTab({ url }); return { action: 'deny' }; });
    cw.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(cw, d.url); });
    // janelas de início de sessão que abrem diretamente na Google
    if (details && !details.postBody && GOOGLE_LOGIN.test(details.url || '')) { googleUA(cw, details.url); cw.loadURL(details.url).catch(() => {}); }
  });

  wc.on('will-attach-webview', e => e.preventDefault());
  wc.on('context-menu', (e, p) => contextMenu(wc, p));
}

let lastAltWC = null;  // página onde se carregou no Option pela última vez
function spaceForOpener() { const t = cur(); return t ? t.space : S.spaces[0].id; }

function contextMenu(wc, p) {
  const items = [];
  const short = s => (s.length > 28 ? s.slice(0, 28) + '…' : s);
  if (p.misspelledWord && p.dictionarySuggestions.length) {
    p.dictionarySuggestions.slice(0, 4).forEach(sug => items.push({ label: sug, click: () => wc.replaceMisspelling(sug) }));
    items.push({ type: 'separator' });
  }
  if (p.linkURL) {
    items.push(
      { label: 'Abrir num separador novo', click: () => newTab({ url: p.linkURL, activate: false }) },
      { label: 'Copiar endereço do link', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' }
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      { label: 'Abrir imagem num separador novo', click: () => newTab({ url: p.srcURL, activate: false }) },
      { label: 'Copiar imagem', click: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Guardar imagem…', click: () => wc.downloadURL(p.srcURL) },
      { type: 'separator' }
    );
  }
  if (p.isEditable) {
    items.push(
      { role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' },
      { role: 'selectAll', label: 'Selecionar tudo' }
    );
  } else if (p.selectionText && p.selectionText.trim()) {
    const txt = p.selectionText.trim();
    items.push(
      { role: 'copy', label: 'Copiar' },
      { label: `Pesquisar “${short(txt)}”`, click: () => newTab({ url: toURL(txt.includes(' ') ? txt : txt + ' ') }) },
      { label: 'Perguntar ao Claude sobre isto', click: () => sendToClaude(`Sobre este excerto de ${wc.getURL()}:\n\n"${txt.slice(0, 4000)}"\n\n`) }
    );
  } else {
    const h = wc.navigationHistory;
    items.push(
      { label: 'Retroceder', enabled: h.canGoBack(), click: () => h.goBack() },
      { label: 'Avançar', enabled: h.canGoForward(), click: () => h.goForward() },
      { label: 'Recarregar', click: () => wc.reload() }
    );
  }
  try {
    const ext = extensions ? extensions.getContextMenuItems(wc, p) : [];
    if (ext.length) { items.push({ type: 'separator' }); ext.forEach(i => items.push(i)); }
  } catch (e) { /* sem itens de extensões */ }
  items.push({ type: 'separator' }, { label: 'Inspecionar', click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup({ window: win });
}

/* ------------------------------------------------------------------ */
/* Separadores                                                          */
/* ------------------------------------------------------------------ */
function ensureTabView(tab) {
  if (tabViews.has(tab.id) || tab.url === NEWTAB) return tabViews.get(tab.id);
  const view = new WebContentsView({ webPreferences: WEB_PREFS() });
  view.setBackgroundColor('#ffffff');
  const wc = view.webContents;
  tabViews.set(tab.id, view);
  win.contentView.addChildView(view);
  view.setVisible(false);
  wireWeb(wc, 'tab');
  try { extensions.addTab(wc, win); } catch (e) { /* extensões opcionais */ }

  const id = tab.id;
  const T = () => tabById(id);
  wc.on('page-title-updated', (e, title) => { const t = T(); if (t) { t.title = title; pushState(); saveState(); } });
  wc.on('page-favicon-updated', (e, fav) => { const t = T(); if (t) { t.favicon = fav[0] || ''; pushState(); } });
  const onNav = (e, url) => {
    const t = T(); if (!t) return;
    t.url = url; pushState(); saveState();
    const o = originOf(url);
    if (o && /^https?:/.test(o)) {
      const v = S.visits[o] || { n: 0 };
      v.n++; v.url = o + '/'; v.title = hostOf(url); S.visits[o] = v;
    }
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) onNav(e, url); });
  wc.on('did-start-loading', () => { const t = T(); if (t) { t.loading = true; pushState(); } });
  wc.on('did-stop-loading', () => { const t = T(); if (t) { t.loading = false; pushState(); } });
  wc.on('did-start-navigation', d => {
    if (!d.isMainFrame || d.isSameDocument) return;
    const t = T(); if (t && t.error) { t.error = null; applyLayout(); pushState(); }
  });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = navegação interrompida pelo próprio utilizador
    const t = T(); if (!t) return;
    t.error = { code, desc, url };
    applyLayout(); pushState();
  });
  wc.on('render-process-gone', (e, d) => {
    const t = T(); if (!t) return;
    t.error = { code: 'crash', desc: d.reason, url: t.url };
    applyLayout(); pushState();
  });
  wc.on('audio-state-changed', e => { const t = T(); if (t) { t.audible = e.audible; pushState(); } });
  wc.on('enter-html-full-screen', () => {
    fullscreenView = view;
    win.contentView.removeChildView(view); win.contentView.addChildView(view);
    if (!win.isFullScreen()) { win.setFullScreen(true); win.__zeusAutoFs = true; }
    applyLayout();
  });
  wc.on('leave-html-full-screen', () => {
    fullscreenView = null;
    if (win.__zeusAutoFs) { win.setFullScreen(false); win.__zeusAutoFs = false; }
    applyLayout();
  });
  wc.on('found-in-page', (e, r) => ui.send('find-result', { active: r.activeMatchOrdinal, total: r.matches }));
  wc.loadURL(tab.url).catch(() => { /* tratado em did-fail-load */ });
  return view;
}

function destroyTabView(id) {
  const view = tabViews.get(id);
  if (!view) return;
  try { extensions.removeTab(view.webContents); } catch (e) { /* ok */ }
  win.contentView.removeChildView(view);
  view.webContents.close();
  tabViews.delete(id);
  thumbs.delete(id);
}

async function captureThumb(id) {
  const view = tabViews.get(id);
  if (!view || !L.page || L.overlay) return;
  try {
    const img = await view.webContents.capturePage();
    if (!img.isEmpty()) thumbs.set(id, 'data:image/jpeg;base64,' + img.resize({ width: 560, quality: 'good' }).toJPEG(72).toString('base64'));
  } catch (e) { /* sem miniatura */ }
}

function newTab({ url, space, activate = true, title } = {}) {
  const tab = {
    id: nextId++,
    url: url ? toURL(url) : NEWTAB,
    title: title || (url ? hostOf(toURL(url)) : 'Página nova'),
    space: space || (cur() ? cur().space : S.spaces[0].id)
  };
  S.tabs.push(tab);
  if (activate) openTab(tab.id);
  else { ensureTabView(tab); pushState(); saveState(); }
  return tab;
}

function openTab(id) {
  const tab = tabById(id);
  if (!tab) return;
  const prev = S.currentId;
  if (prev !== id) captureThumb(prev);
  S.currentId = id;
  fullApp = null;
  S.mru = [id, ...S.mru.filter(x => x !== id && tabById(x))];
  const view = ensureTabView(tab);
  if (view) { try { extensions.selectTab(view.webContents); } catch (e) { /* ok */ } }
  applyLayout();
  if (view && !L.overlay) view.webContents.focus();
  else ui && ui.focus();
  pushState(true); saveState();
}

function removeTab(id, into) {
  const i = S.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = S.tabs.splice(i, 1);
  if (t.url !== NEWTAB) into.unshift({ url: t.url, title: t.title, space: t.space, favicon: t.favicon });
  destroyTabView(id);
  S.mru = S.mru.filter(x => x !== id);
  if (!S.tabs.length) { newTab({ space: t.space }); return; }
  if (S.currentId === id) {
    const next = S.mru.find(x => tabById(x)) || S.tabs[Math.min(i, S.tabs.length - 1)].id;
    openTab(next);
  } else { pushState(); saveState(); }
}
const closeTab = id => { removeTab(id, S.closed); S.closed = S.closed.slice(0, 15); };
const laterTab = id => removeTab(id, S.later);

function navigate(input) {
  const url = toURL(input);
  let tab = cur();
  if (!tab) tab = newTab({ url });
  if (url === NEWTAB) { tab.url = NEWTAB; destroyTabView(tab.id); applyLayout(); pushState(); return; }
  fullApp = null;
  if (!tabViews.has(tab.id)) { tab.url = url; ensureTabView(tab); }
  else { tab.error = null; tabViews.get(tab.id).webContents.loadURL(url).catch(() => {}); }
  applyLayout();
  tabViews.get(tab.id).webContents.focus();
  pushState(); saveState();
}

function navAction(a) {
  const tab = cur(); if (!tab) return;
  const view = tabViews.get(tab.id);
  if (a === 'retry' && tab.error) { const u = tab.error.url || tab.url; tab.error = null; if (view) view.webContents.loadURL(u).catch(() => {}); applyLayout(); pushState(); return; }
  if (!view) return;
  const wc = view.webContents;
  if (a === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (a === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (a === 'reload') wc.reload();
  if (a === 'hardreload') wc.reloadIgnoringCache();
  if (a === 'stop') wc.stop();
}

function jumpInSpace(n) {
  const t = cur(); if (!t) return;
  const list = S.tabs.filter(x => x.space === t.space);
  if (list[n - 1]) openTab(list[n - 1].id);
}

function topSites() {
  return Object.values(S.visits).sort((a, b) => b.n - a.n).slice(0, 6).map(v => ({ url: v.url, title: v.title }));
}

/* ------------------------------------------------------------------ */
/* Apps da barra                                                        */
/* ------------------------------------------------------------------ */
function ensureAppView(a) {
  if (appViews.has(a.id)) return appViews.get(a.id);
  if (!a.url) return null;
  const view = new WebContentsView({ webPreferences: WEB_PREFS() });
  view.setBackgroundColor('#ffffff');
  appViews.set(a.id, view);
  win.contentView.addChildView(view);
  view.setVisible(false);
  const wc = view.webContents;
  wireWeb(wc, 'app');
  try { extensions.addTab(wc, win); } catch (e) { /* ok */ }
  wc.on('page-title-updated', (e, title) => {
    const m = /\((\d+)\)/.exec(title) || /^(\d+)\s/.exec(title);
    const n = m ? parseInt(m[1], 10) : 0;
    if (badges[a.id] !== n) { badges[a.id] = n; pushState(); }
  });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    appErrors[a.id] = { code, desc, url }; applyLayout(); pushState();
  });
  wc.on('did-start-navigation', d => {
    if (d.isMainFrame && !d.isSameDocument && appErrors[a.id]) { delete appErrors[a.id]; applyLayout(); pushState(); }
  });
  wc.loadURL(a.url).catch(() => {});
  return view;
}
function destroyAppView(id) {
  const view = appViews.get(id); if (!view) return;
  try { extensions.removeTab(view.webContents); } catch (e) { /* ok */ }
  win.contentView.removeChildView(view);
  view.webContents.close();
  appViews.delete(id);
  delete badges[id];
  delete appErrors[id];
}
function openApp(id) {
  const a = appById(id); if (!a || !a.url) return;
  const view = ensureAppView(a);
  if (a.mode === 'full') {
    fullApp = fullApp === id ? null : id;
    if (openPanel === id) openPanel = null;
  } else {
    openPanel = openPanel === id ? null : id;
    if (fullApp === id) fullApp = null;
  }
  applyLayout();
  if (view && (fullApp === id || openPanel === id)) { view.webContents.focus(); try { extensions.selectTab(view.webContents); } catch (e) { /* ok */ } }
  pushState(true);
}
function closeAppViews() { openPanel = null; fullApp = null; applyLayout(); pushState(true); }
function setAppMode(id, mode) {
  const a = appById(id); if (!a) return;
  a.mode = mode === 'full' ? 'full' : 'side';
  const wasOpen = openPanel === id || fullApp === id;
  if (openPanel === id) openPanel = null;
  if (fullApp === id) fullApp = null;
  if (wasOpen) { if (a.mode === 'full') fullApp = id; else openPanel = id; }
  applyLayout(); pushState(true); saveState();
}
function addApp({ name, url, mode }) {
  const u = toURL(url);
  if (!/^https?:/.test(u)) return { ok: false, error: 'Escreve um endereço web válido, por exemplo web.telegram.org.' };
  const id = 'a' + Date.now().toString(36);
  S.apps.push({ id, name: (name || hostOf(u)).slice(0, 24), url: u, mode: mode === 'side' ? 'side' : 'full', icon: '', preload: false });
  saveState(); pushState(true);
  return { ok: true, id };
}
function updateApp(id, patch) {
  const a = appById(id); if (!a) return { ok: false };
  if (patch.url !== undefined) {
    const u = toURL(patch.url);
    if (!/^https?:/.test(u)) return { ok: false, error: 'Escreve um endereço web válido.' };
    if (u !== a.url) { a.url = u; destroyAppView(id); }
  }
  if (patch.name) a.name = String(patch.name).slice(0, 24);
  if (patch.mode) a.mode = patch.mode === 'full' ? 'full' : 'side';
  saveState(); pushState(true);
  return { ok: true };
}
function removeApp(id) {
  destroyAppView(id);
  S.apps = S.apps.filter(a => a.id !== id);
  if (DEFAULT_APPS.some(a => a.id === id)) S.removedApps = [...new Set([...(S.removedApps || []), id])];
  if (openPanel === id) openPanel = null;
  if (fullApp === id) fullApp = null;
  applyLayout(); saveState(); pushState(true);
}
function appMenu(id) {
  const a = appById(id); if (!a) return;
  const view = appViews.get(id);
  Menu.buildFromTemplate([
    { label: 'Abrir ao lado', type: 'radio', checked: a.mode === 'side', click: () => setAppMode(id, 'side') },
    { label: 'Abrir em página inteira', type: 'radio', checked: a.mode === 'full', click: () => setAppMode(id, 'full') },
    { type: 'separator' },
    { label: 'Recarregar', enabled: !!view, click: () => view && view.webContents.reload() },
    { label: 'Editar nome e endereço…', click: () => ui.send('ui-command', { cmd: 'edit-app', id }) },
    { type: 'separator' },
    { label: 'Remover da barra', click: () => removeApp(id) }
  ]).popup({ window: win });
}

/* ------------------------------------------------------------------ */
/* Claude                                                               */
/* ------------------------------------------------------------------ */
function ensureClaudeView() {
  if (claudeView) return claudeView;
  claudeView = new WebContentsView({ webPreferences: WEB_PREFS() });
  claudeView.setBackgroundColor('#ffffff');
  win.contentView.addChildView(claudeView);
  claudeView.setVisible(false);
  wireWeb(claudeView.webContents, 'claude');
  claudeView.webContents.loadURL('https://claude.ai/new').catch(() => {});
  return claudeView;
}
function setClaude(open) {
  S.claudeOpen = !!open;
  if (open) ensureClaudeView();
  applyLayout(); pushState(true); saveState();
  if (open && claudeView) claudeView.webContents.focus();
}
function whenLoaded(wc) {
  return new Promise(res => {
    if (!wc.isLoading()) return res();
    wc.once('did-stop-loading', () => res());
    setTimeout(res, 8000);
  });
}
async function sendToClaude(text) {
  setClaude(true);
  const wc = claudeView.webContents;
  await whenLoaded(wc);
  let ok = false;
  for (let i = 0; i < 6 && !ok; i++) {
    try {
      ok = await wc.executeJavaScript(`(function(t){
        var el=document.querySelector('div[contenteditable="true"]');
        if(!el) return false;
        el.focus();
        return document.execCommand('insertText', false, t);
      })(${JSON.stringify(text)})`);
    } catch (e) { ok = false; }
    if (!ok) await new Promise(r => setTimeout(r, 700));
  }
  if (!ok) {
    clipboard.writeText(text);
    ui.send('toast', 'Não consegui escrever no Claude. Copiei o texto: cola-o com ⌘V.');
  } else wc.focus();
  return ok;
}
async function sendPageToClaude() {
  const tab = cur();
  let view = null;
  if (fullApp) view = appViews.get(fullApp);
  else if (tab) view = tabViews.get(tab.id);
  if (!view) { ui.send('toast', 'Abre uma página primeiro.'); return; }
  let info = null;
  try {
    // lido num mundo isolado: a página não consegue alterar o que é lido
    info = await view.webContents.executeJavaScriptInIsolatedWorld(1001, [{
      code: `({title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 15000)})`
    }]);
  } catch (e) { info = null; }
  if (!info) { ui.send('toast', 'Não foi possível ler esta página.'); return; }
  const cut = info.text.length >= 15000 ? '\n\n[texto cortado]' : '';
  await sendToClaude(`Página: ${info.title}\n${info.url}\n\n${info.text}${cut}\n\n---\n`);
}

/* ------------------------------------------------------------------ */
/* Permissões                                                           */
/* ------------------------------------------------------------------ */
const AUTO_ALLOW = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'notifications', 'persistent-storage', 'speaker-selection']);
const ASK = {
  media: 'usar a câmara ou o microfone',
  geolocation: 'saber a tua localização',
  'display-capture': 'gravar o teu ecrã',
  'clipboard-read': 'ler a área de transferência',
  'storage-access': 'aceder aos seus cookies noutros sites',
  'top-level-storage-access': 'aceder aos seus cookies noutros sites',
  'keyboardLock': 'controlar o teclado',
  'idle-detection': 'saber quando estás inativo',
  'window-management': 'gerir janelas no teu ecrã',
  'local-fonts': 'ler os tipos de letra instalados',
  midi: 'usar dispositivos MIDI',
  midiSysex: 'controlar dispositivos MIDI',
  'screen-wake-lock': 'manter o ecrã ligado'
};
function setupPermissions(ses) {
  ses.setPermissionRequestHandler(async (wc, permission, cb, details) => {
    if (AUTO_ALLOW.has(permission)) return cb(true);
    const origin = originOf(details.requestingUrl || (wc && wc.getURL()) || '');
    if (!ASK[permission] || !origin) return cb(false);
    const key = origin + '|' + permission;
    if (key in S.permissions) return cb(S.permissions[key]);
    let what = ASK[permission];
    if (permission === 'media' && details.mediaTypes) {
      const m = details.mediaTypes;
      what = m.includes('video') && m.includes('audio') ? 'usar a câmara e o microfone' : m.includes('video') ? 'usar a câmara' : 'usar o microfone';
    }
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Permitir', 'Bloquear'], defaultId: 1, cancelId: 1,
      message: `${hostOf(origin)} quer ${what}.`,
      detail: 'Podes mudar esta decisão mais tarde nas definições do Zeus.',
      checkboxLabel: 'Lembrar a decisão para este site', checkboxChecked: true
    });
    const ok = r.response === 0;
    if (r.checkboxChecked) { S.permissions[key] = ok; saveState(); }
    cb(ok);
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true;
    const key = (requestingOrigin || '') + '|' + permission;
    return S.permissions[key] === true;
  });
}

/* ------------------------------------------------------------------ */
/* Extensões do Chrome                                                  */
/* ------------------------------------------------------------------ */
async function setupExtensions() {
  extensions = new ElectronChromeExtensions({
    session: zeusSession,
    async createTab(details) {
      const tab = newTab({ url: details.url || 'about:blank', activate: details.active !== false });
      return [ensureTabView(tab).webContents, win];
    },
    selectTab(wc) {
      for (const [id, v] of tabViews) if (v.webContents === wc) return openTab(id);
    },
    removeTab(wc) {
      for (const [id, v] of tabViews) if (v.webContents === wc) return closeTab(id);
    },
    async createWindow(details) {
      const url = Array.isArray(details.url) ? details.url[0] : details.url;
      const w = new BrowserWindow({ width: details.width || 460, height: details.height || 640, parent: win, webPreferences: WEB_PREFS() });
      if (url) w.loadURL(url);
      return w;
    },
    removeWindow(w) { if (w && w !== win && !w.isDestroyed()) w.close(); },
    async requestPermissions(extension, perms) {
      const r = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Permitir', 'Recusar'], defaultId: 1, cancelId: 1,
        message: `A extensão “${extension.name}” pede mais permissões.`,
        detail: [...(perms.permissions || []), ...(perms.origins || [])].join('\n')
      });
      return r.response === 0;
    }
  });
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
  extensions.on('browser-action-popup-created', () => { /* o próprio módulo posiciona o popup */ });

  try {
    await installChromeWebStore({
      session: zeusSession,
      extensionsPath: path.join(app.getPath('userData'), 'Extensions'),
      autoUpdate: true,
      async beforeInstall(details) {
        const r = await dialog.showMessageBox(win, {
          type: 'question', buttons: ['Instalar', 'Cancelar'], defaultId: 0, cancelId: 1,
          message: `Instalar “${details.localizedName}” no Zeus?`,
          detail: 'As extensões podem ler e alterar as páginas que visitas. Instala apenas as que conheces.'
        });
        const allow = r.response === 0;
        if (allow) setTimeout(() => pushExtensions(), 3000);
        return { action: allow ? 'allow' : 'deny' };
      }
    });
  } catch (e) { console.error('Chrome Web Store indisponível', e); }
}
function listExtensions() {
  try {
    return zeusSession.extensions.getAllExtensions().map(x => ({ id: x.id, name: x.name, version: x.version }));
  } catch (e) { return []; }
}
function pushExtensions() { ui && ui.send('extensions', listExtensions()); }

/* ------------------------------------------------------------------ */
/* IPC com a interface                                                  */
/* ------------------------------------------------------------------ */
function fromUI(e) { return ui && e.sender === ui; }
function handle(name, fn) {
  ipcMain.handle(name, (e, ...args) => {
    if (!fromUI(e)) throw new Error('origem não autorizada');
    return fn(...args);
  });
}
function setupIPC() {
  handle('ready', () => { pushState(true); pushExtensions(); return true; });
  handle('layout', rects => {
    const clean = r => (r && r.width > 0 && r.height > 0)
      ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
    const wasOverlay = L.overlay;
    L = { page: clean(rects.page), panel: clean(rects.panel), claude: clean(rects.claude), overlay: !!rects.overlay };
    applyLayout();
    if (L.overlay && !wasOverlay) ui.focus();
    if (!L.overlay && wasOverlay) {
      const v = fullApp ? appViews.get(fullApp) : tabViews.get(S.currentId);
      if (v) v.webContents.focus();
    }
  });
  handle('mosaic:prepare', async () => {
    let bg = '';
    const v = fullApp ? appViews.get(fullApp) : tabViews.get(S.currentId);
    if (v && !L.overlay) {
      try {
        const img = await v.webContents.capturePage();
        if (!img.isEmpty()) {
          bg = 'data:image/jpeg;base64,' + img.resize({ width: 1200, quality: 'good' }).toJPEG(70).toString('base64');
          if (!fullApp) thumbs.set(S.currentId, 'data:image/jpeg;base64,' + img.resize({ width: 560, quality: 'good' }).toJPEG(72).toString('base64'));
        }
      } catch (e) { /* sem fundo */ }
    }
    return { bg, thumbs: Object.fromEntries(thumbs) };
  });
  handle('tab:new', (opts = {}) => { newTab(opts); });
  handle('tab:open', id => openTab(id));
  handle('tab:close', id => closeTab(id));
  handle('tab:later', id => laterTab(id));
  handle('tab:move', (id, space) => { const t = tabById(id); if (t && S.spaces.some(s => s.id === space)) { t.space = space; pushState(); saveState(); } });
  handle('tab:restore', (list, i) => {
    const arr = list === 'later' ? S.later : S.closed;
    const item = arr.splice(i, 1)[0];
    if (item) newTab({ url: item.url, space: item.space, title: item.title });
  });
  handle('tab:reopen', () => { const item = S.closed.shift(); if (item) newTab({ url: item.url, space: item.space, title: item.title }); });
  handle('navigate', input => navigate(input));
  handle('nav', a => navAction(a));
  handle('find', (q, opts) => {
    const v = tabViews.get(S.currentId); if (!v) return;
    if (!q) { v.webContents.stopFindInPage('clearSelection'); return; }
    v.webContents.findInPage(q, opts || {});
  });
  handle('space:add', name => {
    const nm = String(name || '').trim().slice(0, 30); if (!nm) return;
    S.spaces.push({ id: 's' + Date.now().toString(36), name: nm }); pushState(); saveState();
  });
  handle('space:rename', (id, name) => {
    const s = S.spaces.find(x => x.id === id); const nm = String(name || '').trim().slice(0, 30);
    if (s && nm) { s.name = nm; pushState(); saveState(); }
  });
  handle('space:remove', id => {
    if (S.spaces.length <= 1) return;
    const first = S.spaces.find(s => s.id !== id);
    S.tabs.forEach(t => { if (t.space === id) t.space = first.id; });
    S.spaces = S.spaces.filter(s => s.id !== id); pushState(); saveState();
  });
  handle('app:open', id => openApp(id));
  handle('app:close', () => closeAppViews());
  handle('app:mode', (id, mode) => setAppMode(id, mode));
  handle('app:add', d => addApp(d || {}));
  handle('app:update', (id, patch) => updateApp(id, patch || {}));
  handle('app:remove', id => removeApp(id));
  handle('app:menu', id => appMenu(id));
  handle('app:reorder', ids => {
    if (!Array.isArray(ids)) return;
    const byId = new Map(S.apps.map(a => [a.id, a]));
    const next = ids.map(id => byId.get(id)).filter(Boolean);
    S.apps.forEach(a => { if (!next.includes(a)) next.push(a); });
    S.apps = next; saveState(); pushState(true);
  });
  handle('page:insertText', text => {
    const wc = lastAltWC;
    if (!wc || wc.isDestroyed()) return;
    const t = String(text || '').slice(0, 4);
    wc.focus();
    if (t) wc.insertText(t);
  });
  handle('app:reload', id => { const v = appViews.get(id); const a = appById(id); if (!v) return; delete appErrors[id]; v.webContents.loadURL(a.url).catch(() => {}); applyLayout(); pushState(); });
  handle('claude:toggle', open => setClaude(open === undefined ? !S.claudeOpen : open));
  handle('claude:sendPage', () => sendPageToClaude());
  handle('claude:ask', text => sendToClaude(String(text || '')));
  handle('claude:new', () => { setClaude(true); claudeView.webContents.loadURL('https://claude.ai/new').catch(() => {}); });
  handle('settings:set', (patch = {}) => {
    const ALLOWED = Object.keys(DEFAULT_SETTINGS);
    const clean = {};
    for (const k of Object.keys(patch)) if (ALLOWED.includes(k)) clean[k] = patch[k];
    ['panelWidth', 'claudeWidth'].forEach(k => { if (k in clean) clean[k] = Math.max(280, Math.min(1400, Math.round(+clean[k] || 420))); });
    if ('updateRepo' in clean) clean.updateRepo = String(clean.updateRepo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    S.settings = Object.assign({}, S.settings, clean);
    if (clean.theme) nativeTheme.themeSource = clean.theme === 'system' ? 'system' : clean.theme;
    if (!isMac && clean.theme) updateOverlayColors();
    if ('updateRepo' in clean && updater) updater.check(true);
    pushState(true); saveState();
  });
  handle('permissions:list', () => Object.entries(S.permissions).map(([k, v]) => { const [o, p] = k.split('|'); return { origin: o, permission: p, allowed: v }; }));
  handle('permissions:forget', key => { delete S.permissions[key]; saveState(); });
  handle('ext:list', () => listExtensions());
  handle('ext:store', () => newTab({ url: WEBSTORE }));
  handle('ext:remove', async id => {
    try { await uninstallExtension(id, { session: zeusSession, extensionsPath: path.join(app.getPath('userData'), 'Extensions') }); }
    catch (e) { try { zeusSession.extensions.removeExtension(id); } catch (_) { /* ok */ } }
    pushExtensions();
  });
  handle('data:clear', async what => {
    if (what === 'cache') await zeusSession.clearCache();
    if (what === 'all') { await zeusSession.clearStorageData(); await zeusSession.clearCache(); }
    return true;
  });
  handle('update:status', () => updater ? updater.status : null);
  handle('update:check', () => updater ? updater.check(true) : null);
  handle('update:install', () => updater ? updater.install() : { ok: false });
  handle('ui:focusPage', () => { const v = fullApp ? appViews.get(fullApp) : tabViews.get(S.currentId); if (v) v.webContents.focus(); });
}

let updater = null;
function setupUpdater() {
  updater = new Updater({
    getRepo: () => S.settings.updateRepo,
    isEnabled: () => S.settings.autoUpdate !== false,
    onStatus: st => { if (ui && !ui.isDestroyed()) ui.send('update', st); }
  });
  updater.start();
}

function updateOverlayColors() {
  if (!win || isMac) return;
  const dark = S.settings.theme === 'dark' || (S.settings.theme === 'system' && nativeTheme.shouldUseDarkColors);
  try { win.setTitleBarOverlay({ color: dark ? '#0b0b0c' : '#ffffff', symbolColor: dark ? '#f6f6f4' : '#0b0b0c' }); } catch (e) { /* ok */ }
}

/* ------------------------------------------------------------------ */
/* Menu da aplicação                                                    */
/* ------------------------------------------------------------------ */
function buildMenu() {
  const toUI = cmd => () => ui && ui.send('ui-command', { cmd });
  const curWC = () => { const v = fullApp ? appViews.get(fullApp) : tabViews.get(S.currentId); return v && v.webContents; };
  const template = [
    ...(isMac ? [{
      label: 'Zeus', submenu: [
        { role: 'about', label: 'Acerca do Zeus' },
        { type: 'separator' },
        { label: 'Definições…', accelerator: 'Cmd+,', click: toUI('settings') },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar o Zeus' }, { role: 'hideOthers', label: 'Ocultar os outros' }, { role: 'unhide', label: 'Mostrar tudo' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair do Zeus' }
      ]
    }] : []),
    {
      label: 'Ficheiro', submenu: [
        { label: 'Separador novo', accelerator: 'CmdOrCtrl+T', click: () => newTab() },
        { label: 'Reabrir separador fechado', accelerator: 'CmdOrCtrl+Shift+T', click: () => { const it = S.closed.shift(); if (it) newTab({ url: it.url, space: it.space }); } },
        { label: 'Abrir endereço', accelerator: 'CmdOrCtrl+L', click: toUI('address') },
        { type: 'separator' },
        { label: 'Fechar separador', accelerator: 'CmdOrCtrl+W', click: () => { if (fullApp || openPanel) closeAppViews(); else if (S.currentId) closeTab(S.currentId); } },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'Definições', accelerator: 'Ctrl+,', click: toUI('settings') }, { role: 'quit', label: 'Sair' }])
      ]
    },
    {
      label: 'Editar', submenu: [
        { role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' },
        { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' },
        { role: 'pasteAndMatchStyle', label: 'Colar sem formatação' }, { role: 'selectAll', label: 'Selecionar tudo' },
        { type: 'separator' },
        { label: 'Procurar na página', accelerator: 'CmdOrCtrl+F', click: toUI('find') }
      ]
    },
    {
      label: 'Ver', submenu: [
        { label: 'Separadores (mosaico)', accelerator: 'CmdOrCtrl+E', click: toUI('mosaic') },
        { label: 'Claude', accelerator: 'CmdOrCtrl+Shift+K', click: () => setClaude(!S.claudeOpen) },
        { label: 'Enviar esta página ao Claude', accelerator: 'CmdOrCtrl+Shift+J', click: () => sendPageToClaude() },
        { type: 'separator' },
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => { const w = curWC(); if (w) w.reload(); } },
        { label: 'Recarregar sem cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => { const w = curWC(); if (w) w.reloadIgnoringCache(); } },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamanho real' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Reduzir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Ecrã inteiro' },
        { label: 'Ferramentas de programador', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => { const w = curWC(); if (w) w.toggleDevTools(); } }
      ]
    },
    {
      label: 'Navegar', submenu: [
        { label: 'Retroceder', accelerator: 'CmdOrCtrl+[', click: () => navAction('back') },
        { label: 'Avançar', accelerator: 'CmdOrCtrl+]', click: () => navAction('forward') },
        { type: 'separator' },
        { label: 'Separador seguinte', accelerator: 'Ctrl+Tab', click: () => cycle(1) },
        { label: 'Separador anterior', accelerator: 'Ctrl+Shift+Tab', click: () => cycle(-1) }
      ]
    },
    { role: 'windowMenu', label: 'Janela' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function cycle(d) {
  const t = cur(); if (!t) return;
  const list = S.tabs.filter(x => x.space === t.space);
  const i = list.findIndex(x => x.id === t.id);
  const n = list[(i + d + list.length) % list.length];
  if (n) openTab(n.id);
}

/* ------------------------------------------------------------------ */
/* Arranque                                                             */
/* ------------------------------------------------------------------ */
app.on('web-contents-created', (e, wc) => {
  // regra geral: nada de <webview>, nada de janelas abertas sem passar pelo Zeus
  wc.on('will-attach-webview', ev => ev.preventDefault());
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) newTab({ url }); return { action: 'deny' }; });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  loadState();
  nativeTheme.themeSource = S.settings.theme === 'system' ? 'system' : S.settings.theme;
  app.userAgentFallback = chromeUA();
  zeusSession = session.fromPartition(PARTITION);
  zeusSession.setUserAgent(chromeUA());
  setupPermissions(zeusSession);
  setupGoogleSignin(zeusSession);
  // a interface só fala com o processo principal; não precisa de permissões
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(false));
  setupIPC();
  buildMenu();
  createWindow();
  await setupExtensions();
  setupUpdater();
  // abre o separador atual e carrega em segundo plano as apps com notificações
  const t = cur(); if (t) ensureTabView(t);
  setTimeout(() => { S.apps.filter(a => a.preload && a.url).forEach(a => ensureAppView(a)); applyLayout(); pushState(); }, 2500);
  if (S.claudeOpen) ensureClaudeView();
  applyLayout();
  pushState(true);
  if (Notification.isSupported()) { /* notificações nativas das páginas ficam ativas */ }
});

app.on('window-all-closed', () => { saveNow(); app.quit(); });
app.on('before-quit', saveNow);

'use strict';
/*
 * Zeus — processo principal.
 * A janela tem uma vista de interface (src/ui) por baixo e, por cima, vistas
 * Chromium para cada separador, para cada app da barra e para o Claude.
 * Todas as páginas web correm em sandbox, sem acesso ao Node nem ao sistema.
 */
const {
  app, BrowserWindow, WebContentsView, session, ipcMain, Menu, dialog,
  clipboard, shell, nativeTheme, Notification, ShareMenu } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, uninstallExtension, loadAllExtensions } = require('electron-chrome-web-store');
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
  { id: 'apolo', name: 'Apolo', url: '', mode: 'full', icon: 'apolo', preload: false, linksInTabs: true },
  { id: 'wa', name: 'WhatsApp', url: 'https://web.whatsapp.com/', mode: 'full', icon: 'wa', preload: true, linksInTabs: true },
  { id: 'mail', name: 'Email', url: 'https://mail.google.com/', mode: 'full', icon: 'mail', preload: true, linksInTabs: true },
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
  autoPip: true,
  homeFeeds: [],              // contas Google ligadas à página principal (agenda e tarefas do dia)              // ao sair de um separador com vídeo a tocar, o vídeo fica a flutuar
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
  history: [],            // {url, title, n, t} — endereços visitados, para sugerir ao escrever
  appLast: {},            // id da app -> último endereço (para voltar onde estava)
  bounds: null,
  claudeOpen: false
};
let nextId = 1;

const HISTORY_MAX = 6000;
function remember(url, title) {
  if (!/^https?:/.test(url || '')) return;
  const u = url.replace(/#.*$/, '');
  let h = S.history.find(x => x.url === u);
  if (h) { h.n++; h.t = Date.now(); if (title) h.title = title; S.history = [h, ...S.history.filter(x => x !== h)]; }
  else { S.history.unshift({ url: u, title: title || '', n: 1, t: Date.now() }); if (S.history.length > HISTORY_MAX) S.history.length = HISTORY_MAX; }
}
function retitle(url, title) {
  const u = (url || '').replace(/#.*$/, '');
  const h = S.history.find(x => x.url === u); if (h && title) h.title = title;
}
const bare = u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
// sugestões para o campo de endereço: endereços já visitados que comecem ou contenham o que se escreveu
function suggest(q) {
  q = String(q || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, ''); if (!q) return [];
  const now = Date.now();
  const freshness = t => Math.max(0, 20 - (now - (t || 0)) / 86400000);
  const out = [];
  const sites = new Map();   // site que começa pelo texto escrito → visitas somadas (para sugerir a página principal)
  for (const h of S.history) {
    const b = bare(h.url).toLowerCase(), host = hostOf(h.url), title = (h.title || '').toLowerCase();
    let score = 0;
    if (host.startsWith(q)) score = 100; else if (b.startsWith(q)) score = 80;
    else if (host.split('.').some(p => p.startsWith(q))) score = 50;
    else if (b.includes(q)) score = 30; else if (title.includes(q)) score = 25;
    if (!score) continue;
    if (host.startsWith(q) || host.split('.').some(p => p.startsWith(q))) {
      const st = sites.get(host) || { n: 0, t: 0, title: '', root: false };
      st.n += h.n; st.t = Math.max(st.t, h.t || 0);
      if (b === host) { st.root = true; st.title = h.title; }
      sites.set(host, st);
    }
    score += Math.min(40, Math.log2(1 + h.n) * 8) + freshness(h.t);
    if (b === host) score += 5;  // páginas principais primeiro
    out.push({ url: h.url, title: h.title, score });
  }
  // a página principal de cada site que corresponde ao texto, à frente das páginas soltas desse site
  // (escrever "obs" completa para observador.pt, e não para um artigo qualquer)
  for (const [host, st] of sites) {
    const base = host.startsWith(q) ? 106 : 56;
    out.push({ url: 'https://' + host + '/', title: st.title || host, score: base + Math.min(45, Math.log2(1 + st.n) * 8) + freshness(st.t) });
  }
  out.sort((a, b) => b.score - a.score);
  const seen = new Set(); const res = [];
  for (const o of out) { const k = bare(o.url).toLowerCase(); if (seen.has(k)) continue; seen.add(k); res.push({ url: o.url, title: o.title }); if (res.length >= 7) break; }
  return res;
}
/*
 * Importar o histórico de outro browser (Vivaldi, Chrome, Brave, Edge, Arc) — todos usam o ficheiro "History"
 * do Chromium (SQLite). Copia-se o ficheiro (o browser pode estar aberto) e lê-se com o SQLite do Node.
 */
const OTHER_BROWSERS = [
  { id: 'vivaldi', name: 'Vivaldi', mac: 'Vivaldi', win: 'Vivaldi/User Data', linux: 'vivaldi' },
  { id: 'chrome', name: 'Google Chrome', mac: 'Google/Chrome', win: 'Google/Chrome/User Data', linux: 'google-chrome' },
  { id: 'brave', name: 'Brave', mac: 'BraveSoftware/Brave-Browser', win: 'BraveSoftware/Brave-Browser/User Data', linux: 'BraveSoftware/Brave-Browser' },
  { id: 'edge', name: 'Microsoft Edge', mac: 'Microsoft Edge', win: 'Microsoft/Edge/User Data', linux: 'microsoft-edge' },
  { id: 'arc', name: 'Arc', mac: 'Arc/User Data', win: null, linux: null }
];
function historyFiles(b) {
  const rel = isMac ? b.mac : (process.platform === 'win32' ? b.win : b.linux);
  if (!rel) return [];
  const base = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', rel)
    : path.join(app.getPath('appData'), rel);
  let dirs = [];
  try { dirs = fs.readdirSync(base).filter(n => n === 'Default' || /^Profile \d+$/.test(n)); } catch (e) { return []; }
  return dirs.map(d => path.join(base, d, 'History')).filter(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });
}
function otherBrowsers() { return OTHER_BROWSERS.map(b => ({ id: b.id, name: b.name, profiles: historyFiles(b).length })).filter(b => b.profiles); }
function importHistory(id) {
  const b = OTHER_BROWSERS.find(x => x.id === id); if (!b) return { ok: false, error: 'Browser desconhecido.' };
  const files = historyFiles(b);
  if (!files.length) return { ok: false, error: `Não encontrei o histórico do ${b.name} neste computador.` };
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { return { ok: false, error: 'Esta versão do Zeus não consegue ler o histórico.' }; }
  const byUrl = new Map(S.history.map(h => [h.url, h]));
  let added = 0, seen = 0;
  for (const f of files) {
    const tmp = path.join(app.getPath('temp'), 'zeus-history-' + Date.now() + '.sqlite');
    try {
      fs.copyFileSync(f, tmp);
      const db = new DatabaseSync(tmp, { readOnly: true });
      const rows = db.prepare(`SELECT url, title, visit_count AS n, typed_count AS typed, (last_visit_time / 1000) AS t
        FROM urls WHERE hidden = 0 AND (url LIKE 'http://%' OR url LIKE 'https://%') AND length(url) < 600
        ORDER BY (visit_count + 2 * typed_count) DESC, last_visit_time DESC LIMIT 5000`).all();
      db.close();
      for (const r of rows) {
        seen++;
        const u = String(r.url).replace(/#.*$/, '');
        // tempo do Chromium: microssegundos desde 1601-01-01 (já dividido por 1000 na consulta)
        const t = Math.max(0, Math.round(Number(r.t) - 11644473600000));
        const n = Number(r.n || 0) + 2 * Number(r.typed || 0);
        const h = byUrl.get(u);
        if (h) { h.n = Math.max(h.n, n); h.t = Math.max(h.t || 0, t); if (!h.title && r.title) h.title = String(r.title); }
        else { const x = { url: u, title: String(r.title || ''), n: Math.max(1, n), t }; byUrl.set(u, x); added++; }
      }
    } catch (e) { console.error('Histórico de', f, e.message); }
    finally { try { fs.rmSync(tmp, { force: true }); } catch (e) { /* ok */ } }
  }
  S.history = [...byUrl.values()].sort((a, b2) => (b2.t || 0) - (a.t || 0)).slice(0, HISTORY_MAX);
  saveState();
  return { ok: true, added, seen, name: b.name };
}
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
    // 0.2.8: no Apolo os links abrem em separadores (as outras apps abrem tudo dentro de si)
    S.apps.forEach(a => { if (a.id === 'apolo' && a.linksInTabs === undefined) a.linksInTabs = true; });
    // 0.2.9: o WhatsApp também abre os links em separadores
    if (!saved.waLinks) { S.apps.forEach(a => { if (a.id === 'wa' || hostOf(a.url || '') === 'web.whatsapp.com') a.linksInTabs = true; }); S.waLinks = true; }
    // 0.3.0: o Gmail também abre os links em separadores
    // 0.3.1: na Drive, navegar fica na app; documentos (Docs, Sheets, Slides) abrem em separadores
    if (!saved.driveLinks) { S.apps.forEach(a => { if (hostOf(a.url || '') === 'drive.google.com' && !a.linksInTabs) a.linksInTabs = 'external'; }); }
    if (!saved.gmailLinks) { S.apps.forEach(a => { if (hostOf(a.url || '') === 'mail.google.com') a.linksInTabs = true; }); }
  } catch (e) { /* primeiro arranque */ }
  if (!S.settings.updateRepo && PKG.zeus && PKG.zeus.updateRepo) S.settings.updateRepo = PKG.zeus.updateRepo;
  S.tabs = (S.tabs || []).filter(t => t && t.url);
  if (!Array.isArray(S.history)) S.history = [];
  if (!S.appLast || typeof S.appLast !== 'object') S.appLast = {};
  // primeira vez: o histórico começa com os sites mais visitados
  if (!S.history.length) Object.values(S.visits || {}).forEach(v => { if (v.url) S.history.push({ url: v.url, title: v.title || '', n: v.n || 1, t: Date.now() - 86400000 }); });
  if (!S.settings.restoreTabs && S.tabs.length) {
    // começa limpo, mas os separadores da última vez ficam em "Fechados há pouco"
    S.closed = [...S.tabs.filter(t => t.url !== NEWTAB).map(t => ({ url: t.url, title: t.title, space: t.space, favicon: t.favicon })), ...(S.closed || [])].slice(0, 15);
    S.tabs = [];
  }
  S.tabs.forEach(t => { t.id = nextId++; delete t.loading; delete t.error; delete t.audible; delete t.media; });
  const curIdx = typeof S.currentIndex === 'number' ? S.currentIndex : 0;
  if (!S.tabs.length) S.tabs.push({ id: nextId++, url: NEWTAB, title: 'Página nova', space: S.spaces[0].id });
  S.currentId = (S.tabs[curIdx] || S.tabs[0]).id;
  S.mru = [S.currentId];
  // 0.3.6: passam a ficar no topo os separadores abertos há menos tempo — inverte uma vez a ordem antiga de cada espaço
  if (!S.newestFirst) {
    const bySpace = new Map();
    S.tabs.forEach(t => { if (!bySpace.has(t.space)) bySpace.set(t.space, []); bySpace.get(t.space).push(t); });
    S.tabs = [...bySpace.values()].flatMap(list => list.reverse());
    S.newestFirst = true;
  }
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
      tabs: S.tabs.map(t => ({ url: t.url, title: t.title, favicon: t.favicon, space: t.space, partition: t.partition || null, sessionLabel: t.sessionLabel || null })),
      currentIndex: Math.max(0, S.tabs.findIndex(t => t.id === S.currentId)),
      spaces: S.spaces, later: S.later.slice(0, 40), closed: S.closed.slice(0, 15),
      apps: S.apps, removedApps: S.removedApps || [], waLinks: true, gmailLinks: true, driveLinks: true, newestFirst: true, settings: S.settings, permissions: S.permissions,
      visits: S.visits, history: S.history.slice(0, HISTORY_MAX), appLast: S.appLast, bounds: win && !win.isDestroyed() ? win.getNormalBounds() : S.bounds,
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
let L = { page: null, panel: null, claude: null, overlay: false, cover: false };

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
  try { ses.registerPreloadScript({ type: 'frame', id: 'zeus-pages', filePath: path.join(__dirname, 'preload-pages.js') }); }
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

const WEB_PREFS = ses => ({
  session: ses || zeusSession,
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
    const show = !ov && !L.cover && !fullApp && id === S.currentId && tab && !tab.error && tab.url !== NEWTAB && L.page;
    if (show) view.setBounds(L.page);
    // de volta ao separador do vídeo: o vídeo sai da janela flutuante e volta para a página
    if (show && pipTabs.has(id)) pipExit(id);
    view.setVisible(!!show);
  }
  // apps
  for (const [id, view] of appViews) {
    let rect = null;
    if (!ov && !L.cover && !appErrors[id] && fullApp === id && L.page) rect = L.page;
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
    const view = fullApp ? appViews.get(fullApp) : (cur() && tabViews.get(S.currentId));
    const wc = view && view.webContents;
    ui.send('state', {
      tabs: S.tabs.map(t => ({
        id: t.id, url: t.url, title: t.title || hostOf(t.url) || 'Página nova', favicon: t.favicon || '', sessionLabel: t.sessionLabel || '',
        space: t.space, loading: !!t.loading, error: t.error || null, audible: !!t.audible, media: !!t.media
      })),
      currentId: S.currentId,
      mru: S.mru,
      canGoBack: !!(wc && wc.navigationHistory.canGoBack()),
      canGoForward: !!(wc && wc.navigationHistory.canGoForward()),
      spaces: S.spaces, later: S.later, closed: S.closed,
      apps: S.apps.map(a => Object.assign({}, a, { badge: badges[a.id] || 0, loaded: appViews.has(a.id), error: appErrors[a.id] || null })),
      openPanel, fullApp, fullAppURL: fullApp && wc ? wc.getURL() : '', claudeOpen: S.claudeOpen,
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

function wireWeb(wc, kind, ctx = {}) {
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
          webPreferences: WEB_PREFS(wc.session)
        }
      };
    }
    const opener = kind === 'app' ? appById(ctx.appId) : null;
    // janela em branco que a página vai preencher depois (a Drive faz isto ao abrir um documento):
    // cria-se escondida e, quando tiver endereço, decide-se se vai para a app ou para um separador
    if (kind === 'app' && (!url || url === 'about:blank')) {
      relayNext = { kind, ctx, wc, disposition };
      return { action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences: WEB_PREFS(wc.session) } };
    }
    if (kind === 'app' && linkTarget(opener, wc, url) === 'app') { wc.loadURL(url).catch(() => {}); return { action: 'deny' }; }
    // links de um separador com sessão separada continuam nessa sessão (mesma conta)
    let partition = null, sessionLabel = null;
    if (kind === 'tab' && ctx.tabId) {
      const t = tabById(ctx.tabId);
      if (t) { partition = t.partition || null; sessionLabel = t.sessionLabel || null; }
    } else if (opener && opener.isolated) { partition = appPartition(opener.id); sessionLabel = opener.name; }
    newTab({ url, activate: disposition !== 'background-tab', space: spaceForOpener(kind), partition, sessionLabel });
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child, details) => {
    const cw = child.webContents;
    if (relayNext && relayNext.wc === wc) {
      const r = relayNext; relayNext = null;
      let done = false;
      const finish = url => {
        if (done) return; done = true;
        const op = appById(r.ctx.appId);
        if (url && /^https?:/.test(url)) {
          if (linkTarget(op, wc, url) === 'app') wc.loadURL(url).catch(() => {});
          else newTab({ url, activate: r.disposition !== 'background-tab', space: spaceForOpener(), partition: op && op.isolated ? appPartition(op.id) : null, sessionLabel: op && op.isolated ? op.name : null });
        }
        setImmediate(() => { try { if (!child.isDestroyed()) child.close(); } catch (e) { /* ok */ } });
      };
      cw.on('did-start-navigation', d => { if (d.isMainFrame && /^https?:/.test(d.url)) finish(d.url); });
      cw.setWindowOpenHandler(({ url }) => { finish(url); return { action: 'deny' }; });
      setTimeout(() => finish(null), 15000);
      return;
    }
    cw.setWindowOpenHandler(({ url }) => {
      const op = kind === 'app' ? appById(ctx.appId) : null;
      if (/^https?:/.test(url)) { if (op && linkTarget(op, wc, url) === 'app' && !wc.isDestroyed()) wc.loadURL(url).catch(() => {}); else newTab({ url }); }
      return { action: 'deny' };
    });
    cw.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(cw, d.url); });
    // janelas de início de sessão que abrem diretamente na Google
    if (details && !details.postBody && GOOGLE_LOGIN.test(details.url || '')) { googleUA(cw, details.url); cw.loadURL(details.url).catch(() => {}); }
  });

  wc.on('will-attach-webview', e => e.preventDefault());
  wc.on('context-menu', (e, p) => { const ap = kind === 'app' ? appById(ctx.appId) : null; contextMenu(wc, p, ap && !ap.linksInTabs ? 'app' : kind); });
  // apps com "outros sites em separadores" (ex.: Drive): abrir um documento do Google Docs/Sheets/Slides
  // dentro da própria página vai para um separador, na sessão da app
  if (kind === 'app') wc.on('will-navigate', (e, url) => {
    const ap = appById(ctx.appId);
    if (!ap || ap.linksInTabs !== 'external') return;
    if (hostOf(url) === 'docs.google.com' && hostOf(wc.getURL()) !== 'docs.google.com') {
      e.preventDefault();
      newTab({ url, space: spaceForOpener(), partition: ap.isolated ? appPartition(ap.id) : null, sessionLabel: ap.isolated ? ap.name : null });
    }
  });
}

let relayNext = null;   // janela em branco aberta por uma app, à espera do endereço
/*
 * Para onde vai um link aberto numa app da barra:
 *  - linksInTabs falso → dentro da app;  true → separador novo;
 *  - 'external' → o mesmo site fica na app, outros sites vão para separador (ex.: Drive → Docs/Sheets).
 * Mudar de conta (/u/1/ no mesmo site) e o início de sessão na Google ficam sempre na app.
 */
function linkTarget(app, wc, url) {
  if (!app) return 'tab';
  const here = hostOf(wc.getURL()), there = hostOf(url);
  let accountSwitch = false;
  try { accountSwitch = there === here && /\/u\/\d+(\/|$)/.test(new URL(url).pathname); } catch (e) { /* ok */ }
  if (accountSwitch || there === 'accounts.google.com') return 'app';
  if (app.linksInTabs === 'external') return there === here || there === hostOf(app.url) ? 'app' : 'tab';
  return app.linksInTabs ? 'tab' : 'app';
}
let lastAltWC = null;  // página onde se carregou no Option pela última vez
function spaceForOpener() { const t = cur(); return t ? t.space : S.spaces[0].id; }

function contextMenu(wc, p, kind) {
  const inApp = kind === 'app';
  const openHere = u => wc.loadURL(u).catch(() => {});
  const items = [];
  const short = s => (s.length > 28 ? s.slice(0, 28) + '…' : s);
  if (p.misspelledWord && p.dictionarySuggestions.length) {
    p.dictionarySuggestions.slice(0, 4).forEach(sug => items.push({ label: sug, click: () => wc.replaceMisspelling(sug) }));
    items.push({ type: 'separator' });
  }
  if (p.linkURL) {
    items.push(
      inApp ? { label: 'Abrir aqui', click: () => openHere(p.linkURL) } : { label: 'Abrir num separador novo', click: () => newTab({ url: p.linkURL, activate: false }) },
      { label: 'Copiar endereço do link', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' }
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      inApp ? { label: 'Abrir imagem aqui', click: () => openHere(p.srcURL) } : { label: 'Abrir imagem num separador novo', click: () => newTab({ url: p.srcURL, activate: false }) },
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
      { label: `Pesquisar “${short(txt)}”`, click: () => { const u = toURL(txt.includes(' ') ? txt : txt + ' '); if (inApp) openHere(u); else newTab({ url: u }); } },
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
  let rec = sessionForPartition(tab.partition);
  if (!rec) { tab.partition = null; tab.sessionLabel = null; rec = { ses: zeusSession, ext: extensions }; }
  tabExts.set(tab.id, rec.ext);
  const view = new WebContentsView({ webPreferences: WEB_PREFS(rec.ses) });
  view.setBackgroundColor('#ffffff');
  const wc = view.webContents;
  tabViews.set(tab.id, view);
  win.contentView.addChildView(view);
  view.setVisible(false);
  wireWeb(wc, 'tab', { tabId: tab.id });
  try { if (rec.ext) rec.ext.addTab(wc, win); } catch (e) { /* extensões opcionais */ }

  const id = tab.id;
  const T = () => tabById(id);
  wc.on('page-title-updated', (e, title) => { const t = T(); if (t) { t.title = title; retitle(t.url, title); pushState(); saveState(); } });
  wc.on('page-favicon-updated', (e, fav) => { const t = T(); if (t) { t.favicon = fav[0] || ''; pushState(); } });
  const onNav = (e, url) => {
    const t = T(); if (!t) return;
    t.url = url; pushState(); saveState();
    remember(url, wc.getTitle() !== url ? wc.getTitle() : '');
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
  wc.on('media-started-playing', () => { const t = T(); if (t) { t.media = true; pushState(); } });
  wc.on('media-paused', () => { const t = T(); if (t) { t.media = false; pushState(); } });
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
  try { const ext = tabExts.get(id); if (ext) ext.removeTab(view.webContents); } catch (e) { /* ok */ }
  win.contentView.removeChildView(view);
  view.webContents.close();
  tabViews.delete(id);
  tabExts.delete(id);
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

// os separadores abertos há menos tempo ficam no topo do seu espaço
function toTop(tab) {
  const i = S.tabs.indexOf(tab); if (i >= 0) S.tabs.splice(i, 1);
  const first = S.tabs.findIndex(x => x.space === tab.space);
  if (first < 0) S.tabs.push(tab); else S.tabs.splice(first, 0, tab);
}
function newTab({ url, space, activate = true, title, partition = null, sessionLabel = null } = {}) {
  const tab = {
    id: nextId++,
    url: url ? toURL(url) : NEWTAB,
    title: title || (url ? hostOf(toURL(url)) : 'Página nova'),
    space: space || (cur() ? cur().space : S.spaces[0].id),
    partition: partition || null,
    sessionLabel: partition ? sessionLabel : null
  };
  S.tabs.push(tab); toTop(tab);
  if (activate) openTab(tab.id);
  else { ensureTabView(tab); pushState(); saveState(); }
  return tab;
}

function openTab(id) {
  const tab = tabById(id);
  if (!tab) return;
  const prev = S.currentId;
  if (prev !== id) { captureThumb(prev); autoPip(prev); pipExit(id); }
  S.currentId = id;
  fullApp = null;
  S.mru = [id, ...S.mru.filter(x => x !== id && tabById(x))];
  // o separador onde se entra sobe para o topo do seu espaço: em cima fica sempre o último visto
  if (prev !== id) toTop(tab);
  const view = ensureTabView(tab);
  if (view) { try { const ext = tabExts.get(id); if (ext) ext.selectTab(view.webContents); } catch (e) { /* ok */ } }
  applyLayout();
  if (view && !L.overlay) view.webContents.focus();
  else ui && ui.focus();
  pushState(true); saveState();
}

function removeTab(id, into) {
  const i = S.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = S.tabs.splice(i, 1);
  if (t.url !== NEWTAB) into.unshift({ url: t.url, title: t.title, space: t.space, favicon: t.favicon, partition: t.partition || null, sessionLabel: t.sessionLabel || null });
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
// mover um separador para outro espaço (fica no topo desse espaço)
function moveTabToSpace(id, space) {
  const t = tabById(id); if (!t || !S.spaces.some(s => s.id === space) || t.space === space) return;
  t.space = space; toTop(t);
  const sp = S.spaces.find(s => s.id === space);
  pushState(); saveState();
  ui && ui.send('toast', 'Movido para ' + sp.name);
}
// clique direito num cartão do mosaico
function tabMenu(id) {
  const t = tabById(id); if (!t) return;
  const others = S.spaces.filter(s => s.id !== t.space);
  Menu.buildFromTemplate([
    { label: 'Abrir', click: () => { ui.send('ui-command', { cmd: 'mosaic-close' }); openTab(id); } },
    { type: 'separator' },
    { label: 'Mover para', submenu: [
      ...others.map(s => ({ label: s.name, click: () => moveTabToSpace(id, s.id) })),
      ...(others.length ? [{ type: 'separator' }] : []),
      { label: 'Espaço novo…', click: () => ui.send('ui-command', { cmd: 'new-space-with', id }) }
    ] },
    { type: 'separator' },
    { label: 'Copiar endereço', enabled: t.url !== NEWTAB, click: () => clipboard.writeText(t.url) },
    { label: 'Guardar em "Mais tarde"', click: () => laterTab(id) },
    { label: 'Fechar separador', click: () => closeTab(id) }
  ]).popup({ window: win });
}

function navigate(input) {
  const url = toURL(input);
  let tab = cur();
  if (!tab) tab = newTab({ url });
  if (url === NEWTAB) { tab.url = NEWTAB; destroyTabView(tab.id); applyLayout(); pushState(); return; }
  // abrir um site a partir de uma página nova conta como separador acabado de abrir: vai para o topo
  if (tab.url === NEWTAB) toTop(tab);
  fullApp = null;
  if (!tabViews.has(tab.id)) { tab.url = url; ensureTabView(tab); }
  else { tab.error = null; tabViews.get(tab.id).webContents.loadURL(url).catch(() => {}); }
  applyLayout();
  tabViews.get(tab.id).webContents.focus();
  pushState(); saveState();
}

/* ------------------------------------------------------------------ */
/* Página principal: agenda e tarefas do dia das contas Google          */
/* ------------------------------------------------------------------ */
/*
 * Cada conta liga-se com um pequeno Apps Script pessoal (assets/zeus-hoje.gs) publicado como aplicação Web
 * com acesso "Só eu". O Zeus lê-o com a sessão da app Gmail dessa conta (os cookies dela), por isso
 * ninguém mais consegue ler o endereço. Não há chaves nem palavras-passe guardadas no Zeus.
 */
const SCRIPT_URL = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/(u\/\d+\/)?s\/[\w-]+\/exec(\?.*)?$/;
let todayCache = { t: 0, data: null };
const feedSession = f => { const a = appById(f.appId); return a ? sessionForApp(a).ses : zeusSession; };
// uma sessão pode ter várias contas Google (ex.: pessoal e Observador na mesma app): o Apps Script com acesso
// "Só eu" só responde à conta dona, por isso tenta-se /u/0/, /u/1/… até encontrar a conta certa (e guarda-se)
function withAccount(url, n) {
  if (n == null) return url;
  return url.replace(/\/(a\/macros\/[^/]+|macros)\/(u\/\d+\/)?s\//, (m, base) => `/${base}/u/${n}/s/`);
}
async function fetchFeedOnce(f, url, params) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await feedSession(f).fetch(u.toString(), { credentials: 'include', redirect: 'follow', cache: 'no-store' });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* página de login ou de erro */ }
  if (j) { if (!j.ok) throw Object.assign(new Error(j.error || 'Erro no Apps Script.'), { fatal: true }); return j; }
  const title = ((/<title>([^<]*)<\/title>/i.exec(text) || [])[1] || '').trim();
  if (/accounts\.google\.com|ServiceLogin|signin/i.test(r.url + text.slice(0, 3000))) throw new Error('login');
  throw new Error(`resposta ${r.status}${title ? ' — ' + title : ''}`);
}
async function callFeed(f, params) {
  const tries = f.authuser != null ? [f.authuser] : [null, 0, 1, 2, 3, 4];
  let last = null;
  for (const n of tries) {
    try {
      const j = await fetchFeedOnce(f, withAccount(f.url, n), params);
      if (n != null && f.authuser !== n) { f.authuser = n; saveState(); }
      return j;
    } catch (e) { last = e; if (e.fatal) throw e; }
  }
  // a conta guardada deixou de responder (ex.: ordem das contas mudou): volta a procurar na próxima vez
  if (f.authuser != null) { delete f.authuser; saveState(); }
  const app = (appById(f.appId) || {}).name || 'Gmail';
  if (last && last.message === 'login') throw new Error(`Nenhuma conta da app ${app} tem acesso a este Apps Script. Entra nessa conta na app ${app} (ou cria o Apps Script na conta certa).`);
  throw new Error(`O endereço não devolveu a agenda (${last ? last.message : 'sem resposta'}). Confirma que é o URL da aplicação Web, que acaba em /exec, e que a implementação está como "Executar como: Eu".`);
}
const localDate = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
async function homeToday(force) {
  const feeds = S.settings.homeFeeds || [];
  if (!feeds.length) return { feeds: 0, events: [], tasks: [], errors: [] };
  if (!force && todayCache.data && Date.now() - todayCache.t < 5 * 60 * 1000 && todayCache.date === localDate()) return todayCache.data;
  const date = localDate();
  const res = await Promise.all(feeds.map(f => callFeed(f, { date }).then(d => ({ f, d }), e => ({ f, e }))));
  const events = [], tasks = [], errors = [];
  for (const { f, d, e } of res) {
    const label = f.label || (appById(f.appId) || {}).name || f.account || 'Google';
    if (e) { errors.push({ feed: f.id, label, error: e.message }); continue; }
    if (d.account && !f.account) { f.account = d.account; saveState(); }
    (d.events || []).forEach(ev => events.push(Object.assign({}, ev, { feed: f.id, label })));
    (d.tasks || []).forEach(t => tasks.push(Object.assign({}, t, { feed: f.id, label })));
  }
  events.sort((a, b) => (b.allDay - a.allDay) || a.start.localeCompare(b.start));
  tasks.sort((a, b) => (b.overdue - a.overdue) || a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  const data = { feeds: feeds.length, events, tasks, errors, at: Date.now() };
  todayCache = { t: Date.now(), date, data };
  return data;
}
async function homeTaskDone(feedId, list, task) {
  const f = (S.settings.homeFeeds || []).find(x => x.id === feedId); if (!f) return { ok: false };
  try { await callFeed(f, { action: 'done', list, task }); todayCache.t = 0; return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}
function homeScriptCode() {
  try { return fs.readFileSync(path.join(__dirname, '..', 'assets', 'zeus-hoje.gs'), 'utf8'); } catch (e) { return ''; }
}
// abre o Apps Script numa janela com a sessão (a conta) da app escolhida e copia o código
function homeSetupOpen(appId) {
  const a = appById(appId); if (!a) return { ok: false };
  clipboard.writeText(homeScriptCode());
  const { ses } = sessionForApp(a);
  const w = new BrowserWindow({ width: 1180, height: 820, parent: win, title: 'Apps Script — ' + a.name, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: WEB_PREFS(ses) });
  const wc = w.webContents;
  wc.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(wc, d.url); });
  // janelas de autorização da Google abrem como janelas filhas, na mesma conta
  wc.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, parent: w, autoHideMenuBar: true, webPreferences: WEB_PREFS(ses) } }));
  wc.on('did-create-window', child => child.webContents.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(child.webContents, d.url); }));
  // escolher a conta Google onde criar o Apps Script (quando há mais de uma na sessão)
  const start = 'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent('https://script.new');
  googleUA(wc, start);
  w.loadURL(start).catch(() => {});
  return { ok: true };
}
async function homeFeedAdd({ appId, url, label }) {
  const a = appById(appId);
  url = String(url || '').trim();
  if (!a) return { ok: false, error: 'Escolhe a app da conta.' };
  // (em desenvolvimento, ZEUS_TEST_SCRIPT permite um servidor de teste local; nunca na app empacotada)
  const testOk = !app.isPackaged && process.env.ZEUS_TEST_SCRIPT && url.startsWith(process.env.ZEUS_TEST_SCRIPT);
  if (!SCRIPT_URL.test(url) && !testOk) return { ok: false, error: 'Cola o URL da aplicação Web (começa por https://script.google.com/ e acaba em /exec).' };
  const f = { id: 'f' + Date.now().toString(36), appId, url, label: String(label || a.name).slice(0, 30), account: '' };
  try {
    const d = await callFeed(f, { date: localDate() });
    f.account = d.account || '';
    S.settings.homeFeeds = [...(S.settings.homeFeeds || []), f];
    todayCache.t = 0; saveState(); pushState(true);
    return { ok: true, account: f.account, events: (d.events || []).length, tasks: (d.tasks || []).length };
  } catch (e) { return { ok: false, error: e.message }; }
}
function homeFeedRemove(id) {
  S.settings.homeFeeds = (S.settings.homeFeeds || []).filter(f => f.id !== id);
  todayCache.t = 0; saveState(); pushState(true);
}

// casa: página nova (hora, meteorologia, pesquisa) — reaproveita uma página nova vazia do espaço
function goHome() {
  const t = cur();
  const space = t ? t.space : S.spaces[0].id;
  if (!(t && t.url === NEWTAB && !fullApp)) {
    const blank = S.tabs.find(x => x.url === NEWTAB && x.space === space);
    if (blank) { toTop(blank); openTab(blank.id); } else newTab({ space });
  }
  // a interface fecha o mosaico (ou outra janela por cima) e põe o cursor na pesquisa
  ui.send('ui-command', { cmd: 'home' });
}
function pageWC() { const v = fullApp ? appViews.get(fullApp) : tabViews.get(S.currentId); return v && !v.webContents.isDestroyed() ? v.webContents : null; }

/* Vídeo a flutuar (picture-in-picture) */
const PIP_ENTER = force => `(async () => {
  const vs = [...document.querySelectorAll('video')].filter(v => v.readyState > 1 && !v.disablePictureInPicture);
  let v = vs.find(v => !v.paused && !v.muted) || vs.find(v => !v.paused);
  if (!v && ${force}) v = vs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!v) return 'none';
  if (document.pictureInPictureElement === v) return 'already';
  await v.requestPictureInPicture(); return 'ok';
})().catch(e => 'err')`;
const PIP_STATE = `!!document.pictureInPictureElement`;
const PIP_EXIT = `(document.pictureInPictureElement ? document.exitPictureInPicture().then(() => 'out') : Promise.resolve('none')).catch(() => 'err')`;
async function inFrames(wc, code) {
  const out = [];
  if (!wc || wc.isDestroyed()) return out;
  let frames = [];
  try { frames = wc.mainFrame.framesInSubtree; } catch (e) { frames = [wc.mainFrame]; }
  for (const f of frames) { try { out.push(await f.executeJavaScript(code, true)); } catch (e) { /* moldura sem acesso */ } }
  return out;
}
async function pipEnter(wc, force) { const r = await inFrames(wc, PIP_ENTER(force)); return r.includes('ok') || r.includes('already'); }
const pipTabs = new Set();   // separadores cujo vídeo passou a flutuar automaticamente
function autoPip(tabId) {
  if (S.settings.autoPip === false) return;
  const t = tabById(tabId); const v = tabViews.get(tabId);
  if (!t || !t.media || !v) return;
  pipEnter(v.webContents, false).then(ok => { if (ok) pipTabs.add(tabId); }).catch(() => {});
}
function pipExit(tabId) { pipTabs.delete(tabId); const v = tabViews.get(tabId); if (v) inFrames(v.webContents, PIP_EXIT).catch(() => {}); }
async function pipToggle() {
  const wc = pageWC(); if (!wc) return;
  const on = (await inFrames(wc, PIP_STATE)).includes(true);
  if (on) { await inFrames(wc, PIP_EXIT); return; }
  if (!(await pipEnter(wc, true))) ui.send('toast', 'Não há nenhum vídeo nesta página para pôr a flutuar.');
}

/* Partilhar a página */
// email novo numa janela própria, com a sessão (conta) da app: fecha sozinha depois de enviar
// e não mexe no que a app tinha aberto
function composeWindow(a, url) {
  const { ses } = sessionForApp(a);
  const w = new BrowserWindow({
    width: 760, height: 680, parent: win, title: 'Email novo — ' + a.name,
    autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: WEB_PREFS(ses)
  });
  const wc = w.webContents;
  wc.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(wc, d.url); });
  wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) newTab({ url: u, partition: a.isolated ? appPartition(a.id) : null, sessionLabel: a.isolated ? a.name : null }); return { action: 'deny' }; });
  googleUA(wc, url);
  w.loadURL(url).catch(() => {});
}
function openInApp(a, url) {
  const view = ensureAppView(a); if (!view) return;
  view.webContents.loadURL(url).catch(() => {});
  if (fullApp !== a.id && openPanel !== a.id) openApp(a.id);
}
// menu de partilha próprio (desenhado na interface): o processo principal diz o que há e executa a escolha
function shareCurrent() {
  const wc = pageWC(); if (!wc) return null;
  const url = wc.getURL(); if (!/^https?:/.test(url)) return null;
  return { url, title: wc.getTitle() || hostOf(url) };
}
function shareTargets() {
  const t = []; const has = h => S.apps.filter(a => a.url && hostOf(a.url) === h);
  has('mail.google.com').forEach(a => t.push({ id: 'gmail:' + a.id, label: a.name === 'Email' ? 'Gmail' : a.name, sub: 'Gmail', icon: 'mail' }));
  has('mail.proton.me').forEach(a => t.push({ id: 'proton:' + a.id, label: a.name, sub: 'Proton Mail', icon: 'pmail' }));
  has('web.whatsapp.com').forEach(a => t.push({ id: 'wa:' + a.id, label: a.name, sub: 'WhatsApp', icon: 'wa' }));
  t.push(
    { id: 'claude', label: 'Claude', sub: 'conversa', icon: 'claude' },
    { id: 'telegram', label: 'Telegram', sub: 'separador', icon: 'send' },
    { id: 'linkedin', label: 'LinkedIn', sub: 'separador', icon: 'in' },
    { id: 'x', label: 'X', sub: 'separador', icon: 'x2' },
    { id: 'bluesky', label: 'Bluesky', sub: 'separador', icon: 'sky' },
    { id: 'facebook', label: 'Facebook', sub: 'separador', icon: 'fb' },
    { id: 'mailapp', label: 'Mail do Mac', sub: 'app do sistema', icon: 'mail' }
  );
  return t;
}
function shareInfo() {
  const c = shareCurrent(); if (!c) return null;
  return Object.assign(c, { targets: shareTargets(), mac: isMac });
}
function appUser(a, re) { const m = re.exec(S.appLast[a.id] || ''); return m ? m[1] : null; }
function shareDo(id, pos) {
  const c = shareCurrent();
  if (!c) { ui.send('toast', 'Esta página não pode ser partilhada.'); return; }
  const { url, title } = c; const enc = encodeURIComponent; const both = title + '\n' + url;
  const [kind, appId] = String(id).split(':'); const a = appId ? appById(appId) : null;
  switch (kind) {
    case 'copy': clipboard.writeText(url); ui.send('toast', 'Endereço copiado.'); break;
    case 'copyboth': clipboard.writeText(both); ui.send('toast', 'Título e endereço copiados.'); break;
    case 'gmail': if (a) { const u = appUser(a, /\/mail\/u\/(\d+)/); composeWindow(a, `https://mail.google.com/mail/${u ? 'u/' + u + '/' : ''}?view=cm&fs=1&su=${enc(title)}&body=${enc(url)}`); } break;
    case 'proton': if (a) {
      // o Proton Mail abre um email novo a partir de um endereço mailto; o link fica também copiado, por segurança
      const u = appUser(a, /mail\.proton\.me\/u\/(\d+)/) || '0';
      clipboard.writeText(both);
      openInApp(a, `https://mail.proton.me/u/${u}/inbox#mailto=${enc('mailto:?subject=' + enc(title) + '&body=' + enc(url))}`);
      ui.send('toast', 'A abrir um email no Proton Mail. O link também ficou copiado (⌘V).');
    } break;
    case 'wa': if (a) openInApp(a, `https://web.whatsapp.com/send?text=${enc(title + ' ' + url)}`); break;
    case 'claude': sendToClaude(`${title}\n${url}\n\n`); break;
    case 'telegram': newTab({ url: `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}` }); break;
    case 'linkedin': newTab({ url: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` }); break;
    case 'x': newTab({ url: `https://x.com/intent/post?text=${enc(title)}&url=${enc(url)}` }); break;
    case 'bluesky': newTab({ url: `https://bsky.app/intent/compose?text=${enc(title + ' ' + url)}` }); break;
    case 'facebook': newTab({ url: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` }); break;
    case 'mailapp': shell.openExternal(`mailto:?subject=${enc(title)}&body=${enc(url)}`); break;
    case 'browser': shell.openExternal(url); break;
    case 'native': if (isMac) {
      const opts = { window: win };
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) { opts.x = Math.round(pos.x); opts.y = Math.round(pos.y); }
      try { new ShareMenu({ urls: [url] }).popup(opts); }
      catch (e) { Menu.buildFromTemplate([{ label: 'Partilhar com…', role: 'shareMenu', sharingItem: { urls: [url] } }]).popup(opts); }
    } break;
  }
}

function navAction(a) {
  if (fullApp) {
    const v = appViews.get(fullApp); if (!v) return;
    const w = v.webContents, ap = appById(fullApp);
    if (a === 'back' && w.navigationHistory.canGoBack()) w.navigationHistory.goBack();
    if (a === 'forward' && w.navigationHistory.canGoForward()) w.navigationHistory.goForward();
    if (a === 'reload' || a === 'retry') w.reload();
    if (a === 'hardreload') w.reloadIgnoringCache();
    if (a === 'stop') w.stop();
    if (a === 'apphome' && ap && ap.url) w.loadURL(ap.url).catch(() => {});
    if (a === 'home') goHome();
    return;
  }
  if (a === 'home') { goHome(); return; }
  const tab = cur(); if (!tab) return;
  const view = tabViews.get(tab.id);
  if (a === 'retry' && tab.error) { const u = tab.error.url || tab.url; tab.error = null; if (view) view.webContents.loadURL(u).catch(() => {}); applyLayout(); pushState(); return; }
  if (!view) return;
  const wc = view.webContents;
  if (a === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (a === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (a === 'reload') wc.reload();
  if (a === 'home') goHome();
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
/*
 * Sessão de cada app. Com "sessão separada", a app tem os seus próprios cookies,
 * logins e armazenamento (como se estivesse num browser à parte); as permissões,
 * o início de sessão na Google e as extensões instaladas são configurados também nela.
 */
const appSessions = new Map();   // id da app -> { ses, ext }
const appPartition = id => 'persist:app-' + id;
function sessionForApp(a) {
  if (!a.isolated) return { ses: zeusSession, ext: extensions };
  if (appSessions.has(a.id)) return appSessions.get(a.id);
  const ses = session.fromPartition(appPartition(a.id));
  ses.setUserAgent(chromeUA());
  setupPermissions(ses);
  setupGoogleSignin(ses);
  let ext = null, ready = Promise.resolve();
  try {
    ext = new ElectronChromeExtensions(Object.assign({ session: ses }, extensionHandlers()));
    // a app só começa a carregar depois das extensões, para elas entrarem logo na página
    ready = Promise.all([
      loadAllExtensions(ses, extensionsPath(), { allowUnpacked: false }).catch(() => {}),
      loadUnpackedInto(ses).catch(() => {})
    ]);
  } catch (e) { ext = null; }
  const rec = { ses, ext, ready };
  appSessions.set(a.id, rec);
  return rec;
}
const tabExts = new Map();   // id do separador -> extensões da sessão dele
function sessionForPartition(p) {
  if (!p) return { ses: zeusSession, ext: extensions };
  const a = S.apps.find(x => x.isolated && appPartition(x.id) === p);
  return a ? sessionForApp(a) : null;
}
function extFor(id) { const a = appById(id); const r = a && a.isolated ? appSessions.get(id) : null; return r ? r.ext : extensions; }

function ensureAppView(a) {
  if (appViews.has(a.id)) return appViews.get(a.id);
  if (!a.url) return null;
  const { ses, ext, ready } = sessionForApp(a);
  const view = new WebContentsView({ webPreferences: WEB_PREFS(ses) });
  view.setBackgroundColor('#ffffff');
  appViews.set(a.id, view);
  win.contentView.addChildView(view);
  view.setVisible(false);
  const wc = view.webContents;
  wireWeb(wc, 'app', { appId: a.id });
  try { if (ext) ext.addTab(wc, win); } catch (e) { /* ok */ }
  wc.on('page-title-updated', (e, title) => {
    const m = /\((\d+)\)/.exec(title) || /^(\d+)\s/.exec(title);
    const n = m ? parseInt(m[1], 10) : 0;
    if (badges[a.id] !== n) { badges[a.id] = n; pushState(); }
  });
  let startedFromLast = false, triedHome = false, crashes = 0;
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    // se o último endereço guardado falhar, tenta uma vez a página inicial da app
    if (startedFromLast && !triedHome) { triedHome = true; delete S.appLast[a.id]; wc.loadURL(a.url).catch(() => {}); return; }
    appErrors[a.id] = { code, desc, url }; applyLayout(); pushState();
  });
  // a página da app rebentou (fica em branco): recarrega sozinha uma vez; depois mostra o aviso com "Tentar de novo"
  wc.on('render-process-gone', (e, d) => {
    if (d.reason === 'clean-exit') return;
    if (++crashes <= 1) { setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, 500); return; }
    appErrors[a.id] = { code: 'crash', desc: 'A página da app deixou de responder.', url: wc.getURL() || a.url }; applyLayout(); pushState();
  });
  wc.on('unresponsive', () => { appErrors[a.id] = { code: 'hang', desc: 'A página da app não está a responder.', url: wc.getURL() || a.url }; applyLayout(); pushState(); });
  wc.on('responsive', () => { if (appErrors[a.id] && appErrors[a.id].code === 'hang') { delete appErrors[a.id]; applyLayout(); pushState(); } });
  // lembrar onde a app estava (ex.: a Drive ou o Calendário da conta do trabalho)
  const keep = url => {
    const k = appLastFor(a, url);
    if (k) { S.appLast[a.id] = k; saveState(); }
    pushState();
  };
  wc.on('did-navigate', (e, url) => keep(url));
  wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) keep(url); });
  wc.on('did-start-navigation', d => {
    if (d.isMainFrame && !d.isSameDocument && appErrors[a.id]) { delete appErrors[a.id]; applyLayout(); pushState(); }
  });
  const last = appLastFor(a, S.appLast[a.id] || '');
  const start = last || a.url;
  startedFromLast = !!last && last !== a.url;
  // espera pelas extensões da sessão, mas nunca mais de 4 segundos (se uma extensão encravar, a app abre na mesma)
  const go = () => { if (!wc.isDestroyed() && !wc.getURL()) wc.loadURL(start).catch(() => {}); };
  Promise.race([Promise.resolve(ready), new Promise(r => setTimeout(r, 4000))]).then(go, go);
  return view;
}
// que endereço guardar para a app voltar lá: só páginas do próprio site; no Gmail, só a caixa da conta
// (nunca um email a escrever, ex. ?view=cm aberto pela partilha, que fica em branco depois de enviado)
function appLastFor(a, url) {
  if (!/^https?:/.test(url || '') || hostOf(url) !== hostOf(a.url)) return null;
  if (hostOf(url) === 'mail.google.com') {
    const m = /\/mail\/u\/(\d+)/.exec(url);
    return 'https://mail.google.com/mail/' + (m ? 'u/' + m[1] + '/' : '');
  }
  if (/[?&](view=cm|compose=)/.test(url)) return null;
  return url;
}
function destroyAppView(id) {
  const view = appViews.get(id); if (!view) return;
  try { const ext = extFor(id); if (ext) ext.removeTab(view.webContents); } catch (e) { /* ok */ }
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
    if (fullApp !== id && !fullApp) autoPip(S.currentId);
    fullApp = fullApp === id ? null : id;
    if (!fullApp) pipExit(S.currentId);
    if (openPanel === id) openPanel = null;
  } else {
    openPanel = openPanel === id ? null : id;
    if (fullApp === id) fullApp = null;
  }
  applyLayout();
  if (view && (fullApp === id || openPanel === id)) { view.webContents.focus(); try { const ext = extFor(id); if (ext) ext.selectTab(view.webContents); } catch (e) { /* ok */ } }
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
const ICONS = ['', 'mail', 'pmail', 'wa', 'cal', 'notion', 'pluto', 'apolo', 'work', 'globe', 'star', 'mic', 'play'];
function addApp({ name, url, mode, icon, isolated }) {
  const u = toURL(url);
  if (!/^https?:/.test(u)) return { ok: false, error: 'Escreve um endereço web válido, por exemplo web.telegram.org.' };
  const id = 'a' + Date.now().toString(36);
  S.apps.push({
    id, name: (name || hostOf(u)).slice(0, 24), url: u, mode: mode === 'side' ? 'side' : 'full',
    icon: ICONS.includes(icon) ? icon : '', isolated: isolated !== false, preload: false,
    linksInTabs: hostOf(u) === 'drive.google.com' ? 'external' : false
  });
  saveState(); pushState(true);
  return { ok: true, id };
}
function updateApp(id, patch) {
  const a = appById(id); if (!a) return { ok: false };
  if (patch.url !== undefined) {
    const u = toURL(patch.url);
    if (!/^https?:/.test(u)) return { ok: false, error: 'Escreve um endereço web válido.' };
    if (u !== a.url) { a.url = u; delete S.appLast[id]; destroyAppView(id); }
  }
  if (patch.name) a.name = String(patch.name).slice(0, 24);
  if (patch.mode) a.mode = patch.mode === 'full' ? 'full' : 'side';
  if (patch.icon !== undefined && ICONS.includes(patch.icon)) a.icon = patch.icon;
  if (patch.linksInTabs !== undefined) a.linksInTabs = patch.linksInTabs === 'external' ? 'external' : !!patch.linksInTabs;
  if (patch.isolated !== undefined && !!patch.isolated !== !!a.isolated) setIsolated(id, !!patch.isolated);
  saveState(); pushState(true);
  return { ok: true };
}
// mudar de sessão: a app recomeça (é preciso voltar a entrar na conta nessa sessão)
function setIsolated(id, on) {
  const a = appById(id); if (!a) return;
  const wasOpen = openPanel === id || fullApp === id;
  destroyAppView(id);
  a.isolated = on;
  if (wasOpen) { ensureAppView(a); applyLayout(); }
  saveState(); pushState(true);
}
async function clearAppSession(id) {
  try { await session.fromPartition(appPartition(id)).clearStorageData(); } catch (e) { /* ok */ }
  appSessions.delete(id);
}
function removeApp(id) {
  delete S.appLast[id];
  const old = appById(id);
  destroyAppView(id);
  if (old && old.isolated) clearAppSession(id);
  S.apps = S.apps.filter(a => a.id !== id);
  if (DEFAULT_APPS.some(a => a.id === id)) S.removedApps = [...new Set([...(S.removedApps || []), id])];
  if (openPanel === id) openPanel = null;
  if (fullApp === id) fullApp = null;
  applyLayout(); saveState(); pushState(true);
}
async function askIsolated(id, on) {
  const a = appById(id); if (!a) return;
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: [on ? 'Separar' : 'Partilhar', 'Cancelar'], defaultId: 0, cancelId: 1,
    message: on ? `Dar ao ${a.name} uma sessão separada?` : `Pôr o ${a.name} na sessão partilhada?`,
    detail: on
      ? 'Fica com cookies e contas só seus, como se estivesse noutro browser. Vais ter de voltar a entrar na conta dentro desta app.'
      : 'Passa a partilhar contas e cookies com os separadores e as outras apps partilhadas. Vais ter de voltar a entrar na conta.'
  });
  if (r.response === 0) setIsolated(id, on);
}
function appMenu(id) {
  const a = appById(id); if (!a) return;
  const view = appViews.get(id);
  Menu.buildFromTemplate([
    { label: 'Abrir ao lado', type: 'radio', checked: a.mode === 'side', click: () => setAppMode(id, 'side') },
    { label: 'Abrir em página inteira', type: 'radio', checked: a.mode === 'full', click: () => setAppMode(id, 'full') },
    { type: 'separator' },
    { label: 'Recarregar', enabled: !!view, click: () => view && view.webContents.reload() },
    { label: 'Editar nome, endereço e ícone…', click: () => ui.send('ui-command', { cmd: 'edit-app', id }) },
    { label: 'Sessão separada', type: 'checkbox', checked: !!a.isolated, click: () => askIsolated(id, !a.isolated) },
    { label: 'Links', submenu: [
      { label: 'Abrem dentro da app', type: 'radio', checked: !a.linksInTabs, click: () => { a.linksInTabs = false; saveState(); pushState(true); } },
      { label: 'Abrem em separadores', type: 'radio', checked: a.linksInTabs === true, click: () => { a.linksInTabs = true; saveState(); pushState(true); } },
      { label: 'Outros sites em separadores (o próprio site fica na app)', type: 'radio', checked: a.linksInTabs === 'external', click: () => { a.linksInTabs = 'external'; saveState(); pushState(true); } }
    ] },
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
const extensionsPath = () => path.join(app.getPath('userData'), 'Extensions');
function extensionHandlers() {
  return {
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
  };
}
async function setupExtensions() {
  extensions = new ElectronChromeExtensions(Object.assign({ session: zeusSession }, extensionHandlers()));
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
  extensions.on('browser-action-popup-created', () => { /* o próprio módulo posiciona o popup */ });

  try {
    await installChromeWebStore({
      session: zeusSession,
      extensionsPath: extensionsPath(),
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
  await loadUnpackedInto(zeusSession);
}
/*
 * Extensões carregadas a partir de uma pasta (ou .zip), como o "modo de programador" do Chrome/Vivaldi.
 * São copiadas para userData/Unpacked/<nome> e carregadas em todas as sessões (separadores e apps).
 */
const unpackedPath = () => path.join(app.getPath('userData'), 'Unpacked');
const allSessions = () => [zeusSession, ...[...appSessions.values()].map(r => r.ses)].filter(Boolean);
function unpackedDirs() {
  try { return fs.readdirSync(unpackedPath()).map(n => path.join(unpackedPath(), n)).filter(d => fs.existsSync(path.join(d, 'manifest.json'))); }
  catch (e) { return []; }
}
async function loadUnpackedInto(ses) {
  for (const dir of unpackedDirs()) {
    try {
      const have = ses.extensions.getAllExtensions().some(x => path.resolve(x.path) === path.resolve(dir));
      if (!have) await ses.extensions.loadExtension(dir, { allowFileAccess: true });
    } catch (e) { console.error('Extensão da pasta não carregou', dir, e.message); }
  }
}
function findManifestDir(root) {
  if (fs.existsSync(path.join(root, 'manifest.json'))) return root;
  // um .zip ou pasta com uma única subpasta lá dentro
  const subs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('__MACOSX') && !d.name.startsWith('.'));
  for (const d of subs) { const r = path.join(root, d.name); if (fs.existsSync(path.join(r, 'manifest.json'))) return r; }
  return null;
}
async function addUnpackedExtension() {
  // só em desenvolvimento (nunca na app empacotada): testes automáticos sem janelas de diálogo
  const testPick = !app.isPackaged && process.env.ZEUS_TEST_EXT;
  const r = testPick ? { canceled: false, filePaths: [testPick] } : await dialog.showOpenDialog(win, {
    title: 'Carregar extensão',
    message: 'Escolhe a pasta da extensão (a que tem o ficheiro manifest.json) ou o ficheiro .zip.',
    buttonLabel: 'Carregar',
    properties: ['openDirectory', 'openFile'],
    filters: [{ name: 'Extensão (.zip ou pasta)', extensions: ['zip'] }]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  let src = r.filePaths[0]; let tmp = null;
  try {
    if (/\.zip$/i.test(src)) {
      tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'zeus-ext-'));
      await new Promise((res, rej) => {
        const cmd = isMac ? ['ditto', ['-x', '-k', src, tmp]] : ['unzip', ['-q', src, '-d', tmp]];
        execFile(cmd[0], cmd[1], err => err ? rej(err) : res());
      });
      src = tmp;
    }
    const dir = findManifestDir(src);
    if (!dir) return { ok: false, error: 'Não encontrei o ficheiro manifest.json. Escolhe a pasta da extensão (ou o .zip).' };
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
    catch (e) { return { ok: false, error: 'O manifest.json da extensão não é válido.' }; }
    const base = String(manifest.name || path.basename(dir)).replace(/__MSG_\w+__/g, '').trim() || path.basename(dir);
    const slug = base.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'extensao';
    const ok = testPick ? { response: 0 } : await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Carregar', 'Cancelar'], defaultId: 0, cancelId: 1,
      message: `Carregar a extensão “${base}”${manifest.version ? ' (versão ' + manifest.version + ')' : ''}?`,
      detail: 'As extensões podem ler e alterar as páginas que visitas. Carrega apenas extensões tuas ou que conheças. Fica disponível nos separadores e em todas as apps da barra.'
    });
    if (ok.response !== 0) return { ok: false, canceled: true };
    const dest = path.join(unpackedPath(), slug);
    // versão nova da mesma extensão: tira a anterior de todas as sessões e substitui os ficheiros
    for (const ses of allSessions()) {
      try { ses.extensions.getAllExtensions().filter(x => path.resolve(x.path) === path.resolve(dest)).forEach(x => ses.extensions.removeExtension(x.id)); } catch (e) { /* ok */ }
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(unpackedPath(), { recursive: true });
    fs.cpSync(dir, dest, { recursive: true });
    for (const ses of allSessions()) await loadUnpackedInto(ses);
    // recarregar as apps e separadores abertos para a extensão entrar já nas páginas
    for (const v of [...appViews.values(), ...tabViews.values()]) { try { v.webContents.reload(); } catch (e) { /* ok */ } }
    pushExtensions();
    return { ok: true, name: base };
  } catch (e) {
    return { ok: false, error: 'Não foi possível carregar a extensão: ' + e.message };
  } finally {
    if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ok */ }
  }
}
function removeUnpacked(id) {
  let dir = null;
  for (const ses of allSessions()) {
    try {
      const x = ses.extensions.getExtension(id);
      if (x && path.resolve(x.path).startsWith(path.resolve(unpackedPath()))) { dir = x.path; ses.extensions.removeExtension(id); }
    } catch (e) { /* ok */ }
  }
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ok */ } return true; }
  return false;
}
function listExtensions() {
  try {
    return zeusSession.extensions.getAllExtensions().map(x => ({ id: x.id, name: x.name, version: x.version, unpacked: path.resolve(x.path).startsWith(path.resolve(unpackedPath())) }));
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
    L = { page: clean(rects.page), panel: clean(rects.panel), claude: clean(rects.claude), overlay: !!rects.overlay, cover: !!rects.cover };
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
  handle('tab:menu', id => tabMenu(id));
  // mover um separador: para outro espaço e/ou para outra posição (antes do separador "before"; sem ele, para o fim do espaço)
  handle('tab:move', (id, space, before) => {
    const t = tabById(id); if (!t || !S.spaces.some(s => s.id === space)) return;
    t.space = space;
    S.tabs = S.tabs.filter(x => x !== t);
    let i = before != null ? S.tabs.findIndex(x => x.id === before && x.space === space) : -1;
    if (i < 0) { const last = S.tabs.map(x => x.space).lastIndexOf(space); i = last < 0 ? S.tabs.length : last + 1; }
    S.tabs.splice(i, 0, t);
    pushState(); saveState();
  });
  handle('tab:restore', (list, i) => {
    const arr = list === 'later' ? S.later : S.closed;
    const item = arr.splice(i, 1)[0];
    if (item) newTab({ url: item.url, space: item.space, title: item.title, partition: item.partition, sessionLabel: item.sessionLabel });
  });
  handle('tab:reopen', () => { const item = S.closed.shift(); if (item) newTab({ url: item.url, space: item.space, title: item.title, partition: item.partition, sessionLabel: item.sessionLabel }); });
  handle('navigate', input => navigate(input));
  handle('nav', a => navAction(a));
  handle('history:suggest', q => suggest(q));
  handle('home:today', force => homeToday(!!force));
  handle('home:taskDone', (feed, list, task) => homeTaskDone(feed, list, task));
  handle('home:setupOpen', appId => homeSetupOpen(appId));
  handle('home:feedAdd', d => homeFeedAdd(d || {}));
  handle('home:feedRemove', id => homeFeedRemove(id));
  handle('home:code', () => { clipboard.writeText(homeScriptCode()); return true; });
  handle('history:browsers', () => otherBrowsers());
  handle('history:import', id => importHistory(id));
  handle('history:count', () => S.history.length);
  handle('share:info', () => shareInfo());
  handle('share:do', (id, pos) => shareDo(id, pos));
  handle('pip:toggle', () => pipToggle());
  handle('page:snapshot', async () => {
    const wc = pageWC(); if (!wc) return '';
    try { const img = await wc.capturePage(); return img.isEmpty() ? '' : 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64'); } catch (e) { return ''; }
  });
  handle('find', (q, opts) => {
    const v = tabViews.get(S.currentId); if (!v) return;
    if (!q) { v.webContents.stopFindInPage('clearSelection'); return; }
    v.webContents.findInPage(q, opts || {});
  });
  handle('space:add', name => {
    const nm = String(name || '').trim().slice(0, 30); if (!nm) return;
    const id = 's' + Date.now().toString(36);
    S.spaces.push({ id, name: nm }); pushState(); saveState();
    return id;
  });
  // nova ordem dos espaços (arrastar o título de um espaço no mosaico)
  handle('space:reorder', ids => {
    if (!Array.isArray(ids)) return;
    const next = ids.map(id => S.spaces.find(s => s.id === id)).filter(Boolean);
    S.spaces.forEach(s => { if (!next.includes(s)) next.push(s); });
    S.spaces = next; pushState(); saveState();
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
  handle('app:reload', id => {
    const v = appViews.get(id); const a = appById(id); if (!v || !a) return;
    // recarrega onde está (não volta ao início); se deu erro, tenta outra vez o mesmo endereço
    if (appErrors[id]) { const u = appErrors[id].url || S.appLast[id] || a.url; delete appErrors[id]; v.webContents.loadURL(u).catch(() => {}); }
    else v.webContents.reload();
    applyLayout(); pushState();
  });
  handle('claude:toggle', open => setClaude(open === undefined ? !S.claudeOpen : open));
  handle('claude:sendPage', () => sendPageToClaude());
  handle('claude:ask', text => sendToClaude(String(text || '')));
  handle('claude:new', () => { setClaude(true); claudeView.webContents.loadURL('https://claude.ai/new').catch(() => {}); });
  handle('settings:set', (patch = {}) => {
    const ALLOWED = Object.keys(DEFAULT_SETTINGS).filter(k => k !== 'homeFeeds');
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
  handle('ext:load', () => addUnpackedExtension());
  handle('ext:remove', async id => {
    if (removeUnpacked(id)) { pushExtensions(); return; }
    try { await uninstallExtension(id, { session: zeusSession, extensionsPath: path.join(app.getPath('userData'), 'Extensions') }); }
    catch (e) { try { zeusSession.extensions.removeExtension(id); } catch (_) { /* ok */ } }
    pushExtensions();
  });
  handle('data:clear', async what => {
    if (what === 'cache') await zeusSession.clearCache();
    if (what === 'history' || what === 'all') { S.history = []; S.visits = {}; S.closed = []; saveState(); pushState(); }
    if (what === 'all') {
      await zeusSession.clearStorageData(); await zeusSession.clearCache();
      for (const a of S.apps) if (a.isolated) { const ses = session.fromPartition(appPartition(a.id)); await ses.clearStorageData(); await ses.clearCache(); }
    }
    if (what === 'cache') for (const a of S.apps) if (a.isolated) await session.fromPartition(appPartition(a.id)).clearCache();
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
        { label: 'Reabrir separador fechado', accelerator: 'CmdOrCtrl+Shift+T', click: () => { const it = S.closed.shift(); if (it) newTab({ url: it.url, space: it.space, partition: it.partition, sessionLabel: it.sessionLabel }); } },
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
        { label: 'Página inicial', accelerator: 'CmdOrCtrl+Shift+H', click: () => goHome() },
        { type: 'separator' },
        { label: 'Vídeo a flutuar', accelerator: 'CmdOrCtrl+Alt+P', click: () => pipToggle() },
        { label: 'Partilhar a página…', accelerator: 'CmdOrCtrl+Shift+S', click: () => ui && ui.send('ui-command', { cmd: 'share' }) },
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
  // sem número vermelho no ícone da Dock (os sites já não o conseguem pôr, mas fica a garantia)
  if (isMac) setInterval(() => { try { if (app.getBadgeCount() > 0 || app.dock.getBadge()) { app.setBadgeCount(0); app.dock.setBadge(''); } } catch (e) { /* ok */ } }, 1500);
  // a interface só fala com o processo principal; não precisa de permissões
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(false));
  setupIPC();
  buildMenu();
  createWindow();
  await setupExtensions();
  setupUpdater();
  // abre o separador atual e carrega em segundo plano as apps com notificações
  // o Zeus abre sempre na página principal (hora, meteorologia, agenda e tarefas)
  goHome();
  setTimeout(() => { S.apps.filter(a => a.preload && a.url).forEach(a => ensureAppView(a)); applyLayout(); pushState(); }, 2500);
  if (S.claudeOpen) ensureClaudeView();
  applyLayout();
  pushState(true);
  if (Notification.isSupported()) { /* notificações nativas das páginas ficam ativas */ }
});

app.on('window-all-closed', () => { saveNow(); app.quit(); });
app.on('before-quit', saveNow);

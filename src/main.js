'use strict';
/*
 * Zeus — processo principal.
 * A janela tem uma vista de interface (src/ui) por baixo e, por cima, vistas
 * Chromium para cada separador, para cada app da barra e para o Claude.
 * Todas as páginas web correm em sandbox, sem acesso ao Node nem ao sistema.
 */
const {
  app, BrowserWindow, WebContentsView, session, ipcMain, Menu, dialog,
  clipboard, shell, nativeTheme, Notification, ShareMenu, nativeImage, net, safeStorage, systemPreferences } = require('electron');
const { setupNotas } = require('./notas-main');
const { setupOrfeu, isMedia: isOrfeuMedia } = require('./orfeu-main');
const { setupHermes } = require('./hermes-main');
const { setupEco } = require('./eco-main');
const { setupVideoDL } = require('./video-dl');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, uninstallExtension, loadAllExtensions } = require('electron-chrome-web-store');
const { Updater } = require('./updater');
const { Scores } = require('./scores');
const { Zoom } = require('./zoom');
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
  { id: 'radar', name: 'Radar', url: 'zeus://radar', mode: 'full', icon: 'radar', preload: false, internal: 'radar' },
  { id: 'zoom', name: 'Zoom', url: 'zeus://zoom', mode: 'full', icon: 'zoom', preload: false, internal: 'zoom' },
  { id: 'notas', name: 'Notas', url: 'zeus://notas', mode: 'full', icon: 'notas', preload: false, internal: 'notas' },
  { id: 'orfeu', name: 'Player', url: 'zeus://orfeu', mode: 'full', icon: 'orfeu', preload: false, internal: 'orfeu' },
  { id: 'hermes', name: 'Disco', url: 'zeus://hermes', mode: 'full', icon: 'hermes', preload: false, internal: 'hermes' },
  { id: 'eco', name: 'Editor', url: 'zeus://eco', mode: 'full', icon: 'eco', preload: false, internal: 'eco' },
  // página "Futebol hoje": abre pela bola da barra dos resultados, não aparece na barra das apps
  { id: 'futebol', name: 'Futebol', url: 'zeus://futebol', mode: 'full', icon: '', preload: false, internal: 'futebol', hidden: true },
  { id: 'wa', name: 'WhatsApp', url: 'https://web.whatsapp.com/', mode: 'full', icon: 'wa', preload: true, linksInTabs: true },
  { id: 'mail', name: 'Email', url: 'https://mail.google.com/', mode: 'full', icon: 'mail', preload: true, linksInTabs: true },
  { id: 'cal', name: 'Calendário', url: 'https://calendar.google.com/', mode: 'full', icon: 'cal', preload: false },
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so/', mode: 'full', icon: 'notion', preload: false },
  { id: 'pmail', name: 'Proton Mail', url: 'https://mail.proton.me/', mode: 'full', icon: 'pmail', preload: true },
  { id: 'pluto', name: 'Pluto', url: '', mode: 'full', icon: 'pluto', preload: false },
  { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/', mode: 'full', icon: 'music', preload: false }
];
const DEFAULT_SPACES = [
  { id: 'obs', name: 'Observador' },
  { id: 'pod', name: 'Podcasts' },
  { id: 'pes', name: 'Pessoal' }
];
const DEFAULT_SETTINGS = {
  tabMode: 'mosaic',          // mosaic | top | right
  rightWide: true,            // separadores à direita: true = com títulos (com zoom ajustado), false = só ícones
  rightZoom: true,            // com os títulos à direita, reduzir o zoom das páginas para manterem o aspeto de computador
  theme: 'dark',              // dark | light | system
  barColor: 'neutro',         // cor das barras (cima, apps, separadores, resultados): neutro | cinza | ardosia | salva | areia | noite | vinho | custom
  barCustom: {},              // cor escolhida à mão, por tema: { light: '#rrggbb', dark: '#rrggbb' }
  search: 'google',           // google | duckduckgo | startpage | brave
  city: { name: 'Lisboa', lat: 38.7223, lon: -9.1393 },
  newtabMode: 'web',          // web | claude
  restoreTabs: true,          // ao abrir, retomar os separadores da última vez
  panelWidth: 420,            // largura do painel das apps ao lado
  claudeWidth: 420,
  autoUpdate: true,
  autoPip: true,
  teams: [],                  // equipas seguidas no futebol em direto (Sofascore): [{ id, name }]
  goalAlerts: true,           // notificação do Mac quando há golo num desses jogos
  bigGames: true,             // também os jogos grandes das principais ligas europeias
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
    // 0.18.3: nomes mais diretos (Hermes → Disco, Orfeu → Player, Eco → Editor), só se o João não lhes tiver mudado o nome
    const RENAME = { hermes: ['Hermes', 'Disco'], orfeu: ['Orfeu', 'Player'], eco: ['Eco', 'Editor'] };
    S.apps.forEach(a => { const r = RENAME[a.id]; if (r && a.name === r[0]) a.name = r[1]; });
    // 0.18.0: o Eco (editor de áudio) entra logo a seguir ao Hermes
    if (!ids.has('eco')) {
      const i = S.apps.findIndex(a => a.id === 'eco'), j = S.apps.findIndex(a => a.id === 'hermes');
      if (i > -1 && j > -1 && i !== j + 1) S.apps.splice(j + 1, 0, ...S.apps.splice(i, 1));
    }
    // 0.16.0: o Hermes (ficheiros) entra logo a seguir ao Orfeu
    if (!ids.has('hermes')) {
      const i = S.apps.findIndex(a => a.id === 'hermes'), j = S.apps.findIndex(a => a.id === 'orfeu');
      if (i > -1 && j > -1 && i !== j + 1) S.apps.splice(j + 1, 0, ...S.apps.splice(i, 1));
    }
    // 0.15.0: o Orfeu (leitor de áudio e vídeo) entra logo a seguir às Notas
    if (!ids.has('orfeu')) {
      const i = S.apps.findIndex(a => a.id === 'orfeu'), j = S.apps.findIndex(a => a.id === 'notas');
      if (i > -1 && j > -1 && i !== j + 1) S.apps.splice(j + 1, 0, ...S.apps.splice(i, 1));
    }
    // 0.14.0: as Notas entram logo a seguir ao Zoom
    if (!ids.has('notas')) {
      const i = S.apps.findIndex(a => a.id === 'notas'), j = S.apps.findIndex(a => a.id === 'zoom');
      if (i > -1 && j > -1 && i !== j + 1) S.apps.splice(j + 1, 0, ...S.apps.splice(i, 1));
    }
    // 0.13.0: o Zoom (artigos guardados) entra logo a seguir ao Radar
    if (!ids.has('zoom')) {
      const i = S.apps.findIndex(a => a.id === 'zoom'), j = S.apps.findIndex(a => a.id === 'radar');
      if (i > -1 && j > -1 && i !== j + 1) S.apps.splice(j + 1, 0, ...S.apps.splice(i, 1));
    }
    // 0.6.0: o Radar (notícias) entra logo a seguir ao Apolo
    if (!ids.has('radar')) {
      const i = S.apps.findIndex(a => a.id === 'radar'), j = S.apps.findIndex(a => a.id === 'apolo');
      if (i > -1 && j > -1 && i !== j + 1) S.apps.splice(j + 1, 0, ...S.apps.splice(i, 1));
    }
    // 0.2.8: no Apolo os links abrem em separadores (as outras apps abrem tudo dentro de si)
    S.apps.forEach(a => { if (a.id === 'apolo' && a.linksInTabs === undefined) a.linksInTabs = true; });
    // 0.2.9: o WhatsApp também abre os links em separadores
    if (!saved.waLinks) { S.apps.forEach(a => { if (a.id === 'wa' || hostOf(a.url || '') === 'web.whatsapp.com') a.linksInTabs = true; }); S.waLinks = true; }
    // 0.3.0: o Gmail também abre os links em separadores
    // 0.3.1: na Drive, navegar fica na app; documentos (Docs, Sheets, Slides) abrem em separadores
    // 0.5.13: o João quer os títulos à direita (o zoom ajustado mantém o aspeto de computador)
    if (!saved.rightWideV) S.settings.rightWide = true;
    if (!saved.driveLinks) { S.apps.forEach(a => { if (hostOf(a.url || '') === 'drive.google.com' && !a.linksInTabs) a.linksInTabs = 'external'; }); }
    if (!saved.gmailLinks) { S.apps.forEach(a => { if (hostOf(a.url || '') === 'mail.google.com') a.linksInTabs = true; }); }
  } catch (e) { /* primeiro arranque */ }
  if (!S.settings.updateRepo && PKG.zeus && PKG.zeus.updateRepo) S.settings.updateRepo = PKG.zeus.updateRepo;
  S.tabs = (S.tabs || []).filter(t => t && t.url);
  if (!Array.isArray(S.history)) S.history = [];
  if (!Array.isArray(S.downloads)) S.downloads = [];
  if (!S.appLast || typeof S.appLast !== 'object') S.appLast = {};
  // primeira vez: o histórico começa com os sites mais visitados
  if (!S.history.length) Object.values(S.visits || {}).forEach(v => { if (v.url) S.history.push({ url: v.url, title: v.title || '', n: v.n || 1, t: Date.now() - 86400000 }); });
  if (!S.settings.restoreTabs && S.tabs.length) {
    // começa limpo, mas os separadores da última vez ficam em "Fechados há pouco"
    S.closed = [...S.tabs.filter(t => t.url !== NEWTAB).map(t => ({ url: t.url, title: t.title, space: t.space, favicon: t.favicon })), ...(S.closed || [])].slice(0, 15);
    S.tabs = [];
  }
  S.tabs.forEach(t => { t.id = nextId++; delete t.loading; delete t.error; delete t.audible; delete t.media; delete t.hasVideo; });
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
      pendingKey: S.pendingKey || null, apps: S.apps, removedApps: S.removedApps || [], waLinks: true, gmailLinks: true, driveLinks: true, newestFirst: true, rightWideV: true, settings: S.settings, permissions: S.permissions,
      siteZoom: S.siteZoom || {}, downloads: (S.downloads || []).slice(0, DL_MAX).map(d => d.state === 'progressing' ? { ...d, state: 'interrupted', paused: false } : d), visits: S.visits, history: S.history.slice(0, HISTORY_MAX), appLast: S.appLast, bounds: win && !win.isDestroyed() ? win.getNormalBounds() : S.bounds,
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
let videoDL = null;
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
  // highlights do Zoom (só se ativam nos separadores; ver preload-highlight.js)
  try { ses.registerPreloadScript({ type: 'frame', id: 'zeus-highlight', filePath: path.join(__dirname, 'preload-highlight.js') }); }
  catch (e) { console.error('preload dos highlights', e); }
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
      ? { trafficLightPosition: { x: 14, y: 15 } }
      : { titleBarOverlay: { color: '#0b0b0c', symbolColor: '#f6f6f4', height: 44 } }),
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
  win.on('close', e => {
    // a meio de uma gravação nas Notas: pergunta antes de fechar
    if (!quitOk && notasApp && notasApp.isRecording()) {
      e.preventDefault();
      notasApp.quitCheck().then(go => { if (go) { quitOk = true; win.close(); } });
      return;
    }
    saveNow();
  });
  win.on('closed', () => { win = null; });
  win.on('blur', () => ui && ui.send('alt', 'blur'));
}

/*
 * Mostrar/esconder uma vista com o tamanho certo. Uma vista que recebe o tamanho novo enquanto está
 * escondida (ex.: o Gmail ao lado, fechado e reaberto, ou passado de "ao lado" a página inteira) pode
 * continuar desenhada com o tamanho antigo — fica "compactada" e cortada. Por isso, ao reaparecer ou
 * mudar de tamanho, primeiro mostra-se e depois dá-se o tamanho, com um pequeno abanão (1 px) para a
 * página voltar a medir a janela.
 */
const shownAt = new WeakMap();   // vista -> "x,y,w,h" com que foi mostrada
function placeView(view, rect) {
  if (!rect) {
    if (view.getVisible && !view.getVisible()) return;
    view.setVisible(false); shownAt.delete(view); return;
  }
  const key = rect.x + ',' + rect.y + ',' + rect.width + ',' + rect.height;
  const wasHidden = view.getVisible ? !view.getVisible() : !shownAt.has(view);
  if (!wasHidden && shownAt.get(view) === key) return;
  view.setVisible(true);
  view.setBounds(rect);
  if (wasHidden || shownAt.get(view) !== key) {
    const wc = view.webContents;
    setTimeout(() => {
      if (wc.isDestroyed() || shownAt.get(view) !== key) return;
      view.setBounds({ x: rect.x, y: rect.y, width: Math.max(1, rect.width - 1), height: rect.height });
      view.setBounds(rect);
      try { wc.invalidate(); } catch (e) { /* ok */ }
    }, 60);
  }
  shownAt.set(view, key);
}

/*
 * Separadores à direita com títulos: a página fica mais estreita e muitos sites passam para o aspeto
 * de tablet/telemóvel. Para o evitar, reduz-se o zoom da página principal o suficiente para ela "ver"
 * pelo menos 1200 píxeis de largura (no máximo até 75%). Nos outros modos o zoom volta a 100%.
 */
const DESKTOP_WIDTH = 1200;   // meio-termo: aspeto de computador sem o texto ficar demasiado pequeno
// sites que só mostram o aspeto de computador a partir de uma largura maior
const SITE_DESKTOP = { 'observador.pt': 1280 };
const zoomedByUs = new WeakSet();
const siteOf = wc => { try { return hostOf(wc.getURL()); } catch (e) { return ''; } };
function fitZoom(view) {
  if (view.__internal) return;   // páginas do próprio Zeus (Radar) ajustam-se sozinhas
  const wc = view.webContents; if (wc.isDestroyed() || !L.page) return;
  const host = siteOf(wc);
  const own = S.siteZoom && host && S.siteZoom[host];   // zoom escolhido à mão para este site (⌘− / ⌘+)
  const on = S.settings.tabMode === 'right' && S.settings.rightWide && S.settings.rightZoom !== false;
  let z;
  if (own) z = own;
  else if (on) z = Math.max(0.75, Math.min(1, L.page.width / (SITE_DESKTOP[host] || DESKTOP_WIDTH)));
  else { if (!zoomedByUs.has(view)) return; z = 1; }
  if (Math.abs(wc.getZoomFactor() - z) > 0.005) wc.setZoomFactor(z);
  if (z !== 1) zoomedByUs.add(view); else zoomedByUs.delete(view);
}
// ⌘− / ⌘+ / ⌘0 na página à frente: zoom por site, guardado
function zoomStep(dir) {
  const v = fullApp ? appViews.get(fullApp) : tabViews.get(S.currentId);
  if (!v || v.webContents.isDestroyed()) return;
  const wc = v.webContents; const host = siteOf(wc); if (!host) return;
  S.siteZoom = S.siteZoom || {};
  if (dir === 0) delete S.siteZoom[host];
  else {
    const steps = [0.5, 0.67, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.1, 1.25, 1.5, 1.75, 2];
    const curZ = wc.getZoomFactor();
    let i = steps.findIndex(x => x >= curZ - 0.001); if (i < 0) i = steps.length - 1;
    if (dir > 0) i = steps[i] > curZ + 0.001 ? i : Math.min(steps.length - 1, i + 1);
    else i = steps[i] < curZ - 0.001 ? i : Math.max(0, i - 1);
    if (Math.abs(steps[i] - 1) < 0.001) delete S.siteZoom[host]; else S.siteZoom[host] = steps[i];
  }
  saveState();
  if (!S.siteZoom[host]) { zoomedByUs.add(v); }
  fitZoom(v);
  ui && ui.send('toast', `Zoom ${Math.round(wc.getZoomFactor() * 100)}% em ${host}` + (S.siteZoom[host] ? '' : ' (automático)'));
}

function applyLayout() {
  if (!win) return;
  const ov = L.overlay;
  // separadores
  for (const [id, view] of tabViews) {
    const tab = tabById(id);
    const show = !ov && !L.cover && !fullApp && id === S.currentId && tab && !tab.error && tab.url !== NEWTAB && L.page;
    // de volta ao separador do vídeo: o vídeo sai da janela flutuante e volta para a página
    if (show && pipTabs.has(id)) pipExit(id);
    placeView(view, show ? L.page : null);
    if (show) fitZoom(view);
  }
  // apps
  for (const [id, view] of appViews) {
    let rect = null;
    if (!ov && !L.cover && !appErrors[id] && fullApp === id && L.page) rect = L.page;
    else if (!ov && !appErrors[id] && openPanel === id && L.panel) rect = L.panel;
    placeView(view, rect);
    if (rect && rect === L.page) fitZoom(view);
  }
  // Claude
  if (claudeView) placeView(claudeView, !ov && S.claudeOpen && L.claude ? L.claude : null);
  placeRadarPreview();
  // vídeo em ecrã inteiro por cima de tudo
  if (fullscreenView) {
    const [w, h] = win.getContentSize();
    fullscreenView.setBounds({ x: 0, y: 0, width: w, height: h });
    fullscreenView.setVisible(true);
    shownAt.delete(fullscreenView);   // ao sair do ecrã inteiro volta a receber o tamanho normal
  }
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
      zoomSaved: !!(zoom && wc && /^https?:/.test(wc.getURL()) && zoom.has(wc.getURL())),
      videoHere: !!(videoDL && !fullApp && wc && /^https?:/.test(wc.getURL()) && (videoDL.isVideoSite(wc.getURL()) || (cur() && (cur().hasVideo || cur().media)))),
      spaces: S.spaces, later: S.later, closed: S.closed, pickSpace,
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
    // ficheiros gerados pela própria página (o WhatsApp faz isto ao transferir fotos, vídeos e documentos): transferir
    if (/^(blob|data):/i.test(url)) { try { wc.downloadURL(url); } catch (e) { /* ok */ } return { action: 'deny' }; }
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
      cw.on('did-start-navigation', d => {
        if (!d.isMainFrame) return;
        if (/^https?:/.test(d.url)) finish(d.url);
        // a janela em branco recebeu um ficheiro (blob/data): transfere-o pela página que o pediu
        else if (/^(blob|data):/i.test(d.url)) { const u = d.url; setImmediate(() => { try { if (!wc.isDestroyed()) wc.downloadURL(u); } catch (e) { /* ok */ } }); finish(null); }
      });
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
  // a página tenta abrir um ficheiro gerado (blob/data) por cima de si própria: transfere-o em vez disso
  wc.on('will-navigate', (e, url) => { if (/^(blob|data):/i.test(url)) { e.preventDefault(); try { wc.downloadURL(url); } catch (x) { /* ok */ } } });
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
  if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && !/^mediasource:/i.test(p.srcURL)) {
    items.push({ label: p.mediaType === 'video' ? 'Guardar vídeo…' : 'Guardar áudio…', click: () => wc.downloadURL(p.srcURL) }, { type: 'separator' });
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
  // o zoom é por site: ao mudar de site volta a acertar-se (separadores à direita com títulos)
  wc.on('did-navigate', () => { if (view.getVisible()) fitZoom(view); });
  try { if (rec.ext) rec.ext.addTab(wc, win); } catch (e) { /* extensões opcionais */ }

  const id = tab.id;
  const T = () => tabById(id);
  wc.on('page-title-updated', (e, title) => { const t = T(); if (t) { t.title = title; retitle(t.url, title); pushState(); saveState(); } });
  wc.on('page-favicon-updated', (e, fav) => { const t = T(); if (t) { t.favicon = fav[0] || ''; pushState(); } });
  const onNav = (e, url) => {
    const t = T(); if (!t) return;
    if (t.url !== url) t.hasVideo = false;
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
  wc.on('did-stop-loading', () => {
    const t = T(); if (!t) return;
    t.loading = false; pushState();
    // há algum vídeo na página? (para mostrar o botão de descarregar vídeos)
    if (/^https?:/.test(wc.getURL())) wc.executeJavaScript("!!document.querySelector('video')", true).then(v => { const t2 = T(); if (t2 && !!v !== !!t2.hasVideo) { t2.hasVideo = !!v; pushState(); } }).catch(() => {});
  });
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
  wc.on('media-started-playing', () => { const t = T(); if (t) { t.media = true; t.hasVideo = true; pushState(); } });
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
    space: space || takePick() || (cur() ? cur().space : S.spaces[0].id),
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
  if (pickSpace && tab.space !== pickSpace) pickSpace = null;   // foi para outro espaço: a escolha deixa de valer
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
async function fetchFeedOnce(f, url, params, cookies) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
  if (f.key) u.searchParams.set('k', f.key);
  const r = await feedSession(f).fetch(u.toString(), { credentials: cookies ? 'include' : 'omit', redirect: 'follow', cache: 'no-store' });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* página de login ou de erro */ }
  if (j) {
    if (!j.ok) {
      // código antigo sem o serviço das tarefas ligado
      const msg = /Tasks is not defined/i.test(j.error || '') ? 'Falta ligar o serviço das tarefas no Apps Script: no editor, Serviços (+) › Google Tasks API › Adicionar; depois Implementar › Gerir implementações › lápis › Versão: Nova versão › Implementar.' : (j.error || 'Erro no Apps Script.');
      throw Object.assign(new Error(msg), { fatal: true });
    }
    return j;
  }
  const title = ((/<title>([^<]*)<\/title>/i.exec(text) || [])[1] || '').trim();
  if (/accounts\.google\.com|ServiceLogin|signin/i.test(r.url + text.slice(0, 3000))) throw new Error('login');
  throw new Error(`resposta ${r.status}${title ? ' — ' + title : ''}`);
}
async function callFeed(f, params) {
  // 1.º sem cookies (aplicação Web com acesso "Qualquer pessoa", protegida pela chave do Zeus)
  let last = null;
  if (f.key || f.mode === 'anyone') {
    try { return await fetchFeedOnce(f, f.url, params, false); } catch (e) { last = e; if (e.fatal) throw e; }
  }
  // depois com a sessão da app ("Só eu"), experimentando as contas /u/0/, /u/1/…
  const tries = f.authuser != null ? [f.authuser] : [null, 0, 1, 2, 3, 4];
  for (const n of tries) {
    try {
      const j = await fetchFeedOnce(f, withAccount(f.url, n), params, true);
      if (n != null && f.authuser !== n) { f.authuser = n; saveState(); }
      return j;
    } catch (e) { if (!last || last.message === 'login' || /404/.test(last.message)) last = e; if (e.fatal) throw e; }
  }
  // a conta guardada deixou de responder (ex.: ordem das contas mudou): volta a procurar na próxima vez
  if (f.authuser != null) { delete f.authuser; saveState(); }
  const app = (appById(f.appId) || {}).name || 'Gmail';
  if (last && last.message === 'login') throw new Error(`Nenhuma conta da app ${app} tem acesso a este Apps Script. Entra nessa conta na app ${app} (ou cria o Apps Script na conta certa).`);
  throw new Error(`O endereço não devolveu a agenda (${last ? last.message : 'sem resposta'}). Confirma que colaste o código novo (com a chave), que é o URL da aplicação Web (acaba em /exec) e que a implementação está como "Executar como: Eu" e "Quem tem acesso: Qualquer pessoa".`);
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
    if (d.tasksError) errors.push({ feed: f.id, label, error: d.tasksError });
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
// chave secreta da próxima ligação: vai dentro do código copiado e fica guardada só no Zeus
let pendingKey = null;
function homeScriptCode() {
  // guardada também no estado, para sobreviver a um reinício a meio da ligação
  if (!pendingKey) pendingKey = S.pendingKey || require('crypto').randomBytes(18).toString('base64url');
  S.pendingKey = pendingKey; saveState();
  try { return fs.readFileSync(path.join(__dirname, '..', 'assets', 'zeus-hoje.gs'), 'utf8').replace("var ZEUS_KEY = '';", `var ZEUS_KEY = '${pendingKey}';`); }
  catch (e) { return ''; }
}
// abre o Apps Script numa janela com a sessão (a conta) da app escolhida e copia o código
// contas Google com sessão iniciada na app (pela ordem /u/0, /u/1, …), para abrir o Apps Script na conta certa
async function homeAccounts(appId) {
  const a = appById(appId); if (!a) return [];
  try {
    const r = await sessionForApp(a).ses.fetch('https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard', { credentials: 'include', cache: 'no-store' });
    const text = await r.text();
    const seen = []; (text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []).forEach(e => { if (!seen.includes(e)) seen.push(e); });
    return seen.slice(0, 6).map((email, n) => ({ n, email }));
  } catch (e) { return []; }
}
function homeSetupOpen(appId, n) {
  const a = appById(appId); if (!a) return { ok: false };
  clipboard.writeText(homeScriptCode());
  const { ses } = sessionForApp(a);
  const w = new BrowserWindow({ width: 1180, height: 820, parent: win, title: 'Apps Script — ' + a.name, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: WEB_PREFS(ses) });
  const wc = w.webContents;
  wc.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(wc, d.url); });
  // janelas de autorização da Google abrem como janelas filhas, na mesma conta
  wc.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, parent: w, autoHideMenuBar: true, webPreferences: WEB_PREFS(ses) } }));
  wc.on('did-create-window', child => child.webContents.on('did-start-navigation', d => { if (d.isMainFrame) googleUA(child.webContents, d.url); }));
  // projeto novo do Apps Script na conta escolhida (/u/N/ = N-ésima conta com sessão iniciada)
  const start = Number.isInteger(n) && n >= 0 && n < 10 ? `https://script.google.com/u/${n}/home/projects/create` : 'https://script.google.com/home/projects/create';
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
  if (pendingKey) f.key = pendingKey;
  try {
    const d = await callFeed(f, { date: localDate() });
    if (f.key) { pendingKey = null; delete S.pendingKey; }
    f.account = d.account || '';
    S.settings.homeFeeds = [...(S.settings.homeFeeds || []), f];
    todayCache.t = 0; saveState(); pushState(true);
    return { ok: true, account: f.account, events: (d.events || []).length, tasks: (d.tasks || []).length, tasksError: d.tasksError || '' };
  } catch (e) {
    if (/Chave errada/.test(e.message)) return { ok: false, error: 'O código que está no Apps Script tem uma chave diferente. Carrega em "Copiar o código outra vez", cola-o no editor (substituindo tudo), guarda e cria uma versão nova da implementação.' };
    return { ok: false, error: e.message };
  }
}
function homeFeedRemove(id) {
  S.settings.homeFeeds = (S.settings.homeFeeds || []).filter(f => f.id !== id);
  todayCache.t = 0; saveState(); pushState(true);
}

// casa: página nova (hora, meteorologia, pesquisa) — reaproveita uma página nova vazia do espaço
/* Espaço escolhido na barra da direita (clique no título do espaço): a casinha e o separador novo abrem nesse espaço */
let pickSpace = null;
function takePick() { const p = pickSpace && S.spaces.some(x => x.id === pickSpace) ? pickSpace : null; if (pickSpace) { pickSpace = null; pushState(); } return p; }
// espaço "Recentes": o que se abre a partir da casinha fica aí (depois arrasta-se para outro espaço, se se quiser)
function recentSpace() {
  let s = S.spaces.find(x => x.id === 'rec') || S.spaces.find(x => /^recentes$/i.test(String(x.name).trim()));
  if (!s) { s = { id: 'rec', name: 'Recentes' }; S.spaces.unshift(s); saveState(); }
  return s.id;
}
function goHome() {
  const t = cur();
  const picked = takePick();
  const space = picked || recentSpace();
  if (!(t && t.url === NEWTAB && !fullApp && t.space === space)) {
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
async function pipEnter(wc, force) {
  const r = await inFrames(wc, PIP_ENTER(force));
  const ok = r.includes('ok') || r.includes('already');
  if (ok) pipWatch(wc);
  return ok;
}
/* Som do vídeo a flutuar: a janela de vídeo flutuante do Chromium não tem botão de som, por isso o Zeus põe um na barra de cima
   enquanto houver um vídeo a flutuar (sites como o RTP Play começam o direto sem som). */
const PIP_INFO = `(() => { const v = document.pictureInPictureElement; return v ? (v.muted || v.volume === 0 ? 'muted' : 'sound') : null; })()`;
const PIP_SOUND = `(() => { const v = document.pictureInPictureElement; if (!v) return null;
  if (v.muted || v.volume === 0) { v.muted = false; if (v.volume === 0) v.volume = 1; if (v.paused) v.play().catch(() => {}); } else v.muted = true;
  return v.muted ? 'muted' : 'sound'; })()`;
let pipWC = null, pipTimer = null, pipSent = '';
const pipFind = async wc => (await inFrames(wc, PIP_INFO)).find(x => x === 'muted' || x === 'sound') || null;
function pipSend(state) { const k = state || ''; if (k !== pipSent) { pipSent = k; ui && ui.send('pip', { on: !!state, muted: state === 'muted' }); } }
function pipWatch(wc) {
  pipWC = wc; clearInterval(pipTimer);
  const tick = async () => {
    const st = pipWC && !pipWC.isDestroyed() ? await pipFind(pipWC) : null;
    pipSend(st);
    if (!st) { clearInterval(pipTimer); pipTimer = null; pipWC = null; }
  };
  setTimeout(tick, 300); pipTimer = setInterval(tick, 1500);
}
async function pipSound() {
  if (!pipWC || pipWC.isDestroyed()) return null;
  const st = (await inFrames(pipWC, PIP_SOUND)).find(x => x === 'muted' || x === 'sound') || null;
  pipSend(st); return st;
}
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
function shareDo(id, pos, page) {
  const c = page && /^https?:/.test(page.url || '') ? page : shareCurrent();
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
    // no Radar, recarregar = ir buscar as notícias outra vez (e voltar ao topo das colunas)
    if (v.__internal && ['reload', 'retry', 'hardreload', 'apphome'].includes(a)) { if (w === radarWC) w.send('radar:refresh'); return; }
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
  if (a.internal && INTERNAL[a.internal]) return ensureInternalView(a);
  const { ses, ext, ready } = sessionForApp(a);
  const view = new WebContentsView({ webPreferences: WEB_PREFS(ses) });
  view.setBackgroundColor('#ffffff');
  appViews.set(a.id, view);
  win.contentView.addChildView(view);
  view.setVisible(false);
  const wc = view.webContents;
  wireWeb(wc, 'app', { appId: a.id });
  wc.on('did-navigate', () => { if (view.getVisible() && fullApp === a.id) fitZoom(view); });
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
/* Apps internas: páginas feitas pelo próprio Zeus (não são sites), com uma ponte própria e limitada.
   O Radar só pode: ler e guardar o seu ficheiro, ir buscar feeds/páginas públicas (sem cookies) e abrir links em separadores. */
const INTERNAL = {
  radar: { file: path.join(__dirname, 'radar', 'index.html'), preload: path.join(__dirname, 'radar', 'preload.js') },
  futebol: { file: path.join(__dirname, 'futebol', 'index.html'), preload: path.join(__dirname, 'futebol', 'preload.js') },
  zoom: { file: path.join(__dirname, 'zoomapp', 'index.html'), preload: path.join(__dirname, 'zoomapp', 'preload.js') },
  notas: { file: path.join(__dirname, 'notasapp', 'index.html'), preload: path.join(__dirname, 'notasapp', 'preload.js') },
  orfeu: { file: path.join(__dirname, 'orfeuapp', 'index.html'), preload: path.join(__dirname, 'orfeuapp', 'preload.js') },
  hermes: { file: path.join(__dirname, 'hermesapp', 'index.html'), preload: path.join(__dirname, 'hermesapp', 'preload.js') },
  eco: { file: path.join(__dirname, 'ecoapp', 'index.html'), preload: path.join(__dirname, 'ecoapp', 'preload.js') }
};
let radarWC = null, futebolWC = null, zoomWC = null, notasWC = null, orfeuWC = null, hermesWC = null, ecoWC = null;
let ecoApp = null;
let orfeuApp = null;
let notasApp = null;
const isDark = () => S.settings.theme === 'dark' || (S.settings.theme === 'system' && nativeTheme.shouldUseDarkColors);
function ensureInternalView(a) {
  const def = INTERNAL[a.internal];
  const view = new WebContentsView({ webPreferences: {
    partition: 'persist:zeus-' + a.internal, preload: def.preload,
    sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: true
  } });
  view.__internal = true;
  view.setBackgroundColor(isDark() ? '#0b0b0c' : '#ffffff');
  appViews.set(a.id, view);
  win.contentView.addChildView(view);
  view.setVisible(false);
  const wc = view.webContents;
  if (a.internal === 'radar') radarWC = wc;
  if (a.internal === 'futebol') futebolWC = wc;
  if (a.internal === 'zoom') zoomWC = wc;
  if (a.internal === 'eco') {
    ecoWC = wc;
    // o Eco não pede nada ao sistema (os ficheiros são lidos pelo processo principal)
    wc.session.setPermissionRequestHandler((w, perm, cb) => cb(false));
    wc.session.setPermissionCheckHandler(() => false);
  }
  if (a.internal === 'hermes') {
    hermesWC = wc;
    // o Hermes não pede nada ao sistema pela página (as pastas são lidas pelo processo principal)
    wc.session.setPermissionRequestHandler((w, perm, cb) => cb(false));
    wc.session.setPermissionCheckHandler(() => false);
  }
  if (a.internal === 'orfeu') {
    orfeuWC = wc;
    // o Orfeu não pede nada ao sistema (só ecrã inteiro para os vídeos)
    wc.session.setPermissionRequestHandler((w, perm, cb) => cb(w === orfeuWC && perm === 'fullscreen'));
    wc.session.setPermissionCheckHandler((w, perm) => w === orfeuWC && perm === 'fullscreen');
    wc.once('did-finish-load', () => { const q = pendingMedia.splice(0); if (q.length) orfeuOpenPaths(q); });
  }
  if (a.internal === 'notas') {
    notasWC = wc;
    // as Notas só podem pedir o microfone (para gravar reuniões); nada mais
    const ses = wc.session;
    ses.setPermissionRequestHandler((w, perm, cb, d) => cb(w === notasWC && perm === 'media' && !!d && Array.isArray(d.mediaTypes) && d.mediaTypes.length > 0 && d.mediaTypes.every(t => t === 'audio')));
    ses.setPermissionCheckHandler((w, perm) => perm === 'media' && w === notasWC);
  }
  wc.on('will-navigate', (e, url) => { e.preventDefault(); if (/^https?:/.test(url)) newTab({ url, space: spaceForOpener() }); });
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) newTab({ url, space: spaceForOpener() }); return { action: 'deny' }; });
  wc.on('render-process-gone', (e, d) => { if (d.reason !== 'clean-exit') setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, 500); });
  wc.on('destroyed', () => { if (radarWC === wc) radarWC = null; if (futebolWC === wc) futebolWC = null; if (zoomWC === wc) zoomWC = null; if (notasWC === wc) notasWC = null; if (orfeuWC === wc) orfeuWC = null; if (hermesWC === wc) hermesWC = null; if (ecoWC === wc) ecoWC = null; });
  wc.loadFile(def.file).catch(() => {});
  return view;
}
const RADAR_FILE = () => path.join(app.getPath('userData'), 'radar.json');
function radarLoad() { try { return JSON.parse(fs.readFileSync(RADAR_FILE(), 'utf8')); } catch (e) { return null; } }
function radarSave(d) {
  try {
    const txt = JSON.stringify(d || {});
    if (txt.length > 20e6) return false;
    const tmp = RADAR_FILE() + '.tmp'; fs.writeFileSync(tmp, txt); fs.renameSync(tmp, RADAR_FILE()); return true;
  } catch (e) { return false; }
}
// vai buscar um feed (ou a página de um site, para lhe descobrir o feed); sem cookies, até 5 MB, 15 s no máximo
async function radarFetch(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: 'Endereço inválido.' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await zeusSession.fetch(url, {
      signal: ctl.signal, credentials: 'omit', redirect: 'follow',
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, application/json;q=0.8, text/html;q=0.7, */*;q=0.5' }
    });
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 5e6) buf = buf.subarray(0, 5e6);
    const type = r.headers.get('content-type') || '';
    const head = buf.subarray(0, 4000).toString('latin1');
    const cs = (/charset=["']?([\w-]+)/i.exec(type) || /encoding=["']([\w-]+)/i.exec(head) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1] || 'utf-8';
    let text; try { text = new TextDecoder(cs).decode(buf); } catch (e) { text = new TextDecoder('utf-8').decode(buf); }
    return { ok: r.ok, status: r.status, url: r.url || url, type, text };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'O site demorou demasiado a responder.' : 'Não foi possível ligar ao site.' };
  } finally { clearTimeout(timer); }
}
/* Pré-visualização de notícias dentro do Radar: uma página web verdadeira (sessão do Zeus, com as assinaturas
   iniciadas), por cima do painel que o Radar reserva para ela. */
let radarPrev = null, radarPrevRect = null;
// a mesma página de pré-visualização serve o Radar e o Zoom: prevOwner diz a qual pertence agora
let prevOwner = 'radar';
const prevWC = () => { const w = prevOwner === 'zoom' ? zoomWC : radarWC; return w && !w.isDestroyed() ? w : null; };
const prevCh = name => (prevOwner === 'zoom' ? 'zoomapp:' : 'radar:') + name;
function placeRadarPreview() {
  if (!radarPrev || radarPrev.webContents.isDestroyed()) return;
  const rv = appViews.get(prevOwner);
  const vis = rv && rv.getVisible() && radarPrevRect && !L.overlay && !L.cover && (fullApp === prevOwner || openPanel === prevOwner);
  if (!vis) { placeView(radarPrev, null); return; }
  const b = rv.getBounds(), r = radarPrevRect;
  placeView(radarPrev, { x: b.x + Math.round(r.x), y: b.y + Math.round(r.y), width: Math.max(50, Math.round(r.width)), height: Math.max(50, Math.round(r.height)) });
}
function radarPreviewOpen(url, rect, owner = 'radar') {
  if (prevOwner !== owner && radarPrevRect) { const o = prevWC(); if (o) o.send(prevCh('previewClosed')); }
  prevOwner = owner;
  if (!radarPrev || radarPrev.webContents.isDestroyed()) {
    radarPrev = new WebContentsView({ webPreferences: WEB_PREFS(zeusSession) });
    radarPrev.setBackgroundColor('#ffffff');
    win.contentView.addChildView(radarPrev);
    radarPrev.setVisible(false);
    const wc = radarPrev.webContents;
    wireWeb(wc, 'tab', {});
    try { if (extensions) extensions.addTab(wc, win); } catch (e) { /* ok */ }
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !wc.isFullScreen?.()) { e.preventDefault(); radarPreviewClose(true); }
    });
    const tell = st => { const o = prevWC(); if (o) o.send(prevCh('previewState'), st); };
    wc.on('page-title-updated', (e, t) => tell({ title: t, url: wc.getURL(), loading: wc.isLoading() }));
    wc.on('did-stop-loading', () => tell({ title: wc.getTitle(), url: wc.getURL(), loading: false }));
    wc.on('did-start-loading', () => tell({ loading: true }));
  } else {
    // traz para cima de tudo (pode ter sido criada antes de outras vistas)
    try { win.contentView.removeChildView(radarPrev); win.contentView.addChildView(radarPrev); } catch (e) { /* ok */ }
  }
  radarPrevRect = rect;
  radarPrev.webContents.loadURL(url).catch(() => {});
  placeRadarPreview();
}
function radarPreviewClose(tell) {
  radarPrevRect = null;
  if (radarPrev && !radarPrev.webContents.isDestroyed()) {
    placeView(radarPrev, null);
    radarPrev.webContents.loadURL('about:blank').catch(() => {});   // para o som e os vídeos
  }
  const o = prevWC();
  if (tell && o) o.send(prevCh('previewClosed'));
  if (o) o.focus();
}
/* ------------------------------------------------------------------ */
/* Zoom: artigos guardados, coleções e highlights (ver zoom.js)         */
/* ------------------------------------------------------------------ */
let zoom = null, zoomNotifyT = null;
function zoomChanged() {
  clearTimeout(zoomNotifyT);
  zoomNotifyT = setTimeout(() => {
    pushState();
    if (zoomWC && !zoomWC.isDestroyed()) zoomWC.send('zoomapp:changed');
  }, 120);
}
// páginas web do Zeus onde se pode guardar e sublinhar (separadores, apps da barra, pré-visualização do Radar)
function isWebPage(wc) {
  if (!wc || wc.isDestroyed()) return false;
  for (const v of tabViews.values()) if (v.webContents === wc) return true;
  for (const v of appViews.values()) if (!v.__internal && v.webContents === wc) return true;
  return !!(radarPrev && radarPrev.webContents === wc);
}
// título, imagem, descrição e nome do site da página aberta
async function pageMeta(wc) {
  const url = wc.getURL();
  let m = {};
  try {
    m = await Promise.race([wc.executeJavaScript(`(() => {
      const q = (...ks) => { for (const k of ks) { const e = document.querySelector('meta[property="' + k + '"], meta[name="' + k + '"]'); if (e && e.content) return e.content; } return ''; };
      let img = q('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
      try { if (img) img = new URL(img, location.href).href; } catch (e) { img = ''; }
      return { title: q('og:title', 'twitter:title') || document.title, image: img, excerpt: q('og:description', 'description', 'twitter:description'), site: q('og:site_name') };
    })()`, false), new Promise(r => setTimeout(() => r({}), 2500))]) || {};
  } catch (e) { m = {}; }
  return { url, title: m.title || wc.getTitle(), image: m.image || '', excerpt: m.excerpt || '', site: m.site || '' };
}
async function zoomSaveWC(wc) {
  if (!wc || wc.isDestroyed() || !/^https?:/.test(wc.getURL())) return null;
  const it = zoom.add(await pageMeta(wc));
  return it;
}
function zoomIPC() {
  // barra de cima: guardar / editar a página aberta
  handle('zoom:saveCurrent', async () => { const it = await zoomSaveWC(pageWC()); if (!it) ui.send('toast', 'Esta página não pode ser guardada no Zoom.'); return it; });
  handle('zoom:current', () => { const wc = pageWC(); return wc && zoom.byUrl(wc.getURL()); });
  handle('zoom:update', (id, patch) => zoom.update(String(id), patch || {}));
  handle('zoom:remove', id => zoom.remove(String(id)));
  handle('zoom:cols', () => zoom.data().cols);
  handle('zoom:addCol', name => zoom.addCol(name));
  // highlights: vêm do preload das páginas web (nunca das páginas das extensões nem das páginas internas)
  // só nos separadores e na pré-visualização do Radar (nas apps da barra, como o WhatsApp, a barra de cores atrapalharia)
  const isReadPage = wc => !!wc && !wc.isDestroyed() && ([...tabViews.values()].some(v => v.webContents === wc) || !!(radarPrev && radarPrev.webContents === wc));
  const web = e => isReadPage(e.sender) && e.senderFrame === e.sender.mainFrame;
  ipcMain.handle('zh:list', e => (web(e) && zoom ? zoom.highlightsFor(e.sender.getURL()) : null));
  ipcMain.handle('zh:add', async (e, h) => {
    if (!web(e) || !h) return null;
    const wc = e.sender, had = zoom.has(wc.getURL());
    const r = zoom.addHighlight(had ? { url: wc.getURL() } : await pageMeta(wc), h);
    if (r && !had) ui && ui.send('toast', 'Página guardada no Zoom, com o destaque.');
    return r && r.hl;
  });
  ipcMain.handle('zh:update', (e, hid, patch) => (web(e) ? zoom.updateHighlight(e.sender.getURL(), String(hid), patch || {}) : null));
  ipcMain.handle('zh:remove', (e, hid) => (web(e) ? zoom.removeHighlight(e.sender.getURL(), String(hid)) : false));
  // página Zoom (interna)
  const fromZoom = e => zoomWC && !zoomWC.isDestroyed() && e.sender === zoomWC;
  const zh = (name, fn) => ipcMain.handle('zoomapp:' + name, (e, ...a) => (fromZoom(e) ? fn(...a) : null));
  zh('data', () => zoom.data());
  zh('theme', () => (isDark() ? 'dark' : 'light'));
  zh('update', (id, patch) => zoom.update(String(id), patch || {}));
  // mudanças feitas na página Zoom aparecem logo nas páginas abertas
  const refreshPages = () => {
    const all = [...tabViews.values(), ...[...appViews.values()].filter(v => !v.__internal), ...(radarPrev ? [radarPrev] : [])];
    all.forEach(v => { try { if (!v.webContents.isDestroyed()) v.webContents.send('zh:refresh'); } catch (e) { /* ok */ } });
  };
  zh('remove', id => { const r = zoom.remove(String(id)); refreshPages(); return r; });
  zh('addCol', name => zoom.addCol(name));
  zh('renameCol', (id, name) => zoom.renameCol(String(id), name));
  zh('removeCol', id => zoom.removeCol(String(id)));
  zh('moveCol', (id, dir) => zoom.moveCol(String(id), dir > 0 ? 1 : -1));
  zh('updateHl', (id, hid, patch) => { const it = zoom.byId(String(id)); const r = it ? zoom.updateHighlight(it.url, String(hid), patch || {}) : null; refreshPages(); return r; });
  zh('removeHl', (id, hid) => { const it = zoom.byId(String(id)); const r = it ? zoom.removeHighlight(it.url, String(hid)) : false; refreshPages(); return r; });
  zh('open', (id, bg) => { const it = zoom.byId(String(id)); if (it) newTab({ url: it.url, space: spaceForOpener(), activate: !bg }); });
  zh('copy', text => { clipboard.writeText(String(text || '')); return true; });
  // abrir o artigo dentro do próprio Zoom (a mesma pré-visualização do Radar)
  const okRect = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(+r[k])) ? { x: +r.x, y: +r.y, width: +r.width, height: +r.height } : null;
  zh('preview', (id, rect) => { const it = zoom.byId(String(id)); if (!it || !okRect(rect)) return false; radarPreviewOpen(it.url, okRect(rect), 'zoom'); return true; });
  zh('previewRect', rect => { if (radarPrevRect && prevOwner === 'zoom') { radarPrevRect = okRect(rect) || radarPrevRect; placeRadarPreview(); } });
  zh('previewClose', () => { if (prevOwner === 'zoom') radarPreviewClose(false); });
  zh('previewToTab', () => {
    if (prevOwner !== 'zoom' || !radarPrev || radarPrev.webContents.isDestroyed()) return false;
    const u = radarPrev.webContents.getURL();
    radarPreviewClose(false);
    if (/^https?:/.test(u)) newTab({ url: u, space: spaceForOpener() });
    return true;
  });
}

function radarIPC() {
  const ok = e => radarWC && !radarWC.isDestroyed() && e.sender === radarWC;
  ipcMain.handle('radar:load', e => ok(e) ? radarLoad() : null);
  ipcMain.handle('radar:save', (e, d) => ok(e) ? radarSave(d) : false);
  ipcMain.handle('radar:fetch', (e, url) => ok(e) ? radarFetch(url) : null);
  ipcMain.handle('radar:theme', e => ok(e) ? (isDark() ? 'dark' : 'light') : null);
  const okRect = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(+r[k])) ? { x: +r.x, y: +r.y, width: +r.width, height: +r.height } : null;
  ipcMain.handle('radar:preview', (e, url, rect) => {
    if (!ok(e) || typeof url !== 'string' || !/^https?:\/\//i.test(url) || !okRect(rect)) return false;
    radarPreviewOpen(url, okRect(rect)); return true;
  });
  ipcMain.handle('radar:previewRect', (e, rect) => { if (ok(e) && radarPrevRect && prevOwner === 'radar') { radarPrevRect = okRect(rect) || radarPrevRect; placeRadarPreview(); } });
  ipcMain.handle('radar:previewClose', e => { if (ok(e) && prevOwner === 'radar') radarPreviewClose(false); });
  // guardar a notícia da pré-visualização no Zoom, já na coleção escolhida
  const prevURL = () => (radarPrev && !radarPrev.webContents.isDestroyed() ? radarPrev.webContents.getURL() : '');
  ipcMain.handle('radar:zoomSave', async (e, col) => {
    if (!ok(e) || !radarPrev || radarPrev.webContents.isDestroyed()) return null;
    const wc = radarPrev.webContents;
    if (!/^https?:/.test(wc.getURL())) return null;
    const it = zoom.add(await pageMeta(wc), { col: typeof col === 'string' ? col : '' });
    if (it && ui) { const c = zoom.data().cols.find(x => x.id === it.col); ui.send('toast', c ? `Guardado no Zoom, em “${c.name}”.` : 'Guardado no Zoom.'); }
    return it ? { id: it.id, col: it.col } : null;
  });
  ipcMain.handle('radar:zoomInfo', (e, url) => {
    if (!ok(e) || !zoom) return null;
    const it = zoom.byUrl(String(url || prevURL()));
    return { cols: zoom.data().cols.map(c => ({ id: c.id, name: c.name })), item: it ? { id: it.id, col: it.col } : null };
  });
  ipcMain.handle('radar:zoomAddCol', (e, name) => { if (!ok(e) || !zoom) return null; const c = zoom.addCol(String(name || '')); return c ? { id: c.id, name: c.name } : null; });
  ipcMain.handle('radar:zoomRemove', (e, url) => {
    if (!ok(e) || !zoom) return false;
    const it = zoom.byUrl(String(url || prevURL())); if (!it) return false;
    zoom.remove(it.id); ui && ui.send('toast', 'Tirado do Zoom.'); return true;
  });
  ipcMain.handle('radar:zoomHas', (e, url) => (ok(e) && zoom ? zoom.has(String(url || '')) : false));
  // partilhar a notícia da pré-visualização: o mesmo menu de partilha do Zeus, num menu do sistema junto ao botão
  ipcMain.handle('radar:share', (e, at, fallbackTitle) => {
    if (!ok(e) || !radarPrev || radarPrev.webContents.isDestroyed()) return false;
    const pw = radarPrev.webContents, url = pw.getURL();
    if (!/^https?:/.test(url)) return false;
    const page = { url, title: pw.getTitle() || String(fallbackTitle || '') || hostOf(url) };
    const rv = appViews.get('radar'), b = rv ? rv.getBounds() : { x: 0, y: 0 };
    const pos = at && Number.isFinite(+at.x) ? { x: b.x + Math.round(+at.x), y: b.y + Math.round(+at.y) } : undefined;
    const go = id => shareDo(id, pos, page);
    const items = shareTargets().map(t => ({ label: t.label, click: () => go(t.id) }));
    Menu.buildFromTemplate([
      ...items,
      { type: 'separator' },
      { label: 'Copiar endereço', click: () => go('copy') },
      { label: 'Copiar título e endereço', click: () => go('copyboth') },
      ...(isMac ? [{ label: 'Mais opções do Mac…', click: () => go('native') }] : []),
      { label: 'Abrir no browser do sistema', click: () => go('browser') }
    ]).popup({ window: win, ...(pos || {}) });
    return true;
  });
  // passa a página da pré-visualização para um separador (fica onde estava, sem a recarregar do zero)
  ipcMain.handle('radar:previewToTab', e => {
    if (!ok(e) || !radarPrev || radarPrev.webContents.isDestroyed()) return false;
    const u = radarPrev.webContents.getURL();
    radarPreviewClose(false);
    if (/^https?:/.test(u)) newTab({ url: u, space: spaceForOpener() });
    return true;
  });
  ipcMain.handle('radar:open', (e, url, background) => {
    if (!ok(e) || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    newTab({ url, space: spaceForOpener(), activate: !background });
    if (background) ui && ui.send('toast', 'Aberto num separador em segundo plano.');
    return true;
  });
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
// abre uma app da barra (sem a fechar se já estiver aberta)
/* ------------------------------------------------------------------ */
/* Anexar ficheiros do Hermes ao Gmail ou ao WhatsApp dentro do Zeus    */
/* Larga os ficheiros na página como se fossem arrastados do Finder     */
/* (Input.dispatchDragEvent do Chromium: ficheiros verdadeiros).        */
/* ------------------------------------------------------------------ */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cdp(wc, fn) {
  const d = wc.debugger; let mine = false;
  if (!d.isAttached()) { d.attach('1.3'); mine = true; }
  try { return await fn((m, p) => d.sendCommand(m, p || {})); } finally { if (mine) { try { d.detach(); } catch (e) { /* ok */ } } }
}
async function dropFilesAt(wc, files, x, y) {
  const data = { items: [], files, dragOperationsMask: 1 };
  await cdp(wc, async send => {
    await send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await sleep(120);
    await send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
    await sleep(250);
    await send('Input.dispatchDragEvent', { type: 'dragOver', x: x + 1, y: y + 1, data });
    await sleep(250);
    await send('Input.dispatchDragEvent', { type: 'drop', x: x + 1, y: y + 1, data });
  });
}
// espera que a página tenha o elemento (devolve o centro dele)
async function waitRect(wc, js, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (wc.isDestroyed()) return null;
    if (!wc.isLoading()) { const r = await wc.executeJavaScript(js, true).catch(() => null); if (r) return r; }
    await sleep(400);
  }
  return null;
}
const appWC = id => { const v = appViews.get(id); return v && !v.webContents.isDestroyed() ? v.webContents : null; };
const nameList = files => files.length === 1 ? path.basename(files[0]) : `${files.length} ficheiros`;

// Gmail: abre uma mensagem nova e anexa
async function attachToGmail(files) {
  showApp('mail');
  let wc = appWC('mail'); for (let i = 0; i < 20 && !wc; i++) { await sleep(300); wc = appWC('mail'); }
  if (!wc) return false;
  const u = wc.getURL();
  const GM = process.env.ZEUS_TEST_GMAIL || 'https://mail.google.com/mail/u/0/#inbox?compose=new';
  if (/mail\.google\.com/.test(u) || (process.env.ZEUS_TEST_GMAIL && u.startsWith(GM.split('#')[0]))) await wc.executeJavaScript("location.hash = (location.hash.split('?')[0] || '#inbox') + '?compose=new'").catch(() => {});
  else await wc.loadURL(GM).catch(() => {});
  // o corpo da mensagem nova (a última janela de escrita aberta)
  const r = await waitRect(wc, `(() => {
    const els = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div.Am.editable')].filter(e => e.offsetParent);
    const el = els[els.length - 1]; if (!el) return null;
    const b = (el.closest('[role="dialog"]') || el).getBoundingClientRect();
    if (b.width < 50) return null;
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  })()`, 25000);
  if (!r) return false;
  await sleep(600);
  await dropFilesAt(wc, files, r.x, r.y);
  return true;
}

// WhatsApp: a pessoa escolhe a conversa; um botão na própria página confirma para quem vai
const waPending = { files: null, timer: null };
// conversas do WhatsApp (as que estão na lista da esquerda, ou as que a pesquisa do WhatsApp encontra)
const WA_LIST_JS = q => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const q = ${JSON.stringify(q || '')};
  const box = document.querySelector('#side div[contenteditable="true"], #side input[type="text"], div[contenteditable="true"][data-tab="3"]');
  if (box) {
    const cur = (box.value != null ? box.value : box.textContent) || '';
    if (cur !== q) {
      box.focus();
      if (box.tagName === 'INPUT') { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(box, q); box.dispatchEvent(new Event('input', { bubbles: true })); }
      else { document.execCommand('selectAll', false); if (q) document.execCommand('insertText', false, q); else document.execCommand('delete', false); }
      await sleep(q ? 900 : 500);
    }
  }
  const pane = document.querySelector('#pane-side'); if (!pane) return { error: document.querySelector('canvas, [data-ref]') ? 'login' : 'loading' };
  const rows = [...pane.querySelectorAll('[role="listitem"], [role="row"]')];
  const seen = new Set(), out = [];
  for (const r of rows) {
    const t = [...r.querySelectorAll('span[title]')];
    const name = t[0] && t[0].getAttribute('title'); if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, last: (t[1] && t[1].getAttribute('title')) || '', group: !!r.querySelector('[data-icon*="group"], [data-icon="default-group"]') });
    if (out.length >= 40) break;
  }
  return { chats: out };
})()`;
async function waChats(q) {
  const a = appById('wa'); if (!a) return { error: 'noapp' };
  const view = ensureAppView(a); if (!view) return { error: 'noapp' };
  const wc = view.webContents;
  for (let i = 0; i < 40 && wc.isLoading(); i++) await sleep(250);
  const r = await wc.executeJavaScript(WA_LIST_JS(String(q || '').slice(0, 80)), true).catch(() => null);
  return r || { error: 'loading' };
}
// abre a conversa escolhida (clica nela na lista do WhatsApp) e confirma pelo cabeçalho
async function waOpenChat(wc, name) {
  const js = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const name = ${JSON.stringify(name)};
    const pane = document.querySelector('#pane-side'); if (!pane) return false;
    const hit = [...pane.querySelectorAll('span[title]')].find(s => s.getAttribute('title') === name);
    if (!hit) return false;
    const row = hit.closest('[role="listitem"], [role="row"]') || hit;
    const tgt = row.querySelector('[role="gridcell"], div[tabindex]') || row;
    for (const type of ['mousedown', 'mouseup', 'click']) tgt.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const h = document.querySelector('#main header');
      if (h && [...h.querySelectorAll('span')].some(s => (s.getAttribute('title') || s.textContent || '').trim() === name)) {
        window.__zeusPicked = true;
        const m = document.querySelector('#main').getBoundingClientRect();
        return { x: Math.round(m.left + m.width / 2), y: Math.round(m.top + m.height / 2) };
      }
    }
    return false;
  })()`;
  return wc.executeJavaScript(js, true).catch(() => false);
}
async function attachToWhatsApp(files, chat) {
  showApp('wa');
  if (chat) {
    let wc = appWC('wa'); for (let i = 0; i < 20 && !wc; i++) { await sleep(300); wc = appWC('wa'); }
    if (wc) {
      for (let i = 0; i < 40 && wc.isLoading(); i++) await sleep(250);
      await sleep(400);
      let r = await waOpenChat(wc, chat);
      if (!r) { await wc.executeJavaScript(WA_LIST_JS(chat), true).catch(() => null); r = await waOpenChat(wc, chat); }
      if (r) { await sleep(500); await dropFilesAt(wc, files, r.x, r.y); return true; }
    }
    // não deu para abrir sozinho: a barra pede para escolher a conversa
  }
  let wc = appWC('wa'); for (let i = 0; i < 20 && !wc; i++) { await sleep(300); wc = appWC('wa'); }
  if (!wc) return false;
  waPending.files = files;
  clearInterval(waPending.timer);
  const label = nameList(files);
  const bar = `(() => {
    const L = ${JSON.stringify(label)};
    let b = document.getElementById('zeus-anexar');
    if (!b) {
      b = document.createElement('div'); b.id = 'zeus-anexar';
      Object.assign(b.style, { position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)', zIndex: 2147483647, display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px 10px 16px', borderRadius: '14px', background: '#111b21', color: '#fff', font: '500 14px -apple-system, system-ui, sans-serif', boxShadow: '0 10px 30px rgba(0,0,0,.35)' });
      const t = document.createElement('span'); t.id = 'zeus-anexar-t'; b.appendChild(t);
      const go = document.createElement('button'); go.id = 'zeus-anexar-go';
      Object.assign(go.style, { border: '0', borderRadius: '10px', padding: '8px 14px', background: '#25d366', color: '#0b141a', font: '600 14px -apple-system, system-ui, sans-serif', cursor: 'pointer' });
      go.onclick = () => { window.__zeusAnexar = 'go'; };
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Cancelar';
      Object.assign(x.style, { border: '0', background: 'transparent', color: '#aebac1', font: '16px system-ui', cursor: 'pointer', padding: '4px 6px' });
      x.onclick = () => { window.__zeusAnexar = 'cancel'; };
      b.append(go, x); document.body.appendChild(b);
    }
    // só conta a conversa que a pessoa escolher agora (não a que já estava aberta)
    if (!window.__zeusPickWired) { window.__zeusPickWired = true; window.__zeusPicked = false; document.addEventListener('mousedown', ev => { if (ev.target.closest && ev.target.closest('#pane-side, [role="listitem"], [role="row"]')) window.__zeusPicked = true; }, true); }
    const head = window.__zeusPicked ? document.querySelector('#main header') : null;
    const who = head && (head.querySelector('span[title]') || head.querySelector('span[dir="auto"]'));
    const name = who ? (who.getAttribute('title') || who.textContent || '').trim() : '';
    document.getElementById('zeus-anexar-t').textContent = name ? 'Enviar ' + L + ' para' : 'Abre a conversa para onde queres enviar ' + L;
    const go = document.getElementById('zeus-anexar-go');
    go.textContent = name ? name.slice(0, 40) + ' →' : 'Escolhe a conversa';
    go.disabled = !name; go.style.opacity = name ? '1' : '.45'; go.style.cursor = name ? 'pointer' : 'default';
    const s = window.__zeusAnexar || ''; window.__zeusAnexar = '';
    if (s === 'go' && name) { const m = document.querySelector('#main').getBoundingClientRect(); return { go: true, x: Math.round(m.left + m.width / 2), y: Math.round(m.top + m.height / 2) }; }
    return { cancel: s === 'cancel' };
  })()`;
  const remove = () => { clearInterval(waPending.timer); waPending.timer = null; waPending.files = null; if (!wc.isDestroyed()) wc.executeJavaScript("(() => { const b = document.getElementById('zeus-anexar'); if (b) b.remove(); })()").catch(() => {}); };
  let busy = false; const started = Date.now();
  waPending.timer = setInterval(async () => {
    if (busy) return;
    if (wc.isDestroyed() || Date.now() - started > 10 * 60000) return remove();
    if (wc.isLoading()) return;
    busy = true;
    try {
      const r = await wc.executeJavaScript(bar, true).catch(() => null);
      if (r && r.cancel) remove();
      else if (r && r.go && waPending.files) {
        const f = waPending.files; remove();
        await dropFilesAt(wc, f, r.x, r.y);
      }
    } finally { busy = false; }
  }, 500);
  return true;
}
async function attachFilesToApp(how, files, opts) {
  try {
    const ok = how === 'wa' ? await attachToWhatsApp(files, opts && opts.chat) : await attachToGmail(files);
    if (ok) return true;
  } catch (e) { console.error('anexar', e.message); }
  return false;
}

function showApp(id) { if (fullApp === id || openPanel === id) { const v = appViews.get(id); if (v) v.webContents.focus(); return; } openApp(id); }
/* Ficheiros de áudio e vídeo abertos no Finder ("Abrir com › Zeus") ou arrastados para o ícone: vão para o Orfeu */
const pendingMedia = [];
async function orfeuOpenPaths(paths) {
  if (!orfeuApp) { pendingMedia.push(...paths); return; }
  const ids = await orfeuApp.addPaths(paths, { touch: true });
  if (!ids.length) return;
  showApp('orfeu');
  const go = () => { if (orfeuWC && !orfeuWC.isDestroyed()) orfeuWC.send('orfeu:play', ids); };
  if (orfeuWC && !orfeuWC.isLoading()) go(); else if (orfeuWC) orfeuWC.once('did-finish-load', () => setTimeout(go, 300));
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
const ICONS = ['', 'mail', 'pmail', 'wa', 'cal', 'notion', 'pluto', 'apolo', 'work', 'globe', 'star', 'mic', 'play', 'music'];
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
/* ------------------------------------------------------------------ */
/* Transferências: vão sempre para a pasta Transferências do Mac, com histórico */
/* ------------------------------------------------------------------ */
const DL_MAX = 300;
// ficheiros sem extensão (ex.: blobs do WhatsApp) ganham-na pelo tipo
const EXT_BY_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'application/zip': 'zip', 'text/plain': 'txt', 'text/csv': 'csv', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx' };
const dlItems = new Map();      // id -> DownloadItem (só as que estão a decorrer)
let dlSeq = 0, dlPushT = null;
const wiredDL = new WeakSet();
function uniquePath(dir, name) {
  name = (name || 'transferencia').replace(/[\/\\:]/g, '-').replace(/^\.+/, '') || 'transferencia';
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name), n = 1;
  const taken = new Set(S.downloads.filter(d => d.state === 'progressing').map(d => d.path));
  while (fs.existsSync(p) || taken.has(p)) p = path.join(dir, `${base} (${n++})${ext}`);
  return p;
}
function wireDownloads(ses) {
  if (wiredDL.has(ses)) return; wiredDL.add(ses);
  ses.on('will-download', (e, item, wc) => {
    const id = Date.now().toString(36) + '-' + (++dlSeq);
    let fname = item.getFilename() || 'transferencia';
    if (!path.extname(fname)) { const ext = EXT_BY_MIME[(item.getMimeType() || '').split(';')[0].trim().toLowerCase()]; if (ext) fname += '.' + ext; }
    const save = uniquePath(app.getPath('downloads'), fname);
    item.setSavePath(save);
    let page = '';
    try { page = wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch (x) { /* ok */ }
    const d = { id, url: item.getURL(), page, name: path.basename(save), path: save, mime: item.getMimeType(), total: item.getTotalBytes(), received: 0, state: 'progressing', paused: false, startedAt: Date.now(), endedAt: 0 };
    S.downloads.unshift(d);
    if (S.downloads.length > DL_MAX) S.downloads.length = DL_MAX;
    dlItems.set(id, item);
    ui && ui.send('downloads', { list: dlList(), started: d.name });
    item.on('updated', (ev, state) => {
      d.received = item.getReceivedBytes(); d.total = item.getTotalBytes(); d.paused = item.isPaused();
      d.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      dlPush();
    });
    item.once('done', (ev, state) => {
      dlItems.delete(id);
      d.received = item.getReceivedBytes(); d.total = item.getTotalBytes() || d.received;
      d.state = state; d.paused = false; d.endedAt = Date.now();
      if (state === 'completed' && isMac) { try { app.dock.downloadFinished(save); } catch (x) { /* ok */ } }
      saveState(); dlPush(true);
      if (state === 'completed') ui && ui.send('downloads', { list: dlList(), done: d.name });
    });
    saveState();
  });
}
function dlList() {
  return S.downloads.map(d => ({ ...d, missing: d.state === 'completed' && !fs.existsSync(d.path) }));
}
function dlPush(now) {
  // barra de progresso no ícone da Dock (todas as transferências em curso)
  const act = S.downloads.filter(d => d.state === 'progressing');
  const tot = act.reduce((a, d) => a + (d.total || 0), 0), rec = act.reduce((a, d) => a + d.received, 0);
  try { if (win && !win.isDestroyed()) win.setProgressBar(act.length ? (tot ? Math.min(1, rec / tot) : 2) : -1); } catch (x) { /* ok */ }
  if (now) { clearTimeout(dlPushT); dlPushT = null; ui && ui.send('downloads', { list: dlList() }); return; }
  if (dlPushT) return;
  dlPushT = setTimeout(() => { dlPushT = null; ui && !ui.isDestroyed() && ui.send('downloads', { list: dlList() }); }, 300);
}
// miniatura do ficheiro (no Mac vem do Quick Look: PDF, imagens, vídeo, Word, Excel…); guardada em memória
const dlThumbs = new Map();   // caminho|data de modificação -> dataURL ou ''
const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|tiff?)$/i;
async function dlThumb(id) {
  const d = S.downloads.find(x => x.id === id);
  if (!d || d.state !== 'completed') return null;
  let st; try { st = fs.statSync(d.path); } catch (e) { return null; }
  const key = d.path + '|' + st.mtimeMs;
  if (dlThumbs.has(key)) return dlThumbs.get(key) || null;
  let url = '';
  try {
    let img = null;
    // fotos: a própria imagem (mantém a proporção exata); o resto: miniatura do Quick Look
    if (IMG_EXT.test(d.path) && st.size < 40e6) img = nativeImage.createFromPath(d.path);
    if ((!img || img.isEmpty()) && (isMac || process.platform === 'win32')) img = await nativeImage.createThumbnailFromPath(d.path, { width: 320, height: 320 });
    if (img && !img.isEmpty()) {
      const sz = img.getSize();
      if (sz.width > 320 || sz.height > 320) img = img.resize(sz.width >= sz.height ? { width: 320 } : { height: 320 });
      url = img.toDataURL();
    }
  } catch (e) { url = ''; }
  if (dlThumbs.size > 400) dlThumbs.clear();
  dlThumbs.set(key, url);
  return url || null;
}

function dlAction(act, id) {
  const d = S.downloads.find(x => x.id === id);
  const item = dlItems.get(id);
  if (act === 'folder') { shell.openPath(app.getPath('downloads')); return true; }
  if (act === 'clear') { S.downloads = S.downloads.filter(x => x.state === 'progressing'); saveState(); dlPush(true); return true; }
  if (!d) return false;
  if (act === 'show') { if (fs.existsSync(d.path)) { shell.showItemInFolder(d.path); return true; } return 'missing'; }
  if (act === 'open') { if (fs.existsSync(d.path)) { shell.openPath(d.path); return true; } return 'missing'; }
  // pré-visualização rápida (a mesma do Finder com a barra de espaços)
  if (act === 'preview') {
    if (!fs.existsSync(d.path)) return 'missing';
    if (isMac && win) { win.previewFile(d.path, d.name); return true; }
    shell.openPath(d.path); return true;
  }
  if (d.video && videoDL) {
    if (act === 'cancel') return videoDL.cancel(id);
    if (act === 'pause') return false;
    if (act === 'retry') { videoDL.retry(id, d); return true; }
    if (act === 'remove') { videoDL.cancel(id); S.downloads = S.downloads.filter(x => x !== d); saveState(); dlPush(true); return true; }
  }
  if (act === 'cancel' && item) { item.cancel(); return true; }
  if (act === 'pause' && item) { item.isPaused() ? item.resume() : item.pause(); setTimeout(() => dlPush(true), 50); return true; }
  if (act === 'retry') { if (item && item.canResume()) item.resume(); else { S.downloads = S.downloads.filter(x => x !== d); zeusSession.downloadURL(d.url); } dlPush(true); return true; }
  if (act === 'remove') { if (item) item.cancel(); S.downloads = S.downloads.filter(x => x !== d); saveState(); dlPush(true); return true; }
  if (act === 'copy') { clipboard.writeText(d.url); return true; }
  return false;
}

/* Extensões com "activeTab" (ex.: Raindrop): no Chrome, carregar no ícone da extensão dá-lhe acesso à página aberta
   (para ler o título, a descrição e a imagem do artigo). O Electron não tem essa autorização temporária, por isso a
   extensão ficava sem conseguir ler a página. Às extensões que já pedem esse acesso como opcional (o Chrome
   perguntaria), o Zeus concede-o ao carregá-las: acrescenta o acesso aos sites ao manifest e recarrega-as uma vez. */
const ALL_HOSTS = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'];
function wantsActiveHost(m) {
  if (!m || m.manifest_version !== 3) return false;
  const perms = m.permissions || [], opt = [...(m.optional_host_permissions || []), ...(m.optional_permissions || [])];
  return perms.includes('activeTab') && opt.some(x => ALL_HOSTS.includes(x)) && !(m.host_permissions || []).some(x => ALL_HOSTS.includes(x));
}
const wiredExt = new WeakSet();
function wireExtensionAccess(ses) {
  if (wiredExt.has(ses)) return; wiredExt.add(ses);
  // `browser` = `chrome` do Zeus nas páginas e service workers das extensões (ver preload-ext.js)
  for (const type of ['frame', 'service-worker']) {
    try { ses.registerPreloadScript({ type, id: 'zeus-ext-' + type, filePath: path.join(__dirname, 'preload-ext.js') }); }
    catch (e) { console.error('preload das extensões', type, e.message); }
  }
  const api = ses.extensions && typeof ses.extensions.on === 'function' ? ses.extensions : ses;
  api.on('extension-loaded', async (e, ext) => {
    try {
      if (!ext || !wantsActiveHost(ext.manifest)) return;
      const file = path.join(ext.path, 'manifest.json');
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!wantsActiveHost(m)) return;
      m.host_permissions = [...(m.host_permissions || []), '*://*/*'];
      m.zeus_granted_hosts = true;   // marca: acesso concedido pelo Zeus (o Chrome perguntaria)
      fs.writeFileSync(file, JSON.stringify(m, null, 2));
      const x = ses.extensions || ses;
      setTimeout(async () => {
        try { x.removeExtension(ext.id); await x.loadExtension(ext.path, { allowFileAccess: true }); }
        catch (err) { console.error('Não consegui recarregar a extensão', ext.name, err.message); }
      }, 300);
    } catch (err) { console.error('Acesso da extensão', err.message); }
  });
}

function setupPermissions(ses) {
  wireDownloads(ses);
  wireExtensionAccess(ses);
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
  handle('auth:reply', (id, user, pass) => authReply(id, user, pass));
  handle('home:today', force => homeToday(!!force));
  handle('home:taskDone', (feed, list, task) => homeTaskDone(feed, list, task));
  handle('home:setupOpen', (appId, n) => homeSetupOpen(appId, n));
  handle('home:accounts', appId => homeAccounts(appId));
  handle('home:feedAdd', d => homeFeedAdd(d || {}));
  handle('home:feedRemove', id => homeFeedRemove(id));
  handle('home:code', () => { clipboard.writeText(homeScriptCode()); return true; });
  handle('history:browsers', () => otherBrowsers());
  handle('history:import', id => importHistory(id));
  handle('history:count', () => S.history.length);
  handle('share:info', () => shareInfo());
  handle('share:do', (id, pos) => shareDo(id, pos));
  handle('pip:toggle', () => pipToggle());
  handle('pip:sound', () => pipSound());
  // clicar no título de um espaço (barra da direita): abre logo a página principal nesse espaço
  handle('space:home', id => { if (!S.spaces.some(x => x.id === id)) return; pickSpace = id; goHome(); });
  handle('space:pick', id => { pickSpace = pickSpace === id || !S.spaces.some(x => x.id === id) ? null : id; pushState(true); return pickSpace; });
  radarIPC();
  zoomIPC();
  notasApp = setupNotas({
    app, ipcMain, dialog, shell, Menu, BrowserWindow, net, safeStorage, Notification, systemPreferences,
    getWC: () => notasWC, getUi: () => ui, getWin: () => win, getView: () => appViews.get('notas'),
    getZoom: () => zoom, isDark, openTab: url => newTab({ url, space: spaceForOpener() })
  });
  orfeuApp = setupOrfeu({
    app, ipcMain, dialog, shell,
    getWC: () => orfeuWC, getUi: () => ui, getWin: () => win, getNotas: () => notasApp,
    editInEco: p => { if (ecoApp) ecoApp.openFiles([p]); },
    openNotes: id => { showApp('notas'); const send = () => { if (notasWC && !notasWC.isDestroyed()) notasWC.send('notas:cmd', { cmd: 'open', id }); }; if (notasWC && !notasWC.isLoading()) setTimeout(send, 150); else setTimeout(send, 1500); }
  });
  setupHermes({
    app, ipcMain, dialog, shell, Menu, BrowserWindow, nativeImage, clipboard, ShareMenu: isMac ? ShareMenu : null,
    hasApp: id => appById(id),
    // abre o WhatsApp, ou uma mensagem nova no Gmail, dentro do Zeus
    // anexa os ficheiros no Gmail (mensagem nova) ou no WhatsApp (depois de escolher a conversa), dentro do Zeus
    attachFiles: (how, files, opts) => attachFilesToApp(how === 'wa' ? 'wa' : 'mail', files, opts),
    waChats: q => waChats(q),
    getWC: () => hermesWC, getUi: () => ui, getWin: () => win, getView: () => appViews.get('hermes'),
    openInOrfeu: paths => orfeuOpenPaths(paths),
    openInEditor: p => { if (ecoApp) ecoApp.openFiles([p]); },
    openInNotas: async p => {
      const N = notasApp && notasApp.notas;
      if (N) { await N.scan(); const n = [...N.index.values()].find(i => i.path === p); if (n) { showApp('notas'); const go = () => { if (notasWC && !notasWC.isDestroyed()) notasWC.send('notas:cmd', { cmd: 'open', id: n.id }); }; setTimeout(go, notasWC && !notasWC.isLoading() ? 150 : 1500); return; } }
      shell.openPath(p);
    }
  });
  ipcMain.handle('hermes:theme', e => (hermesWC && e.sender === hermesWC ? (isDark() ? 'dark' : 'light') : null));
  ecoApp = setupEco({
    app, ipcMain, dialog, shell, isDark,
    getWC: () => ecoWC, getUi: () => ui, getWin: () => win,
    show: () => { if (appById('eco')) showApp('eco'); },
    openInOrfeu: paths => orfeuOpenPaths(paths)
  });
  ipcMain.handle('orfeu:theme', e => (orfeuWC && e.sender === orfeuWC ? (isDark() ? 'dark' : 'light') : null));
  videoDL = setupVideoDL({
    app, getSession: () => zeusSession, toast: m => ui && !ui.isDestroyed() && ui.send('toast', m),
    ffBin: () => process.env.ZEUS_FFMPEG || (app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg') : path.join(__dirname, '..', 'vendor', `ffmpeg-${process.platform}-${process.arch}`, 'ffmpeg', 'ffmpeg')),
    downloadsDir: () => app.getPath('downloads'),
    downloads: {
      get: id => S.downloads.find(x => x.id === id),
      add: d => {
        S.downloads = S.downloads.filter(x => x.id !== d.id);
        Object.assign(d, { state: 'progressing', paused: false, startedAt: Date.now(), endedAt: 0 });
        S.downloads.unshift(d); if (S.downloads.length > DL_MAX) S.downloads.length = DL_MAX;
        saveState(); ui && ui.send('downloads', { list: dlList(), started: d.name });
        return d;
      },
      update: () => dlPush(),
      done: (d, state) => {
        d.state = state; d.paused = false; d.endedAt = Date.now();
        if (state === 'completed' && isMac) { try { app.dock.downloadFinished(d.path); } catch (x) { /* ok */ } }
        saveState(); dlPush(true);
        if (state === 'completed') ui && ui.send('downloads', { list: dlList(), done: d.name });
      }
    }
  });
  // botão de vídeo na barra: ver o vídeo da página (pergunta sempre a qualidade) e descarregar
  handle('video:probe', async () => {
    const wc = pageWC(); const url = wc && wc.getURL();
    if (!url || !/^https?:/.test(url)) return { error: 'Esta página não tem vídeos.' };
    try { return Object.assign(await videoDL.probe(url), { url }); } catch (e) { return { error: e.message, url }; }
  });
  handle('video:download', (url, choice) => {
    url = String(url || ''); if (!/^https?:/.test(url)) return { error: 'Endereço inválido.' };
    const c = choice || {};
    return videoDL.download(url, { kind: ['mp4', 'mp3', 'm4a'].includes(c.kind) ? c.kind : 'mp4', height: Math.floor(+c.height) || 0, subs: !!c.subs, title: String(c.title || '').slice(0, 160) });
  });
  handle('downloads:list', () => dlList());
  handle('downloads:do', (act, id) => dlAction(String(act), String(id || '')));
  handle('downloads:thumb', id => dlThumb(String(id || '')));
  handle('scores:get', () => scoreList);
  handle('scores:search', q => scores ? scores.search(q) : []);
  handle('scores:teams', list => {
    const clean = (Array.isArray(list) ? list : []).slice(0, 30)
      .map(t => ({ id: Math.floor(+t.id), name: String(t.name || '').slice(0, 80), country: String(t.country || '').slice(0, 60) }))
      .filter(t => t.id > 0 && t.name);
    S.settings.teams = clean; saveState(); pushState(true);
    if (scores) scores.setTeams(clean);
    return clean;
  });
  handle('scores:details', () => scores ? scores.details() : []);
  // a página Futebol (página própria do Zeus, como o Radar) só pode ler os jogos, abrir um jogo e saber o tema
  const fromFut = e => futebolWC && !futebolWC.isDestroyed() && e.sender === futebolWC;
  ipcMain.handle('futebol:details', e => fromFut(e) && scores ? scores.details() : []);
  ipcMain.handle('futebol:open', (e, id) => { if (!fromFut(e)) return; const u = scores && scores.url(id); if (u) newTab({ url: u, space: spaceForOpener() }); });
  ipcMain.handle('futebol:theme', e => fromFut(e) ? (isDark() ? 'dark' : 'light') : null);
  ipcMain.handle('futebol:close', e => { if (fromFut(e) && fullApp === 'futebol') openApp('futebol'); });
  handle('scores:status', () => scores ? scores.status() : null);
  handle('scores:refresh', () => scores ? scores.refreshNow() : null);
  handle('scores:open', id => { const u = scores && scores.url(id); if (u) newTab({ url: u, space: spaceForOpener() }); });
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
    const ALLOWED = Object.keys(DEFAULT_SETTINGS).filter(k => k !== 'homeFeeds' && k !== 'teams');
    const clean = {};
    for (const k of Object.keys(patch)) if (ALLOWED.includes(k)) clean[k] = patch[k];
    if ('barColor' in clean && !['neutro', 'cinza', 'ardosia', 'salva', 'areia', 'noite', 'vinho', 'custom'].includes(clean.barColor)) delete clean.barColor;
    if ('barCustom' in clean) {
      const bc = clean.barCustom || {}, hex = v => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : undefined);
      clean.barCustom = { light: hex(bc.light) || (S.settings.barCustom || {}).light, dark: hex(bc.dark) || (S.settings.barCustom || {}).dark };
    }
    ['panelWidth', 'claudeWidth'].forEach(k => { if (k in clean) clean[k] = Math.max(280, Math.min(1400, Math.round(+clean[k] || 420))); });
    if ('updateRepo' in clean) clean.updateRepo = String(clean.updateRepo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    S.settings = Object.assign({}, S.settings, clean);
    if ('tabMode' in clean || 'rightWide' in clean || 'rightZoom' in clean) setTimeout(applyLayout, 50);
    if (clean.theme) nativeTheme.themeSource = clean.theme === 'system' ? 'system' : clean.theme;
    if (clean.theme && radarWC && !radarWC.isDestroyed()) radarWC.send('radar:theme', isDark() ? 'dark' : 'light');
    if (clean.theme && futebolWC && !futebolWC.isDestroyed()) futebolWC.send('futebol:theme', isDark() ? 'dark' : 'light');
    if (clean.theme && zoomWC && !zoomWC.isDestroyed()) zoomWC.send('zoomapp:theme', isDark() ? 'dark' : 'light');
    if (clean.theme && notasWC && !notasWC.isDestroyed()) notasWC.send('notas:theme', isDark() ? 'dark' : 'light');
    if (clean.theme && orfeuWC && !orfeuWC.isDestroyed()) orfeuWC.send('orfeu:theme', isDark() ? 'dark' : 'light');
    if (clean.theme && hermesWC && !hermesWC.isDestroyed()) hermesWC.send('hermes:theme', isDark() ? 'dark' : 'light');
    if (clean.theme && ecoWC && !ecoWC.isDestroyed()) ecoWC.send('eco:theme', isDark() ? 'dark' : 'light');
    if (!isMac && clean.theme) updateOverlayColors();
    if ('updateRepo' in clean && updater) updater.check(true);
    if ('bigGames' in clean && scores) scores.setBig(clean.bigGames !== false);
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

/* Futebol em direto (ver scores.js): a barra de resultados em baixo e o aviso de golo */
let scores = null, scoreList = [];
function setupScores() {
  scores = new Scores({
    session: zeusSession, BrowserWindow,
    base: !app.isPackaged && process.env.ZEUS_TEST_SCORES ? process.env.ZEUS_TEST_SCORES : undefined,
    log: m => console.log(m),
    onChange: list => { scoreList = list; if (ui && !ui.isDestroyed()) ui.send('scores', list); if (futebolWC && !futebolWC.isDestroyed()) futebolWC.send('futebol:changed'); },
    onGoal: m => {
      if (S.settings.goalAlerts === false || !Notification.isSupported() || m.big) return;   // só avisa nos jogos das equipas seguidas
      const who = m.goalSide === 'home' ? m.home : m.away;
      const n = new Notification({ title: `⚽ Golo ${who.mine ? 'do ' : ''}${who.full}!`, body: `${m.home.full} ${m.home.score}–${m.away.score} ${m.away.full}${m.label ? ' · ' + m.label : ''}`, silent: false });
      n.on('click', () => { if (win) { win.show(); win.focus(); } newTab({ url: m.url, space: spaceForOpener() }); });
      n.show();
    }
  });
  scores.start(S.settings.teams || [], S.settings.bigGames !== false);
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
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => { const w = curWC(); if (w && w === radarWC) w.send('radar:refresh'); else if (w) w.reload(); } },
        { label: 'Recarregar sem cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => { const w = curWC(); if (w) w.reloadIgnoringCache(); } },
        { type: 'separator' },
        { label: 'Tamanho real', accelerator: 'CmdOrCtrl+0', click: () => zoomStep(0) },
        { label: 'Aumentar', accelerator: 'CmdOrCtrl+Plus', click: () => zoomStep(1) },
        { label: 'Aumentar ', accelerator: 'CmdOrCtrl+=', visible: false, acceleratorWorksWhenHidden: true, click: () => zoomStep(1) },
        { label: 'Reduzir', accelerator: 'CmdOrCtrl+-', click: () => zoomStep(-1) },
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
        { label: 'Guardar no Zoom', accelerator: 'CmdOrCtrl+D', click: () => ui && ui.send('ui-command', { cmd: 'zoom-save' }) },
        { label: 'Transferências', accelerator: 'CmdOrCtrl+Alt+L', click: () => ui && ui.send('ui-command', { cmd: 'downloads' }) },
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

/*
 * Sites com nome de utilizador e palavra-passe do próprio browser (autenticação HTTP, comum em
 * ferramentas alojadas no Render, Netlify, etc.): o Electron não mostra a janela sozinho — sem isto,
 * a página fica em branco. Pergunta-se na interface; fica lembrado só enquanto o Zeus estiver aberto.
 */
const authPending = new Map();   // id -> callback
const authMemory = new Map();    // "host|realm" -> {user, pass}
let authSeq = 0;
app.on('login', (event, wc, details, authInfo, callback) => {
  event.preventDefault();
  const key = authInfo.host + '|' + (authInfo.realm || '');
  const mem = authMemory.get(key);
  // se a palavra-passe lembrada falhou (o site voltou a pedir), pergunta outra vez
  if (mem && !mem.used) { mem.used = true; setTimeout(() => { mem.used = false; }, 4000); callback(mem.user, mem.pass); return; }
  if (!ui || ui.isDestroyed()) { callback(); return; }
  const id = ++authSeq;
  authPending.set(id, { callback, key });
  ui.send('ui-command', { cmd: 'auth', id, host: authInfo.host, realm: authInfo.realm || '', proxy: !!authInfo.isProxy, retry: !!mem });
});
function authReply(id, user, pass) {
  const p = authPending.get(id); if (!p) return;
  authPending.delete(id);
  if (user == null) { p.callback(); return; }
  authMemory.set(p.key, { user: String(user), pass: String(pass || ''), used: true });
  setTimeout(() => { const m = authMemory.get(p.key); if (m) m.used = false; }, 4000);
  p.callback(String(user), String(pass || ''));
}

app.on('open-file', (e, p) => {
  if (!isOrfeuMedia(p)) return;
  e.preventDefault();
  if (!app.isReady() || !win) pendingMedia.push(p); else orfeuOpenPaths([p]);
});
app.whenReady().then(async () => {
  loadState();
  zoom = new Zoom(app.getPath('userData'), zoomChanged);
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
  setupScores();
  // abre o separador atual e carrega em segundo plano as apps com notificações
  // o Zeus abre sempre na página principal (hora, meteorologia, agenda e tarefas)
  goHome();
  setTimeout(() => { S.apps.filter(a => a.preload && a.url).forEach(a => ensureAppView(a)); applyLayout(); pushState(); }, 2500);
  if (S.claudeOpen) ensureClaudeView();
  // ficheiros abertos no Finder antes de o Zeus estar pronto
  if (pendingMedia.length) setTimeout(() => { const q = pendingMedia.splice(0); if (q.length) orfeuOpenPaths(q); }, 1200);
  applyLayout();
  pushState(true);
  if (Notification.isSupported()) { /* notificações nativas das páginas ficam ativas */ }
});

app.on('window-all-closed', () => { saveNow(); app.quit(); });
let quitOk = false;
app.on('before-quit', e => {
  if (!quitOk && notasApp && notasApp.isRecording()) {
    e.preventDefault();
    notasApp.quitCheck().then(go => { if (go) { quitOk = true; app.quit(); } });
    return;
  }
  saveNow(); if (zoom) zoom.flush();
});

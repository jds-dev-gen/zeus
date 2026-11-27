'use strict';
/*
 * Olimpo — processo principal.
 *
 * Uma janela sem moldura ocupa o ecrã inteiro e passa a ser o sítio onde tudo acontece:
 * ecrã principal, barra do Claude, Zeus e Apolo (vistas Chromium dentro da janela) e Ficheiros.
 * Uma segunda janela, pequena e transparente, é a barra flutuante que substitui a Dock:
 * aparece quando há uma app aberta (dentro do Olimpo ou do Mac).
 *
 * As páginas web correm em sandbox, sem acesso ao Node. A interface só fala com este processo
 * pela ponte em src/preload/ui.js.
 */
const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell, nativeImage, dialog, net, powerMonitor, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const P = require('./platform');
const { Store } = require('./store');
const apps = require('./apps');
const files = require('./files');
const search = require('./search');
const activity = require('./activity');
const { Space } = require('./space');
const { Claude } = require('./claude');
const { Web } = require('./web');

app.setName('Olimpo');
if (!app.requestSingleInstanceLock()) { app.quit(); }

const DEV = !app.isPackaged;
const TEST = process.env.OLIMPO_TEST === '1';
let store, space, claude, web;
let win = null, dock = null;
let ui = null;
const panel = { aberto: null, split: false };   // o que a interface tem aberto (para a barra flutuante)
let mainFocused = false;
let stopWatch = null;
let summonedByShortcut = false;

/* ------------------------------------------------------------------ */
/* Janelas                                                             */
/* ------------------------------------------------------------------ */
function displayRect() {
  const d = screen.getPrimaryDisplay();
  return d.workArea;
}

function createWindow() {
  const r = displayRect();
  win = new BrowserWindow({
    x: r.x, y: r.y, width: r.width, height: r.height,
    frame: false,
    show: false,
    backgroundColor: '#04060a',
    title: 'Olimpo',
    resizable: TEST,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    roundedCorners: false,
    acceptFirstMouse: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'ui.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  ui = win.webContents;
  ui.on('will-navigate', e => e.preventDefault());
  ui.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) { web.newTab({ url }); send('cmd', { abrir: 'zeus' }); } return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('focus', () => { mainFocused = true; updateDock(); });
  win.on('blur', () => { mainFocused = false; summonedByShortcut = false; updateDock(); });
  win.on('closed', () => { win = null; ui = null; });
  // o Olimpo não se fecha com ⌘W: esconde-se (volta com ⌥ Espaço ou pela barra)
  win.on('close', e => { if (!app.__quitting) { e.preventDefault(); if (P.isMac) app.hide(); else win.hide(); } });
  screen.on('display-metrics-changed', () => { if (win) win.setBounds(displayRect()); placeDock(); });
}

function createDock() {
  dock = new BrowserWindow({
    width: 640, height: 92,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    acceptFirstMouse: true,
    ...(P.isMac ? { vibrancy: 'hud', visualEffectState: 'active', roundedCorners: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'ui.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false
    }
  });
  dock.setAlwaysOnTop(true, 'floating');
  try { dock.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) { /* ok */ }
  dock.webContents.on('will-navigate', e => e.preventDefault());
  dock.loadFile(path.join(__dirname, '..', 'dock', 'index.html'));
  dock.on('closed', () => { dock = null; });
  placeDock();
}

let dockSize = { width: 640, height: 92 };
function placeDock() {
  if (!dock) return;
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  const w = Math.min(dockSize.width, b.width - 40), h = dockSize.height;
  dock.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: Math.round(b.y + b.height - h - 14), width: w, height: h });
}

/* A barra aparece quando há uma app aberta: um painel dentro do Olimpo, ou outra app à frente. */
let dockTimer = null;
function updateDock() {
  clearTimeout(dockTimer);
  dockTimer = setTimeout(() => {
    if (!dock || TEST) return;
    const dockFocused = dock.isFocused();
    // escondida só quando o ecrã principal do Olimpo está à frente
    const visible = !!panel.aberto || !mainFocused;
    if (visible && !dock.isVisible()) { placeDock(); dock.showInactive(); refreshRunning(); }
    else if (!visible && dock.isVisible() && !dockFocused) dock.hide();
    sendDock('dock', dockState());
  }, 120);
}

function send(ch, data) { if (ui && !ui.isDestroyed()) ui.send(ch, data); }
function sendDock(ch, data) { if (dock && !dock.isDestroyed()) dock.webContents.send(ch, data); }
function sendAll(ch, data) { send(ch, data); sendDock(ch, data); }

function showMain(cmd) {
  if (!win) return;
  if (P.isMac) app.focus({ steal: true });
  win.show(); win.focus();
  if (cmd) send('cmd', cmd);
}

/* ------------------------------------------------------------------ */
/* Apps a correr (Mac) e estado da barra                               */
/* ------------------------------------------------------------------ */
let running = { names: [], front: '', ok: false };
let runningTimer = null;
async function refreshRunning() {
  if (!P.isMac) return;
  running = await apps.running();
  sendDock('dock', dockState());
  clearTimeout(runningTimer);
  if (dock && dock.isVisible()) runningTimer = setTimeout(refreshRunning, 4000);
}
function dockState() {
  const S = store.get();
  const e = store.espaco();
  const list = [];
  const push = (id, a) => {
    const installed = a.tipo === 'mac' ? apps.installed().find(x => x.id === id) : null;
    const aberta = a.tipo === 'painel' || a.tipo === 'web' ? (panel.aberto === id || (panel.split && id === 'apolo') || webOpen(id)) : !!(installed && running.names.includes(installed.nome));
    const frente = a.tipo === 'mac' ? (!mainFocused && installed && running.front === installed.nome) : (panel.aberto === id && (mainFocused || dock && dock.isFocused()));
    list.push({ id, nome: a.nome, tipo: a.tipo, mark: (a.nome || '?')[0].toUpperCase(), aberta, frente: !!frente, caminho: installed ? installed.caminho : null });
  };
  push('zeus', S.apps.zeus);
  push('apolo', S.apps.apolo);
  for (const id of e.apps) if (S.apps[id] && id !== 'zeus' && id !== 'apolo') push(id, S.apps[id]);
  return { espaco: e.nome, espacoId: e.id, espacos: S.espacos.map(x => ({ id: x.id, nome: x.nome })), apps: list, painel: panel, olimpoFrente: mainFocused && !panel.aberto, autorizacao: P.isMac && !running.ok && running.error ? 'System Events' : null };
}
const webOpen = id => !!(web && web.views.has('app:' + id));

/* ------------------------------------------------------------------ */
/* Abrir coisas                                                        */
/* ------------------------------------------------------------------ */
async function openTarget(t) {
  const S = store.get();
  if (!t) return;
  if (t.espaco) { setEspaco(t.espaco); showMain({ casa: true }); return 'Espaço mudado.'; }
  if (t.acao) { showMain({ acao: t.acao }); return 'Feito.'; }
  if (t.url) { web.newTab({ url: t.url }); showMain({ abrir: 'zeus' }); return 'Aberto no Zeus.'; }
  if (t.projeto) {
    const p = S.projetos.find(x => x.id === t.projeto || x.nome.toLowerCase() === String(t.projeto).toLowerCase());
    if (!p) return 'Não encontrei esse projeto.';
    activity.add(store, { tipo: 'projeto', id: 'projeto:' + p.id, titulo: p.nome, alvo: { projeto: p.id }, espaco: p.espaco });
    showMain({ projeto: p.id });
    return 'Projeto aberto.';
  }
  if (t.ficheiro || t.caminho) {
    const p = P.expand(t.ficheiro || t.caminho);
    let st = null;
    try { st = fs.statSync(p); } catch (e) { return 'Esse ficheiro já não existe.'; }
    if (st.isDirectory()) { showMain({ pasta: p }); return 'Pasta aberta nos Ficheiros.'; }
    const err = await shell.openPath(p);
    if (err) return 'Não consegui abrir: ' + err;
    activity.add(store, { tipo: 'ficheiro', id: 'ficheiro:' + p, titulo: path.basename(p), sub: P.tilde(path.dirname(p)), alvo: { ficheiro: p } });
    return 'Aberto.';
  }
  let id = t.app || t.mac;
  if (id && !S.apps[id] && !t.mac) {
    // pelo nome (ex.: o Claude diz "DaVinci Resolve")
    const n = String(id).toLowerCase();
    const k = Object.keys(S.apps).find(k => S.apps[k].nome.toLowerCase() === n);
    if (k) id = k;
    else { const m = apps.installed().find(a => a.nome.toLowerCase() === n || a.id === id); if (m) { t = { mac: m.id }; id = m.id; } }
  }
  const a = S.apps[id];
  if (a && (a.tipo === 'painel' || a.tipo === 'web')) {
    if (a.tipo === 'web') activity.add(store, { tipo: 'web', id: 'app:' + id, titulo: a.nome, app: a.nome, sub: 'App web', alvo: { app: id } });
    showMain({ abrir: id });
    return 'Aberto.';
  }
  const inst = apps.installed().find(x => x.id === id) || (a && a.caminho ? { id, nome: a.nome, caminho: a.caminho } : null);
  if (inst) {
    await apps.open(inst, shell);
    activity.add(store, { tipo: 'mac', id: 'mac:' + inst.id, titulo: inst.nome, app: inst.nome, sub: 'App do Mac', alvo: { mac: inst.id } });
    setTimeout(refreshRunning, 800);
    return 'Aberto.';
  }
  return 'Não encontrei essa app.';
}

function setEspaco(id) {
  if (!store.get().espacos.some(e => e.id === id)) return;
  store.change(s => { s.espacoAtual = id; });
  web.push();
  sendDock('dock', dockState());
}

/* ------------------------------------------------------------------ */
/* Arranque com o computador e limpeza da secretária                   */
/* ------------------------------------------------------------------ */
function setLoginItem(on) {
  if (DEV || TEST) return;
  if (P.isMac) { app.setLoginItemSettings({ openAtLogin: !!on }); return; }
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(P.HOME, '.config'), 'autostart');
  const f = path.join(dir, 'olimpo.desktop');
  if (on) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=Olimpo\nExec="${process.execPath}"\nX-GNOME-Autostart-enabled=true\n`); }
  else { try { fs.unlinkSync(f); } catch (e) { /* não havia */ } }
}

async function limparSecretaria(desfazer) {
  if (!P.isMac) return { ok: false, error: 'Só no Mac.' };
  try {
    await P.run('/usr/bin/defaults', ['write', 'com.apple.dock', 'autohide', '-bool', desfazer ? 'false' : 'true']);
    await P.run('/usr/bin/killall', ['Dock']).catch(() => {});
    await P.run('/usr/bin/defaults', ['write', 'com.apple.finder', 'CreateDesktop', desfazer ? 'true' : 'false']);
    await P.run('/usr/bin/killall', ['Finder']).catch(() => {});
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/* ------------------------------------------------------------------ */
/* Atalho global (barra do Claude)                                     */
/* ------------------------------------------------------------------ */
function registerShortcut() {
  globalShortcut.unregisterAll();
  const acc = store.get().definicoes.atalho || 'Alt+Space';
  try {
    const ok = globalShortcut.register(acc, () => {
      if (win && win.isFocused() && !panel.aberto) { send('cmd', { atalho: true }); return; }
      summonedByShortcut = true;
      showMain({ barra: true });
    });
    if (!ok) console.warn('Atalho ocupado:', acc);
    return ok;
  } catch (e) { console.warn('Atalho inválido:', acc); return false; }
}

/* ------------------------------------------------------------------ */
/* Meteorologia (módulo opcional; Open-Meteo, sem chave)               */
/* ------------------------------------------------------------------ */
let meteoCache = null;
async function meteo() {
  const c = store.get().definicoes.cidade || {};
  if (meteoCache && Date.now() - meteoCache.at < 30 * 60 * 1000 && meteoCache.cidade === c.nome) return meteoCache.data;
  try {
    const r = await net.fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`);
    const j = await r.json();
    const data = { cidade: c.nome, temp: Math.round(j.current.temperature_2m), codigo: j.current.weather_code, max: Math.round(j.daily.temperature_2m_max[0]), min: Math.round(j.daily.temperature_2m_min[0]) };
    meteoCache = { at: Date.now(), cidade: c.nome, data };
    return data;
  } catch (e) { return null; }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */
function fromUs(e) {
  const u = e.senderFrame && e.senderFrame.url || '';
  return u.startsWith('file://') && (u.includes('/src/ui/') || u.includes('/src/dock/'));
}
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    if (!fromUs(e)) throw new Error('origem não autorizada');
    return fn(...args, e);
  });
}

function uiState() {
  const S = store.get();
  return {
    S,
    home: P.HOME,
    plataforma: process.platform,
    versao: app.getVersion(),
    painel: panel,
    claude: claude.status()
  };
}

/* Mandar para o Lixo e confirmar que saiu mesmo (em alguns sistemas o pedido "corre bem" sem fazer nada). */
async function paraLixo(p) {
  await shell.trashItem(p);
  if (fs.existsSync(p)) throw new Error('o sistema não o mandou para o Lixo');
}

function projectFolder(nome) {
  const base = P.expand(store.get().ficheiros.pastaProjetos || '~/Projetos');
  return path.join(base, nome.replace(/[/\\:]/g, '-').trim());
}

function setupIPC() {
  handle('state:get', () => uiState());
  handle('espaco:set', id => setEspaco(id));
  handle('search:local', q => search.local(q, store.get()));
  handle('open', t => openTarget(t));
  handle('continuar', async () => {
    let recent = [];
    try { recent = await files.recent({ limit: 10 }); } catch (e) { /* sem Spotlight */ }
    return activity.continuar(store.get(), recent);
  });

  /* ---------- Claude ---------- */
  handle('claude:ask', async (runId, prompt, opts = {}) => {
    let contexto = '';
    if (opts.pagina) {
      const pg = await web.pageText(opts.pagina);
      if (pg) contexto = `Página aberta no Zeus: ${pg.titulo}\n${pg.url}\n\n<pagina>\n${pg.texto}\n</pagina>`;
    }
    claude.ask(runId, prompt, { continuar: !!opts.continuar, contexto });
    return true;
  });
  handle('claude:stop', runId => claude.stop(runId));
  handle('claude:status', () => claude.status());
  handle('proposta:confirmar', async id => {
    const p = claude.takeProposal(id);
    if (!p) return { ok: false, error: 'Esta proposta já não está disponível.' };
    const feitos = [], erros = [];
    for (const it of p.itens) {
      try {
        if (p.tipo === 'mover') { await files.moveTo(it.path, it.destino); feitos.push(it.path); }
        else { await paraLixo(it.path); feitos.push(it.path); }
      } catch (e) { erros.push(path.basename(it.path) + ': ' + e.message); }
    }
    if (p.tipo === 'lixo') space.forget(p.itens.filter(i => feitos.includes(i.path)));
    send('entrada', null);
    return { ok: !erros.length, feitos: feitos.length, erros, nota: p.tipo === 'lixo' ? await space.trashNote() : '' };
  });
  handle('proposta:cancelar', id => { claude.takeProposal(id); return true; });

  /* ---------- apps ---------- */
  handle('apps:installed', () => apps.installed().map(a => ({ id: a.id, nome: a.nome, caminho: a.caminho })));
  handle('apps:icon', p => apps.icon(app, p));
  handle('apps:add', ({ mac = [], webApps = [], espaco }) => {
    store.change(s => {
      const e = s.espacos.find(x => x.id === espaco) || s.espacos[0];
      for (const id of mac) {
        const a = apps.installed().find(x => x.id === id); if (!a) continue;
        s.apps[id] = { nome: a.nome, tipo: 'mac', caminho: a.caminho };
        if (!e.apps.includes(id)) e.apps.push(id);
      }
      for (const w of webApps) {
        const id = w.id || 'web-' + apps.slug(w.nome);
        s.apps[id] = { nome: w.nome, tipo: 'web', url: w.url };
        if (!e.apps.includes(id)) e.apps.push(id);
      }
    });
    sendDock('dock', dockState());
    return true;
  });
  handle('apps:remove', (id, espaco) => {
    store.change(s => { const e = s.espacos.find(x => x.id === espaco); if (e) e.apps = e.apps.filter(x => x !== id); });
    sendDock('dock', dockState());
  });

  /* ---------- ficheiros ---------- */
  handle('files:search', opts => files.search(opts));
  handle('files:recent', opts => files.recent(opts));
  handle('files:entrada', () => files.entrada(store.get().ficheiros));
  handle('files:list', dir => files.listDir(dir));
  handle('files:open', p => openTarget({ ficheiro: p }));
  handle('files:reveal', p => shell.showItemInFolder(P.expand(p)));
  handle('files:arrumar', async (p, projetoId) => {
    const pr = store.get().projetos.find(x => x.id === projetoId);
    if (!pr) throw new Error('Projeto inexistente');
    const dest = await files.moveTo(p, pr.pasta);
    send('entrada', null);
    return dest;
  });
  handle('files:dispensar', p => { store.change(s => { s.ficheiros.dispensados = [p, ...(s.ficheiros.dispensados || [])].slice(0, 2000); }); send('entrada', null); });
  // Lixo: a interface já mostrou o que vai sair e pediu confirmação
  handle('files:trash', async items => {
    const feitos = [], erros = [];
    for (const it of items) {
      const p = P.expand(it.path);
      try {
        if (it.conteudo) {
          // limpar o conteúdo de uma pasta de cache (a pasta fica)
          for (const n of fs.readdirSync(p)) await paraLixo(path.join(p, n));
        } else await paraLixo(p);
        feitos.push(it);
      } catch (e) { erros.push(path.basename(p) + ': ' + e.message); }
    }
    space.forget(feitos);
    send('entrada', null);
    return { feitos: feitos.length, bytes: feitos.reduce((t, i) => t + (i.size || 0), 0), erros, nota: await space.trashNote() };
  });
  handle('files:thumb', async (p, size = 240) => {
    try {
      if (P.isMac || process.platform === 'win32') { const img = await nativeImage.createThumbnailFromPath(P.expand(p), { width: size, height: size }); return img.isEmpty() ? '' : img.toDataURL(); }
      const img = nativeImage.createFromPath(P.expand(p));
      return img.isEmpty() ? '' : img.resize({ width: size }).toDataURL();
    } catch (e) { return ''; }
  });
  ipcMain.on('files:drag', (e, p) => {
    if (!fromUs(e)) return;
    let icon;
    try { icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'drag.png')); } catch (x) { icon = nativeImage.createEmpty(); }
    e.sender.startDrag({ file: P.expand(p), icon: icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR42mN8+v9/PQMRgHFUw6iGUQ0ARqcb4QOQ8lMAAAAASUVORK5CYII=') : icon });
  });

  /* ---------- espaço em disco ---------- */
  handle('space:state', () => space.state());
  handle('space:scan', () => { space.scan(); return true; });
  handle('space:node', p => space.node(p));
  handle('space:biggest', p => space.biggestIn(p));

  /* ---------- projetos ---------- */
  handle('projetos:criar', async ({ nome, espaco, pasta, quadroApolo }) => {
    nome = String(nome || '').trim();
    if (!nome) throw new Error('Falta o nome');
    const dir = pasta ? P.expand(pasta) : projectFolder(nome);
    fs.mkdirSync(dir, { recursive: true });
    const id = apps.slug(nome) + '-' + Date.now().toString(36).slice(-4);
    store.change(s => { s.projetos.push({ id, nome, espaco: espaco || s.espacoAtual, pasta: P.tilde(dir), quadroApolo: quadroApolo || '' }); });
    return id;
  });
  handle('projetos:editar', (id, patch) => store.change(s => { const p = s.projetos.find(x => x.id === id); if (p) Object.assign(p, patch); }));
  // tirar do Olimpo não apaga a pasta
  handle('projetos:tirar', id => store.change(s => { s.projetos = s.projetos.filter(x => x.id !== id); }));
  handle('projetos:escolherPasta', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: P.expand(store.get().ficheiros.pastaProjetos) });
    return r.canceled ? null : P.tilde(r.filePaths[0]);
  });

  /* ---------- espaços e módulos ---------- */
  handle('espacos:guardar', (espacos) => {
    store.change(s => {
      const keep = new Map(s.espacos.map(e => [e.id, e]));
      s.espacos = espacos.map(e => Object.assign({ apps: [] }, keep.get(e.id) || {}, { id: e.id, nome: e.nome, modulos: e.modulos }));
      if (!s.espacos.some(e => e.id === s.espacoAtual)) s.espacoAtual = s.espacos[0].id;
    });
    sendDock('dock', dockState());
  });
  handle('atividade', it => activity.add(store, it));
  handle('copiar', t => clipboard.writeText(String(t || '')));
  handle('zeus:coluna', ({ nome, url }) => {
    nome = String(nome || '').trim(); if (!nome || !/^https?:\/\//.test(url || '')) return false;
    const id = 'web-' + apps.slug(nome);
    store.change(s => { s.apps[id] = { nome, tipo: 'web', url }; if (!s.zeus.coluna.includes(id)) s.zeus.coluna.push(id); });
    return id;
  });
  handle('nota:guardar', (espaco, texto) => store.change(s => { s.notas[espaco] = String(texto || '').slice(0, 20000); }));
  handle('meteo', () => meteo());

  /* ---------- definições ---------- */
  handle('definicoes:guardar', patch => {
    const before = store.get().definicoes;
    store.change(s => {
      if (patch.nome !== undefined) s.nome = String(patch.nome).trim() || s.nome;
      if (patch.definicoes) Object.assign(s.definicoes, patch.definicoes);
      if (patch.ficheiros) Object.assign(s.ficheiros, patch.ficheiros);
    });
    const d = store.get().definicoes;
    if (d.arranque !== before.arranque) setLoginItem(d.arranque);
    if (d.atalho !== before.atalho) registerShortcut();
    if (patch.ficheiros) { if (stopWatch) stopWatch(); stopWatch = files.watchEntrada(store.get().ficheiros, () => send('entrada', null)); }
    return true;
  });
  handle('mac:limparSecretaria', desfazer => limparSecretaria(desfazer));
  handle('app:esconder', () => { if (P.isMac) app.hide(); else if (win) win.minimize(); });
  handle('app:sair', () => { app.__quitting = true; app.quit(); });
  handle('app:atalhoUsado', () => { const v = summonedByShortcut; summonedByShortcut = false; return v; });

  /* ---------- painéis web ---------- */
  handle('web:state', () => web.state());
  handle('web:newTab', url => web.newTab({ url }).id);
  handle('web:select', id => web.selectTab(id));
  handle('web:close', id => web.closeTab(id));
  handle('web:navigate', (input, key) => web.navigate(input, key));
  handle('web:nav', (key, what) => web.nav(key, what));
  handle('web:app', (id, url) => web.app(id, url));
  handle('web:layout', list => web.layout(list));
  handle('web:externo', key => { const wc = web.wcFor(key); if (wc) shell.openExternal(wc.getURL()); });

  /* ---------- o que a interface tem aberto (para a barra) ---------- */
  handle('painel', p => { panel.aberto = p.aberto || null; panel.split = !!p.split; updateDock(); });
  handle('dock:size', s => { dockSize = { width: Math.ceil(s.width), height: Math.ceil(s.height) }; placeDock(); });
  handle('dock:abrir', async (id) => {
    const a = store.get().apps[id];
    if (!a) return;
    if (a.tipo === 'mac') return openTarget({ mac: id });
    showMain({ abrir: id });
  });
  handle('dock:state', () => dockState());
  handle('dock:casa', () => showMain({ casa: true }));
  handle('dock:barra', () => showMain({ barra: true }));
  handle('dock:espaco', id => { setEspaco(id); });
  handle('dock:disposicao', split => send('cmd', { disposicao: split ? 'split' : 'full' }));
  handle('dock:acrescentar', () => showMain({ acao: 'acrescentar-app' }));
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */
app.whenReady().then(() => {
  store = new Store(process.env.OLIMPO_DATA || undefined);
  space = new Space(store.dir, () => store.get().ficheiros);
  space.on(ev => sendAll('space', ev));
  claude = new Claude({ store, space, dataDir: store.dir, onEvent: (runId, ev) => send('claude', { runId, ev }), openTarget });
  createWindow();
  web = new Web({
    win, store,
    onState: ev => {
      if (ev.type === 'state') send('web', ev.state);
      else if (ev.type === 'open-zeus') send('cmd', { abrir: 'zeus' });
      else if (ev.type === 'focus-address') send('cmd', { endereco: true, novo: !!ev.newTab });
    },
    onActivity: it => activity.add(store, it)
  });
  setupIPC();
  store.onChange(() => send('state', uiState()));
  if (!TEST) createDock();
  registerShortcut();
  setLoginItem(store.get().definicoes.arranque);
  stopWatch = files.watchEntrada(store.get().ficheiros, () => send('entrada', null));
  // primeiro varrimento do disco pouco depois de abrir (e de novo uma vez por dia)
  const scanIfOld = () => { const at = space.result && space.result.at; if (!TEST && (!at || Date.now() - at > 24 * 3600 * 1000)) space.scan(); };
  setTimeout(scanIfOld, 60 * 1000);
  setInterval(scanIfOld, 3 * 3600 * 1000);
  // fora do Mac, o índice de ficheiros próprio começa já em segundo plano
  if (!P.isMac && !TEST) files.index.build().catch(() => {});
  app.on('browser-window-blur', () => setTimeout(updateDock, 50));
  app.on('browser-window-focus', () => setTimeout(updateDock, 50));
  app.on('did-become-active', () => updateDock());
  app.on('did-resign-active', () => { mainFocused = false; updateDock(); });
  powerMonitor.on('resume', () => { if (win) win.setBounds(displayRect()); });
  if (DEV && process.env.OLIMPO_SHOTS) require('./dev-shots')(() => win, process.env.OLIMPO_SHOTS);
});

app.on('second-instance', () => showMain({ casa: true }));
app.on('activate', () => showMain());
app.on('before-quit', () => { app.__quitting = true; try { store && store.saveNow(); } catch (e) { /* ok */ } });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!P.isMac) app.quit(); });

// o Olimpo também abre ficheiros arrastados para o ícone (Mac)
app.on('open-file', (e, p) => { e.preventDefault(); if (store) openTarget({ ficheiro: p }); });

if (DEV) process.on('unhandledRejection', e => console.error('unhandledRejection', e));
module.exports = { openTarget };

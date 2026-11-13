'use strict';
/*
 * Notas — a parte do processo principal: ficheiros, cópia em Word, exportar, gravar reuniões,
 * transcrever no próprio Mac (whisper.cpp) e resumir com o Claude (API da Anthropic, chave guardada no Porta-chaves).
 * Só a página interna das Notas pode chamar estas funções.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { Notas, fileBase, toText } = require('./notas');
const { buildDocx } = require('./notas-docx');

const MODEL = { file: 'ggml-large-v3-turbo.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin', sha1: '4af2b29d7ec73d781377bfd1758ca957a807e941', size: 1624555275 };
const VAD = { file: 'ggml-silero-v6.2.0.bin', url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin' };
const CLAUDE_MODEL = 'claude-sonnet-5-5';

function setupNotas(x) {
  const { app, ipcMain, dialog, shell, Menu, BrowserWindow, net, safeStorage, Notification, systemPreferences } = x;
  const UD = app.getPath('userData');
  const wc = () => { const w = x.getWC(); return w && !w.isDestroyed() ? w : null; };
  const send = (ch, ...a) => { const w = wc(); if (w) w.send('notas:' + ch, ...a); };
  const toast = msg => { const u = x.getUi(); if (u && !u.isDestroyed()) u.send('toast', msg); };
  const notas = new Notas(UD, () => send('changed'));
  const from = e => { const w = wc(); return !!w && e.sender === w && e.senderFrame === w.mainFrame; };
  const h = (name, fn) => ipcMain.handle('notas:' + name, async (e, ...a) => (from(e) ? fn(...a) : null));
  const trash = p => shell.trashItem(p);
  // operações em ficheiros uma de cada vez (gravar, mudar o nome, apagar), para não se atropelarem
  let chain = Promise.resolve();
  const serial = fn => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  const str = (v, n = 200) => String(v == null ? '' : v).slice(0, n);

  /* ---------- notas e pastas ---------- */
  h('theme', () => (x.isDark() ? 'dark' : 'light'));
  h('list', () => serial(() => notas.scan()));
  h('search', q => notas.search(str(q, 200)));
  h('read', async id => { const n = await notas.read(str(id, 40)); if (n && n.audio) n.audioUrl = fs.existsSync(n.audio) ? pathToFileURL(n.audio).href : ''; return n; });
  h('create', (folder, title, html) => serial(() => notas.create(str(folder, 100), str(title, 200), str(html, 5e6))));
  const wordT = new Map();
  h('save', (id, patch, blocks) => serial(async () => {
    id = str(id, 40);
    const p = {};
    if (patch && 'title' in patch) p.title = str(patch.title, 200);
    if (patch && 'html' in patch) p.html = str(patch.html, 5e6);
    if (patch && 'fav' in patch) p.fav = !!patch.fav;
    if (patch && 'folder' in patch) p.folder = str(patch.folder, 100);
    const r = await notas.save(id, p);
    if (r && Array.isArray(blocks) && notas.where().wordCopy) {
      // cópia em Word ao lado da nota, uns segundos depois da última alteração
      clearTimeout(wordT.get(id));
      wordT.set(id, setTimeout(() => serial(() => writeWord(id, blocks)).catch(() => {}), 2500));
    }
    return r;
  }));
  async function writeWord(id, blocks) {
    const n = notas.info(id); if (!n) return;
    const buf = await buildDocx(n.title, blocks);
    const p = n.path.replace(/\.html?$/i, '.docx');
    const tmp = path.join(path.dirname(p), '.' + path.basename(p) + '.tmp');
    await fsp.writeFile(tmp, buf); await fsp.rename(tmp, p);
  }
  h('remove', id => serial(() => notas.remove(str(id, 40), trash)));
  h('trashList', () => serial(() => notas.trashList(trash)));
  h('trashRead', key => notas.trashRead(str(key, 80)));
  h('restore', key => serial(() => notas.restore(str(key, 80))));
  h('purge', key => serial(() => notas.purge(str(key, 80), trash)));
  h('addFolder', name => serial(() => notas.addFolder(str(name, 100))));
  h('renameFolder', (a, b) => serial(() => notas.renameFolder(str(a, 100), str(b, 100))));
  h('removeFolder', name => serial(() => notas.removeFolder(str(name, 100), trash)));
  h('where', () => notas.where());
  h('chooseRoot', async () => {
    const r = await dialog.showOpenDialog(x.getWin(), { title: 'Pasta das notas', buttonLabel: 'Usar esta pasta', defaultPath: notas.root(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    notas.setRoot(r.filePaths[0]); await serial(() => notas.scan()); send('changed'); return notas.where();
  });
  h('resetRoot', async () => { notas.setRoot(''); await serial(() => notas.scan()); send('changed'); return notas.where(); });
  h('setWordCopy', on => { notas.setWordCopy(on); return notas.where(); });
  h('reveal', id => { const n = notas.info(str(id, 40)); if (n) shell.showItemInFolder(n.path); else { notas.ensureRoot(); shell.openPath(notas.root()); } });
  h('openLink', url => { if (/^https?:\/\//i.test(String(url || ''))) x.openTab(String(url)); });

  /* ---------- exportar ---------- */
  const downloads = name => path.join(app.getPath('downloads'), name);
  h('exportWord', async (id, blocks) => {
    const n = notas.info(str(id, 40)); if (!n) return false;
    const r = await dialog.showSaveDialog(x.getWin(), { title: 'Exportar para Word', defaultPath: downloads(fileBase(n.title) + '.docx'), filters: [{ name: 'Word', extensions: ['docx'] }] });
    if (r.canceled || !r.filePath) return false;
    await fsp.writeFile(r.filePath, await buildDocx(n.title, Array.isArray(blocks) ? blocks : []));
    toast('Nota exportada para Word.'); shell.showItemInFolder(r.filePath); return true;
  });
  h('exportPdf', async id => {
    const n = notas.info(str(id, 40)); if (!n) return false;
    const r = await dialog.showSaveDialog(x.getWin(), { title: 'Exportar para PDF', defaultPath: downloads(fileBase(n.title) + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return false;
    const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
    try {
      w.webContents.on('will-navigate', e => e.preventDefault());
      await w.loadFile(n.path);
      const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
      await fsp.writeFile(r.filePath, pdf);
    } finally { w.destroy(); }
    toast('Nota exportada para PDF.'); shell.showItemInFolder(r.filePath); return true;
  });

  /* ---------- menu de uma nota (menu do sistema) ---------- */
  h('noteMenu', (id, at) => {
    const n = notas.info(str(id, 40)); if (!n) return;
    const cmd = (c, arg) => () => send('cmd', { cmd: c, id: n.id, arg });
    const folders = notas.list().folders.map(f => f.name);
    const menu = Menu.buildFromTemplate([
      { label: 'Favorita', type: 'checkbox', checked: !!n.fav, click: cmd('fav', !n.fav) },
      { label: 'Mover para', submenu: [{ label: 'Sem pasta', type: 'radio', checked: !n.folder, click: cmd('move', '') }, ...(folders.length ? [{ type: 'separator' }] : []), ...folders.map(f => ({ label: f, type: 'radio', checked: n.folder === f, click: cmd('move', f) }))] },
      { type: 'separator' },
      { label: 'Exportar para Word…', click: cmd('exportWord') },
      { label: 'Exportar para PDF…', click: cmd('exportPdf') },
      { label: 'Mostrar no Finder', click: () => shell.showItemInFolder(n.path) },
      { type: 'separator' },
      { label: 'Resumir com o Claude', click: cmd('summarize') },
      { type: 'separator' },
      { label: 'Apagar nota…', click: async () => {
        const r = await dialog.showMessageBox(x.getWin(), { type: 'warning', buttons: ['Apagar', 'Cancelar'], defaultId: 1, cancelId: 1, message: `Apagar "${n.title}"?`, detail: 'Vai para o Lixo das Notas (com a cópia em Word e a gravação, se houver), onde fica 30 dias e pode ser recuperada.' });
        if (r.response === 0) { await serial(() => notas.remove(n.id, trash)); send('cmd', { cmd: 'removed', id: n.id }); }
      } }
    ]);
    const w = x.getWin(), v = x.getView();
    const b = v ? v.getBounds() : { x: 0, y: 0 };
    menu.popup({ window: w, x: Math.round(b.x + (+at.x || 0)), y: Math.round(b.y + (+at.y || 0)) });
  });

  /* ---------- destaques do Zoom ---------- */
  h('zoomHighlights', () => {
    const z = x.getZoom(); if (!z) return [];
    const out = [];
    for (const it of z.data().items) for (const hl of it.highlights || []) out.push({ text: hl.text, comment: hl.comment || '', color: hl.color, title: it.title, url: it.url, site: it.site, at: hl.createdAt || it.updatedAt || 0 });
    return out.sort((a, b) => b.at - a.at).slice(0, 400);
  });

  /* ---------- gravar reuniões ---------- */
  const REC = path.join(UD, 'gravacoes');
  let rec = null;   // { id, pcm, aud, ext, started }
  // estado para a barra das apps: a gravar (vermelho) ou a transcrever/resumir (amarelo)
  let lastStatus = '';
  function status() { if (rec) return 'rec'; return (typeof jobs !== 'undefined' && jobs.some(j => /^(transcrever|resumir|espera-modelo|preparar)$/.test(j.stage))) ? 'busy' : ''; }
  function pushStatus() { const st = status(); if (st !== lastStatus) { lastStatus = st; if (x.onStatus) x.onStatus(st); } }
  h('micAccess', async () => {
    if (process.platform !== 'darwin') return 'granted';
    let st = systemPreferences.getMediaAccessStatus('microphone');
    if (st === 'not-determined') st = (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied';
    return st;
  });
  h('recStart', async (id, mime) => {
    id = str(id, 40);
    if (rec) return { ok: false, error: 'Já está a decorrer outra gravação.' };
    if (!notas.info(id)) return { ok: false, error: 'Nota não encontrada.' };
    await fsp.mkdir(REC, { recursive: true });
    const ext = /mp4/.test(String(mime)) ? 'm4a' : /ogg/.test(String(mime)) ? 'ogg' : 'webm';
    const stamp = Date.now();
    rec = { id, ext, started: stamp, pcmPath: path.join(REC, `${id}-${stamp}.pcm`), audPath: path.join(REC, `${id}-${stamp}.${ext}`) };
    rec.pcm = fs.createWriteStream(rec.pcmPath); rec.aud = fs.createWriteStream(rec.audPath);
    pushStatus();
    return { ok: true };
  });
  ipcMain.on('notas:recPcm', (e, buf) => { if (from(e) && rec && buf && buf.byteLength) rec.pcm.write(Buffer.from(buf)); });
  ipcMain.on('notas:recAud', (e, buf) => { if (from(e) && rec && buf && buf.byteLength) rec.aud.write(Buffer.from(buf)); });
  const closeStream = s => new Promise(r => s.end(r));
  h('recCancel', async () => {
    if (!rec) return true;
    const r = rec; rec = null; pushStatus();
    await closeStream(r.pcm); await closeStream(r.aud);
    for (const f of [r.pcmPath, r.audPath]) fsp.unlink(f).catch(() => {});
    return true;
  });
  h('recStop', () => stopRecording());
  async function stopRecording() {
    if (!rec) return null;
    const r = rec; rec = null; pushStatus();
    await closeStream(r.pcm); await closeStream(r.aud);
    // áudio comprimido vai para a pasta da nota (fica no Drive); o WAV é só para o Whisper e apaga-se no fim
    const wav = r.pcmPath.replace(/\.pcm$/, '.wav');
    await pcmToWav(r.pcmPath, wav);
    fsp.unlink(r.pcmPath).catch(() => {});
    const n = notas.info(r.id);
    let audioName = '';
    if (n) {
      const dir = path.dirname(n.path), base = path.basename(n.path).replace(/\.html?$/i, '');
      const dst = notas.freeName(dir, `${base} — áudio`, '.' + r.ext);
      try { await fsp.copyFile(r.audPath, dst); await fsp.unlink(r.audPath); audioName = path.basename(dst); } catch (e) { /* o áudio fica na pasta das gravações */ }
      if (audioName) await serial(() => notas.save(r.id, { audio: audioName }));
    }
    const secs = Math.round(Math.max(0, fs.statSync(wav).size - 44) / 32000);
    addJob({ id: r.id, wav, secs, stage: 'transcrever', pct: 0, at: Date.now() });
    return { ok: true, secs, audioUrl: audioName && n ? pathToFileURL(path.join(path.dirname(notas.info(r.id).path), audioName)).href : '' };
  }
  async function pcmToWav(src, dst) {
    const size = fs.existsSync(src) ? fs.statSync(src).size : 0;
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + size, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(16000, 24);
    hdr.writeUInt32LE(32000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(size, 40);
    await fsp.writeFile(dst, hdr);
    if (size) await new Promise((res, rej) => fs.createReadStream(src).pipe(fs.createWriteStream(dst, { flags: 'a' })).on('finish', res).on('error', rej));
  }

  /* ---------- Whisper (no próprio Mac) ---------- */
  const WDIR = path.join(UD, 'whisper');
  const binPath = () => process.env.ZEUS_WHISPER || (app.isPackaged ? path.join(process.resourcesPath, 'whisper', 'whisper-cli') : path.join(__dirname, '..', 'vendor', `whisper-${process.platform}-${process.arch}`, 'whisper', 'whisper-cli'));
  const modelPath = () => process.env.ZEUS_WHISPER_MODEL || path.join(WDIR, MODEL.file);
  const vadPath = () => path.join(WDIR, VAD.file);
  let dl = null;   // { pct, got, total, abort }
  const modelState = () => ({
    state: dl ? 'downloading' : fs.existsSync(modelPath()) ? 'ready' : 'none',
    pct: dl ? dl.pct : 0, got: dl ? dl.got : 0, total: dl ? dl.total : MODEL.size,
    bin: fs.existsSync(binPath()), size: MODEL.size
  });
  h('modelState', () => modelState());
  h('modelDownload', () => { if (!dl && !fs.existsSync(modelPath())) downloadModel().catch(() => {}); return modelState(); });
  h('modelCancel', () => { if (dl) dl.abort(); return true; });
  h('modelRemove', async () => { if (dl) return false; await fsp.unlink(modelPath()).catch(() => {}); send('model', modelState()); return true; });
  async function fetchTo(url, dst, onProgress, signal, sha1) {
    const res = await net.fetch(url, { signal, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    const tmp = dst + '.part';
    const out = fs.createWriteStream(tmp);
    const hash = sha1 ? crypto.createHash('sha1') : null;
    let got = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const b = Buffer.from(value);
        got += b.length; if (hash) hash.update(b);
        if (!out.write(b)) await new Promise(r => out.once('drain', r));
        onProgress(got, total);
      }
    } finally { await new Promise(r => out.end(r)); }
    if (hash && hash.digest('hex') !== sha1) { await fsp.unlink(tmp).catch(() => {}); throw new Error('O ficheiro chegou estragado. Tenta outra vez.'); }
    await fsp.rename(tmp, dst);
  }
  async function downloadModel() {
    await fsp.mkdir(WDIR, { recursive: true });
    const ctl = new AbortController();
    dl = { pct: 0, got: 0, total: MODEL.size, abort: () => ctl.abort() };
    send('model', modelState());
    let last = 0;
    try {
      if (!fs.existsSync(vadPath())) await fetchTo(VAD.url, vadPath(), () => {}, ctl.signal).catch(() => {});   // detetor de voz (evita "texto inventado" nos silêncios); opcional
      await fetchTo(MODEL.url, modelPath(), (got, total) => {
        dl.got = got; dl.total = total || MODEL.size; dl.pct = Math.min(100, Math.floor(got / dl.total * 100));
        if (Date.now() - last > 400) { last = Date.now(); send('model', modelState()); }
      }, ctl.signal, MODEL.sha1);
      dl = null; send('model', modelState());
      toast('O modelo de transcrição está pronto.');
      runJobs();
    } catch (e) {
      const aborted = ctl.signal.aborted;
      dl = null; send('model', Object.assign(modelState(), { error: aborted ? '' : 'Não foi possível descarregar o modelo' + (/^net::|fetch failed/i.test(String(e.message || e)) ? ' (sem ligação ao servidor). Verifica a internet e tenta outra vez.' : ': ' + (e.message || e)) }));
    }
  }

  /* ---------- trabalhos: transcrever e resumir (um de cada vez, guardados em disco) ---------- */
  const JOBS = path.join(UD, 'notas-trabalhos.json');
  let jobs = []; try { jobs = JSON.parse(fs.readFileSync(JOBS, 'utf8')); } catch (e) { jobs = []; }
  jobs.forEach(j => { if (j.stage === 'transcrever' || j.stage === 'resumir') j.pct = 0; });
  const saveJobs = () => { try { fs.writeFileSync(JOBS, JSON.stringify(jobs)); } catch (e) { /* ok */ } };
  const pub = () => jobs.map(j => ({ id: j.id, stage: j.stage, pct: j.pct || 0, error: j.error || '', secs: j.secs || 0 }));
  const emit = () => { saveJobs(); send('jobs', pub()); pushStatus(); };
  function addJob(j) { jobs.push(j); emit(); runJobs(); }
  h('jobs', () => pub());
  // a página vai buscar os resultados prontos e põe-nos na nota (é ela que tem a nota aberta)
  h('takeResults', () => { const done = jobs.filter(j => j.stage === 'pronto'); jobs = jobs.filter(j => j.stage !== 'pronto'); saveJobs(); send('jobs', pub()); return done.map(j => ({ id: j.id, html: j.html, title: j.title || '' })); });
  h('retryJob', id => { jobs.filter(j => j.id === str(id, 40) && j.stage === 'erro').forEach(j => { j.stage = j.html ? 'resumir' : 'transcrever'; j.error = ''; }); emit(); runJobs(); return true; });
  h('dismissJob', id => { jobs = jobs.filter(j => !(j.id === str(id, 40) && j.stage === 'erro')); emit(); return true; });
  let running = false;
  async function runJobs() {
    wake();
    if (running) return;
    running = true;
    try {
      for (;;) {
        const j = jobs.find(k => k.stage === 'transcrever' || k.stage === 'resumir');
        if (!j) break;
        if (j.stage === 'transcrever') {
          if (!fs.existsSync(binPath())) { j.stage = 'erro'; j.error = 'O programa de transcrição não está incluído nesta versão do Zeus.'; emit(); continue; }
          if (!fs.existsSync(modelPath())) { j.stage = 'espera-modelo'; emit(); continue; }
          try {
            const segs = await transcribe(j);
            j.transcript = segs; j.stage = 'resumir'; j.pct = 0; emit();
          } catch (e) { j.stage = 'erro'; j.error = 'A transcrição falhou: ' + (e.message || e); emit(); continue; }
        }
        if (j.stage === 'resumir') {
          let sum = null, err = '';
          if (getKey() && (j.transcript || []).length) {
            try { sum = await claudeSummary(segsToText(j.transcript)); } catch (e) { err = netErr(e); }
          }
          j.html = (sum ? summaryHtml(sum) : '') + transcriptHtml(j.transcript || [], err);
          j.title = sum && sum.titulo ? sum.titulo : '';
          j.stage = 'pronto'; j.pct = 100;
          delete j.transcript;
          if (!process.env.ZEUS_KEEP_WAV) fsp.unlink(j.wav).catch(() => {});
          emit();
          send('results');
          const n = notas.info(j.id);
          toast(`Transcrição pronta${n ? ': ' + n.title : ''}.`);
          try { if (Notification.isSupported() && !x.getWin().isFocused()) new Notification({ title: 'Zeus — Notas', body: `A transcrição${n ? ' de "' + n.title + '"' : ''} está pronta.` }).show(); } catch (e) { /* ok */ }
        }
      }
    } finally { running = false; }
  }
  // quando o modelo fica pronto, os trabalhos à espera dele avançam
  function wake() { let any = false; jobs.forEach(j => { if (j.stage === 'espera-modelo' && fs.existsSync(modelPath())) { j.stage = 'transcrever'; any = true; } }); if (any) emit(); }
  setTimeout(() => runJobs(), 4000);

  function transcribe(j) {
    return new Promise((resolve, reject) => {
      const out = j.wav.replace(/\.wav$/, '');
      const threads = String(Math.max(2, Math.min(8, (os.cpus() || []).length >= 8 ? 4 : (os.cpus() || []).length - 1)));
      const args = ['-m', modelPath(), '-f', j.wav, '-l', 'pt', '-oj', '-of', out, '-pp', '-t', threads, '-mc', '64'];
      if (fs.existsSync(vadPath()) && !process.env.ZEUS_WHISPER_MODEL) args.push('--vad', '-vm', vadPath());
      const p = spawn(binPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let errTail = '';
      p.stderr.on('data', d => {
        const s = d.toString();
        errTail = (errTail + s).slice(-2000);
        const m = /progress =\s*(\d+)%/g; let k, last = null;
        while ((k = m.exec(s))) last = +k[1];
        if (last != null) { const pct = Math.min(99, last); if (pct !== j.pct) { j.pct = pct; send('jobs', pub()); } }
      });
      p.on('error', reject);
      p.on('close', async code => {
        if (code !== 0) return reject(new Error(code === null ? 'interrompida' : (errTail.split('\n').filter(Boolean).slice(-1)[0] || 'código ' + code)));
        try {
          const json = JSON.parse(await fsp.readFile(out + '.json', 'utf8'));
          fsp.unlink(out + '.json').catch(() => {});
          resolve((json.transcription || []).map(s => ({ t: Math.round(((s.offsets && s.offsets.from) || 0) / 1000), e: Math.round(((s.offsets && s.offsets.to) || 0) / 1000), x: String(s.text || '').trim() })).filter(s => s.x && !/^\[.*\]$/.test(s.x)));
        } catch (e) { reject(new Error('resultado ilegível')); }
      });
    });
  }
  const clock = t => { t = Math.max(0, t | 0); const hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm).padStart(2, '0')) + ':' + String(ss).padStart(2, '0'); };
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // junta os pedaços do Whisper em parágrafos (muda de parágrafo nas pausas ou quando fica comprido)
  function paragraphs(segs) {
    const out = []; let cur = null;
    for (const s of segs) {
      if (!cur || s.t - cur.end > 2 || cur.text.length > 450) { cur = { t: s.t, end: s.e, text: s.x }; out.push(cur); }
      else { cur.text += ' ' + s.x; cur.end = s.e; }
    }
    return out;
  }
  const segsToText = segs => paragraphs(segs).map(p => `[${clock(p.t)}] ${p.text}`).join('\n');
  function transcriptHtml(segs, err) {
    const ps = paragraphs(segs);
    return `<h2>Transcrição</h2>` + (err ? `<p><i>O resumo não foi feito: ${escH(err)}</i></p>` : '') +
      (ps.length ? ps.map(p => `<p><span class="ts" data-t="${p.t}">${clock(p.t)}</span> ${escH(p.text)}</p>`).join('') : '<p><i>Não se ouviu fala nesta gravação.</i></p>');
  }
  function summaryHtml(s) {
    const li = a => (a || []).filter(Boolean).map(v => `<li>${escH(v)}</li>`).join('');
    let h = `<h2>Resumo</h2>`;
    if (s.resumo) h += `<p>${escH(s.resumo)}</p>`;
    if ((s.pontos || []).length) h += `<h3>Pontos principais</h3><ul>${li(s.pontos)}</ul>`;
    if ((s.decisoes || []).length) h += `<h3>Decisões</h3><ul>${li(s.decisoes)}</ul>`;
    if ((s.tarefas || []).length) h += `<h3>Tarefas</h3><ul class="todo">${s.tarefas.map(t => `<li>${escH(t.tarefa || t)}${t.responsavel ? ` — <b>${escH(t.responsavel)}</b>` : ''}${t.prazo ? ` (${escH(t.prazo)})` : ''}</li>`).join('')}</ul>`;
    if ((s.proximos || []).length) h += `<h3>Próximos passos</h3><ul>${li(s.proximos)}</ul>`;
    return h;
  }

  /* ---------- Claude (resumos) ---------- */
  const KEYF = path.join(UD, 'anthropic-chave.bin');
  // a chave lida fica em memória: o Porta-chaves do Mac só é consultado uma vez por sessão
  // (depois de uma atualização o Mac pode voltar a perguntar; se a pessoa recusar, a leitura falha)
  let keyCache = '', keyErr = '';
  function getKey() {
    if (keyCache) return keyCache;
    let b;
    try { b = fs.readFileSync(KEYF); } catch (e) { keyErr = ''; return ''; }
    try {
      keyCache = b.subarray(0, 4).toString() === 'TXT:' ? b.subarray(4).toString() : safeStorage.decryptString(b);
      keyErr = ''; return keyCache;
    } catch (e) { keyErr = 'locked'; return ''; }
  }
  const keyState = () => { if (getKey()) return 'ok'; return keyErr === 'locked' ? 'locked' : 'none'; };
  function setKey(k) {
    keyCache = ''; keyErr = '';
    if (!k) { try { fs.unlinkSync(KEYF); } catch (e) { /* ok */ } return; }
    keyCache = k;
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(k) : Buffer.concat([Buffer.from('TXT:'), Buffer.from(k)]);
    fs.writeFileSync(KEYF, data, { mode: 0o600 });
  }
  async function claude(system, user, maxTokens = 2500, key = getKey()) {
    if (!key) throw new Error('falta a chave da API da Anthropic');
    const base = (!app.isPackaged && process.env.ZEUS_TEST_ANTHROPIC) || 'https://api.anthropic.com';
    const res = await net.fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j && j.error && j.error.message ? j.error.message : 'HTTP ' + res.status;
      if (res.status === 401) throw new Error('a chave da API não é válida');
      if (res.status === 402 || /credit|billing/i.test(msg)) throw new Error('a conta da API não tem saldo');
      throw new Error(msg);
    }
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  }
  const SUM_SYS = 'És o assistente de um subdiretor de um jornal português. Resumes reuniões, entrevistas e outras gravações a partir de transcrições automáticas (podem ter erros de reconhecimento). Escreves em português europeu, de forma clara e sóbria. Não inventas nada que não esteja na transcrição. Respondes só com JSON válido, sem mais texto.';
  async function claudeSummary(text) {
    const t = String(text || '').slice(0, 180000);
    const out = await claude(SUM_SYS, `Transcrição da gravação (reunião, entrevista ou outra; com marcas de tempo):\n\n${t}\n\nDevolve um objeto JSON com estes campos:\n{"titulo": "título curto (máx. 8 palavras)", "resumo": "3 a 5 frases", "pontos": ["pontos principais"], "decisoes": ["decisões tomadas"], "tarefas": [{"tarefa": "...", "responsavel": "nome ou vazio", "prazo": "prazo ou vazio"}], "proximos": ["próximos passos"]}\nListas vazias se não houver nada. Nomes de pessoas só se forem ditos na gravação.`);
    const m = /\{[\s\S]*\}/.exec(out);
    if (!m) throw new Error('resposta sem resumo');
    return JSON.parse(m[0]);
  }
  const netErr = e => { const m = String((e && e.message) || e || ''); return /INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|NETWORK_CHANGED|net::ERR_/i.test(m) ? 'não havia ligação à internet' : m; };
  h('hasKey', () => !!getKey());
  h('setKey', async k => {
    k = str(k, 300).trim();
    if (!k) { setKey(''); return { ok: true }; }
    if (!/^sk-ant-/.test(k)) return { ok: false, error: 'A chave da Anthropic começa por "sk-ant-".' };
    try { await claude('Responde só "ok".', 'ok', 5, k); } catch (e) { return { ok: false, error: 'A chave não funcionou: ' + e.message + '.' }; }
    setKey(k); return { ok: true };
  });
  h('summarize', async (id, text) => {
    try { const s = await claudeSummary(str(text, 200000)); return { ok: true, html: summaryHtml(s), title: s.titulo || '' }; }
    catch (e) { return { ok: false, error: netErr(e) }; }
  });

  // ao sair do Zeus a meio de uma gravação: guarda o que já foi gravado e transcreve-o na próxima vez
  async function quitCheck() {
    if (!rec) return true;
    const r = await dialog.showMessageBox(x.getWin(), { type: 'warning', buttons: ['Continuar a gravar', 'Sair e guardar a gravação'], defaultId: 0, cancelId: 0, message: 'Está a decorrer a gravação de uma reunião.', detail: 'Se saíres agora, o que já foi gravado fica guardado na nota e é transcrito quando voltares a abrir o Zeus.' });
    if (r.response !== 1) return false;
    await stopRecording().catch(() => {});
    return true;
  }
  // para o Orfeu: criar uma nota (com o ficheiro de áudio/vídeo original ligado) e transcrever um WAV para ela
  async function createNote(title, html, audioAbs) { const id = await serial(() => notas.create('', title, html, audioAbs || '')); send('changed'); return id; }
  function transcribeInto(id, wav, secs) { addJob({ id, wav, secs, stage: 'transcrever', pct: 0, at: Date.now() }); }
  setTimeout(pushStatus, 1500);
  return { notas, isRecording: () => !!rec, status, quitCheck, createNote, transcribeInto, modelState, getKey, keyState, setKey, whisper: () => ({ bin: binPath(), model: modelPath() }) };
}

module.exports = { setupNotas, toText };

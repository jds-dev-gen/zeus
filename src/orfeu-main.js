'use strict';
/*
 * Orfeu — leitor de áudio e vídeo do Zeus (parte do processo principal).
 * Biblioteca (recentes, fila, pastas do Mac, marcas), conversão dos formatos que o Chromium não lê,
 * forma de onda, miniaturas, cortar excertos e exportar só o áudio — tudo com o ffmpeg que vai dentro da app.
 * Só a página interna do Orfeu pode chamar estas funções.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'aif', 'aiff', 'wma', 'ac3', 'amr', 'caf', 'mka', 'alac', 'mp2', 'm4b'];
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'ogv', 'vob', 'mxf', 'divx', 'f4v'];
const MEDIA_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT]);
const extOf = p => path.extname(p).slice(1).toLowerCase();
const isMedia = p => MEDIA_EXT.has(extOf(p));
// o que o Chromium do Zeus lê sem ajuda (contentor + codecs)
const OK_VIDEO = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1']);
const OK_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_u8', 'alac']);
const OK_CONT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4b']);

function setupOrfeu(x) {
  const { app, ipcMain, dialog, shell } = x;
  const UD = path.join(app.getPath('userData'), 'orfeu');
  const DB = path.join(app.getPath('userData'), 'orfeu.json');
  fs.mkdirSync(path.join(UD, 'conv'), { recursive: true });
  fs.mkdirSync(path.join(UD, 'mini'), { recursive: true });
  fs.mkdirSync(path.join(UD, 'onda'), { recursive: true });
  const wc = () => { const w = x.getWC(); return w && !w.isDestroyed() ? w : null; };
  const send = (ch, ...a) => { const w = wc(); if (w) w.send('orfeu:' + ch, ...a); };
  const toast = msg => { const u = x.getUi(); if (u && !u.isDestroyed()) u.send('toast', msg); };
  const from = e => { const w = wc(); return !!w && e.sender === w && e.senderFrame === w.mainFrame; };
  const h = (name, fn) => ipcMain.handle('orfeu:' + name, async (e, ...a) => (from(e) ? fn(...a) : null));
  const str = (v, n = 4000) => String(v == null ? '' : v).slice(0, n);

  /* ---------- biblioteca ---------- */
  let D; try { D = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch (e) { D = {}; }
  D.items = D.items || {}; D.queue = D.queue || []; D.folders = D.folders || [];
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { const t = DB + '.tmp'; fs.writeFileSync(t, JSON.stringify(D)); fs.renameSync(t, DB); } catch (e) { /* ok */ } }, 400); };
  const idOf = p => crypto.createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 14);
  const pub = it => it && Object.assign({}, it, {
    url: it.conv && fs.existsSync(it.conv) ? pathToFileURL(it.conv).href : pathToFileURL(it.path).href,
    thumb: it.thumb && fs.existsSync(it.thumb) ? pathToFileURL(it.thumb).href : '',
    exists: fs.existsSync(it.path), folder: path.basename(path.dirname(it.path))
  });
  // regista um ficheiro na biblioteca (sem o copiar) e vai buscar a informação dele
  async function register(p, opts = {}) {
    p = path.resolve(String(p || ''));
    if (!isMedia(p)) return null;
    let st; try { st = await fsp.stat(p); } catch (e) { return null; }
    if (!st.isFile()) return null;
    const id = idOf(p);
    let it = D.items[id];
    if (!it) it = D.items[id] = { id, path: p, name: path.basename(p), added: Date.now(), pos: 0, marks: [] };
    if (it.size !== st.size || it.mtime !== st.mtimeMs || !it.probed) {
      Object.assign(it, { size: st.size, mtime: st.mtimeMs });
      const info = await probe(p).catch(() => null);
      if (info) Object.assign(it, info, { probed: true });
      it.kind = it.video ? 'video' : (it.audio || AUDIO_EXT.includes(extOf(p))) ? 'audio' : 'video';
      it.playable = native(it);
      if (it.conv && !fs.existsSync(it.conv)) delete it.conv;
    }
    if (opts.touch) it.lastPlayed = Date.now();
    if (opts.recent !== false) it.recent = true;
    save();
    if (it.kind === 'video' && !it.thumb) thumb(it).catch(() => {});
    return it;
  }
  const native = it => {
    const ext = extOf(it.path);
    if (!OK_CONT.has(ext)) return false;
    if (it.video && !OK_VIDEO.has(it.video)) return false;
    if (it.audio && !OK_AUDIO.has(it.audio)) return false;
    return true;
  };
  h('library', async () => ({
    items: Object.values(D.items).filter(i => i.recent).map(pub),
    queue: D.queue.filter(id => D.items[id]),
    folders: D.folders.map(f => ({ path: f, name: path.basename(f), exists: fs.existsSync(f) })),
    ffmpeg: fs.existsSync(ffBin()),
    convSize: dirSize(path.join(UD, 'conv'))
  }));
  h('item', id => pub(D.items[str(id, 40)]));
  // abrir ficheiros: arrastados para a página, escolhidos em "Abrir…" ou vindos do Finder ("Abrir com › Zeus")
  async function addPaths(paths, opts = {}) {
    const out = [];
    for (const p of (paths || []).slice(0, 200)) {
      if (!p) continue;
      let st; try { st = await fsp.stat(p); } catch (e) { continue; }
      if (st.isDirectory()) { for (const f of await listMedia(p, 1)) { const it = await register(f, opts); if (it) out.push(it.id); } }
      else { const it = await register(p, opts); if (it) out.push(it.id); }
    }
    return out;
  }
  h('addPaths', async (paths, play) => {
    const ids = await addPaths((Array.isArray(paths) ? paths : []).map(p => str(p)).filter(Boolean));
    if (!ids.length) return { ids: [], error: 'Nenhum ficheiro de áudio ou vídeo.' };
    if (play) D.queue = [...ids.slice(1), ...D.queue.filter(i => !ids.includes(i))];
    save(); return { ids };
  });
  h('openDialog', async () => {
    const r = await dialog.showOpenDialog(x.getWin(), { title: 'Abrir no Orfeu', buttonLabel: 'Abrir', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Áudio e vídeo', extensions: [...MEDIA_EXT] }, { name: 'Todos os ficheiros', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths.length) return { ids: [] };
    const ids = await addPaths(r.filePaths);
    D.queue = [...ids.slice(1), ...D.queue.filter(i => !ids.includes(i))]; save();
    return { ids };
  });
  h('forget', id => { const it = D.items[str(id, 40)]; if (it) { it.recent = false; D.queue = D.queue.filter(i => i !== it.id); save(); } return true; });
  h('setPos', (id, pos, done) => { const it = D.items[str(id, 40)]; if (it) { it.pos = Math.max(0, +pos || 0); if (done != null) it.done = !!done; it.lastPlayed = Date.now(); save(); } return true; });
  h('touch', id => { const it = D.items[str(id, 40)]; if (it) { it.lastPlayed = Date.now(); it.recent = true; save(); } return true; });
  h('setQueue', ids => { D.queue = (Array.isArray(ids) ? ids : []).map(i => str(i, 40)).filter(i => D.items[i]).slice(0, 500); save(); return D.queue; });
  h('setMarks', (id, marks) => {
    const it = D.items[str(id, 40)]; if (!it) return null;
    it.marks = (Array.isArray(marks) ? marks : []).slice(0, 500).map(m => ({ t: Math.max(0, +m.t || 0), text: str(m.text, 500) })).sort((a, b) => a.t - b.t);
    save(); return it.marks;
  });
  h('reveal', id => { const it = D.items[str(id, 40)]; if (it) shell.showItemInFolder(it.path); });

  /* ---------- pastas do Mac ---------- */
  async function listMedia(dir, depth) {
    const out = [];
    let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const d of ents) {
      if (d.name.startsWith('.')) continue;
      const p = path.join(dir, d.name);
      if (d.isFile() && isMedia(p)) out.push(p);
      else if (d.isDirectory() && depth > 0) out.push(...await listMedia(p, depth - 1));
      if (out.length > 2000) break;
    }
    return out;
  }
  h('addFolder', async () => {
    const r = await dialog.showOpenDialog(x.getWin(), { title: 'Juntar uma pasta do Mac ao Orfeu', buttonLabel: 'Juntar', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const f = r.filePaths[0];
    if (!D.folders.includes(f)) D.folders.push(f);
    save(); return f;
  });
  h('removeFolder', f => { D.folders = D.folders.filter(x2 => x2 !== str(f)); save(); return true; });
  // o que está numa pasta (até dois níveis); a informação de cada ficheiro vem aos poucos
  h('folder', async f => {
    f = str(f);
    if (!D.folders.includes(f)) return null;
    const files = await listMedia(f, 2);
    const out = [];
    for (const p of files) {
      let st; try { st = await fsp.stat(p); } catch (e) { continue; }
      const id = idOf(p), it = D.items[id];
      out.push(it && it.size === st.size ? pub(it) : { id, path: p, name: path.basename(p), size: st.size, mtime: st.mtimeMs, kind: AUDIO_EXT.includes(extOf(p)) ? 'audio' : 'video', folder: path.basename(path.dirname(p)), fresh: true });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  });
  h('ensure', async p => { const it = await register(str(p), { recent: false }); return it ? pub(it) : null; });

  /* ---------- ffmpeg ---------- */
  const ffBin = () => process.env.ZEUS_FFMPEG || (app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg') : path.join(__dirname, '..', 'vendor', `ffmpeg-${process.platform}-${process.arch}`, 'ffmpeg', 'ffmpeg'));
  function ff(args, onProgress, total) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(ffBin())) return reject(new Error('o ffmpeg não está incluído nesta versão'));
      const p = spawn(ffBin(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '', out = '';
      p.stdout.on('data', d => {
        out = (out + d.toString()).slice(-4000);
        if (onProgress && total) { const m = /out_time_(?:ms|us)=(\d+)/g; let k, last = null; while ((k = m.exec(d.toString()))) last = +k[1]; if (last != null) onProgress(Math.min(99, Math.round(last / 1e6 / total * 100))); }
      });
      p.stderr.on('data', d => { err = (err + d.toString()).slice(-8000); });
      p.on('error', reject);
      p.on('close', code => code === 0 ? resolve({ err, out }) : reject(Object.assign(new Error((err.trim().split('\n').pop() || 'ffmpeg falhou').slice(0, 300)), { stderr: err, code })));
      if (x.track) x.track(p);
    });
  }
  // informação do ficheiro: duração e codecs (o ffmpeg sem saída escreve-a e acaba com erro, é normal)
  async function probe(p) {
    let txt = '';
    try { await ff(['-i', p]); } catch (e) { txt = e.stderr || ''; }
    if (!txt) return null;
    const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(txt);
    const v = /Stream #[^\n]*?Video:\s*([a-z0-9_]+)[^\n]*?(\d{2,5})x(\d{2,5})/i.exec(txt.replace(/Video: [^\n]*attached pic[^\n]*/g, ''));
    const a = /Stream #[^\n]*?Audio:\s*([a-z0-9_]+)(?:[^\n]*?(\d{4,6}) Hz)?(?:, ([a-z0-9.()]+))?/i.exec(txt);
    return {
      duration: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0,
      video: v ? v[1].toLowerCase() : '', width: v ? +v[2] : 0, height: v ? +v[3] : 0,
      audio: a ? a[1].toLowerCase() : '', rate: a && a[2] ? +a[2] : 0, channels: a && a[3] ? a[3] : ''
    };
  }
  async function thumb(it) {
    const out = path.join(UD, 'mini', it.id + '.jpg');
    const at = Math.max(1, Math.min(60, (it.duration || 20) * 0.1));
    await ff(['-y', '-ss', String(at), '-i', it.path, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out]);
    it.thumb = out; save(); send('thumb', { id: it.id, thumb: pathToFileURL(out).href });
  }
  // forma de onda: picos de 1200 pedaços, guardados para a próxima vez
  const waveJobs = new Map();
  h('wave', id => {
    const it = D.items[str(id, 40)]; if (!it) return null;
    const f = path.join(UD, 'onda', it.id + '-' + Math.round(it.mtime || 0) + '.json');
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* calcula */ }
    if (waveJobs.has(it.id)) return waveJobs.get(it.id);
    const job = new Promise(resolve => {
      if (!fs.existsSync(ffBin())) return resolve(null);
      const N = 1200, rate = 2000;
      const total = Math.max(1, Math.round((it.duration || 60) * rate));
      const per = Math.max(1, Math.floor(total / N));
      const peaks = new Array(N).fill(0);
      let n = 0, carry = null;
      const p = spawn(ffBin(), ['-hide_banner', '-nostdin', '-v', 'error', '-i', it.path, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
      p.stdout.on('data', d => {
        let b = carry ? Buffer.concat([carry, d]) : d;
        const len = b.length - (b.length % 2); carry = b.length % 2 ? b.subarray(len) : null;
        for (let i = 0; i < len; i += 2) { const v = Math.abs(b.readInt16LE(i)); const k = Math.min(N - 1, Math.floor(n / per)); if (v > peaks[k]) peaks[k] = v; n++; }
      });
      p.on('error', () => resolve(null));
      p.on('close', () => {
        const max = Math.max(1, ...peaks);
        const used = Math.min(N, Math.ceil(n / per));
        const out = peaks.slice(0, used).map(v => Math.round(Math.sqrt(v / max) * 255));   // raiz: as partes calmas também se veem
        try { fs.writeFileSync(f, JSON.stringify(out)); } catch (e) { /* ok */ }
        waveJobs.delete(it.id); resolve(out);
      });
    });
    waveJobs.set(it.id, job);
    return job;
  });

  /* ---------- trabalhos com o ffmpeg (converter, cortar, exportar áudio, preparar a transcrição) ---------- */
  let jobs = [];   // { key, id, kind, label, pct, error }
  const pubJobs = () => jobs.map(j => ({ key: j.key, id: j.id, kind: j.kind, label: j.label, pct: j.pct || 0, error: j.error || '', out: j.out || '' }));
  const emit = () => send('jobs', pubJobs());
  h('jobs', () => pubJobs());
  h('dismissJob', key => { jobs = jobs.filter(j => j.key !== str(key, 80)); emit(); return true; });
  async function runJob(j, fn) {
    if (jobs.some(o => o.key === j.key && !o.error && o.pct < 100)) return null;
    jobs = jobs.filter(o => o.key !== j.key);
    j.pct = 0; jobs.push(j); emit();
    try { const r = await fn(pct => { if (pct !== j.pct) { j.pct = pct; emit(); } }); j.pct = 100; emit(); setTimeout(() => { jobs = jobs.filter(o => o !== j); emit(); }, 6000); return r; }
    catch (e) { j.error = (e && e.message) || String(e); emit(); return null; }
  }
  const progArgs = ['-progress', 'pipe:1', '-nostats'];
  const isMac = process.platform === 'darwin';
  const h264 = () => (isMac ? ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-allow_sw', '1'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']);
  // converter para um formato que o Zeus lê; muda só o "invólucro" quando os codecs já servem (é rápido)
  h('convert', async id => {
    const it = D.items[str(id, 40)]; if (!it) return null;
    if (it.conv && fs.existsSync(it.conv)) return pub(it);
    const audioOnly = it.kind === 'audio' || !it.video;
    const out = path.join(UD, 'conv', it.id + (audioOnly ? '.m4a' : '.mp4'));
    const copyV = it.video && ['h264', 'hevc'].includes(it.video);
    const copyA = it.audio && ['aac', 'mp3'].includes(it.audio);
    const tmp = out + '.part' + (audioOnly ? '.m4a' : '.mp4');
    const r = await runJob({ key: 'conv:' + it.id, id: it.id, kind: 'conv', label: `A preparar "${it.name}" para tocar no Zeus` }, prog => ff(['-y', '-i', it.path, ...progArgs,
      ...(audioOnly ? ['-vn'] : ['-map', '0:v:0?', '-map', '0:a:0?', ...(copyV ? ['-c:v', 'copy', ...(it.video === 'hevc' ? ['-tag:v', 'hvc1'] : [])] : h264())]),
      ...(copyA ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']), '-movflags', '+faststart', tmp], prog, it.duration).then(() => fsp.rename(tmp, out)));
    if (r === null && !fs.existsSync(out)) { fsp.unlink(tmp).catch(() => {}); return null; }
    it.conv = out; save();
    return pub(it);
  });
  const clock = t => { t = Math.max(0, Math.floor(t)); const hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60; return (hh ? hh + 'h' + String(mm).padStart(2, '0') : String(mm)) + "'" + String(ss).padStart(2, '0'); };
  const safeName = s => String(s).replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  async function askSave(title, name, exts) {
    if (!app.isPackaged && process.env.ZEUS_TEST_SAVE) return path.join(process.env.ZEUS_TEST_SAVE, name);   // testes, sem janela
    const r = await dialog.showSaveDialog(x.getWin(), { title, defaultPath: path.join(app.getPath('downloads'), name), filters: exts.map(e => ({ name: e.toUpperCase(), extensions: [e] })) });
    return r.canceled ? null : r.filePath;
  }
  // cortar um excerto (com imagem, ou só o som)
  h('exportClip', async (id, a, b, audioOnly) => {
    const it = D.items[str(id, 40)]; if (!it) return null;
    a = Math.max(0, +a || 0); b = Math.min(it.duration || 1e9, +b || 0);
    if (!(b > a)) return { error: 'Marca o início e o fim do excerto.' };
    const base = safeName(it.name.replace(/\.[^.]+$/, '')) + ` (${clock(a)}–${clock(b)})`;
    const onlyA = audioOnly || it.kind === 'audio';
    const src = extOf(it.path);
    const ext = onlyA ? (['mp3', 'm4a', 'wav', 'flac'].includes(src) ? src : 'm4a') : 'mp4';
    const out = await askSave(onlyA ? 'Guardar o excerto (áudio)' : 'Guardar o excerto', base + '.' + ext, onlyA ? [ext, ...['m4a', 'mp3', 'wav'].filter(e => e !== ext)] : ['mp4']);
    if (!out) return null;
    const oe = extOf(out);
    const aArgs = oe === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : oe === 'wav' ? ['-c:a', 'pcm_s16le'] : oe === 'flac' ? ['-c:a', 'flac'] : ['-c:a', 'aac', '-b:a', '256k'];
    // o corte é sempre recodificado: fica certo ao centésimo de segundo (copiar o vídeo cortava nas imagens-chave)
    const r = await runJob({ key: 'clip:' + it.id + ':' + out, id: it.id, kind: 'clip', label: `A cortar o excerto ${clock(a)}–${clock(b)}`, out }, prog => ff(['-y', '-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', it.path, ...progArgs,
      ...(onlyA ? ['-vn'] : ['-map', '0:v:0?', '-map', '0:a:0?', ...h264()]), ...aArgs, ...(oe === 'mp4' || oe === 'm4a' ? ['-movflags', '+faststart'] : []), out], prog, b - a));
    if (r === null) return null;
    toast('Excerto guardado.'); shell.showItemInFolder(out); return { out };
  });
  h('exportAudio', async id => {
    const it = D.items[str(id, 40)]; if (!it) return null;
    if (!it.audio) return { error: 'Este ficheiro não tem som.' };
    const base = safeName(it.name.replace(/\.[^.]+$/, ''));
    const def = it.audio === 'mp3' ? 'mp3' : 'm4a';
    const out = await askSave('Exportar só o áudio', base + '.' + def, [def, ...['m4a', 'mp3', 'wav'].filter(e => e !== def)]);
    if (!out) return null;
    const oe = extOf(out);
    const aArgs = oe === 'mp3' ? (it.audio === 'mp3' ? ['-c:a', 'copy'] : ['-c:a', 'libmp3lame', '-q:a', '2']) : oe === 'wav' ? ['-c:a', 'pcm_s16le'] : (it.audio === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '256k']);
    const r = await runJob({ key: 'aud:' + it.id + ':' + out, id: it.id, kind: 'audio', label: `A exportar o áudio de "${it.name}"`, out }, prog => ff(['-y', '-i', it.path, ...progArgs, '-vn', ...aArgs, ...(oe === 'm4a' ? ['-movflags', '+faststart'] : []), out], prog, it.duration));
    if (r === null) return null;
    toast('Áudio exportado.'); shell.showItemInFolder(out); return { out };
  });

  /* ---------- para as Notas ---------- */
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tclock = t => { t = Math.max(0, Math.floor(t)); const hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm).padStart(2, '0')) + ':' + String(ss).padStart(2, '0'); };
  const srcLine = it => `<p><span class="src">Ficheiro: ${escH(it.name)} · ${escH(path.dirname(it.path).replace(os.homedir(), '~'))}${it.duration ? ' · ' + tclock(it.duration) : ''}</span></p>`;
  const playable = it => (it.conv && fs.existsSync(it.conv) ? it.conv : it.path);
  h('marksToNote', async id => {
    const it = D.items[str(id, 40)]; if (!it) return null;
    const N = x.getNotas(); if (!N) return { error: 'As Notas não estão disponíveis.' };
    if (!(it.marks || []).length) return { error: 'Ainda não há marcas neste ficheiro.' };
    const html = srcLine(it) + `<h2>Marcas</h2>` + it.marks.map(m => `<p><span class="ts" data-t="${Math.floor(m.t)}">${tclock(m.t)}</span> ${escH(m.text || '—')}</p>`).join('');
    const noteId = await N.createNote(`${it.name.replace(/\.[^.]+$/, '')} — marcas`, html, playable(it));
    toast('Marcas enviadas para as Notas.');
    return { noteId };
  });
  h('transcribe', async id => {
    const it = D.items[str(id, 40)]; if (!it) return null;
    const N = x.getNotas(); if (!N) return { error: 'As Notas não estão disponíveis.' };
    if (!it.audio) return { error: 'Este ficheiro não tem som.' };
    const marks = (it.marks || []).length ? `<h2>Marcas</h2>` + it.marks.map(m => `<p><span class="ts" data-t="${Math.floor(m.t)}">${tclock(m.t)}</span> ${escH(m.text || '—')}</p>`).join('') : '';
    const noteId = await N.createNote(`${it.name.replace(/\.[^.]+$/, '')} — transcrição`, srcLine(it) + marks, playable(it));
    // o Whisper precisa de 16 kHz, mono, 16 bits
    const wav = path.join(app.getPath('userData'), 'gravacoes', `orfeu-${it.id}-${Date.now()}.wav`);
    await fsp.mkdir(path.dirname(wav), { recursive: true });
    const r = await runJob({ key: 'tr:' + it.id, id: it.id, kind: 'transcribe', label: `A preparar "${it.name}" para transcrever` }, prog => ff(['-y', '-i', it.path, ...progArgs, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], prog, it.duration));
    if (r === null) return { error: 'Não foi possível preparar o som para transcrever.' };
    N.transcribeInto(noteId, wav, Math.round(it.duration || 0));
    toast('A transcrever nas Notas — a nota fica pronta sozinha.');
    return { noteId };
  });
  h('openNotes', noteId => x.openNotes(str(noteId, 40)));

  /* ---------- legendas (.srt passa a .vtt) ---------- */
  h('subs', async (idOrPath) => {
    let p = str(idOrPath);
    if (D.items[p]) {   // procura uma legenda com o mesmo nome ao lado do ficheiro
      const it = D.items[p], base = it.path.replace(/\.[^.]+$/, '');
      p = ['.vtt', '.srt', '.pt.srt', '.por.srt'].map(e => base + e).find(f => fs.existsSync(f)) || '';
      if (!p) return null;
    } else if (!/\.(srt|vtt)$/i.test(p) || !fs.existsSync(p)) return null;
    let t; try { t = await fsp.readFile(p, 'utf8'); } catch (e) { return null; }
    if (t.length > 3e6) return null;
    if (/\.srt$/i.test(p)) t = 'WEBVTT\n\n' + t.replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
    return { name: path.basename(p), vtt: t };
  });
  h('chooseSubs', async () => {
    const r = await dialog.showOpenDialog(x.getWin(), { title: 'Legendas', properties: ['openFile'], filters: [{ name: 'Legendas', extensions: ['srt', 'vtt'] }] });
    return r.canceled ? null : r.filePaths[0];
  });

  /* ---------- arrumação ---------- */
  function dirSize(d) { let s = 0; try { for (const f of fs.readdirSync(d)) { try { s += fs.statSync(path.join(d, f)).size; } catch (e) { /* ok */ } } } catch (e) { /* ok */ } return s; }
  h('clearConv', async () => {
    for (const f of await fsp.readdir(path.join(UD, 'conv')).catch(() => [])) await fsp.unlink(path.join(UD, 'conv', f)).catch(() => {});
    Object.values(D.items).forEach(it => { delete it.conv; }); save(); return true;
  });
  // conversões que não se abrem há 60 dias vão fora
  setTimeout(async () => {
    const now = Date.now();
    for (const it of Object.values(D.items)) if (it.conv && now - (it.lastPlayed || it.added || 0) > 60 * 864e5) { await fsp.unlink(it.conv).catch(() => {}); delete it.conv; }
    save();
  }, 15000);

  return { addPaths, isMedia, register };
}

module.exports = { setupOrfeu, isMedia: p => MEDIA_EXT.has(path.extname(String(p)).slice(1).toLowerCase()) };

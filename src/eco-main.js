'use strict';
/*
 * Eco — editor de áudio simples do Zeus (processo principal).
 * Projetos não destrutivos: os ficheiros originais nunca são alterados; um projeto é uma lista de
 * pedaços (clips) de ficheiros em três pistas (Voz, Música, Efeitos). O ffmpeg do Orfeu desenha as
 * ondas, encontra as pausas e faz a mistura final (limpeza de ruído, música que baixa com a voz,
 * volume igualado).
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');

const PEAKS_PER_SEC = 100;
// formatos que o Chromium toca diretamente (os outros são convertidos para a pré-escuta)
const PLAYABLE = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mp4', 'weba']);
const MEDIA_EXT = ['mp3', 'm4a', 'aac', 'wav', 'aif', 'aiff', 'aifc', 'caf', 'flac', 'ogg', 'oga', 'opus', 'wma', 'amr', 'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mpg', 'mpeg', '3gp', 'weba'];
const TRACKS = () => ([
  { id: 'voz', name: 'Voz', kind: 'voice', gain: 1, mute: false, solo: false, clips: [] },
  { id: 'musica', name: 'Música', kind: 'music', gain: 0.35, mute: false, solo: false, duck: true, clips: [] },
  { id: 'efeitos', name: 'Efeitos', kind: 'fx', gain: 1, mute: false, solo: false, clips: [] }
]);

function setupEco(x) {
  const { app, ipcMain, dialog, shell } = x;
  const UD = path.join(app.getPath('userData'), 'eco');
  const PJ = path.join(UD, 'projetos'), CACHE = path.join(UD, 'cache');
  fs.mkdirSync(PJ, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
  const ffBin = () => process.env.ZEUS_FFMPEG || (app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg') : path.join(__dirname, '..', 'vendor', `ffmpeg-${process.platform}-${process.arch}`, 'ffmpeg', 'ffmpeg'));
  const wc = () => { const w = x.getWC(); return w && !w.isDestroyed() ? w : null; };
  const send = (ch, d) => { const w = wc(); if (w) w.send('eco:' + ch, d); };
  const toast = m => { const u = x.getUi(); if (u && !u.isDestroyed()) u.send('toast', m); };
  const from = e => { const w = wc(); return !!w && e.sender === w && e.senderFrame === w.mainFrame; };
  const h = (n, fn) => ipcMain.handle('eco:' + n, async (e, ...a) => (from(e) ? fn(...a) : null));
  const str = (v, n = 4000) => String(v == null ? '' : v).slice(0, n);
  const abs = p => { p = str(p); return p && path.isAbsolute(p) ? path.normalize(p) : null; };
  const exists = p => { try { fs.accessSync(p); return true; } catch (e) { return false; } };
  const extOf = p => path.extname(p).slice(1).toLowerCase();
  const num = (v, d = 0, lo = -1e9, hi = 1e9) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- projetos ---------- */
  const pFile = id => path.join(PJ, String(id).replace(/[^a-z0-9]/gi, '') + '.json');
  function clean(p) {
    // só guarda o que o editor precisa, com números e textos limpos
    const out = { id: str(p.id, 40).replace(/[^a-z0-9]/gi, '') || newId(), name: str(p.name, 140) || 'Projeto sem nome', created: num(p.created, Date.now()), updated: Date.now(), sources: {}, tracks: [], settings: {}, lastExport: str(p.lastExport || '', 2000) };
    for (const [k, s] of Object.entries(p.sources || {}).slice(0, 400)) {
      const sp = abs(s && s.path); if (!sp) continue;
      out.sources[str(k, 40)] = { path: sp, name: str(s.name, 300) || path.basename(sp), dur: num(s.dur, 0, 0), ch: num(s.ch, 2, 1, 8), key: str(s.key, 40), url: str(s.url, 3000) };
    }
    const base = TRACKS();
    for (const t0 of base) {
      const t = (p.tracks || []).find(y => y && y.id === t0.id) || t0;
      out.tracks.push({ id: t0.id, name: t0.name, kind: t0.kind, gain: num(t.gain, t0.gain, 0, 4), mute: !!t.mute, solo: !!t.solo, ...(t0.kind === 'music' ? { duck: t.duck !== false } : {}),
        clips: (Array.isArray(t.clips) ? t.clips : []).slice(0, 5000).filter(c => c && out.sources[c.src]).map(c => ({
          id: str(c.id, 40) || newId(), src: str(c.src, 40), in: num(c.in, 0, 0), out: num(c.out, 0, 0), at: num(c.at, 0, 0), gain: num(c.gain, 1, 0, 8),
          ramp: Array.isArray(c.ramp) ? [num(c.ramp[0], 1, 0, 8), num(c.ramp[1], 1, 0, 8)] : [1, 1]
        })).filter(c => c.out - c.in > 0.001) });
    }
    const s = p.settings || {};
    out.settings = { denoise: !!s.denoise, denoiseAmount: num(s.denoiseAmount, 0.5, 0, 1), pauses: num(s.pauses, 1.5, 0.4, 5), loudness: ['podcast', 'radio', 'off'].includes(s.loudness) ? s.loudness : 'podcast' };
    return out;
  }
  async function listProjects() {
    const out = [];
    for (const f of await fsp.readdir(PJ).catch(() => [])) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = JSON.parse(await fsp.readFile(path.join(PJ, f), 'utf8'));
        const dur = Math.max(0, ...p.tracks.map(t => Math.max(0, ...t.clips.map(c => c.at + c.out - c.in))));
        out.push({ id: p.id, name: p.name, updated: p.updated, dur });
      } catch (e) { /* ficheiro estragado: ignora */ }
    }
    return out.sort((a, b) => b.updated - a.updated);
  }
  async function saveProject(p) { const c = clean(p); await fsp.writeFile(pFile(c.id), JSON.stringify(c)); return { id: c.id, updated: c.updated }; }
  async function loadProject(id) { try { return clean(JSON.parse(await fsp.readFile(pFile(id), 'utf8'))); } catch (e) { return null; } }
  async function createProject(name, paths) {
    const p = clean({ id: newId(), name: name || 'Projeto novo', created: Date.now(), tracks: TRACKS(), sources: {} });
    if (paths && paths.length) {
      const srcs = await addFiles(paths);
      let at = 0;
      for (const s of srcs) {
        p.sources[s.id] = s;
        p.tracks[0].clips.push({ id: newId(), src: s.id, in: 0, out: s.dur, at, gain: 1, ramp: [1, 1] });
        at += s.dur;
      }
      if (!name && srcs[0]) p.name = srcs[0].name.replace(/\.[^.]+$/, '') + ' (edição)';
    }
    await saveProject(p);
    return loadProject(p.id);
  }

  /* ---------- ffmpeg ---------- */
  function ff(args, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!exists(ffBin())) return reject(new Error('o ffmpeg não está incluído nesta versão'));
      // muitos pedaços = muitos ficheiros abertos de uma vez: sobe o limite (no Mac são 256 por defeito)
      const p = spawn('/bin/sh', ['-c', 'ulimit -n 8192 2>/dev/null || ulimit -n 4096 2>/dev/null; exec "$0" "$@"', ffBin(), '-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      if (opts.onData) p.stdout.on('data', opts.onData); else p.stdout.resume();
      p.stderr.on('data', d => { err = (err + d).slice(-60000); if (opts.onErr) opts.onErr(String(d)); });
      if (opts.proc) opts.proc(p);
      p.on('error', reject);
      p.on('close', code => (code === 0 ? resolve(err) : reject(Object.assign(new Error((err.trim().split('\n').filter(l => !/^\s*$/.test(l)).pop() || 'o ffmpeg falhou').slice(0, 300)), { stderr: err, code }))));
    });
  }
  async function probe(p) {
    let err = '';
    try { await ff(['-i', p]); } catch (e) { err = e.stderr || ''; }
    const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
    const dur = m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
    const a = /Stream #[^\n]*Audio:[^\n]*/.exec(err);
    if (!a) return null;
    const ch = /\bmono\b/.test(a[0]) ? 1 : 2;
    return { dur, ch };
  }
  const keyOf = (p, st) => crypto.createHash('sha1').update(p + '|' + st.mtimeMs + '|' + st.size).digest('hex').slice(0, 16);
  // onda: o maior valor de cada centésimo de segundo (0–255), guardado em cache
  async function makePeaks(p, key) {
    const out = path.join(CACHE, key + '.peaks');
    if (exists(out)) return out;
    const per = 8000 / PEAKS_PER_SEC; const parts = []; let cur = 0, n = 0, rest = Buffer.alloc(0);
    await ff(['-v', 'error', '-i', p, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], {
      onData: ch => {
        const b = rest.length ? Buffer.concat([rest, ch]) : ch;
        const even = b.length - (b.length % 2);
        for (let i = 0; i < even; i += 2) { const v = Math.abs(b.readInt16LE(i)); if (v > cur) cur = v; if (++n >= per) { parts.push(Math.min(255, Math.round(Math.sqrt(cur / 32768) * 255))); cur = 0; n = 0; } }
        rest = b.subarray(even);
      }
    });
    if (n) parts.push(Math.min(255, Math.round(Math.sqrt(cur / 32768) * 255)));
    await fsp.writeFile(out, Buffer.from(parts));
    return out;
  }
  // ficheiro para ouvir no editor (o original, se o Chromium o tocar; senão uma cópia M4A em cache)
  async function playable(p, key) {
    if (PLAYABLE.has(extOf(p)) && !['mp4', 'webm'].includes(extOf(p))) return pathToFileURL(p).href;
    const out = path.join(CACHE, key + '.m4a');
    if (!exists(out)) await ff(['-v', 'error', '-y', '-i', p, '-vn', '-c:a', 'aac', '-b:a', '192k', out]);
    return pathToFileURL(out).href;
  }
  const busy = new Map();
  async function addFiles(paths) {
    const list = (Array.isArray(paths) ? paths : []).map(abs).filter(p => p && exists(p) && MEDIA_EXT.includes(extOf(p))).slice(0, 50);
    const out = [];
    for (const p of list) {
      send('busy', `A preparar ${path.basename(p)}…`);
      try {
        const st = await fsp.stat(p); const key = keyOf(p, st);
        const info = await probe(p); if (!info) { toast(`${path.basename(p)} não tem som.`); continue; }
        await makePeaks(p, key);
        const url = await playable(p, key);
        out.push({ id: newId(), path: p, name: path.basename(p), dur: info.dur, ch: info.ch, key, url });
      } catch (e) { toast(`Não consegui abrir ${path.basename(p)}: ${e.message}`); }
    }
    send('busy', '');
    return out;
  }
  async function peaks(src) {
    const p = abs(src && src.path); if (!p) return null;
    let key = str(src.key, 40);
    try { const st = await fsp.stat(p); key = keyOf(p, st); } catch (e) { return null; }
    const f = await makePeaks(p, key).catch(() => null);
    return f ? fsp.readFile(f) : null;
  }
  // pausas (silêncios) de um ficheiro: [[início, fim], …] em segundos do ficheiro
  async function silences(p, minDur, noise) {
    p = abs(p); if (!p) return [];
    const err = await ff(['-i', p, '-vn', '-af', `silencedetect=noise=${num(noise, -38, -80, -10)}dB:d=${num(minDur, 1, 0.2, 10)}`, '-f', 'null', '-']).catch(e => e.stderr || '');
    const out = []; let s = null;
    for (const line of String(err).split('\n')) {
      let m;
      if ((m = /silence_start: (-?[\d.]+)/.exec(line))) s = Math.max(0, +m[1]);
      else if ((m = /silence_end: ([\d.]+)/.exec(line)) && s != null) { out.push([s, +m[1]]); s = null; }
    }
    return out;
  }

  /* ---------- mistura (para ouvir um bocado com os efeitos e para exportar) ---------- */
  function graph(p, w0, w1, o) {
    const inputs = [], chains = [], trackOut = {};
    const solo = p.tracks.some(t => t.solo && t.clips.length);
    const live = p.tracks.filter(t => t.clips.length && !t.mute && (!solo || t.solo));
    const dur = Math.max(0.05, w1 - w0);
    for (const t of live) {
      const labs = [];
      for (const c of t.clips) {
        const len = c.out - c.in, a = c.at, b = c.at + len;
        const t0 = Math.max(a, w0), t1 = Math.min(b, w1);
        if (t1 - t0 < 0.002) continue;
        const s = p.sources[c.src]; if (!s) continue;
        const k = inputs.length;
        inputs.push(['-ss', (c.in + (t0 - a)).toFixed(4), '-t', (t1 - t0).toFixed(4), '-i', s.path]);
        const off = t0 - a, L = len.toFixed(4), r0 = c.ramp ? c.ramp[0] : 1, r1 = c.ramp ? c.ramp[1] : 1;
        // ganho do pedaço × rampa (fade) × microfade de 6 ms nas pontas (sem estalidos nos cortes)
        const vol = `${c.gain.toFixed(4)}*(${r0}+(${r1 - r0})*(t+${off.toFixed(4)})/${L})*min(1\\,(t+${off.toFixed(4)})/0.006)*min(1\\,(${L}-t-${off.toFixed(4)})/0.006)`;
        const lab = `c${k}`;
        chains.push(`[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume='${vol}':eval=frame,adelay=${Math.round((t0 - w0) * 1000)}:all=1[${lab}]`);
        labs.push(`[${lab}]`);
      }
      if (!labs.length) continue;
      const mix = labs.length === 1 ? `${labs[0]}anull` : `${labs.join('')}amix=inputs=${labs.length}:normalize=0:dropout_transition=0`;
      let fx = `,volume=${t.gain.toFixed(3)}`;
      if (t.kind === 'voice' && o.denoise) fx += `,afftdn=nr=${Math.round(6 + o.denoiseAmount * 24)}:nf=-30:tn=1,highpass=f=70`;
      chains.push(`${mix}${fx}[t_${t.id}]`);
      trackOut[t.id] = `[t_${t.id}]`;
    }
    const names = Object.keys(trackOut);
    if (!names.length) { chains.push(`anullsrc=r=48000:cl=stereo,atrim=0:${dur.toFixed(3)}[mix]`); }
    else {
      const music = p.tracks.find(t => t.id === 'musica');
      // a música baixa sozinha quando há voz
      if (trackOut.musica && trackOut.voz && music && music.duck) {
        chains.push(`${trackOut.voz}asplit=2[vz][vsc]`);
        chains.push(`${trackOut.musica}[vsc]sidechaincompress=threshold=0.02:ratio=12:attack=30:release=600:knee=4[mz]`);
        trackOut.voz = '[vz]'; trackOut.musica = '[mz]';
      }
      const ins = Object.values(trackOut);
      chains.push(`${ins.join('')}${ins.length === 1 ? 'anull' : `amix=inputs=${ins.length}:normalize=0:dropout_transition=0`},apad,atrim=0:${dur.toFixed(3)}[pre]`);
      const lufs = o.loudness === 'radio' ? -23 : o.loudness === 'podcast' ? -16 : null;
      chains.push(lufs ? `[pre]loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=48000[mix]` : `[pre]alimiter=limit=0.97:level=false[mix]`);
    }
    return { args: inputs.flat(), filter: chains.join(';\n'), dur };
  }
  const projEnd = p => Math.max(0, ...p.tracks.map(t => Math.max(0, ...t.clips.map(c => c.at + c.out - c.in))));
  async function runGraph(p, w0, w1, o, outArgs, outPath, onProg, proc) {
    const g = graph(p, w0, w1, o);
    const script = path.join(CACHE, 'grafo-' + process.pid + '-' + Date.now() + '.txt');
    await fsp.writeFile(script, g.filter);
    try {
      await ff(['-v', 'error', '-stats_period', '0.5', '-progress', 'pipe:2', '-y', ...g.args, '-filter_complex_script', script, '-map', '[mix]', ...outArgs, outPath], {
        proc, onErr: s => { const m = /out_time_us=(\d+)/.exec(s); if (m && onProg) onProg(Math.min(1, (+m[1] / 1e6) / g.dur)); }
      });
    } finally { fsp.unlink(script).catch(() => {}); }
  }
  // ouvir uns segundos a partir de um ponto, com a limpeza e o volume final
  async function preview(p, t, len) {
    p = clean(p);
    const w0 = num(t, 0, 0), w1 = Math.min(projEnd(p), w0 + num(len, 10, 2, 60));
    if (w1 - w0 < 0.2) return null;
    const out = path.join(CACHE, 'ouvir-' + Date.now() + '.m4a');
    for (const f of await fsp.readdir(CACHE).catch(() => [])) if (/^ouvir-/.test(f)) fsp.unlink(path.join(CACHE, f)).catch(() => {});
    await runGraph(p, w0, w1, { denoise: p.settings.denoise, denoiseAmount: p.settings.denoiseAmount, loudness: p.settings.loudness }, ['-c:a', 'aac', '-b:a', '192k'], out);
    return pathToFileURL(out).href;
  }
  let exportProc = null;
  const FORMATS = { mp3: ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3'], m4a: ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'], wav: ['-c:a', 'pcm_s24le'] };
  async function exportProject(p, o) {
    p = clean(p); o = o || {};
    const fmt = FORMATS[o.fmt] ? o.fmt : 'mp3';
    const sel = Array.isArray(o.range) && o.range[1] - o.range[0] > 0.1 ? [num(o.range[0], 0, 0), num(o.range[1], 0, 0)] : null;
    const w0 = sel ? sel[0] : 0, w1 = sel ? sel[1] : projEnd(p);
    if (w1 - w0 < 0.1) return { error: 'O projeto está vazio.' };
    const first = (p.tracks[0].clips[0] && p.sources[p.tracks[0].clips[0].src]) || Object.values(p.sources)[0];
    const dir = first ? path.dirname(first.path) : app.getPath('music');
    const base = (p.name || 'Eco').replace(/\s*\(edição\)\s*$/i, '').replace(/[\/\\:]/g, '-').slice(0, 120) + (sel ? ' — excerto' : ' — editado');
    const r = !app.isPackaged && process.env.ZEUS_TEST_SAVE ? { filePath: path.join(process.env.ZEUS_TEST_SAVE, `${base}.${fmt}`) }   // testes, sem janela
      : await dialog.showSaveDialog(x.getWin(), { title: 'Exportar áudio', defaultPath: path.join(dir, `${base}.${fmt}`), filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    let out = r.filePath; if (extOf(out) !== fmt) out += '.' + fmt;
    const tmp = out + '.a-exportar.' + fmt;
    send('export', { pct: 0 });
    try {
      await runGraph(p, w0, w1, { denoise: p.settings.denoise, denoiseAmount: p.settings.denoiseAmount, loudness: o.loudness === false ? 'off' : p.settings.loudness },
        [...FORMATS[fmt], '-metadata', `title=${p.name}`], tmp, pct => send('export', { pct }), pr => { exportProc = pr; });
      await fsp.rename(tmp, out);
    } catch (e) {
      fsp.unlink(tmp).catch(() => {});
      exportProc = null;
      if (e.code === null || /SIGTERM|signal/i.test(String(e.message))) return { canceled: true };
      return { error: 'Não foi possível exportar: ' + e.message };
    }
    exportProc = null;
    p.lastExport = out; await saveProject(p);
    send('export', { pct: 1 });
    if (o.orfeu && x.openInOrfeu) x.openInOrfeu([out]);
    toast(`Exportado: ${path.basename(out)}`);
    return { path: out, name: path.basename(out) };
  }

  /* ---------- ligações à página ---------- */
  h('theme', () => (x.isDark() ? 'dark' : 'light'));
  h('projects', () => listProjects());
  h('load', id => loadProject(str(id, 40)));
  h('save', p => (p && typeof p === 'object' ? saveProject(p) : null));
  h('create', (name, paths) => createProject(str(name, 140), Array.isArray(paths) ? paths : []));
  h('remove', async id => { await fsp.unlink(pFile(str(id, 40))).catch(() => {}); return listProjects(); });
  h('chooseFiles', async () => {
    const r = await dialog.showOpenDialog(x.getWin(), { title: 'Juntar áudio ao projeto', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Áudio e vídeo', extensions: MEDIA_EXT }] });
    return r.canceled ? [] : addFiles(r.filePaths);
  });
  h('addFiles', paths => addFiles(paths));
  h('peaks', src => peaks(src));
  h('silences', (p, minDur) => silences(p, minDur));
  h('preview', (p, t, len) => preview(p, t, len).catch(e => ({ error: e.message })));
  h('export', (p, o) => exportProject(p, o).catch(e => ({ error: e.message })));
  h('cancelExport', () => { if (exportProc) { try { exportProc.kill('SIGTERM'); } catch (e) { /* ok */ } } return true; });
  h('reveal', p => { p = abs(p); if (p && exists(p)) shell.showItemInFolder(p); return true; });
  h('openOrfeu', p => { p = abs(p); if (p && exists(p) && x.openInOrfeu) x.openInOrfeu([p]); return true; });

  // abrir ficheiros num projeto novo (a partir do Orfeu ou do Hermes)
  async function openFiles(paths) {
    const p = await createProject('', paths);
    if (!p || !p.tracks[0].clips.length) return null;
    x.show();
    const go = () => send('open', p.id);
    const w = wc(); if (w && !w.isLoading()) setTimeout(go, 150); else setTimeout(go, 1500);
    return p.id;
  }
  return { openFiles, isAudio: p => MEDIA_EXT.includes(extOf(p)) };
}

module.exports = { setupEco };

'use strict';
/*
 * Descarregar vídeos (YouTube e mais de mil outros sites) com o yt-dlp, que vai dentro do Zeus.
 * O ffmpeg do Orfeu junta imagem e som e converte o áudio. Usa a sessão do Zeus (cookies) para os vídeos que pedem login.
 * O yt-dlp atualiza-se sozinho uma vez por semana (o YouTube muda muitas vezes e estraga versões antigas).
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');

// sites de vídeo conhecidos (o botão aparece logo); nas outras páginas aparece se houver um <video>
const VIDEO_SITES = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com\/(watch|shorts\/|live\/|embed\/)|youtu\.be\/|vimeo\.com\/\d|player\.vimeo\.com\/video|(x|twitter)\.com\/[^/]+\/status\/|instagram\.com\/(p|reels?|tv)\/|facebook\.com\/.*(videos?|watch|reel)|fb\.watch\/|tiktok\.com\/@[^/]+\/video|linkedin\.com\/(posts|feed\/update)|dailymotion\.com\/video|soundcloud\.com\/[^/]+\/[^/?]+|twitch\.tv\/(videos\/|[^/]+\/clip)|rtp\.pt\/play|bsky\.app\/profile\/[^/]+\/post|threads\.(net|com)\/@[^/]+\/post|reddit\.com\/r\/[^/]+\/comments)/i;

function setupVideoDL(x) {
  const { app, getSession, ui, toast, ffBin, downloads } = x;
  const UD = path.join(app.getPath('userData'), 'yt-dlp');
  fs.mkdirSync(UD, { recursive: true });
  const bundled = () => process.env.ZEUS_YTDLP || (app.isPackaged ? path.join(process.resourcesPath, 'yt-dlp', 'yt-dlp') : path.join(__dirname, '..', 'vendor', 'yt-dlp', 'yt-dlp'));
  const local = path.join(UD, 'yt-dlp');
  const STAMP = path.join(UD, 'atualizado.json');
  // usa-se uma cópia na pasta do Zeus, para se poder atualizar sem mexer na app
  function bin() {
    if (process.env.ZEUS_YTDLP) return process.env.ZEUS_YTDLP;
    const b = bundled();
    try {
      const bs = fs.statSync(b);
      let copy = !fs.existsSync(local);
      if (!copy) { const st = JSON.parse(fs.readFileSync(STAMP, 'utf8') || '{}'); copy = st.bundledMtime !== bs.mtimeMs && !st.updated; }
      if (copy) { fs.copyFileSync(b, local); fs.chmodSync(local, 0o755); fs.writeFileSync(STAMP, JSON.stringify({ bundledMtime: bs.mtimeMs, at: Date.now() })); }
    } catch (e) { if (!fs.existsSync(local)) return null; }
    return local;
  }
  const available = () => !!bin();
  // atualização semanal do yt-dlp (em segundo plano)
  function weeklyUpdate() {
    if (process.env.ZEUS_YTDLP) return;
    let st = {}; try { st = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch (e) { /* ok */ }
    if (Date.now() - (st.checked || 0) < 7 * 864e5) return;
    const b = bin(); if (!b) return;
    execFile(b, ['-U', '--no-colors'], { timeout: 180000 }, (err, out) => {
      st.checked = Date.now(); if (!err && /Updated yt-dlp to|up to date/i.test(String(out))) st.updated = st.updated || /Updated/i.test(String(out));
      try { fs.writeFileSync(STAMP, JSON.stringify(st)); } catch (e) { /* ok */ }
    });
  }
  setTimeout(weeklyUpdate, 60000);

  /* ---------- cookies da sessão do Zeus (para vídeos que pedem login) ---------- */
  const siteOf = host => { const p = host.split('.').filter(Boolean); return p.slice(-2).join('.'); };
  async function cookieFile(url) {
    let host = ''; try { host = new URL(url).hostname; } catch (e) { return null; }
    const site = siteOf(host);
    const sites = new Set([site]);
    if (/youtube\.com|youtu\.be/.test(host)) { sites.add('youtube.com'); sites.add('google.com'); }
    if (/(^|\.)x\.com$|twitter\.com/.test(host)) { sites.add('x.com'); sites.add('twitter.com'); }
    let all = []; try { all = await getSession().cookies.get({}); } catch (e) { return null; }
    const mine = all.filter(c => { const d = (c.domain || '').replace(/^\./, ''); return [...sites].some(s => d === s || d.endsWith('.' + s)); });
    if (!mine.length) return null;
    const lines = ['# Netscape HTTP Cookie File', ...mine.map(c => [c.hostOnly ? c.domain.replace(/^\./, '') : (c.domain.startsWith('.') ? c.domain : '.' + c.domain), c.hostOnly ? 'FALSE' : 'TRUE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', c.expirationDate ? Math.floor(c.expirationDate) : 0, c.name, c.value].join('\t'))];
    const f = path.join(UD, 'cookies-' + process.pid + '-' + Date.now() + '.txt');
    await fsp.writeFile(f, lines.join('\n') + '\n', { mode: 0o600 });
    return f;
  }

  /* ---------- ver o que há no vídeo (título, qualidades, legendas) ---------- */
  function runJSON(args, ms) {
    return new Promise((resolve, reject) => {
      const b = bin(); if (!b) return reject(new Error('o programa de descarregar vídeos não está incluído nesta versão'));
      execFile(b, args, { timeout: ms, maxBuffer: 80e6 }, (err, out, errOut) => {
        if (err) { const m = String(errOut || err.message).split('\n').filter(l => /ERROR/.test(l)).pop() || String(errOut || err.message).trim().split('\n').pop(); return reject(new Error(friendly(m))); }
        try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('resposta ilegível')); }
      });
    });
  }
  function friendly(m) {
    m = String(m || '').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '');
    if (/Unsupported URL/i.test(m)) return 'Não encontrei nenhum vídeo nesta página.';
    if (/DRM/i.test(m)) return 'Este vídeo está protegido contra cópia (DRM) e não se pode descarregar.';
    if (/Sign in|login|log in|cookies/i.test(m)) return 'Este vídeo pede sessão iniciada. Entra no site no Zeus e tenta outra vez.';
    if (/Private video|private/i.test(m)) return 'Este vídeo é privado.';
    if (/not available|unavailable|removed/i.test(m)) return 'Este vídeo não está disponível.';
    if (/timed out|timeout/i.test(m)) return 'O site demorou demasiado a responder.';
    return m.slice(0, 200) || 'Não foi possível ler o vídeo.';
  }
  async function probe(url) {
    const ck = await cookieFile(url);
    try {
      const j = await runJSON(['-J', '--no-playlist', '--no-warnings', '--no-colors', ...(ck ? ['--cookies', ck] : []), url], 90000);
      const info = j._type === 'playlist' && j.entries && j.entries[0] ? j.entries[0] : j;
      const fmts = info.formats || [info];
      // vcodec desconhecido (sites simples com um <video>): conta como vídeo com som
      const vids = fmts.filter(f => f.vcodec !== 'none' && f.video_ext !== 'none');
      const auds = fmts.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
      const dur = info.duration || 0;
      const size = f => f && (f.filesize || f.filesize_approx || (f.tbr && dur ? Math.round(f.tbr * 125 * dur) : 0)) || 0;
      const bestA = auds.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];
      const heights = [...new Set(vids.map(f => f.height).filter(Boolean))].sort((a, b) => b - a);
      const estFor = h => { const v = vids.filter(f => !h || (f.height || 0) <= h).sort((a, b) => b.height - a.height || size(b) - size(a))[0]; return v ? size(v) + (v.acodec && v.acodec !== 'none' ? 0 : size(bestA)) : 0; };
      const subs = Object.keys(info.subtitles || {}).filter(k => k !== 'live_chat');
      const auto = Object.keys(info.automatic_captions || {});
      const pick = list => list.filter(l => /^(pt|en)/i.test(l));
      return {
        ok: true, title: info.title || 'Vídeo', uploader: info.uploader || info.channel || '', site: /^(Generic|HTML5MediaEmbed)$/i.test(info.extractor_key || '') ? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })() : (info.extractor_key || ''), duration: info.duration || 0,
        thumb: info.thumbnail || '', heights, top: heights[0] || 0,
        sizes: Object.fromEntries([heights[0] || 0, 1080, 720, 480].map(h => [h, estFor(h)])),
        audioSize: size(bestA) || (info.duration ? Math.round(info.duration * 16000) : 0),
        audioOnly: !vids.length,
        subs: [...new Set([...pick(subs), ...pick(auto)])].slice(0, 6), subsAuto: !pick(subs).length && pick(auto).length > 0
      };
    } finally { if (ck) fsp.unlink(ck).catch(() => {}); }
  }

  /* ---------- descarregar (aparece nas Transferências do Zeus) ---------- */
  const procs = new Map();   // id -> processo
  const runs = new Map();    // id -> { url, choice } (para "Tentar de novo")
  function argsFor(choice) {
    const c = choice || {};
    const h = +c.height || 0;
    if (c.kind === 'mp3') return ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail', '--embed-metadata'];
    if (c.kind === 'm4a') return ['-f', 'ba[ext=m4a]/ba/b', '-x', '--audio-format', 'm4a', '--embed-thumbnail', '--embed-metadata'];
    // vídeo: MP4; a igualdade de resolução, H.264 + AAC (abre em todo o lado: QuickTime, Keynote, redes sociais)
    return ['-f', 'bv*+ba/b', '-S', h ? `res:${h},vcodec:h264,acodec:aac` : 'res,fps,vcodec:h264,acodec:aac', '--merge-output-format', 'mp4', '--remux-video', 'mp4', '--embed-metadata'];
  }
  async function download(url, choice, reuseId) {
    const b = bin(); if (!b) return { error: 'O programa de descarregar vídeos não está incluído nesta versão.' };
    const dir = x.downloadsDir();
    const id = reuseId || ('v' + Date.now().toString(36));
    const title = String((choice && choice.title) || 'Vídeo').slice(0, 160);
    const ext = choice && (choice.kind === 'mp3' || choice.kind === 'm4a') ? choice.kind : 'mp4';
    const d = downloads.add({ id, url, page: url, name: `${title}.${ext}`, path: '', mime: ext === 'mp4' ? 'video/mp4' : 'audio/' + ext, total: 0, received: 0, video: { url, choice }, note: 'A preparar…' });
    runs.set(id, { url, choice });
    const ck = await cookieFile(url);
    const tmp = path.join(UD, 'a-descarregar-' + id);   // ficheiros intermédios (apagados no fim ou ao cancelar)
    const args = ['--no-playlist', '--no-colors', '--newline', '--progress', '--no-mtime', '--concurrent-fragments', '4',
      '--ffmpeg-location', ffBin(), '-P', dir, '-P', 'temp:' + tmp, '-o', '%(title).150B.%(ext)s', '--replace-in-metadata', 'title', '\\s*[:|/\\\\]\\s*', ' - ',
      '--progress-template', 'download:ZEUSP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(info.format_id)s',
      '--print', 'after_move:ZEUSF %(filepath)s',
      ...argsFor(choice),
      ...(choice && choice.subs ? ['--write-subs', '--write-auto-subs', '--sub-langs', 'pt.*,pt,en.*,en', '--convert-subs', 'srt'] : []),
      ...(ck ? ['--cookies', ck] : []), url];
    const p = spawn(b, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    procs.set(id, p);
    let finalPath = '', errTail = '', parts = 0, lastFmt = '';
    const onLine = line => {
      let m;
      if ((m = /^ZEUSP (\S+) (\S+) (\S+) (\S+) (\S+)/.exec(line))) {
        if (m[5] !== lastFmt) { lastFmt = m[5]; parts++; }
        const got = +m[1] || 0, tot = +m[2] || +m[3] || 0, sp = +m[4] || 0;
        d.received = got; d.total = tot;
        d.note = (parts > 1 ? 'A descarregar o som' : 'A descarregar') + (sp ? ` · ${(sp / 1e6).toFixed(1).replace('.', ',')} MB/s` : '');
        downloads.update(d);
      } else if (/^ZEUSF /.test(line)) finalPath = line.slice(6).trim();
      else if (/\[Merger\]|\[VideoRemuxer\]/.test(line)) { d.note = 'A juntar imagem e som…'; d.total = 0; downloads.update(d); }
      else if (/\[ExtractAudio\]/.test(line)) { d.note = 'A converter o áudio…'; d.total = 0; downloads.update(d); }
      else if (/\[EmbedThumbnail\]|\[Metadata\]/.test(line)) { d.note = 'A terminar…'; downloads.update(d); }
    };
    let buf = '';
    p.stdout.on('data', ch => { buf += ch; const ls = buf.split('\n'); buf = ls.pop(); ls.forEach(onLine); });
    p.stderr.on('data', ch => { errTail = (errTail + ch).slice(-3000); });
    p.on('close', code => {
      procs.delete(id); if (ck) fsp.unlink(ck).catch(() => {});
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      if (buf) onLine(buf);
      if (d.state === 'cancelled') { downloads.done(d, 'cancelled'); return; }
      if (code === 0 && finalPath && fs.existsSync(finalPath)) {
        d.path = finalPath; d.name = path.basename(finalPath);
        try { d.total = d.received = fs.statSync(finalPath).size; } catch (e) { /* ok */ }
        d.note = '';
        downloads.done(d, 'completed');
        toast(`Vídeo descarregado: ${d.name}`);
      } else {
        d.note = friendly(errTail.split('\n').filter(l => /ERROR/.test(l)).pop() || errTail.trim().split('\n').pop());
        downloads.done(d, 'interrupted');
        toast('Não foi possível descarregar o vídeo: ' + d.note);
      }
    });
    p.on('error', () => { d.note = 'Não foi possível começar.'; downloads.done(d, 'interrupted'); });
    return { id };
  }
  function cancel(id) { const p = procs.get(id); if (!p) return false; const d = downloads.get(id); if (d) d.state = 'cancelled'; try { p.kill('SIGTERM'); } catch (e) { /* ok */ } return true; }
  function retry(id, d) { const r = runs.get(id) || (d && d.video); if (!r || !r.url) return false; download(r.url, r.choice, id); return true; }

  return { probe, download, cancel, retry, available, isVideoSite: url => VIDEO_SITES.test(String(url || '')), owns: id => procs.has(id) || runs.has(id) };
}

module.exports = { setupVideoDL, VIDEO_SITES };

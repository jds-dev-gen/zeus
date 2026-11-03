'use strict';
/* Orfeu — biblioteca e leitor de áudio e vídeo do Zeus. */
const O = window.orfeuApp;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const SPEEDS = [0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2];
const media = $('#media');

let LIB = { items: [], queue: [], folders: [], ffmpeg: true, convSize: 0 };
let view = 'recent';             // recent | queue | audio | video | marks | f:<pasta>
let folderItems = null;          // ficheiros da pasta aberta
let cur = null;                  // ficheiro a tocar
let peaks = null;
let q = '';
let jobs = [];
let clipIn = null, clipOut = null;
let editingMark = -1;

function clock(t) {
  t = Math.max(0, Math.floor(+t || 0));
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
}
function when(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date(), diff = (now - d) / 60000;
  if (diff < 60) return diff < 1 ? 'agora' : `há ${Math.floor(diff)} min`;
  if (d.toDateString() === now.toDateString()) return 'hoje';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'ontem';
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }).replace('.', '');
}
const fmtOf = it => (it.name.split('.').pop() || '').toUpperCase();
const CODECS = { h264: 'H.264', hevc: 'HEVC (H.265)', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', mpeg4: 'MPEG-4', msmpeg4v3: 'DivX', wmv3: 'WMV', prores: 'ProRes', mpeg2video: 'MPEG-2', aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', ac3: 'AC3', eac3: 'E-AC3', dts: 'DTS', wmav2: 'WMA', amr_nb: 'AMR' };
const codec = c => CODECS[c] || (/^pcm_/.test(c) ? 'PCM' : String(c || '').toUpperCase());
const chans = c => { c = String(c || ''); return c === 'mono' || c === '1' ? 'mono' : c === 'stereo' || c === '2' ? 'estéreo' : /5\.1/.test(c) ? '5.1' : ''; };
const sizeTxt = b => b > 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB';

/* ================================================================== */
/* Biblioteca                                                           */
/* ================================================================== */
async function load() {
  LIB = (await O.library()) || LIB;
  renderSide();
  if (view.startsWith('f:')) await openFolder(view.slice(2), true); else renderList();
}
const ICON = {
  recent: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  queue: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  audio: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  video: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
  marks: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  folder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  wave: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"/></svg>'
};
function renderSide() {
  const it = LIB.items;
  const f = (id, icon, name, count, extra = '') => `<button class="f ${view === id ? 'on' : ''} ${extra}" type="button" data-view="${esc(id)}">${icon}<span class="n">${esc(name)}</span>${count != null ? `<span class="c">${count || ''}</span>` : ''}</button>`;
  $('#side').innerHTML =
    f('recent', ICON.recent, 'Recentes', it.length) +
    f('queue', ICON.queue, 'Fila', LIB.queue.length) +
    f('audio', ICON.audio, 'Áudio', it.filter(i => i.kind === 'audio').length) +
    f('video', ICON.video, 'Vídeo', it.filter(i => i.kind === 'video').length) +
    f('marks', ICON.marks, 'Com marcas', it.filter(i => (i.marks || []).length).length) +
    `<div class="lbl">Pastas</div>` +
    LIB.folders.map(p => `<div class="f ${view === 'f:' + p.path ? 'on' : ''} ${p.exists ? '' : 'gone'}" role="button" tabindex="0" data-view="${esc('f:' + p.path)}" title="${esc(p.path)}">${ICON.folder}<span class="n">${esc(p.name)}</span><button class="ico x" type="button" data-unfolder="${esc(p.path)}" title="Tirar esta pasta do Orfeu (os ficheiros ficam onde estão)">✕</button></div>`).join('') +
    `<button class="addf" type="button" id="addFolder">+ Juntar pasta do Mac</button>` +
    `<div class="foot">${LIB.ffmpeg ? 'Lê todos os formatos (com o ffmpeg).' : 'Sem o ffmpeg: só os formatos comuns.'}${LIB.convSize > 50e6 ? `<br>Conversões guardadas: ${sizeTxt(LIB.convSize)} · <button type="button" id="clearConv">limpar</button>` : ''}</div>`;
}
$('#side').addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('#addFolder')) { const f = await O.addFolder(); if (f) { view = 'f:' + f; await load(); } return; }
  if (t.closest('#clearConv')) { await O.clearConv(); return load(); }
  const un = t.closest('[data-unfolder]');
  if (un) { e.stopPropagation(); await O.removeFolder(un.dataset.unfolder); if (view === 'f:' + un.dataset.unfolder) view = 'recent'; return load(); }
  const v = t.closest('[data-view]'); if (!v) return;
  view = v.dataset.view; folderItems = null;
  renderSide();
  if (view.startsWith('f:')) openFolder(view.slice(2)); else renderList();
});
async function openFolder(p, quiet) {
  if (!quiet) $('#list').innerHTML = '<div class="none">A ler a pasta…</div>';
  folderItems = (await O.folder(p)) || [];
  if (view === 'f:' + p) renderList();
}
function listItems() {
  let items;
  if (view === 'queue') items = LIB.queue.map(id => LIB.items.find(i => i.id === id)).filter(Boolean);
  else if (view.startsWith('f:')) items = folderItems || [];
  else {
    items = [...LIB.items].sort((a, b) => (b.lastPlayed || b.added || 0) - (a.lastPlayed || a.added || 0));
    if (view === 'audio') items = items.filter(i => i.kind === 'audio');
    if (view === 'video') items = items.filter(i => i.kind === 'video');
    if (view === 'marks') items = items.filter(i => (i.marks || []).length);
  }
  if (q) { const w = fold(q).split(/\s+/).filter(Boolean); items = items.filter(i => w.every(x => fold(i.name + ' ' + (i.folder || '') + ' ' + (i.marks || []).map(m => m.text).join(' ')).includes(x))); }
  return items;
}
function renderList() {
  const items = listItems();
  if (!items.length) {
    $('#list').innerHTML = `<div class="none">${q ? `Nada encontrado para “${esc(q)}”.` : view === 'queue' ? 'A fila está vazia.<br>Passa o rato por um ficheiro e carrega em <b>+</b> para o pôr na fila.' : view.startsWith('f:') ? 'Não há áudio nem vídeo nesta pasta.' : 'Ainda não abriste nada.<br>Arrasta ficheiros para aqui ou carrega em <b>Abrir…</b>'}</div>`;
    return;
  }
  const inQueue = new Set(LIB.queue);
  $('#list').innerHTML = items.slice(0, 600).map((i, k) => {
    const pct = i.duration && i.pos ? Math.min(100, i.pos / i.duration * 100) : 0;
    const sub = [i.folder, fmtOf(i), i.done ? 'terminado' : i.pos > 5 ? 'parado em ' + clock(i.pos) : when(i.lastPlayed || i.mtime)].filter(Boolean).join(' · ');
    const ops = view === 'queue'
      ? `<button class="ico" type="button" data-qup="${k}" title="Subir">↑</button><button class="ico" type="button" data-qdel="${esc(i.id)}" title="Tirar da fila">✕</button>`
      : `${inQueue.has(i.id) ? '' : `<button class="ico" type="button" data-qadd="${esc(i.id)}" title="Pôr na fila">+</button>`}${view.startsWith('f:') ? '' : `<button class="ico" type="button" data-forget="${esc(i.id)}" title="Tirar dos recentes (o ficheiro fica onde está)">✕</button>`}`;
    return `<div class="it ${cur && cur.id === i.id ? 'on' : ''} ${i.exists === false ? 'gone' : ''}" role="button" tabindex="0" data-id="${esc(i.id)}" data-path="${esc(i.path)}">
      <span class="th" style="${i.thumb ? `background-image:url('${esc(i.thumb).replace(/'/g, '%27')}')` : ''}">${i.thumb ? '' : i.kind === 'video' ? ICON.video : ICON.wave}${i.duration ? `<span class="d">${clock(i.duration)}</span>` : ''}</span>
      <span class="m"><b>${esc(i.name)}</b><small>${esc(sub)}</small>${pct > 1 ? `<span class="prog ${i.done ? 'done' : ''}"><i style="width:${i.done ? 100 : pct}%"></i></span>` : ''}</span>
      <span class="ops">${ops}</span></div>`;
  }).join('');
}
$('#list').addEventListener('click', async e => {
  const t = e.target;
  const qa = t.closest('[data-qadd]'); if (qa) { e.stopPropagation(); let id = qa.dataset.qadd; if (view.startsWith('f:')) { const it = await O.ensure(t.closest('[data-path]').dataset.path); if (!it) return; id = it.id; } await O.setQueue([...LIB.queue, id]); return load(); }
  const qd = t.closest('[data-qdel]'); if (qd) { e.stopPropagation(); await O.setQueue(LIB.queue.filter(i => i !== qd.dataset.qdel)); return load(); }
  const qu = t.closest('[data-qup]'); if (qu) { e.stopPropagation(); const k = +qu.dataset.qup; if (k > 0) { const a = [...LIB.queue]; [a[k - 1], a[k]] = [a[k], a[k - 1]]; await O.setQueue(a); load(); } return; }
  const fg = t.closest('[data-forget]'); if (fg) { e.stopPropagation(); await O.forget(fg.dataset.forget); return load(); }
  const b = t.closest('[data-id]'); if (!b) return;
  if (view.startsWith('f:')) { const it = await O.ensure(b.dataset.path); if (it) play(it.id); return; }
  if (view === 'queue') await O.setQueue(LIB.queue.filter(i => i !== b.dataset.id));
  play(b.dataset.id);
});
$('#list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.it')) e.target.click(); });
$('#q').addEventListener('input', e => { q = e.target.value.trim(); renderList(); });
$('#q').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; q = ''; renderList(); e.target.blur(); } });

/* ================================================================== */
/* Tocar                                                                */
/* ================================================================== */
let saveT = null, lastSaved = 0, wantPlay = false;
async function play(id, opts = {}) {
  savePos();
  const it = await O.item(id); if (!it) return;
  if (!it.exists) { cur = it; showPlayer(); $('#prep').hidden = false; $('#prep').innerHTML = `<div><b>O ficheiro já não está aqui</b>${esc(it.path)}<br>Foi mudado de sítio ou apagado.</div>`; return; }
  cur = it; peaks = null; clipIn = clipOut = null; $('#clip').hidden = true; editingMark = -1;
  // só começa a tocar quando se carrega em play (a fila, depois de começada, continua sozinha)
  wantPlay = opts.autoplay === true;
  O.touch(id);
  showPlayer();
  renderList();
  // formato que o Zeus não lê: converte primeiro (fica guardado para a próxima vez)
  if (!it.playable && !it.conv) return prepare();
  setSource();
  O.wave(it.id).then(p => { if (cur && cur.id === it.id) { peaks = p; drawWave(); } });
}
function setSource() {
  $('#prep').hidden = true;
  media.src = cur.url;
  // legendas com o mesmo nome do ficheiro, se houver
  clearSubs();
  if (cur.kind === 'video') O.subs(cur.id).then(s => { if (s) addSubs(s); });
}
async function prepare() {
  const it = cur;
  if (!LIB.ffmpeg) { $('#prep').hidden = false; $('#prep').innerHTML = `<div><b>Formato que o Zeus não lê</b>${esc(fmtOf(it))} ${it.video ? '(' + esc(it.video) + ')' : ''} — precisa do ffmpeg, que não está incluído nesta versão.</div>`; return; }
  $('#prep').hidden = false; $('#prep').innerHTML = `<div><b>A preparar o ficheiro para tocar…</b>${esc(fmtOf(it))} não é lido diretamente pelo Zeus; fica convertido para a próxima vez.<div class="bar"><i id="prepBar" style="width:0%"></i></div></div>`;
  const r = await O.convert(it.id);
  if (!cur || cur.id !== it.id) return;
  if (!r) { $('#prep').innerHTML = `<div><b>Não foi possível preparar este ficheiro</b>${esc((jobs.find(j => j.id === it.id && j.error) || {}).error || '')}</div>`; return; }
  cur = r; setSource(); showPlayer();
  O.wave(it.id).then(p => { if (cur && cur.id === it.id) { peaks = p; drawWave(); } });
}
function showPlayer() {
  $('#empty').hidden = !!cur;
  if (!cur) return;
  const p = $('#player');
  p.classList.toggle('audio', cur.kind === 'audio');
  $('#pTitle').textContent = cur.name.replace(/\.[^.]+$/, '');
  $('#pMeta').textContent = [cur.folder, fmtOf(cur) + (cur.conv ? ' (convertido para o Zeus)' : ''), cur.duration ? clock(cur.duration) : '', cur.width ? cur.width + '×' + cur.height : ''].filter(Boolean).join(' · ');
  $('#sInfo').textContent = [cur.video ? codec(cur.video) : '', cur.audio ? codec(cur.audio) : '', cur.audio && cur.rate ? String(Math.round(cur.rate / 100) / 10).replace('.', ',') + ' kHz' : '', chans(cur.channels), cur.size ? sizeTxt(cur.size) : ''].filter(Boolean).join(' · ');
  renderMarks(); updateTimes(); drawWave(); renderPlayBtn(); requestAnimationFrame(fitVideo);
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: $('#pTitle').textContent, artist: cur.folder || 'Orfeu', album: 'Zeus' });
}
media.addEventListener('loadedmetadata', () => {
  if (!cur) return;
  if (!cur.duration && media.duration) cur.duration = media.duration;
  if (cur.pos > 5 && cur.pos < (cur.duration || media.duration) - 10 && !cur.done) { media.currentTime = cur.pos; msg('Retomado onde paraste'); }
  media.playbackRate = speed;
  if (wantPlay) media.play().catch(() => {});
});
// se o Zeus afinal não conseguir ler o ficheiro, tenta convertê-lo
media.addEventListener('error', () => { if (cur && !cur.conv && LIB.ffmpeg && media.src) { media.removeAttribute('src'); prepare(); } });
media.addEventListener('timeupdate', () => { updateTimes(); drawWave(); if (Date.now() - lastSaved > 5000) savePos(); });
media.addEventListener('play', renderPlayBtn);
media.addEventListener('pause', () => { renderPlayBtn(); savePos(); });
media.addEventListener('ended', async () => {
  if (cur) { await O.setPos(cur.id, 0, true); cur.done = true; cur.pos = 0; }
  renderPlayBtn();
  await load();
  const next = LIB.queue[0];
  if (next) { await O.setQueue(LIB.queue.slice(1)); await load(); play(next, { autoplay: true }); }
});
function savePos() { if (!cur || !media.src || !isFinite(media.currentTime) || media.currentTime < 1) return; lastSaved = Date.now(); cur.pos = media.currentTime; O.setPos(cur.id, media.currentTime, media.ended ? true : (media.currentTime > (media.duration || 1e9) - 5 ? true : false)); }
window.addEventListener('beforeunload', savePos);
document.addEventListener('visibilitychange', () => { if (document.hidden) savePos(); else load(); });
function updateTimes() {
  const d = media.duration || (cur && cur.duration) || 0, t = media.currentTime || 0;
  $('#tNow').textContent = clock(t);
  $('#tLeft').textContent = d ? '−' + clock(d - t) : '';
  $('#mAt').textContent = clock(t);
}
let msgT = null;
function msg(t) { $('#tMsg').textContent = t; clearTimeout(msgT); msgT = setTimeout(() => { $('#tMsg').textContent = ''; }, 3500); }
const PLAY = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
function renderPlayBtn() { $('#playBtn').innerHTML = media.paused ? PLAY : PAUSE; }
const toggle = () => { if (!cur || !media.src) return; if (media.paused) media.play().catch(() => {}); else media.pause(); };
const skip = s => { if (!media.src) return; media.currentTime = Math.max(0, Math.min((media.duration || 0) - 0.1, media.currentTime + s)); };
$('#playBtn').addEventListener('click', toggle);
document.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => skip(+b.dataset.skip)));
let speed = 1;
try { speed = +localStorage.getItem('orfeu.speed') || 1; } catch (e) { /* ok */ }
function setSpeed(v) { speed = v; media.playbackRate = v; $('#speed').textContent = String(v).replace('.', ',') + '×'; try { localStorage.setItem('orfeu.speed', v); } catch (e) { /* ok */ } }
setSpeed(speed);
$('#speed').addEventListener('click', e => {
  const b = e.currentTarget, r = b.getBoundingClientRect(), pop = $('#pop');
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.innerHTML = SPEEDS.map(v => `<button type="button" data-sp="${v}" class="${v === speed ? 'on' : ''}">${String(v).replace('.', ',')}×</button>`).join('');
  pop.hidden = false; pop.style.left = r.left + 'px'; pop.style.top = (r.top - pop.offsetHeight - 6) + 'px';
});
$('#pop').addEventListener('click', e => { const b = e.target.closest('[data-sp]'); if (b) { setSpeed(+b.dataset.sp); $('#pop').hidden = true; } });
document.addEventListener('mousedown', e => { if (!$('#pop').hidden && !e.target.closest('#pop') && !e.target.closest('#speed')) $('#pop').hidden = true; });
$('#vol').addEventListener('input', e => { media.volume = +e.target.value; try { localStorage.setItem('orfeu.vol', e.target.value); } catch (er) { /* ok */ } });
try { const v = localStorage.getItem('orfeu.vol'); if (v) { media.volume = +v; $('#vol').value = v; } } catch (e) { /* ok */ }
$('#pipBtn').addEventListener('click', () => { if (document.pictureInPictureElement) document.exitPictureInPicture(); else media.requestPictureInPicture().catch(() => {}); });
// tamanho do vídeo: o maior que cabe no espaço livre, mantendo a proporção do próprio vídeo
function fitVideo() {
  const box = $('#vbox'); if (!box || document.fullscreenElement) return;
  const W = box.clientWidth, H = box.clientHeight;
  const r = media.videoWidth && media.videoHeight ? media.videoWidth / media.videoHeight : (cur && cur.width && cur.height ? cur.width / cur.height : 16 / 9);
  let w = W, h = W / r;
  if (h > H) { h = H; w = H * r; }
  media.style.width = Math.max(0, Math.floor(w)) + 'px'; media.style.height = Math.max(0, Math.floor(h)) + 'px';
}
new ResizeObserver(fitVideo).observe($('#vbox'));
media.addEventListener('loadedmetadata', fitVideo);
media.addEventListener('resize', fitVideo);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { media.style.width = ''; media.style.height = ''; } fitVideo(); });
$('#fsBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else $('#vbox').requestFullscreen().catch(() => {}); });
$('#vbox').addEventListener('click', e => { if (e.target === media) toggle(); });
$('#vbox').addEventListener('dblclick', () => $('#fsBtn').click());
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => media.play());
  navigator.mediaSession.setActionHandler('pause', () => media.pause());
  navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
  navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
  navigator.mediaSession.setActionHandler('nexttrack', () => { const n = LIB.queue[0]; if (n) { O.setQueue(LIB.queue.slice(1)).then(load); play(n, { autoplay: true }); } });
}

/* ---------- legendas ---------- */
let subsUrl = null;
// tira as legendas do ficheiro anterior (desligar antes de remover: senão a última frase fica no ecrã)
function clearSubs() {
  for (const t of media.textTracks) t.mode = 'disabled';
  media.querySelectorAll('track').forEach(t => t.remove());
}
function addSubs(s) {
  clearSubs();
  if (subsUrl) URL.revokeObjectURL(subsUrl);
  subsUrl = URL.createObjectURL(new Blob([s.vtt], { type: 'text/vtt' }));
  const tr = document.createElement('track');
  tr.kind = 'subtitles'; tr.label = s.name; tr.srclang = 'pt'; tr.src = subsUrl; tr.default = true;
  media.appendChild(tr);
  setTimeout(() => { if (media.textTracks[0]) media.textTracks[0].mode = 'showing'; }, 50);
  msg('Legendas: ' + s.name);
}
$('#subsBtn').addEventListener('click', async () => { const p = await O.chooseSubs(); if (p) { const s = await O.subs(p); if (s) addSubs(s); } });

/* ---------- forma de onda / linha do tempo ---------- */
const cv = $('#wave');
function drawWave() {
  const box = $('#tl'); const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  const dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const cWave = css.getPropertyValue('--wave').trim(), cOn = css.getPropertyValue('--wave-on').trim(), cAcc = css.getPropertyValue('--accent').trim(), cSel = css.getPropertyValue('--sel').trim();
  const d = media.duration || (cur && cur.duration) || 0;
  const frac = d ? (media.currentTime || 0) / d : 0;
  const top = 16, hh = h - top - 2;
  // excerto escolhido
  if (d && clipIn != null) { const a = clipIn / d * w, b = (clipOut != null ? clipOut : media.currentTime) / d * w; g.fillStyle = cSel; g.fillRect(Math.min(a, b), 0, Math.abs(b - a), h); }
  if (peaks && peaks.length) {
    const bars = Math.max(20, Math.floor(w / 3));
    const bw = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = peaks[Math.min(peaks.length - 1, Math.floor(i / bars * peaks.length))] / 255;
      const bh = Math.max(2, v * hh);
      g.fillStyle = i / bars < frac ? cOn : cWave;
      g.fillRect(i * bw + 0.5, top + (hh - bh) / 2, Math.max(1, bw - 1.2), bh);
    }
  } else {
    // sem forma de onda (ainda): barra simples
    const y = top + hh / 2 - 2;
    g.fillStyle = cWave; g.fillRect(0, y, w, 4);
    g.fillStyle = cOn; g.fillRect(0, y, w * frac, 4);
  }
  // marcas
  if (cur && d) {
    g.font = '600 11px Geist, sans-serif'; g.textBaseline = 'top';
    (cur.marks || []).forEach(m => { const x = m.t / d * w; g.fillStyle = cAcc; g.fillRect(x - 1, top - 2, 2, hh + 2); if (w > 300) g.fillText(clock(m.t), Math.min(w - 40, x + 4), 0); });
  }
  // cabeça de leitura
  g.fillStyle = cOn; g.fillRect(Math.round(frac * w) - 1, top - 4, 2, hh + 6);
}
new ResizeObserver(() => drawWave()).observe($('#tl'));
let dragging = false;
const seekAt = e => { const r = $('#tl').getBoundingClientRect(); const d = media.duration || (cur && cur.duration) || 0; if (!d || !media.src) return; media.currentTime = Math.max(0, Math.min(d - 0.05, (e.clientX - r.left) / r.width * d)); updateTimes(); drawWave(); };
$('#tl').addEventListener('mousedown', e => { dragging = true; seekAt(e); });
window.addEventListener('mousemove', e => { if (dragging) seekAt(e); });
window.addEventListener('mouseup', () => { dragging = false; });

/* ---------- marcas ---------- */
function renderMarks() {
  const ms = (cur && cur.marks) || [];
  $('#mlist').innerHTML = ms.map((m, i) => i === editingMark
    ? `<div class="mk"><code>${clock(m.t)}</code><input data-medit="${i}" value="${esc(m.text)}"></div>`
    : `<div class="mk" data-mi="${i}"><code>${clock(m.t)}</code><span>${esc(m.text || '—')}</span><button class="ico" type="button" data-mren="${i}" title="Mudar o texto">✎</button><button class="ico" type="button" data-mdel="${i}" title="Apagar a marca">✕</button></div>`).join('');
  const ed = $('[data-medit]'); if (ed) { ed.focus(); ed.select(); }
  $('#aMarks').disabled = !ms.length;
}
async function saveMarks() { if (!cur) return; cur.marks = await O.setMarks(cur.id, cur.marks || []) || cur.marks; renderMarks(); drawWave(); load(); }
$('#mlist').addEventListener('click', e => {
  const del = e.target.closest('[data-mdel]'); if (del) { cur.marks.splice(+del.dataset.mdel, 1); return saveMarks(); }
  const ren = e.target.closest('[data-mren]'); if (ren) { editingMark = +ren.dataset.mren; return renderMarks(); }
  const m = e.target.closest('[data-mi]'); if (m && media.src) { media.currentTime = cur.marks[+m.dataset.mi].t; }
});
$('#mlist').addEventListener('keydown', e => {
  const i = e.target.dataset.medit; if (i == null) return;
  if (e.key === 'Enter') { cur.marks[+i].text = e.target.value.trim(); editingMark = -1; saveMarks(); }
  if (e.key === 'Escape') { editingMark = -1; renderMarks(); }
});
let markAt = null;
$('#mText').addEventListener('focus', () => { markAt = media.currentTime || 0; $('#mAt').textContent = clock(markAt); });
$('#madd').addEventListener('submit', e => {
  e.preventDefault(); if (!cur) return;
  const t = markAt != null ? markAt : media.currentTime || 0;
  cur.marks = [...(cur.marks || []), { t, text: $('#mText').value.trim() }];
  $('#mText').value = ''; markAt = null; $('#mText').blur();
  saveMarks(); msg('Marca em ' + clock(t));
});
$('#mText').addEventListener('keydown', e => { if (e.key === 'Escape') { $('#mText').value = ''; markAt = null; $('#mText').blur(); } });

/* ---------- excerto, áudio, Notas, Finder ---------- */
function renderClip() {
  $('#cIn').textContent = clipIn != null ? clock(clipIn) : '—';
  $('#cOut').textContent = clipOut != null ? clock(clipOut) : '—';
  $('#cLen').textContent = clipIn != null && clipOut != null && clipOut > clipIn ? 'duração ' + clock(clipOut - clipIn) : '';
  $('#cSave').disabled = !(clipIn != null && clipOut != null && clipOut > clipIn);
  drawWave();
}
const openClip = () => { if (!cur) return; $('#clip').hidden = false; if (clipIn == null) clipIn = media.currentTime || 0; renderClip(); };
$('#aClip').addEventListener('click', openClip);
$('#setIn').addEventListener('click', () => { clipIn = media.currentTime || 0; if (clipOut != null && clipOut <= clipIn) clipOut = null; renderClip(); });
$('#setOut').addEventListener('click', () => { clipOut = media.currentTime || 0; if (clipIn != null && clipOut <= clipIn) { const t = clipIn; clipIn = clipOut; clipOut = t; } renderClip(); });
$('#cClose').addEventListener('click', () => { $('#clip').hidden = true; clipIn = clipOut = null; drawWave(); });
$('#cSave').addEventListener('click', async () => { if (!cur) return; media.pause(); const r = await O.exportClip(cur.id, clipIn, clipOut, $('#cAudio').checked); if (r && r.error) msg(r.error); });
$('#aAudio').addEventListener('click', async () => { if (!cur) return; const r = await O.exportAudio(cur.id); if (r && r.error) msg(r.error); });
$('#aReveal').addEventListener('click', () => { if (cur) O.reveal(cur.id); });
$('#aMarks').addEventListener('click', async () => {
  if (!cur) return;
  const r = await O.marksToNote(cur.id);
  if (r && r.error) return msg(r.error);
  if (r && r.noteId) noteDone('As marcas estão numa nota nova', r.noteId);
});
$('#aTrans').addEventListener('click', async () => {
  if (!cur) return;
  $('#aTrans').disabled = true;
  const r = await O.transcribe(cur.id);
  $('#aTrans').disabled = false;
  if (r && r.error) return msg(r.error);
  if (r && r.noteId) noteDone('A transcrição vai ficar numa nota nova (o Whisper trabalha em segundo plano)', r.noteId);
});
function noteDone(text, noteId) {
  $('#sJob').innerHTML = `<span>${esc(text)}.</span><button type="button" id="goNote" style="text-decoration:underline;color:var(--fg)">Abrir nas Notas</button>`;
  $('#goNote').onclick = () => O.openNotes(noteId);
}

/* ---------- trabalhos do ffmpeg ---------- */
O.onJobs(j => {
  jobs = j || [];
  const live = jobs.filter(x => !x.error && x.pct < 100);
  const err = jobs.find(x => x.error);
  const done = jobs.find(x => x.pct >= 100 && !x.error);
  const pb = $('#prepBar'); const cj = cur && jobs.find(x => x.kind === 'conv' && x.id === cur.id); if (pb && cj) pb.style.width = cj.pct + '%';
  if (live.length) $('#sJob').innerHTML = `<span>${esc(live[0].label)}… ${live[0].pct}%</span><span class="bar"><i style="width:${live[0].pct}%"></i></span>`;
  else if (err) $('#sJob').innerHTML = `<span class="err">${esc(err.label)}: ${esc(err.error)}</span><button type="button" data-dis="${esc(err.key)}">✕</button>`;
  else if (done && done.kind !== 'conv' && done.kind !== 'transcribe') $('#sJob').innerHTML = `<span style="color:var(--ok)">✓ ${esc(done.label.replace(/^A /, '').replace(/^cortar/, 'Excerto cortado').replace(/^exportar o áudio/, 'Áudio exportado'))}</span>`;
  else if (!$('#goNote')) $('#sJob').innerHTML = '';
});
$('#sJob').addEventListener('click', e => { const b = e.target.closest('[data-dis]'); if (b) O.dismissJob(b.dataset.dis); });
O.onThumb(({ id, thumb }) => { const it = LIB.items.find(i => i.id === id); if (it) { it.thumb = thumb; renderList(); } });

/* ================================================================== */
/* Abrir ficheiros: botão, arrastar, Finder                             */
/* ================================================================== */
async function opened(r) {
  await load();
  if (r && r.ids && r.ids.length) { view = view.startsWith('f:') ? 'recent' : view; renderSide(); renderList(); play(r.ids[0]); }
  else if (r && r.error) msg(r.error);
}
$('#open').addEventListener('click', async () => opened(await O.openDialog()));
let dragN = 0;
document.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('#drop').hidden = false; } });
document.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#drop').hidden = true; });
document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', async e => {
  e.preventDefault(); dragN = 0; $('#drop').hidden = true;
  const paths = [...(e.dataTransfer.files || [])].map(f => O.pathFor(f)).filter(Boolean);
  if (!paths.length) return;
  // legendas arrastadas para cima de um vídeo
  if (paths.length === 1 && /\.(srt|vtt)$/i.test(paths[0])) { if (cur && cur.kind === 'video') { const s = await O.subs(paths[0]); if (s) addSubs(s); } return; }
  opened(await O.addPaths(paths, true));
});
O.onPlay(async ids => { await load(); if (ids && ids[0]) { view = 'recent'; renderSide(); renderList(); play(ids[0]); } });

/* ---------- atalhos ---------- */
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.metaKey && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#open').click(); return; }
  if (e.metaKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); toggle(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); skip(e.shiftKey ? -30 : -5); }
  else if (k === 'ArrowRight') { e.preventDefault(); skip(e.shiftKey ? 30 : 5); }
  else if (k === 'j' || k === 'J') skip(-10);
  else if (k === 'l' || k === 'L') skip(10);
  else if (k === 'k' || k === 'K') toggle();
  else if (k === 'm' || k === 'M') { if (cur) { e.preventDefault(); $('#mText').focus(); } }
  else if (k === 'i' || k === 'I') { if (cur) { openClip(); $('#setIn').click(); } }
  else if (k === 'o' || k === 'O') { if (cur) { openClip(); $('#setOut').click(); } }
  else if (k === '[' || k === ']') { const i = SPEEDS.indexOf(speed); setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + (k === ']' ? 1 : -1)))]); msg('Velocidade ' + String(speed).replace('.', ',') + '×'); }
  else if ((k === 'f' || k === 'F') && cur && cur.kind === 'video') $('#fsBtn').click();
  else if (k === 'Escape' && !$('#clip').hidden) $('#cClose').click();
});

/* ---------- tema e arranque ---------- */
const setTheme = t => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; drawWave(); };
O.onTheme(setTheme);
$('#empty').innerHTML = `<div><b>Orfeu</b>Arrasta ficheiros de áudio ou vídeo para aqui,<br>abre-os com o botão, ou no Finder com “Abrir com › Zeus”.<div class="row"><button class="btn primary" type="button" id="emptyOpen">Abrir…</button><button class="btn" type="button" id="emptyFolder">Juntar pasta do Mac</button></div></div>`;
$('#emptyOpen').addEventListener('click', () => $('#open').click());
$('#emptyFolder').addEventListener('click', () => $('#addFolder').click());
(async () => {
  setTheme(await O.theme());
  jobs = await O.jobs() || [];
  await load();
  showPlayer();
  renderPlayBtn();
})();

'use strict';
/* Eco — editor de áudio do Zeus: três pistas (Voz, Música, Efeitos), edição na onda, nada destrutivo. */
const E = window.ecoApp;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PPS_PEAKS = 100;
const KEEP_PAUSE = 0.4;   // ao tirar pausas, fica este tanto de silêncio (respirar)
const TRACK_INFO = { voz: { sub: 'a pista principal', color: '--voice', bg: '--voice-bg' }, musica: { sub: 'baixa com a voz', color: '--music', bg: '--music-bg' }, efeitos: { sub: 'sons curtos', color: '--fx', bg: '--fx-bg' } };

let P = null;               // projeto aberto
let projects = [];
const peaks = new Map();    // id da fonte -> Uint8Array (100 por segundo)
let view = { x0: 0, pps: 20 }, fitted = false;
let ph = 0;                 // agulha (segundos)
let sel = null;             // { tid, a, b }
let curT = 'voz';
let clipboard = null;
let hist = [], hidx = -1;
let saveT = null;

/* ---------- formatos ---------- */
function fmt(s, dec) {
  s = Math.max(0, s || 0);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const sec = dec ? x.toFixed(1).padStart(4, '0').replace('.', ',') : String(Math.floor(x)).padStart(2, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + sec;
}
const fmtLen = s => (s < 60 ? s.toFixed(1).replace('.', ',') + ' s' : fmt(s));
const when = ms => { const d = new Date(ms), n = new Date(); if (d.toDateString() === n.toDateString()) return 'hoje'; const y = new Date(); y.setDate(y.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'ontem'; return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' }); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* ---------- modelo: pedaços nas pistas ---------- */
const len = c => c.out - c.in;
const end = c => c.at + len(c);
const T = id => P && P.tracks.find(t => t.id === id);
const projEnd = () => (P ? Math.max(0, ...P.tracks.map(t => Math.max(0, ...t.clips.map(end)))) : 0);
const sortT = t => t.clips.sort((a, b) => a.at - b.at);
function rampAt(c, t) { const r = c.ramp || [1, 1]; return r[0] + (r[1] - r[0]) * Math.min(1, Math.max(0, (t - c.at) / len(c))); }
function splitAt(t, time) {
  const out = [];
  for (const c of t.clips) {
    if (c.at + 0.0005 < time && time < end(c) - 0.0005) {
      const r = rampAt(c, time), cut = c.in + (time - c.at);
      out.push({ ...c, out: cut, ramp: [c.ramp[0], r] }, { ...c, id: uid(), in: cut, at: time, ramp: [r, c.ramp[1]] });
    } else out.push(c);
  }
  t.clips = out; sortT(t);
}
const inside = (c, a, b) => c.at >= a - 0.0005 && end(c) <= b + 0.0005;
function removeRange(t, a, b, ripple) {
  splitAt(t, a); splitAt(t, b);
  t.clips = t.clips.filter(c => !inside(c, a, b));
  if (ripple) t.clips.forEach(c => { if (c.at >= b - 0.0005) c.at = Math.max(0, c.at - (b - a)); });
  sortT(t);
}
function copyRange(t, a, b) {
  const tmp = { clips: t.clips.map(c => ({ ...c, ramp: [...c.ramp] })) };
  splitAt(tmp, a); splitAt(tmp, b);
  return { clips: tmp.clips.filter(c => inside(c, a, b)).map(c => ({ ...c, at: c.at - a })), len: b - a, from: t.id };
}
function insertAt(t, time, clips, span, ripple) {
  if (ripple) { splitAt(t, time); t.clips.forEach(c => { if (c.at >= time - 0.0005) c.at += span; }); }
  for (const c of clips) t.clips.push({ ...c, id: uid(), at: c.at + time, ramp: [...c.ramp] });
  sortT(t);
}
function eachInside(t, a, b, fn) { splitAt(t, a); splitAt(t, b); t.clips.filter(c => inside(c, a, b)).forEach(fn); }

/* ---------- histórico (desfazer / refazer) ---------- */
const snap = () => JSON.stringify({ tracks: P.tracks, sources: P.sources, settings: P.settings });
function commit(label) {
  hist = hist.slice(0, hidx + 1);
  hist.push({ label, at: Date.now(), s: snap() });
  if (hist.length > 200) hist.shift();
  hidx = hist.length - 1;
  scheduleSave(); renderAll();
}
function goHist(i) {
  if (i < 0 || i >= hist.length || i === hidx) return;
  hidx = i;
  const s = JSON.parse(hist[i].s);
  P.tracks = s.tracks; P.sources = s.sources; P.settings = s.settings;
  stopPlay(); scheduleSave(); renderAll();
}
function renderHist() {
  const box = $('#hist');
  box.innerHTML = hist.map((h, i) => `<button type="button" data-h="${i}" class="${i === hidx ? 'now' : i > hidx ? 'undone' : ''}"><span>${esc(h.label)}</span><code>${new Date(h.at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</code></button>`).join('');
  const now = box.querySelector('.now'); if (now) now.scrollIntoView({ block: 'nearest' });
  $('#undoBtn').disabled = hidx <= 0; $('#redoBtn').disabled = hidx >= hist.length - 1;
}
$('#hist').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (b) goHist(+b.dataset.h); });
$('#undoBtn').addEventListener('click', () => goHist(hidx - 1));
$('#redoBtn').addEventListener('click', () => goHist(hidx + 1));

/* ---------- guardar ---------- */
function scheduleSave() {
  clearTimeout(saveT);
  $('#pInfo').textContent = 'A guardar…';
  saveT = setTimeout(async () => {
    if (!P) return;
    const r = await E.save(P).catch(() => null);
    if (r) { P.updated = r.updated; $('#pInfo').textContent = info(); loadProjects(); }
  }, 700);
}
const info = () => `${fmt(projEnd())} · guardado ${new Date(P.updated || Date.now()).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })} · os originais não são alterados`;

/* ---------- projetos ---------- */
async function loadProjects() {
  projects = await E.projects() || [];
  $('#projs').innerHTML = projects.map(p => `<button class="pj ${P && p.id === P.id ? 'on' : ''}" type="button" data-p="${esc(p.id)}"><span>${esc(p.name)}</span><small>${when(p.updated)}</small><i class="x" data-del="${esc(p.id)}" title="Apagar o projeto (os ficheiros ficam)">✕</i></button>`).join('');
}
$('#projs').addEventListener('click', async e => {
  const d = e.target.closest('[data-del]');
  if (d) {
    e.stopPropagation();
    const row = d.closest('.pj');
    if (!row.classList.contains('confirm')) { row.classList.add('confirm'); row.querySelector('span').textContent = 'Apagar? Clica outra vez'; setTimeout(() => loadProjects(), 3000); return; }
    const id = d.dataset.del;
    await E.remove(id);
    if (P && P.id === id) { P = null; await loadProjects(); if (projects[0]) openProject(projects[0].id); else showEmpty(); return; }
    loadProjects(); return;
  }
  const b = e.target.closest('[data-p]'); if (b && (!P || b.dataset.p !== P.id)) openProject(b.dataset.p);
});
$('#newProj').addEventListener('click', async () => { const p = await E.create('Projeto novo', []); if (p) { setProject(p); $('#pName').select(); $('#pName').focus(); } });
async function openProject(id) {
  stopPlay();
  if (P) { clearTimeout(saveT); await E.save(P).catch(() => {}); }
  const p = await E.load(id);
  if (p) setProject(p);
}
function setProject(p) {
  P = p; sel = null; ph = 0; curT = 'voz'; fitted = false;
  hist = [{ label: 'Projeto aberto', at: Date.now(), s: snap() }]; hidx = 0;
  $('#pName').value = P.name;
  $('#pInfo').textContent = info();
  $('#empty').hidden = true;
  syncSettings();
  loadPeaks();
  loadProjects();
  renderAll();
  try { localStorage.setItem('eco.last', P.id); } catch (e) { /* ok */ }
}
function showEmpty() { P = null; $('#empty').hidden = false; loadProjects(); }
$('#pName').addEventListener('change', () => { if (!P) return; P.name = $('#pName').value.trim() || 'Projeto sem nome'; $('#pName').value = P.name; scheduleSave(); });
$('#pName').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); });
async function loadPeaks() {
  for (const [id, s] of Object.entries(P.sources)) {
    if (peaks.has(id)) continue;
    E.peaks(s).then(b => { if (b) { peaks.set(id, new Uint8Array(b)); drawLanes(); drawOverview(); } });
  }
}

/* ---------- fontes (ficheiros do projeto) ---------- */
function renderSources() {
  const used = new Set(P.tracks.flatMap(t => t.clips.map(c => c.src)));
  $('#srcs').innerHTML = Object.entries(P.sources).map(([id, s]) => {
    const kind = P.tracks.find(t => t.clips.some(c => c.src === id));
    return `<div class="src" draggable="true" data-src="${esc(id)}" title="${esc(s.path)}"><div class="w" style="color:var(${TRACK_INFO[kind ? kind.id : 'voz'].color})"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"/></svg></div><div><b>${esc(s.name)}</b><small>${s.dur < 10 ? fmtLen(s.dur) : fmt(s.dur)}${used.has(id) ? '' : ' · por usar'}</small></div>
      <span class="to"><button type="button" data-put="voz" title="Pôr na Voz, na agulha">Voz</button><button type="button" data-put="musica" title="Pôr na Música, na agulha">Música</button><button type="button" data-put="efeitos" title="Pôr nos Efeitos, na agulha">Efeito</button></span></div>`;
  }).join('');
}
$('#srcs').addEventListener('click', e => { const b = e.target.closest('[data-put]'); if (b) placeSource(b.closest('[data-src]').dataset.src, b.dataset.put, ph); });
$('#srcs').addEventListener('dragstart', e => { const s = e.target.closest('[data-src]'); if (s) { e.dataTransfer.setData('eco/src', s.dataset.src); e.dataTransfer.effectAllowed = 'copy'; } });
function placeSource(sid, tid, time) {
  const s = P.sources[sid], t = T(tid); if (!s || !t) return;
  const c = { id: uid(), src: sid, in: 0, out: s.dur, at: 0, gain: 1, ramp: [1, 1] };
  if (tid === 'voz') {
    const e0 = Math.max(0, ...t.clips.map(end));
    const at = Math.min(time, e0);
    insertAt(t, at, [c], s.dur, true);
  } else insertAt(t, Math.max(0, time), [c], s.dur, false);
  curT = tid;
  commit(`Juntou “${s.name}” ${tid === 'voz' ? 'à Voz' : tid === 'musica' ? 'à Música' : 'aos Efeitos'}`);
}
async function addPaths(paths, tid, time) {
  const list = paths.filter(Boolean); if (!list.length) return;
  if (!P) { const p = await E.create('', list); if (p) setProject(p); return; }
  const srcs = await E.addFiles(list) || [];
  if (!srcs.length) return;
  srcs.forEach(s => { P.sources[s.id] = s; });
  loadPeaks();
  const empty = !P.tracks.some(t => t.clips.length);
  if (tid || empty) { let at = time != null ? time : ph; for (const s of srcs) { placeSource(s.id, tid || 'voz', at); at += s.dur; } }
  else { commit(srcs.length === 1 ? `Juntou o ficheiro “${srcs[0].name}”` : `Juntou ${srcs.length} ficheiros`); flash('Ficou na lista “Neste projeto”: arrasta-o para uma pista, ou larga-o logo em cima da pista.'); }
}
$('#addSrc').addEventListener('click', async () => { if (!P) return; const srcs = await E.chooseFiles() || []; if (!srcs.length) return; srcs.forEach(s => { P.sources[s.id] = s; }); loadPeaks(); if (!P.tracks.some(t => t.clips.length)) { let at = 0; for (const s of srcs) { placeSource(s.id, 'voz', at); at += s.dur; } } else commit(`Juntou ${srcs.length === 1 ? '“' + srcs[0].name + '”' : srcs.length + ' ficheiros'}`); });
$('#emptyOpen').addEventListener('click', async () => { const p = await E.create('Projeto novo', []); if (!p) return; setProject(p); $('#addSrc').click(); });

/* ---------- desenho ---------- */
function laneRect() { const l = document.querySelector('.lane'); return l ? l.getBoundingClientRect() : { left: 0, width: 600 }; }
const tx = t => (t - view.x0) * view.pps;
const xt = x => view.x0 + x / view.pps;
function buildLanes() {
  $('#lanes').innerHTML = P.tracks.map(t => `<div class="track ${t.kind} ${t.id === curT ? 'cur' : ''}" data-t="${t.id}"><div class="th"><b><i></i>${t.name}</b><small>${TRACK_INFO[t.id].sub}</small><div class="row"><button type="button" data-mute="${t.id}" class="${t.mute ? 'on' : ''}" title="Calar esta pista">M</button><button type="button" data-solo="${t.id}" class="${t.solo ? 'on' : ''}" title="Ouvir só esta pista">S</button><button type="button" class="addt" data-addto="${t.id}" title="Juntar um ficheiro a esta pista, na agulha">+</button></div></div><div class="lane" data-lane="${t.id}"><canvas></canvas></div></div>`).join('');
}
function fitView() {
  const W = laneRect().width || 600, e0 = Math.max(projEnd(), 20);
  view.pps = W / (e0 * 1.03); view.x0 = 0; fitted = true; syncZoom();
}
const ppsMin = () => (laneRect().width || 600) / (Math.max(projEnd(), 20) * 1.03);
const PPS_MAX = 600;
function syncZoom() { const lo = Math.log(ppsMin()), hi = Math.log(PPS_MAX); $('#zoomR').value = Math.round((Math.log(view.pps) - lo) / (hi - lo) * 1000); }
function setZoom(pps, anchorT, anchorX) {
  pps = Math.min(PPS_MAX, Math.max(ppsMin(), pps));
  if (anchorT == null) { anchorT = ph; anchorX = tx(ph); if (anchorX < 0 || anchorX > laneRect().width) anchorX = laneRect().width / 2; }
  view.pps = pps; view.x0 = Math.max(0, anchorT - anchorX / pps); clampView(); syncZoom(); drawAll();
}
function clampView() { const W = laneRect().width || 600; view.x0 = Math.max(0, Math.min(view.x0, Math.max(0, projEnd() * 1.03 - W / view.pps))); }
$('#zoomIn').addEventListener('click', () => setZoom(view.pps * 1.6));
$('#zoomOut').addEventListener('click', () => setZoom(view.pps / 1.6));
$('#zoomFit').addEventListener('click', () => { fitView(); drawAll(); });
$('#zoomR').addEventListener('input', e => { const lo = Math.log(ppsMin()), hi = Math.log(PPS_MAX); setZoom(Math.exp(lo + (hi - lo) * e.target.value / 1000)); });

function drawLane(t) {
  const lane = document.querySelector(`.lane[data-lane="${t.id}"]`); if (!lane) return;
  const cv = lane.querySelector('canvas'), r = lane.getBoundingClientRect(), d = devicePixelRatio || 1;
  if (!r.width) return;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  const g = cv.getContext('2d'); g.scale(d, d);
  const W = r.width, H = r.height, col = css(TRACK_INFO[t.id].color), bg = css(TRACK_INFO[t.id].bg);
  const labelH = t.kind === 'voice' ? 0 : 17;
  const dim = t.mute || (P.tracks.some(y => y.solo) && !t.solo);
  g.globalAlpha = dim ? 0.35 : 1;
  const step = view.pps > 150 ? 1 : 3;
  emptyHint(g, t, W, H);
  for (const c of t.clips) {
    const x0 = tx(c.at), x1 = tx(end(c));
    if (x1 < 0 || x0 > W) continue;
    if (t.kind !== 'voice') {
      g.fillStyle = bg; roundRect(g, x0 + 0.5, 4, Math.max(8, x1 - x0 - 1), H - 8, Math.min(7, Math.max(2, (x1 - x0) / 2))); g.fill();
      g.strokeStyle = col; g.globalAlpha = (dim ? 0.35 : 1) * 0.5; g.lineWidth = 1; roundRect(g, x0 + 0.5, 4.5, Math.max(2, x1 - x0 - 1), H - 9, 7); g.stroke(); g.globalAlpha = dim ? 0.35 : 1;
      if (x1 - x0 > 40) { g.save(); g.beginPath(); g.rect(Math.max(0, x0), 0, Math.min(W, x1) - Math.max(0, x0), H); g.clip(); g.fillStyle = col; g.font = '600 11px Geist, sans-serif'; g.fillText((P.sources[c.src] || {}).name || '', Math.max(0, x0) + 8, 17); g.restore(); }
    }
    const pk = peaks.get(c.src);
    const mid = labelH + (H - labelH) / 2, amp = (H - labelH) * 0.44;
    g.fillStyle = col;
    for (let px = Math.max(0, Math.floor(x0)); px < Math.min(W, Math.ceil(x1)); px += step) {
      const ta = xt(px), tb = xt(px + step);
      let v = 0.04;
      if (pk) { const s0 = c.in + (ta - c.at), s1 = c.in + (tb - c.at); let i0 = Math.max(0, Math.floor(s0 * PPS_PEAKS)), i1 = Math.min(pk.length, Math.max(i0 + 1, Math.ceil(s1 * PPS_PEAKS))); let m = 0; for (let i = i0; i < i1; i++) if (pk[i] > m) m = pk[i]; v = Math.max(0.02, m / 255); }
      v *= Math.min(2, c.gain * rampAt(c, (ta + tb) / 2));
      const bh = Math.max(1, Math.min(1, v) * amp * 2);
      g.fillRect(px, mid - bh / 2, step === 1 ? 1 : 2, bh);
    }
  }
  g.globalAlpha = 1;
  // cortes na voz: onde dois pedaços se juntam
  if (t.kind === 'voice') {
    g.strokeStyle = css('--faint'); g.setLineDash([4, 4]); g.lineWidth = 1.5;
    for (let i = 1; i < t.clips.length; i++) {
      const a = t.clips[i - 1], b = t.clips[i];
      if (Math.abs(end(a) - b.at) > 0.01 || (a.src === b.src && Math.abs(a.out - b.in) < 0.005)) continue;
      const x = tx(b.at); if (x < -2 || x > W + 2) continue;
      g.beginPath(); g.moveTo(x, 22); g.lineTo(x, H); g.stroke();
      g.setLineDash([]); g.fillStyle = css('--bg'); g.beginPath(); g.arc(x, 12, 8, 0, 7); g.fill(); g.strokeStyle = css('--line2'); g.lineWidth = 1; g.stroke();
      g.fillStyle = css('--soft'); g.font = '10px sans-serif'; g.textAlign = 'center'; g.fillText('✂', x, 15.5); g.textAlign = 'left';
      g.strokeStyle = css('--faint'); g.setLineDash([4, 4]); g.lineWidth = 1.5;
    }
    g.setLineDash([]);
  }
  // seleção
  lane.querySelector('.selr') && lane.querySelector('.selr').remove();
  if (sel && sel.tid === t.id) {
    const a = tx(sel.a), b = tx(sel.b);
    const s = document.createElement('div'); s.className = 'selr';
    Object.assign(s.style, { left: a + 'px', width: Math.max(2, b - a) + 'px' });
    const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = `${fmt(sel.a, 1)} → ${fmt(sel.b, 1)} · ${fmtLen(sel.b - sel.a)}`;
    if (b - a > 150) s.appendChild(tag);
    lane.appendChild(s);
  }
}
function moveTag(t, c, label) {
  document.querySelectorAll('.mtag').forEach(x => x.remove());
  if (!t) return;
  const lane = document.querySelector(`.lane[data-lane="${t.id}"]`); if (!lane) return;
  const m = document.createElement('div'); m.className = 'mtag';
  m.style.left = tx(c ? c.at : label.at) + 'px';
  const tag = document.createElement('span'); tag.textContent = c ? `${fmt(c.at, 1)} → ${fmt(end(c), 1)}` : label.text; m.appendChild(tag);
  lane.appendChild(m);
  if (parseFloat(m.style.left) + 210 > lane.clientWidth) m.classList.add('flip');
}
// pistas vazias: um aviso no sítio
function emptyHint(g, t, W, H) {
  if (t.clips.length) return;
  g.fillStyle = css('--faint'); g.font = '12.5px Geist, sans-serif'; g.textAlign = 'center';
  g.fillText(t.kind === 'voice' ? 'Arrasta para aqui a gravação principal' : t.kind === 'music' ? 'Arrasta música para aqui — ou carrega em + à esquerda' : 'Arrasta efeitos sonoros para aqui — ou carrega em + à esquerda', W / 2, H / 2 + 4);
  g.textAlign = 'left';
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawLanes() { if (P) P.tracks.forEach(drawLane); }
function drawRuler() {
  const cv = $('#ruler'), r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; if (!r.width) return;
  cv.width = r.width * d; cv.height = r.height * d;
  const g = cv.getContext('2d'); g.scale(d, d);
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const st = steps.find(s => s * view.pps >= 80) || 3600;
  g.fillStyle = css('--faint'); g.strokeStyle = css('--line2'); g.font = '10.5px "Geist Mono", monospace';
  for (let t = Math.floor(view.x0 / st) * st; t < xt(r.width); t += st) {
    const x = tx(t); if (x < -40) continue;
    g.fillRect(x, r.height - 7, 1, 7);
    g.fillText(st < 1 ? fmt(t, 1) : fmt(t), x + 4, 15);
  }
}
function drawOverview() {
  if (!P) return;
  const cv = $('#ovc'), r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; if (!r.width) return;
  cv.width = r.width * d; cv.height = r.height * d;
  const g = cv.getContext('2d'); g.scale(d, d);
  const total = Math.max(projEnd(), 1), W = r.width, H = r.height;
  for (const t of P.tracks) {
    g.fillStyle = css(TRACK_INFO[t.id].color); g.globalAlpha = t.kind === 'voice' ? 0.75 : 0.35;
    for (const c of t.clips) {
      const pk = peaks.get(c.src);
      const x0 = c.at / total * W, x1 = end(c) / total * W;
      for (let px = Math.floor(x0); px < x1; px += 2) {
        let v = 0.15;
        if (pk) { const s0 = c.in + (px / W * total - c.at), s1 = s0 + 2 / W * total; let m = 0; for (let i = Math.max(0, Math.floor(s0 * 100)); i < Math.min(pk.length, Math.ceil(s1 * 100)); i++) if (pk[i] > m) m = pk[i]; v = m / 255; }
        const bh = Math.max(1, v * (H - 6) * (t.kind === 'voice' ? 1 : 0.6));
        g.fillRect(px, (H - bh) / 2, 1.2, bh);
      }
    }
  }
  g.globalAlpha = 1;
  const lw = laneRect().width || 600;
  Object.assign($('#ovw').style, { left: (view.x0 / total * W) + 'px', width: Math.min(W, (lw / view.pps) / total * W) + 'px' });
}
function placePlayhead() {
  const tl = $('#tl').getBoundingClientRect(), lr = laneRect();
  const x = lr.left - tl.left + tx(ph);
  const p = $('#ph');
  p.hidden = !P || x < lr.left - tl.left - 1 || x > lr.left - tl.left + lr.width + 1;
  p.style.left = x + 'px';
  $('#tNow').textContent = fmt(ph, 1);
}
function drawAll() { drawRuler(); drawLanes(); drawOverview(); placePlayhead(); }
function renderAll() {
  if (!P) return;
  if (!document.querySelector('.lane')) buildLanes();
  document.querySelectorAll('.track').forEach(el => { const t = T(el.dataset.t); el.classList.toggle('cur', t.id === curT); el.querySelector('[data-mute]').classList.toggle('on', t.mute); el.querySelector('[data-solo]').classList.toggle('on', t.solo); });
  if (!fitted) fitView();
  clampView();
  $('#tTot').textContent = '/ ' + fmt(projEnd());
  $('#selInfo').hidden = !sel; if (sel) $('#selInfo').textContent = `Seleção ${fmtLen(sel.b - sel.a)}`;
  $('#orfeuBtn').disabled = !P.lastExport;
  document.querySelectorAll('.tools [data-op]').forEach(b => {
    const op = b.dataset.op;
    b.disabled = ['cut', 'copy', 'del', 'silence', 'fadein', 'fadeout', 'volume'].includes(op) ? !sel : op === 'paste' ? !clipboard : op === 'pauses' ? !T('voz').clips.length : false;
  });
  $('[data-op="denoise"]').classList.toggle('on', P.settings.denoise);
  renderSources(); renderHist(); syncSettings(); drawAll();
}
new ResizeObserver(() => { if (P) { clampView(); drawAll(); } }).observe($('#tl'));

/* ---------- rato na linha do tempo ---------- */
let drag = null;
$('#lanes').addEventListener('mousedown', async e => {
  const add = e.target.closest('[data-addto]');
  if (add) { e.preventDefault(); const srcs = await E.chooseFiles() || []; if (!srcs.length) return; srcs.forEach(s => { P.sources[s.id] = s; }); loadPeaks(); let at = ph; for (const s of srcs) { placeSource(s.id, add.dataset.addto, at); at += s.dur; } return; }
  const b = e.target.closest('[data-mute],[data-solo]');
  if (b) { const t = T(b.dataset.mute || b.dataset.solo); if (b.dataset.mute) t.mute = !t.mute; else t.solo = !t.solo; commit(`${b.dataset.mute ? (t.mute ? 'Calou' : 'Voltou a ouvir') : (t.solo ? 'Só a pista' : 'Todas as pistas')} ${t.name}`); return; }
  const th = e.target.closest('.th'); if (th) { curT = th.parentElement.dataset.t; renderAll(); return; }
  const lane = e.target.closest('.lane'); if (!lane || e.button !== 0) return;
  e.preventDefault();
  const t = T(lane.dataset.lane), r = lane.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, time = xt(x);
  curT = t.id;
  // música e efeitos: arrastar um pedaço muda-o de sítio (também para a outra pista); com ⌥ seleciona
  const pad = 6 / view.pps;   // pedaços curtos (efeitos): fáceis de agarrar
  const hit = [...t.clips].reverse().find(c => time >= c.at - pad && time <= end(c) + pad);
  if (t.kind !== 'voice' && hit && !e.altKey) { drag = { mode: 'move', t, c: hit, x: e.clientX, at0: hit.at, from: t.id }; document.body.classList.add('moving'); return; }
  if (e.shiftKey && sel && sel.tid === t.id) { const a = Math.abs(time - sel.a) < Math.abs(time - sel.b) ? sel.b : sel.a; drag = { mode: 'sel', t, a, x: e.clientX, moved: true }; sel = { tid: t.id, a: Math.min(a, time), b: Math.max(a, time) }; renderAll(); return; }
  drag = { mode: 'sel', t, a: Math.max(0, time), x: e.clientX, moved: false };
});
window.addEventListener('mousemove', e => {
  if (!drag) return;
  const r = laneRect(), time = Math.max(0, xt(e.clientX - r.left));
  if (drag.mode === 'move') {
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 3 && Math.abs(e.clientY - (drag.y || e.clientY)) < 3) { drag.y = drag.y || e.clientY; return; }
    drag.moved = true;
    drag.c.at = Math.max(0, drag.at0 + (e.clientX - drag.x) / view.pps);
    // passar para a outra pista (Música ⇄ Efeitos) se o rato estiver em cima dela
    const el = document.elementFromPoint(e.clientX, e.clientY), ln = el && el.closest && el.closest('.lane');
    if (ln && ln.dataset.lane !== drag.t.id && ln.dataset.lane !== 'voz') {
      const nt = T(ln.dataset.lane); drag.t.clips = drag.t.clips.filter(c => c !== drag.c); nt.clips.push(drag.c); const old = drag.t; drag.t = nt; curT = nt.id; drawLane(old);
    }
    moveTag(drag.t, drag.c);
    drawLane(drag.t); return;
  }
  if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return;
  drag.moved = true;
  sel = { tid: drag.t.id, a: Math.min(drag.a, time), b: Math.max(drag.a, time) };
  // perto das pontas, a vista anda
  if (e.clientX > r.left + r.width - 20) view.x0 += 8 / view.pps; else if (e.clientX < r.left + 20) view.x0 = Math.max(0, view.x0 - 8 / view.pps);
  clampView();
  $('#selInfo').hidden = false; $('#selInfo').textContent = `Seleção ${fmtLen(sel.b - sel.a)}`;
  drawAll();
});
window.addEventListener('mouseup', () => {
  if (!drag) return;
  const d = drag; drag = null; document.body.style.cursor = '';
  document.body.classList.remove('moving'); moveTag(null);
  if (d.mode === 'move') {
    sortT(d.t);
    if (d.moved) commit(`Moveu “${(P.sources[d.c.src] || {}).name || 'pedaço'}” para ${fmt(d.c.at, 1)}${d.t.id !== d.from ? (d.t.id === 'musica' ? ' (Música)' : ' (Efeitos)') : ''}`);
    else { sel = { tid: d.t.id, a: d.c.at, b: end(d.c) }; renderAll(); }
    return;
  }
  if (!d.moved) { sel = null; seek(d.a); }
  else if (sel && sel.b - sel.a < 0.02) sel = null;
  renderAll();
});
$('#lanes').addEventListener('mousemove', e => {
  if (drag) return;
  const lane = e.target.closest('.lane'); if (!lane || !P) return;
  const t = T(lane.dataset.lane); if (t.kind === 'voice') { lane.style.cursor = ''; return; }
  const time = xt(e.clientX - lane.getBoundingClientRect().left);
  const pad = 6 / view.pps;
  lane.style.cursor = !e.altKey && t.clips.some(c => time >= c.at - pad && time <= end(c) + pad) ? 'grab' : '';
});
$('#lanes').addEventListener('dblclick', e => {
  const lane = e.target.closest('.lane'); if (!lane) return;
  const t = T(lane.dataset.lane), time = xt(e.clientX - lane.getBoundingClientRect().left);
  const c = t.clips.find(y => time >= y.at && time <= end(y));
  if (c) { sel = { tid: t.id, a: c.at, b: end(c) }; renderAll(); }
});
// régua e mapa: mudar a agulha / a vista
function rulerSeek(e) { const r = $('#ruler').getBoundingClientRect(); seek(Math.max(0, xt(e.clientX - r.left))); }
$('#ruler').addEventListener('mousedown', e => { rulerSeek(e); const mv = ev => rulerSeek(ev); window.addEventListener('mousemove', mv); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mv), { once: true }); });
function ovGo(e) { const r = $('#overview').getBoundingClientRect(), total = Math.max(projEnd(), 1); const t = (e.clientX - r.left) / r.width * total; view.x0 = Math.max(0, t - (laneRect().width / view.pps) / 2); clampView(); drawAll(); }
$('#overview').addEventListener('mousedown', e => { ovGo(e); const mv = ev => ovGo(ev); window.addEventListener('mousemove', mv); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mv), { once: true }); });
// roda: andar no tempo; com ⌘ ou dois dedos a apertar: zoom
$('#tl').addEventListener('wheel', e => {
  if (!P) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { const r = laneRect(), x = e.clientX - r.left; setZoom(view.pps * Math.exp(-e.deltaY * 0.01), xt(x), x); return; }
  view.x0 += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / view.pps; clampView(); drawAll();
}, { passive: false });

/* ---------- ferramentas ---------- */
function needSel() { if (!sel) { flash('Seleciona primeiro um bocado na onda (arrasta com o rato).'); return false; } return true; }
const tName = id => ({ voz: 'Voz', musica: 'Música', efeitos: 'Efeitos' }[id]);
const rangeTxt = () => `${fmt(sel.a)} → ${fmt(sel.b)}`;
const OPS = {
  cut() { if (!needSel()) return; const t = T(sel.tid); clipboard = copyRange(t, sel.a, sel.b); removeRange(t, sel.a, sel.b, true); const l = rangeTxt(); seek(sel.a); sel = null; commit(`Cortou ${l} (${tName(t.id)})`); },
  copy() { if (!needSel()) return; clipboard = copyRange(T(sel.tid), sel.a, sel.b); flash(`Copiado: ${fmtLen(clipboard.len)}`); renderAll(); },
  paste() {
    if (!clipboard) return;
    const t = T(curT), ripple = t.kind === 'voice';
    insertAt(t, ph, clipboard.clips, clipboard.len, ripple);
    sel = { tid: t.id, a: ph, b: ph + clipboard.len };
    commit(`Colou ${fmtLen(clipboard.len)} em ${fmt(ph)} (${tName(t.id)})`);
  },
  del() { if (!needSel()) return; const t = T(sel.tid); const l = rangeTxt(); removeRange(t, sel.a, sel.b, true); seek(sel.a); sel = null; commit(`Apagou ${l} (${tName(t.id)})`); },
  silence() { if (!needSel()) return; const t = T(sel.tid); removeRange(t, sel.a, sel.b, false); commit(`Silêncio ${rangeTxt()} (${tName(t.id)})`); },
  fadein() { if (!needSel()) return; const { a, b } = sel; const f = x => Math.min(1, Math.max(0, (x - a) / (b - a))); eachInside(T(sel.tid), a, b, c => { c.ramp = [c.ramp[0] * f(c.at), c.ramp[1] * f(end(c))]; }); commit(`Fade in ${fmtLen(b - a)} em ${fmt(a)}`); },
  fadeout() { if (!needSel()) return; const { a, b } = sel; const f = x => Math.min(1, Math.max(0, 1 - (x - a) / (b - a))); eachInside(T(sel.tid), a, b, c => { c.ramp = [c.ramp[0] * f(c.at), c.ramp[1] * f(end(c))]; }); commit(`Fade out ${fmtLen(b - a)} em ${fmt(a)}`); },
  volume(btn) {
    if (!needSel()) return;
    popup(btn, [['+6 dB (o dobro)', 2], ['+3 dB', 1.413], ['−3 dB', 0.708], ['−6 dB (metade)', 0.5], ['−12 dB', 0.25], ['Repor o volume', 0]], v => {
      eachInside(T(sel.tid), sel.a, sel.b, c => { if (v === 0) { c.gain = 1; c.ramp = [1, 1]; } else c.gain = Math.min(8, c.gain * v); });
      commit(v === 0 ? `Repôs o volume ${rangeTxt()}` : `Volume ${v > 1 ? '+' : '−'}${Math.abs(Math.round(20 * Math.log10(v)))} dB ${rangeTxt()}`);
    });
  },
  async pauses() {
    const t = T('voz'); if (!t.clips.length) return;
    const min = P.settings.pauses;
    busy('A procurar as pausas…');
    const bySrc = {};
    for (const sid of new Set(t.clips.map(c => c.src))) bySrc[sid] = await E.silences(P.sources[sid].path, min) || [];
    busy('');
    const cuts = [];
    for (const c of t.clips) for (const [s, e] of bySrc[c.src] || []) {
      const s1 = Math.max(s, c.in), e1 = Math.min(e, c.out);
      if (e1 - s1 < min || e1 - s1 <= KEEP_PAUSE + 0.05) continue;
      cuts.push([c.at + (s1 - c.in) + KEEP_PAUSE / 2, c.at + (e1 - c.in) - KEEP_PAUSE / 2]);
    }
    if (!cuts.length) { flash(`Não há pausas maiores que ${String(min).replace('.', ',')} s.`); return; }
    cuts.sort((x, y) => y[0] - x[0]);
    let tot = 0; for (const [a, b] of cuts) { removeRange(t, a, b, true); tot += b - a; }
    sel = null;
    commit(`Tirou ${cuts.length} pausa${cuts.length > 1 ? 's' : ''} (−${fmtLen(tot)})`);
    flash(`Tirou ${cuts.length} pausa${cuts.length > 1 ? 's' : ''}: o áudio ficou ${fmtLen(tot)} mais curto.`);
  },
  denoise() { P.settings.denoise = !P.settings.denoise; commit(P.settings.denoise ? 'Limpar ruído: ligado' : 'Limpar ruído: desligado'); if (P.settings.denoise) flash('A limpeza ouve-se no ficheiro exportado — ou em “Ouvir 10 s com os efeitos”.'); }
};
$('#tools').addEventListener('click', e => { const b = e.target.closest('[data-op]'); if (b && !b.disabled && P) OPS[b.dataset.op](b); });

/* ---------- definições (direita) ---------- */
function syncSettings() {
  if (!P) return;
  const s = P.settings;
  $('#sDenoise').checked = s.denoise; $('#sDenoiseAmt').value = Math.round(s.denoiseAmount * 100); $('#sDenoiseAmt').disabled = !s.denoise;
  $('#sPauses').value = String(s.pauses); $('#sLoud').value = s.loudness;
  $('#loudNote').textContent = s.loudness === 'podcast' ? '−16 LUFS, como o Spotify e a Apple Podcasts.' : s.loudness === 'radio' ? '−23 LUFS, a norma da rádio e da televisão.' : 'O volume fica como está.';
  for (const t of P.tracks) { const r = document.querySelector(`[data-tg="${t.id}"]`); if (document.activeElement !== r) r.value = Math.round(t.gain * 100); document.querySelector(`[data-tgv="${t.id}"]`).textContent = Math.round(t.gain * 100) + '%'; }
  $('#sDuck').checked = T('musica').duck !== false;
}
$('#sDenoise').addEventListener('change', e => { P.settings.denoise = e.target.checked; commit(e.target.checked ? 'Limpar ruído: ligado' : 'Limpar ruído: desligado'); });
$('#sDenoiseAmt').addEventListener('change', e => { P.settings.denoiseAmount = e.target.value / 100; commit(`Força da limpeza: ${e.target.value}%`); });
$('#sPauses').addEventListener('change', e => { P.settings.pauses = +e.target.value; scheduleSave(); });
$('#sLoud').addEventListener('change', e => { P.settings.loudness = e.target.value; commit(`Volume final: ${e.target.selectedOptions[0].textContent}`); });
$('#sDuck').addEventListener('change', e => { T('musica').duck = e.target.checked; commit(e.target.checked ? 'A música baixa com a voz' : 'A música não baixa com a voz'); });
document.querySelectorAll('[data-tg]').forEach(r => {
  r.addEventListener('input', () => { const t = T(r.dataset.tg); t.gain = r.value / 100; document.querySelector(`[data-tgv="${t.id}"]`).textContent = r.value + '%'; drawLanes(); });
  r.addEventListener('change', () => { const t = T(r.dataset.tg); commit(`Volume da ${t.name === 'Efeitos' ? 'pista Efeitos' : t.name}: ${r.value}%`); });
});
$('#hearBtn').addEventListener('click', async () => {
  if (!P || !projEnd()) return;
  stopPlay();
  const b = $('#hearBtn'); b.disabled = true; b.textContent = 'A preparar…';
  const r = await E.preview(P, ph, 10).catch(() => null);
  b.disabled = false; b.textContent = 'Ouvir 10 s com os efeitos';
  if (!r || r.error) { flash('Não foi possível preparar: ' + ((r && r.error) || 'erro')); return; }
  const a = $('#hear'); a.src = r; a.play().catch(() => {});
  const t0 = ph; playing = true; renderPlay();
  const tick = () => { if (a.paused || a.ended) { playing = false; renderPlay(); return; } ph = t0 + a.currentTime; follow(); placePlayhead(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

/* ---------- ouvir (pré-escuta das edições) ---------- */
const players = {};
let playing = false, playT0 = 0, perf0 = 0, raf = 0, duck = 1;
function player(id) { if (!players[id]) { const a = new Audio(); a.preload = 'auto'; players[id] = a; } return players[id]; }
function activeClip(t, time) { return t.clips.find(c => time >= c.at && time < end(c)); }
function voiceLevel(time) { const t = T('voz'), c = activeClip(t, time); if (!c) return 0; const pk = peaks.get(c.src); if (!pk) return 0.5; const i = Math.floor((c.in + time - c.at) * PPS_PEAKS); let m = 0; for (let k = i - 5; k <= i + 5; k++) if (pk[k] > m) m = pk[k]; return m / 255; }
function frame() {
  if (!playing) return;
  const now = playT0 + (performance.now() - perf0) / 1000;
  if (now >= projEnd()) { ph = projEnd(); stopPlay(); placePlayhead(); return; }
  ph = now;
  const solo = P.tracks.some(t => t.solo);
  duck += ((voiceLevel(now) > 0.35 ? 0.35 : 1) - duck) * 0.08;
  for (const t of P.tracks) {
    const a = player(t.id), c = activeClip(t, now);
    if (!c) { if (!a.paused) a.pause(); a.dataset.c = ''; continue; }
    const src = P.sources[c.src]; if (!src) continue;
    const want = c.in + (now - c.at);
    let vol = (t.mute || (solo && !t.solo)) ? 0 : t.gain * c.gain * rampAt(c, now);
    if (t.id === 'musica' && t.duck !== false) vol *= duck;
    a.volume = Math.min(1, Math.max(0, vol));
    if (a.dataset.u !== src.url) { a.dataset.u = src.url; a.src = src.url; a.currentTime = want; a.dataset.c = c.id; a.play().catch(() => {}); continue; }
    if (a.dataset.c !== c.id) { a.dataset.c = c.id; if (Math.abs(a.currentTime - want) > 0.03) a.currentTime = want; }
    else if (Math.abs(a.currentTime - want) > 0.15) a.currentTime = want;
    if (a.paused) { a.currentTime = want; a.play().catch(() => {}); }
  }
  follow();
  placePlayhead();
  raf = requestAnimationFrame(frame);
}
function follow() { const W = laneRect().width; const x = tx(ph); if (x > W - 30 || x < 0) { view.x0 = Math.max(0, ph - W * 0.1 / view.pps); clampView(); drawAll(); } }
function startPlay() {
  if (!P || !projEnd()) return;
  $('#hear').pause();
  if (ph >= projEnd() - 0.05) ph = sel ? sel.a : 0;
  playing = true; playT0 = ph; perf0 = performance.now(); duck = voiceLevel(ph) > 0.35 ? 0.35 : 1;
  renderPlay(); raf = requestAnimationFrame(frame);
}
function stopPlay() { playing = false; cancelAnimationFrame(raf); Object.values(players).forEach(a => a.pause()); $('#hear').pause(); renderPlay(); }
function togglePlay() { if (playing) stopPlay(); else startPlay(); }
function seek(t) { ph = Math.max(0, Math.min(t, projEnd())); if (playing) { playT0 = ph; perf0 = performance.now(); Object.values(players).forEach(a => { a.dataset.c = ''; }); } placePlayhead(); }
function renderPlay() { $('#playBtn').innerHTML = playing ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>'; }
$('#playBtn').addEventListener('click', togglePlay);
$('#back10').addEventListener('click', () => seek(ph - 10));
$('#fwd10').addEventListener('click', () => seek(ph + 10));

/* ---------- arrastar ficheiros (do Finder, do Hermes, ou da lista da esquerda) ---------- */
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer.types || [])].some(t => t === 'Files' || t === 'eco/src');
document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; if ([...e.dataTransfer.types].includes('Files')) { if (P) $('#drop').hidden = false; else $('#empty').classList.add('dragover'); } });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; moveTag(null); $('#drop').hidden = true; $('#empty').classList.remove('dragover'); document.querySelectorAll('.lane.dragover').forEach(l => l.classList.remove('dragover')); } });
document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return; e.preventDefault();
  document.querySelectorAll('.lane.dragover').forEach(l => l.classList.remove('dragover'));
  const lane = e.target.closest && e.target.closest('.lane');
  if (lane && P) {
    lane.classList.add('dragover'); $('#drop').hidden = true;
    const t = T(lane.dataset.lane), at = Math.max(0, xt(e.clientX - lane.getBoundingClientRect().left));
    const vEnd = Math.max(0, ...t.clips.map(end));
    const shown = t.kind === 'voice' ? Math.min(at, vEnd) : at;
    moveTag(t, null, { at: shown, text: `Largar em ${fmt(shown, 1)} · ${tName(t.id)}` });
  } else { moveTag(null); if ([...e.dataTransfer.types].includes('Files') && P) $('#drop').hidden = false; }
});
document.addEventListener('drop', async e => {
  if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; moveTag(null);
  $('#drop').hidden = true; $('#empty').classList.remove('dragover');
  const lane = e.target.closest && e.target.closest('.lane');
  document.querySelectorAll('.lane.dragover').forEach(l => l.classList.remove('dragover'));
  const time = lane ? Math.max(0, xt(e.clientX - lane.getBoundingClientRect().left)) : null;
  const sid = e.dataTransfer.getData('eco/src');
  if (sid && P && lane) { placeSource(sid, lane.dataset.lane, time); return; }
  const paths = [...e.dataTransfer.files].map(f => E.pathFor(f)).filter(Boolean);
  if (paths.length) addPaths(paths, lane ? lane.dataset.lane : null, time);
});

/* ---------- exportar ---------- */
let exp = { fmt: 'mp3', loud: true, onlySel: false, orfeu: true };
try { Object.assign(exp, JSON.parse(localStorage.getItem('eco.export') || '{}')); } catch (e) { /* ok */ }
function openExport() {
  if (!P || !projEnd()) { flash('O projeto ainda está vazio.'); return; }
  stopPlay();
  const F = { mp3: ['MP3', 'Podcast · 128 kbps'], m4a: ['M4A', 'Melhor e mais leve'], wav: ['WAV', 'Sem perdas'] };
  const draw = () => {
    const only = exp.onlySel && sel, dur = only ? sel.b - sel.a : projEnd();
    const kbps = exp.fmt === 'mp3' ? 128 : exp.fmt === 'm4a' ? 160 : 2304;
    const orig = Object.values(P.sources)[0];
    $('#mbox').innerHTML = `<h2>Exportar</h2>
      <div class="fmt">${Object.entries(F).map(([k, [n, d]]) => `<button type="button" data-fmt="${k}" class="${exp.fmt === k ? 'on' : ''}"><b>${n}</b><small>${d}</small></button>`).join('')}</div>
      <label class="row2"><input type="checkbox" class="sw" id="xLoud" ${exp.loud && P.settings.loudness !== 'off' ? 'checked' : ''} ${P.settings.loudness === 'off' ? 'disabled' : ''}> Igualar o volume (${P.settings.loudness === 'radio' ? '−23 LUFS, rádio' : P.settings.loudness === 'off' ? 'desligado nas definições' : '−16 LUFS, podcast'})</label>
      <label class="row2"><input type="checkbox" class="sw" id="xSel" ${only ? 'checked' : ''} ${sel ? '' : 'disabled'}> Só a seleção${sel ? ` (${fmtLen(sel.b - sel.a)}) — para um excerto nas redes` : ' (não há nada selecionado)'}</label>
      <label class="row2"><input type="checkbox" class="sw" id="xOrfeu" ${exp.orfeu ? 'checked' : ''}> Abrir no Orfeu quando acabar</label>
      <div class="sum">Fica na pasta ${orig ? `de “${esc(orig.name)}”` : 'que escolheres'} — escolhes o nome a seguir<br>Duração ${fmt(dur)}${!only && Object.values(P.sources).length ? ` · ≈ ${Math.max(1, Math.round(kbps * dur / 8 / 1000))} MB` : ''}${P.settings.denoise ? ' · com limpeza de ruído' : ''}</div>
      <div class="prog" id="xProg" hidden><i></i></div>
      <div class="mbtns"><button class="btn" type="button" id="xCancel">Cancelar</button><button class="btn primary" type="button" id="xGo">Exportar</button></div>`;
  };
  draw(); $('#modal').hidden = false;
  const box = $('#mbox');
  box.onclick = async e => {
    const f = e.target.closest('[data-fmt]'); if (f) { exp.fmt = f.dataset.fmt; draw(); return; }
    if (e.target.id === 'xCancel') { if (box.dataset.busy) E.cancelExport(); else closeModal(); return; }
    if (e.target.id === 'xGo') {
      exp.loud = $('#xLoud').checked; exp.onlySel = $('#xSel').checked; exp.orfeu = $('#xOrfeu').checked;
      try { localStorage.setItem('eco.export', JSON.stringify(exp)); } catch (er) { /* ok */ }
      box.dataset.busy = '1'; $('#xGo').disabled = true; $('#xGo').textContent = 'A exportar…'; $('#xProg').hidden = false;
      const r = await E.export(P, { fmt: exp.fmt, loudness: exp.loud, range: exp.onlySel && sel ? [sel.a, sel.b] : null, orfeu: exp.orfeu });
      delete box.dataset.busy;
      if (!r || r.canceled) { closeModal(); return; }
      if (r.error) { $('#xGo').disabled = false; $('#xGo').textContent = 'Exportar'; $('#xProg').hidden = true; flash(r.error); return; }
      P.lastExport = r.path;
      box.innerHTML = `<h2>Pronto</h2><div class="sum"><b>${esc(r.name)}</b><br>${esc(r.path.replace(/\/[^/]+$/, ''))}</div><div class="mbtns"><button class="btn" type="button" data-x="reveal">Mostrar no Finder</button><button class="btn" type="button" data-x="orfeu">Abrir no Orfeu</button><button class="btn primary" type="button" data-x="close">Fechar</button></div>`;
      renderAll();
      return;
    }
    const x = e.target.closest('[data-x]');
    if (x) { if (x.dataset.x === 'reveal') E.reveal(P.lastExport); if (x.dataset.x === 'orfeu') E.openOrfeu(P.lastExport); closeModal(); }
  };
  box.onchange = e => { if (e.target.id === 'xSel') { exp.onlySel = e.target.checked; draw(); } };
}
function closeModal() { $('#modal').hidden = true; delete $('#mbox').dataset.busy; }
E.onExport(d => { const p = $('#xProg'); if (p) p.querySelector('i').style.width = Math.round((d.pct || 0) * 100) + '%'; });
$('#exportBtn').addEventListener('click', openExport);
$('#orfeuBtn').addEventListener('click', () => { if (P && P.lastExport) E.openOrfeu(P.lastExport); });
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal' && !$('#mbox').dataset.busy) closeModal(); });

/* ---------- menu pequeno e avisos ---------- */
function popup(btn, items, fn) {
  const p = $('#pop'), r = btn.getBoundingClientRect();
  p.innerHTML = items.map(([l], i) => `<button type="button" data-i="${i}">${esc(l)}</button>`).join('');
  p.hidden = false; p.style.left = r.left + 'px'; p.style.top = (r.bottom + 4) + 'px';
  p.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; p.hidden = true; fn(items[+b.dataset.i][1]); };
}
document.addEventListener('mousedown', e => { if (!e.target.closest('#pop') && !e.target.closest('[data-op="volume"]')) $('#pop').hidden = true; });
let flashT = null;
function flash(m) { const b = $('#busy'); b.hidden = false; b.textContent = m; b.classList.add('msg'); clearTimeout(flashT); flashT = setTimeout(() => { b.hidden = true; b.classList.remove('msg'); }, 4000); }
function busy(m) { const b = $('#busy'); b.hidden = !m; b.textContent = m; }
E.onBusy(m => busy(m));

/* ---------- teclado ---------- */
document.addEventListener('keydown', e => {
  if (!P) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox') return;
  if (!$('#modal').hidden) { if (e.key === 'Escape' && !$('#mbox').dataset.busy) closeModal(); return; }
  const k = e.key, cmd = e.metaKey || e.ctrlKey;
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (cmd && k.toLowerCase() === 'z') { e.preventDefault(); goHist(e.shiftKey ? hidx + 1 : hidx - 1); }
  else if (cmd && k.toLowerCase() === 'x') { e.preventDefault(); OPS.cut(); }
  else if (cmd && k.toLowerCase() === 'c') { e.preventDefault(); OPS.copy(); }
  else if (cmd && k.toLowerCase() === 'v') { e.preventDefault(); OPS.paste(); }
  else if (cmd && k.toLowerCase() === 'a') { e.preventDefault(); const t = T(curT); if (t.clips.length) { sel = { tid: t.id, a: t.clips[0].at, b: Math.max(...t.clips.map(end)) }; renderAll(); } }
  else if (cmd && (k === '=' || k === '+')) { e.preventDefault(); setZoom(view.pps * 1.6); }
  else if (cmd && k === '-') { e.preventDefault(); setZoom(view.pps / 1.6); }
  else if (cmd && k === '0') { e.preventDefault(); fitView(); drawAll(); }
  else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); if (sel) OPS.del(); }
  else if (k === 'Escape') { sel = null; $('#pop').hidden = true; renderAll(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); seek(ph - (e.shiftKey ? 10 : 1)); follow(); }
  else if (k === 'ArrowRight') { e.preventDefault(); seek(ph + (e.shiftKey ? 10 : 1)); follow(); }
  else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); const ids = P.tracks.map(t => t.id); curT = ids[Math.max(0, Math.min(2, ids.indexOf(curT) + (k === 'ArrowUp' ? -1 : 1)))]; renderAll(); }
  else if (k === 'Home') { seek(0); follow(); }
  else if (k === 'End') { seek(projEnd()); follow(); }
});

/* ---------- arranque ---------- */
const setTheme = t => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; if (P) drawAll(); };
E.onTheme(setTheme);
E.onOpen(id => openProject(id));
(async () => {
  setTheme(await E.theme());
  renderPlay();
  await loadProjects();
  let last = null; try { last = localStorage.getItem('eco.last'); } catch (e) { /* ok */ }
  const go = projects.find(p => p.id === last) || projects[0];
  if (go) openProject(go.id); else showEmpty();
})();

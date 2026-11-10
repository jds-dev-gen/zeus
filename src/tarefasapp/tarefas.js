/* Tarefas do Zeus — temas (como no Apolo), cartões, arrastar entre temas, painel de cada tarefa.
   Os dados são os mesmos do MacGyver (processo principal); esta página só mostra e pede alterações. */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const COLOR_NAMES = { ouro: 'Ouro', salva: 'Salva', azul: 'Azul', rosa: 'Rosa', lavanda: 'Lavanda', terracota: 'Terracota', petroleo: 'Petróleo', grafite: 'Grafite' };
const PRIO_LABEL = { alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA' };

let S = null;
let view = 'board';
let showDone = false;
let openId = null;
let dragging = null;
try { view = localStorage.getItem('tarefas.view') || 'board'; showDone = localStorage.getItem('tarefas.done') === '1'; } catch (e) { /* ok */ }

/* ---------- dados ---------- */
let loading = null;
async function load(force) {
  if (loading && !force) return loading;
  loading = TF.state(!!force).then(s => {
    S = s;
    document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
    if (!dragging) render();
    return s;
  }).finally(() => { loading = null; });
  return loading;
}
let chT = null;
TF.onChanged(() => { clearTimeout(chT); chT = setTimeout(() => load(), 200); });
TF.onTheme(d => { document.documentElement.dataset.theme = d ? 'dark' : 'light'; });
const allTasks = () => S.tasks.concat(showDone ? S.done : []);
const byId = id => S.tasks.find(t => t.id === id) || S.done.find(t => t.id === id);
const areaById = id => S.areas.find(a => a.id === id);
function matches(t) {
  const q = fold($('#q').value).split(/\s+/).filter(Boolean);
  if (!q.length) return true;
  const hay = fold(t.title + ' ' + t.notes + ' ' + (areaById(t.area) || {}).name);
  return q.every(w => hay.includes(w));
}

/* ---------- datas ---------- */
const dParts = s => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
function shortDate(s) { const p = dParts(s); return `${p.d} ${MES[p.m - 1]}`; }
function dueLabel(t) {
  if (!t.due) return '';
  const day = t.due === S.today ? 'hoje' : t.due === S.tomorrow ? 'amanhã' : shortDate(t.due);
  return day + (t.time ? ' ' + t.time : '');
}
function createdLabel(t) { if (!t.created) return ''; const d = new Date(t.created); return `de ${d.getDate()} ${MES[d.getMonth()]}`; }

/* ---------- desenhar ---------- */
function render() {
  if (!S) return;
  const open = S.tasks.length, late = S.tasks.filter(t => t.overdue).length, today = S.tasks.filter(t => t.due && t.due <= S.today).length;
  $('#count').innerHTML = `${open} por fazer${today ? ` · ${today} para hoje` : ''}${late ? ` · <span class="late">${late} atrasada${late > 1 ? 's' : ''}</span>` : ''}`;
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('#showDone').checked = showDone;
  $('#addArea').hidden = view !== 'board';
  if (!S.areas.length && !S.tasks.length && !S.done.length) { renderWelcome(); renderDrawer(); return; }
  if (view === 'board') renderBoard(); else renderList();
  renderDrawer();
}
function renderWelcome() {
  $('#stage').innerHTML = `<div class="welcome"><h2>As tuas tarefas, por temas</h2>
    <p>Cria um tema para cada área (por exemplo um projeto, um podcast, uma equipa) e põe lá as tarefas. O MacGyver vê e mexe nas mesmas tarefas: pede-lhe para criar, arrumar ou lembrar-te delas.</p>
    <p>Para trazer as tarefas do Apolo: abre o Diário do Apolo no Zeus e pede ao MacGyver <b>“passa estas tarefas para as Tarefas”</b>.</p>
    <div class="row2"><button class="btn" type="button" data-firstarea>+ Criar o primeiro tema</button><button class="btn mg" type="button" data-mg><span class="dot"></span>Abrir o MacGyver</button></div></div>`;
}
function cardHTML(t) {
  const a = areaById(t.area);
  const color = a ? `var(--c-${a.color})` : '';
  const bits = [];
  if (t.notes) bits.push('<span class="ic" title="Tem notas">📝</span>');
  if (t.link) bits.push(t.link.kind === 'email' ? `<button class="chip lk" type="button" data-openlink title="Abrir o email">✉ email</button>` : `<button class="chip lk" type="button" data-openlink title="${esc(t.link.url)}">🔗 abrir</button>`);
  if (t.origin === 'google') bits.push('<span class="chip g" title="Do Google Tasks — arrasta para um tema para a arrumar aqui">Google</span>');
  if (t.due) bits.push(`<span class="chip ${t.overdue && !t.done ? 'late' : ''}" title="${t.overdue ? 'Atrasada' : 'Data'}">${t.overdue && !t.done ? 'atrasada · ' : ''}${esc(dueLabel(t))}</span>`);
  const cr = createdLabel(t); if (cr) bits.push(`<span>${cr}</span>`);
  return `<div class="card ${a ? '' : 'nocolor'} ${t.done ? 'done' : ''}" data-id="${esc(t.id)}" ${color ? `style="background:${color}"` : ''}>
    <button class="ck" type="button" data-ck title="${t.done ? 'Voltar a pôr por fazer' : 'Feita'}" aria-label="Feita"></button>
    <div class="tt">${esc(t.title)}</div>
    ${bits.length ? `<div class="mt">${bits.join('')}</div>` : ''}
    ${t.prio ? `<span class="prio ${t.prio}">${PRIO_LABEL[t.prio]}</span>` : ''}
  </div>`;
}
function colTasks(areaId) {
  const open = S.tasks.filter(t => (t.area || '') === areaId && matches(t)).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.created || 0) - (b.created || 0));
  const done = showDone ? S.done.filter(t => (t.area || '') === areaId && matches(t)) : [];
  return open.concat(done);
}
function renderBoard() {
  const cols = S.areas.map(a => ({ id: a.id, name: a.name, color: a.color }));
  if (S.tasks.some(t => !t.area) || (showDone && S.done.some(t => !t.area)) || !cols.length) cols.push({ id: '', name: 'Sem tema', color: '' });
  let h = `<div class="board" id="board" data-n="${cols.length + 1}">`;
  for (const c of cols) {
    const tt = colTasks(c.id), n = tt.filter(t => !t.done).length;
    h += `<section class="col" data-area="${esc(c.id)}">
      <div class="ch"><span class="cd" style="background:${c.color ? `var(--c-${c.color})` : 'var(--line2)'}"></span><h2 title="${esc(c.name)}">${esc(c.name)}</h2><span class="n">${n}</span>${c.id ? `<button class="more" type="button" data-amenu="${esc(c.id)}" title="Opções do tema" aria-label="Opções do tema">⋯</button>` : ''}</div>
      <div class="cards">${tt.map(cardHTML).join('') || `<div class="empty-col">${$('#q').value ? 'Nada com essas palavras.' : 'Sem tarefas.'}</div>`}</div>
      <label class="add"><span>+</span><input data-addin="${esc(c.id)}" placeholder="Tarefa neste tema" maxlength="300"></label>
    </section>`;
  }
  h += `<div class="newcol" id="newcol"><button type="button" data-newarea>+ Tema novo</button></div></div>`;
  const sy = $('#stage').scrollTop;
  $('#stage').innerHTML = h;
  fitCols();
  $('#stage').scrollTop = sy;
}
// como os espaços: 4 temas por linha se couberem com pelo menos 300 px cada, senão 3 (menos num ecrã estreito)
function fitCols() {
  const b = $('#board'); if (!b) return;
  const w = $('#stage').clientWidth - 44, gap = 18, items = +b.dataset.n || 1;
  const n = w >= 4 * 300 + 3 * gap ? 4 : w >= 3 * 250 + 2 * gap ? 3 : w >= 2 * 240 + gap ? 2 : 1;
  b.style.setProperty('--cols', Math.min(n, items));
}
window.addEventListener('resize', fitCols);
function renderList() {
  const add = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const wk = add(S.today, 7);
  const tasks = S.tasks.filter(matches).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') || ({ alta: 0, media: 1, baixa: 2 }[a.prio] ?? 3) - ({ alta: 0, media: 1, baixa: 2 }[b.prio] ?? 3));
  const groups = [
    ['Atrasadas', tasks.filter(t => t.due && t.due < S.today), 'late'],
    ['Hoje', tasks.filter(t => t.due === S.today)],
    ['Amanhã', tasks.filter(t => t.due === S.tomorrow)],
    ['Próximos 7 dias', tasks.filter(t => t.due > S.tomorrow && t.due <= wk)],
    ['Mais tarde', tasks.filter(t => t.due > wk)],
    ['Sem data', tasks.filter(t => !t.due)]
  ];
  if (showDone) groups.push(['Feitas (últimos 30 dias)', S.done.filter(matches)]);
  const row = t => {
    const a = areaById(t.area);
    return `<div class="row ${t.done ? 'done' : ''}" data-id="${esc(t.id)}"><button class="ck" type="button" data-ck aria-label="Feita"></button>
      <div class="tt">${t.time ? `<span class="tm">${esc(t.time)}</span>` : ''}${esc(t.title)}</div>
      <div class="rm">${a ? `<span class="ar"><i style="background:var(--c-${a.color})"></i>${esc(a.name)}</span>` : t.origin === 'google' ? '<span>Google Tasks</span>' : ''}${t.prio ? `<span class="pr ${t.prio}">${PRIO_LABEL[t.prio]}</span>` : ''}${t.due ? `<span>${esc(t.due < S.today ? 'era para ' + shortDate(t.due) : dueLabel(t))}</span>` : ''}</div></div>`;
  };
  let h = '<div class="list">';
  for (const [name, tt, cls] of groups) if (tt.length) h += `<div class="sec ${cls || ''}"><span>${name}</span><span>${tt.length}</span></div>${tt.map(row).join('')}`;
  if (!tasks.length && !(showDone && S.done.length)) h += '<div class="welcome"><p>Não há tarefas por fazer.</p></div>';
  $('#stage').innerHTML = h + '</div>';
}

/* ---------- painel de uma tarefa ---------- */
let delSure = false;
function renderDrawer() {
  const d = $('#drawer');
  const t = openId && byId(openId);
  if (!t) { d.hidden = true; openId = null; return; }
  if (!d.hidden && d.dataset.id === t.id && d.contains(document.activeElement) && document.activeElement !== d) return;   // a escrever: não redesenha
  const a = areaById(t.area);
  const g = t.origin === 'google';
  d.dataset.id = t.id;
  d.innerHTML = `
    <div class="dh"><span class="bar" style="background:${a ? `var(--c-${a.color})` : 'var(--line2)'}"></span><span class="dn">${a ? esc(a.name) : 'Sem tema'}${t.done ? ' · feita' : ''}</span><button class="ib" type="button" data-dclose title="Fechar (Esc)" aria-label="Fechar">✕</button></div>
    <div class="db">
      <textarea class="dtitle" id="dTitle" rows="2" maxlength="300">${esc(t.title)}</textarea>
      <div class="f"><span>Tema</span><select id="dArea"><option value="">Sem tema</option>${S.areas.map(x => `<option value="${esc(x.id)}" ${x.id === t.area ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="f"><span>Prioridade</span><div class="pseg" id="dPrio">${['alta', 'media', 'baixa', ''].map(p => `<button type="button" data-p="${p}" class="${p || 'none'} ${(t.prio || '') === p ? 'on' : ''}">${p ? PRIO_LABEL[p] : '—'}</button>`).join('')}</div></div>
      <div class="f"><span>Data</span><div class="two"><input type="date" id="dDue" value="${esc(t.due)}"><input type="time" id="dTime" value="${esc(t.time)}" title="Com hora, o MacGyver avisa-te a essa hora" ${g ? 'disabled' : ''}></div></div>
      <textarea class="dnotes" id="dNotes" placeholder="Notas…" ${g ? 'disabled title="Arruma-a num tema para poderes escrever notas"' : ''}>${esc(t.notes)}</textarea>
      ${t.link ? `<a class="dlink" href="#" data-dlink title="${esc(t.link.url)}">${t.link.kind === 'email' ? '✉' : '🔗'} ${esc(t.link.title || t.link.url)}</a>` : ''}
      <div class="dmeta">${[t.created ? 'Criada a ' + new Date(t.created).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' }) : '', t.source ? 'Origem: ' + esc(t.source) : '', t.synced && !g ? 'Também no Google Tasks (telemóvel)' : '', g ? 'Do Google Tasks. Põe-na num tema ou dá-lhe prioridade para passar a ser arrumada aqui (continua ligada à do Google).' : ''].filter(Boolean).join('<br>')}</div>
    </div>
    <div class="dfoot"><button class="btn p" type="button" data-ddone>${t.done ? 'Voltar a pôr por fazer' : '✓ Feita'}</button><span class="spacer"></span><button class="btn del ${delSure ? 'sure' : ''}" type="button" data-ddel>${delSure ? 'Apagar mesmo?' : 'Apagar'}</button></div>`;
  d.hidden = false;
}
function openDrawer(id) { openId = id; delSure = false; $('#drawer').dataset.id = ''; renderDrawer(); }
async function change(id, o) {
  const r = await TF.change(id, o);
  if (r && r.ok === false) toast(r.error);
  await load();
}
$('#drawer').addEventListener('change', e => {
  const t = byId(openId); if (!t) return;
  if (e.target.id === 'dArea') change(t.id, { area: e.target.value });
  if (e.target.id === 'dDue') change(t.id, { due: e.target.value });
  if (e.target.id === 'dTime') change(t.id, { time: e.target.value });
});
$('#drawer').addEventListener('focusout', e => {
  const t = byId(openId); if (!t) return;
  if (e.target.id === 'dTitle' && e.target.value.trim() && e.target.value.trim() !== t.title) change(t.id, { title: e.target.value.trim() });
  if (e.target.id === 'dNotes' && e.target.value !== t.notes) change(t.id, { notes: e.target.value });
});
$('#drawer').addEventListener('keydown', e => { if (e.target.id === 'dTitle' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
let delT = null;
$('#drawer').addEventListener('click', async e => {
  const t = byId(openId); if (!t) return;
  if (e.target.closest('[data-dclose]')) { openId = null; renderDrawer(); return; }
  const p = e.target.closest('[data-p]'); if (p) { change(t.id, { prio: p.dataset.p }); return; }
  if (e.target.closest('[data-dlink]')) { e.preventDefault(); TF.open(t.id); return; }
  if (e.target.closest('[data-ddone]')) { await doneToggle(t); return; }
  if (e.target.closest('[data-ddel]')) {
    if (!delSure) { delSure = true; $('#drawer').dataset.id = ''; renderDrawer(); clearTimeout(delT); delT = setTimeout(() => { delSure = false; $('#drawer').dataset.id = ''; renderDrawer(); }, 4000); return; }
    delSure = false; openId = null;
    const r = await TF.remove(t.id); if (r && r.ok === false) toast(r.error);
    await load();
  }
});

/* ---------- ações ---------- */
let toastT = null, undoFn = null;
function toast(msg, undo) {
  const el = $('#toast'); undoFn = undo || null;
  el.innerHTML = esc(msg) + (undo ? ' <button type="button" data-undo>Desfazer</button>' : '');
  el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; undoFn = null; }, 5000);
}
$('#toast').addEventListener('click', async e => { if (e.target.closest('[data-undo]') && undoFn) { const f = undoFn; undoFn = null; $('#toast').hidden = true; await f(); } });
async function doneToggle(t) {
  const undo = !!t.done;
  const r = await TF.done(t.id, undo);
  if (r && r.ok === false) { toast(r.error); return; }
  if (!undo) toast(`Feita: ${t.title}`, async () => { await TF.done(t.id, true); await load(); });
  if (openId === t.id && !undo && !showDone) openId = null;
  await load();
}
async function addIn(input) {
  const title = input.value.trim(); if (!title) return;
  const area = input.dataset.addin;
  input.value = '';
  const r = await TF.add({ title, area });
  if (r && r.ok === false) { toast(r.error); return; }
  await load();
  const again = document.querySelector(`[data-addin="${CSS.escape(area)}"]`);
  if (again) { again.focus(); const c = again.closest('.col').querySelector('.cards'); c.scrollTop = c.scrollHeight; }
}
async function newArea(name) {
  name = String(name || '').trim(); if (!name) return;
  const r = await TF.addArea(name);
  if (r && r.ok === false) { toast(r.error); return; }
  await load();
  setTimeout(() => { const i = document.querySelector(`[data-addin="${CSS.escape(r.area.id)}"]`); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); } }, 30);
}
function newAreaInput() {
  const nc = $('#newcol') || null;
  if (!nc) { view = 'board'; render(); return newAreaInput(); }
  nc.innerHTML = '<input id="naIn" placeholder="Nome do tema" maxlength="60"><small>Enter para criar · Esc cancela</small>';
  const i = $('#naIn'); i.focus();
  i.addEventListener('keydown', e => { if (e.key === 'Enter') newArea(i.value); if (e.key === 'Escape') render(); });
  i.addEventListener('blur', () => setTimeout(() => { if ($('#naIn') && !$('#naIn').value.trim()) render(); }, 150));
  nc.scrollIntoView({ block: 'center' });
}

/* menu de um tema */
function areaMenu(id, anchor) {
  const a = areaById(id); if (!a) return;
  const pop = $('#pop');
  pop.innerHTML = `<button type="button" data-ar="rename">Mudar o nome</button>
    <div class="sw">${S.colors.map(c => `<i data-color="${c}" class="${c === a.color ? 'on' : ''}" title="${COLOR_NAMES[c] || c}" style="background:var(--c-${c})"></i>`).join('')}</div>
    <hr><button type="button" data-ar="left">← Mover para a esquerda</button><button type="button" data-ar="right">Mover para a direita →</button>
    <hr><button type="button" class="red" data-ar="del">Apagar o tema…</button>`;
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(innerWidth - 210, r.left - 160) + 'px'; pop.style.top = (r.bottom + 6) + 'px';
  pop.hidden = false; pop.dataset.area = id;
}
$('#pop').addEventListener('click', async e => {
  const id = $('#pop').dataset.area, a = areaById(id); if (!a) return;
  const c = e.target.closest('[data-color]');
  if (c) { $('#pop').hidden = true; await TF.changeArea(id, { color: c.dataset.color }); return load(); }
  const ar = e.target.closest('[data-ar]'); if (!ar) return;
  const k = ar.dataset.ar;
  if (k === 'rename') {
    $('#pop').hidden = true;
    const h2 = document.querySelector(`.col[data-area="${CSS.escape(id)}"] h2`); if (!h2) return;
    const inp = document.createElement('input'); inp.value = a.name; inp.maxLength = 60; h2.replaceWith(inp); inp.focus(); inp.select();
    const done = async ok => { if (ok && inp.value.trim() && inp.value.trim() !== a.name) await TF.changeArea(id, { name: inp.value.trim() }); load(); };
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } if (ev.key === 'Escape') { inp.value = a.name; inp.blur(); } });
    inp.addEventListener('blur', () => done(true));
    return;
  }
  if (k === 'left' || k === 'right') { $('#pop').hidden = true; await TF.changeArea(id, { move: k === 'left' ? -1 : 1 }); return load(); }
  if (k === 'del') {
    if (ar.dataset.sure) { $('#pop').hidden = true; await TF.removeArea(id); toast(`Tema “${a.name}” apagado; as tarefas ficaram sem tema.`); return load(); }
    const n = S.tasks.filter(t => t.area === id).length;
    ar.dataset.sure = '1'; ar.textContent = n ? `Apagar? (${n} tarefa${n > 1 ? 's' : ''} fica${n > 1 ? 'm' : ''} sem tema)` : 'Apagar mesmo?';
  }
});
document.addEventListener('mousedown', e => { if (!$('#pop').hidden && !e.target.closest('#pop') && !e.target.closest('[data-amenu]')) $('#pop').hidden = true; });

/* cliques no palco */
$('#stage').addEventListener('click', async e => {
  if (dragJustEnded) return;
  const t = e.target;
  const m = t.closest('[data-amenu]'); if (m) { areaMenu(m.dataset.amenu, m); return; }
  if (t.closest('[data-newarea]') || t.closest('[data-firstarea]')) { if (t.closest('[data-firstarea]')) { view = 'board'; $('#stage').innerHTML = '<div class="board"><div class="newcol" id="newcol"></div></div>'; } newAreaInput(); return; }
  if (t.closest('[data-mg]')) { TF.macgyver(); return; }
  const el = t.closest('[data-id]'); if (!el) return;
  const task = byId(el.dataset.id); if (!task) return;
  if (t.closest('[data-ck]')) { await doneToggle(task); return; }
  if (t.closest('[data-openlink]')) { TF.open(task.id); return; }
  openDrawer(task.id);
});
$('#stage').addEventListener('keydown', e => { const i = e.target.closest('[data-addin]'); if (i && e.key === 'Enter') { e.preventDefault(); addIn(i); } if (i && e.key === 'Escape') { i.value = ''; i.blur(); } });

/* ---------- arrastar cartões (entre temas e para mudar a ordem) ---------- */
let dragJustEnded = false;
$('#stage').addEventListener('pointerdown', e => {
  if (view !== 'board' || e.button !== 0) return;
  const card = e.target.closest('.card'); if (!card || e.target.closest('[data-ck]')) return;
  const t = byId(card.dataset.id); if (!t || t.done) return;
  const start = { x: e.clientX, y: e.clientY };
  const r = card.getBoundingClientRect();
  const off = { x: e.clientX - r.left, y: e.clientY - r.top };
  let ghost = null, slot = null, raf = 0, last = e;
  const move = ev => {
    last = ev;
    if (!ghost) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      dragging = t.id;
      ghost = card.cloneNode(true); ghost.classList.add('ghost'); ghost.style.width = r.width + 'px'; document.body.appendChild(ghost);
      slot = document.createElement('div'); slot.className = 'slot'; slot.style.height = r.height + 'px';
      card.after(slot); card.style.display = 'none';
      document.body.style.cursor = 'grabbing';
      if (!raf) raf = requestAnimationFrame(autoScroll);
    }
    ghost.style.left = (ev.clientX - off.x) + 'px'; ghost.style.top = (ev.clientY - off.y) + 'px';
    place(ev.clientX, ev.clientY);
  };
  function place(x, y) {
    // o tema debaixo do rato (ou o mais perto, nos espaços entre colunas e linhas)
    let col = null, best = 1e9;
    for (const c of document.querySelectorAll('.col')) { const b = c.getBoundingClientRect(); const dx = x < b.left ? b.left - x : x > b.right ? x - b.right : 0, dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0; const d = dx + dy; if (d < best) { best = d; col = c; } }
    if (best > 60) col = null;
    document.querySelectorAll('.col.drop').forEach(c => c !== col && c.classList.remove('drop'));
    if (!col) return;
    col.classList.add('drop');
    const list = col.querySelector('.cards');
    const cards = [...list.querySelectorAll('.card')].filter(c => c !== card && c.style.display !== 'none' && !c.classList.contains('done'));
    let before = null;
    for (const c of cards) { const b = c.getBoundingClientRect(); if (y < b.top + b.height / 2) { before = c; break; } }
    const emp = list.querySelector('.empty-col'); if (emp) emp.remove();
    if (before) { if (slot.nextSibling !== before) list.insertBefore(slot, before); }
    else { const firstDone = list.querySelector('.card.done'); if (firstDone) list.insertBefore(slot, firstDone); else if (slot.parentElement !== list || slot.nextSibling) list.appendChild(slot); }
  }
  function autoScroll() {
    raf = 0; if (!ghost) return;
    const st = $('#stage'), b = st.getBoundingClientRect(), x = last.clientX, y = last.clientY;
    if (y > b.bottom - 60) st.scrollTop += Math.ceil((y - (b.bottom - 60)) / 3); else if (y < b.top + 60) st.scrollTop -= Math.ceil(((b.top + 60) - y) / 3);
    place(x, y);
    raf = requestAnimationFrame(autoScroll);
  }
  const up = async () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', esc_);
    if (!ghost) return;
    cancelAnimationFrame(raf); raf = 0;
    document.body.style.cursor = '';
    document.querySelectorAll('.col.drop').forEach(c => c.classList.remove('drop'));
    const col = slot.closest('.col');
    const ids = col ? [...col.querySelectorAll('.cards > .card:not(.done), .cards > .slot')].map(el => el === slot ? t.id : el.dataset.id).filter(id => id) : null;
    ghost.remove(); ghost = null;
    dragJustEnded = true; setTimeout(() => { dragJustEnded = false; }, 50);
    if (ids && col) {
      const area = col.dataset.area;
      // a lista muda logo; o processo principal confirma
      ids.forEach((id, i) => { const x = byId(id); if (x) { x.area = area; x.order = i + 1; } });
      slot.replaceWith(card); card.style.display = '';
      dragging = null; render();
      const r2 = await TF.reorder(area, ids);
      if (r2 && r2.ok === false) toast(r2.error);
      const a = areaById(area); if (a && t.area !== area) toast(`Passou para “${a.name}”.`);
    } else { slot.replaceWith(card); card.style.display = ''; dragging = null; }
    load();
  };
  const esc_ = ev => { if (ev.key === 'Escape' && ghost) { ghost.remove(); ghost = null; slot.replaceWith(card); card.style.display = ''; dragging = null; document.body.style.cursor = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); render(); } };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('keydown', esc_);
});

/* ---------- cabeçalho e teclado ---------- */
$('#views').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (!b) return; view = b.dataset.view; try { localStorage.setItem('tarefas.view', view); } catch (x) { /* ok */ } render(); });
$('#showDone').addEventListener('change', e => { showDone = e.target.checked; try { localStorage.setItem('tarefas.done', showDone ? '1' : '0'); } catch (x) { /* ok */ } render(); });
$('#q').addEventListener('input', () => render());
$('#addArea').addEventListener('click', () => newAreaInput());
$('#mgBtn').addEventListener('click', () => TF.macgyver());
document.addEventListener('keydown', e => {
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.key === 'Escape') {
    if (!$('#pop').hidden) { $('#pop').hidden = true; return; }
    if (inField) { document.activeElement.blur(); return; }
    if (openId) { openId = null; renderDrawer(); return; }
    if ($('#q').value) { $('#q').value = ''; render(); }
    return;
  }
  if (inField) return;
  if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) { e.preventDefault(); $('#q').focus(); return; }
  if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (view !== 'board') { view = 'board'; render(); } const i = document.querySelector('[data-addin]'); if (i) i.focus(); }
});

load(true);
setInterval(() => { if (!dragging && !document.hidden) load(); }, 120000);

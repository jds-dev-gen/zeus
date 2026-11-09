/* MacGyver — a bolinha, o balão e o painel. Tudo o que é dado vem do processo principal (window.MG). */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

let ST = null;              // estado vindo do processo principal
let mode = 'orb';           // orb | bubble | panel
let tab = 'today';
let settingsOpen = false;
let bubble = null;          // { type: alert | listen | voice | info, ... }
const alertQ = [];          // avisos à espera de serem vistos
const panelAlerts = [];     // avisos chegados com o painel aberto
let thinking = false, speaking = false, transcribing = false;
let listening = false, listenBy = '';
let micLevel = 0;
let ctxOn = true;
let doneLocal = new Set();

/* ---------- bola de energia ---------- */
let raf = 0, active = true, hover = false, lastDraw = 0;
function orbMode() {
  if (listening) return 'listen';
  if (thinking || transcribing) return 'think';
  if (alertQ.length || (bubble && bubble.type === 'alert')) return 'alert';
  return 'calm';
}
function level(t) {
  if (listening) return Math.min(1, micLevel * 7);
  if (speaking) return 0.25 + 0.25 * Math.abs(Math.sin(t * 0.009)) * Math.abs(Math.sin(t * 0.0037));
  return 0;
}
function drawAll(t) {
  const m = orbMode(), lv = level(t);
  document.querySelectorAll('canvas.oc').forEach(c => { if (c.offsetParent !== null || c.classList.contains('big')) drawOrb(c, t, m, lv); });
  document.body.className = 'm-' + m;
}
function loop(t) {
  raf = requestAnimationFrame(loop);
  const m = orbMode();
  const fps = m === 'calm' && !hover && mode === 'orb' ? 20 : 40;
  if (t - lastDraw < 1000 / fps) return;
  lastDraw = t;
  drawAll(t);
  if (listening) updateWave();
}
function startLoop() { if (!raf && active && !document.hidden) raf = requestAnimationFrame(loop); }
function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; drawAll(performance.now()); }
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else startLoop(); });
MG.onFocus(f => { active = !!f || listening || thinking; if (active) startLoop(); else stopLoop(); });
$('#orb').addEventListener('mouseenter', () => { hover = true; });
$('#orb').addEventListener('mouseleave', () => { hover = false; });

/* ---------- tamanho da vista ---------- */
function relayout() {
  if (mode === 'panel') { MG.layout('panel', 0); return; }
  if (mode === 'bubble') { requestAnimationFrame(() => { const b = $('#bubble'); MG.layout('bubble', (b.offsetHeight || 160) + 92 + 40); }); return; }
  MG.layout('orb', 0);
}
function setMode(m) {
  mode = m;
  $('#panel').hidden = m !== 'panel';
  $('#bubble').hidden = m !== 'bubble';
  relayout();
  if (m === 'panel') { renderPanel(); setTimeout(() => { if (!settingsOpen) $('#q').focus(); }, 60); }
}

/* ---------- estado ---------- */
let refreshing = null;
async function refresh(force) {
  if (refreshing && !force) return refreshing;
  refreshing = MG.state(!!force).then(s => {
    ST = s; doneLocal = new Set();
    document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
    renderBadge();
    if (mode === 'panel') renderPanel();
    return s;
  }).finally(() => { refreshing = null; });
  return refreshing;
}
let chT = null;
MG.onChanged(() => { clearTimeout(chT); chT = setTimeout(() => refresh(), 250); });
MG.onTheme(d => { document.documentElement.dataset.theme = d ? 'dark' : 'light'; });
MG.onState(d => {
  if ('thinking' in d) { thinking = d.thinking; if (thinking) startLoop(); }
  if ('speaking' in d) { speaking = d.speaking; if (speaking) startLoop(); }
});

const pendingToday = () => ST ? ST.tasks.filter(t => t.due && t.due <= ST.today && !doneLocal.has(t.id)) : [];
function renderBadge() {
  const p = pendingToday(), late = p.filter(t => t.overdue).length;
  const b = $('#badge');
  b.hidden = !p.length; b.textContent = p.length > 99 ? '99+' : p.length;
  b.classList.toggle('calm', !late);
  $('#orb').title = `MacGyver — ${p.length ? p.length + ' por fazer hoje' + (late ? `, ${late} atrasada${late > 1 ? 's' : ''}` : '') : 'nada por fazer hoje'} · carrega para abrir · ⌥ Espaço para falar`;
}

/* ---------- painel ---------- */
const ddmm = s => s ? s.split('-').reverse().slice(0, 2).join('/') : '';
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function dayName(s) {
  if (!ST) return s;
  if (s === ST.today) return 'Hoje';
  if (s === ST.tomorrow) return 'Amanhã';
  const d = new Date(s + 'T12:00:00'); return `${WD[d.getDay()]}, ${d.getDate()} ${MES[d.getMonth()]}`;
}
const hhmm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const evDay = e => { const d = new Date(e.start); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function taskRow(t, showDay) {
  const done = doneLocal.has(t.id);
  const bits = [];
  if (t.overdue && t.due < ST.today) bits.push(esc('Era para ' + (t.due === addDay(ST.today, -1) ? 'ontem' : ddmm(t.due))));
  else if (showDay && t.due) bits.push(esc(dayName(t.due)));
  if (t.link) bits.push(`<a data-open="${esc(t.id)}" title="${esc(t.link.url)}">${esc(t.link.title || hostOf(t.link.url))}</a>`);
  if (t.source) bits.push(esc(t.source));
  else if (t.origin === 'mg' && t.synced) bits.push('também no Google Tasks');
  const meta = bits.join(' · ');
  return `<div class="task ${t.overdue ? 'late' : ''} ${done ? 'done' : ''}" data-id="${esc(t.id)}">
    <button class="ck" type="button" data-done title="Feita" aria-label="Marcar como feita"></button>
    <div class="tb"><div class="tt">${t.time ? `<span class="tm">${esc(t.time)}</span>` : ''}${esc(t.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
    <div class="tacts">${t.due !== ST.tomorrow ? '<button type="button" data-tomorrow>Amanhã</button>' : ''}<button type="button" data-del>Apagar</button></div>
  </div>`;
}
function addDay(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
function agendaChips(day) {
  const now = Date.now();
  const evs = ST.events.filter(e => evDay(e) === day);
  if (!evs.length) return '';
  return `<div class="agenda">${evs.map(e => {
    const st = new Date(e.start).getTime(), en = new Date(e.end).getTime();
    const cls = e.allDay ? '' : en < now ? 'past' : st <= now ? 'now' : '';
    return `<span class="ev ${cls}" title="${esc(e.title)}${e.location ? ' — ' + esc(e.location) : ''}"><b>${e.allDay ? 'Dia' : hhmm(e.start)}</b>${esc(e.title)}</span>`;
  }).join('')}</div>`;
}
function renderPanel() {
  if (!ST) return;
  const p = pendingToday(), late = p.filter(t => t.overdue).length;
  $('#sub').innerHTML = p.length ? `${p.length} por fazer hoje${late ? ` · <span class="late">${late} atrasada${late > 1 ? 's' : ''}</span>` : ''}` : 'Nada por fazer hoje';
  $('#main').hidden = settingsOpen; $('#settings').hidden = !settingsOpen; $('#setBtn').classList.toggle('on', settingsOpen);
  if (settingsOpen) { renderSettings(); return; }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const tasks = ST.tasks;
  let h = '';
  const addRow = `<label class="add"><span class="plus">+</span><input id="addIn" placeholder="Nova tarefa para ${tab === 'next' ? 'amanhã' : 'hoje'}… (Enter)" maxlength="300"></label>`;
  if (tab === 'today') {
    const tt = tasks.filter(t => t.due && t.due <= ST.today);
    const ag = agendaChips(ST.today);
    if (ag) h += `<div class="sec"><span>Agenda</span></div>${ag}`;
    h += `<div class="sec"><span>Por fazer</span></div>`;
    h += tt.length ? tt.map(t => taskRow(t)).join('') : '<div class="empty">Nada para hoje. Pede-me o que precisares.</div>';
    h += addRow;
  } else if (tab === 'next') {
    let any = false;
    for (let i = 1; i <= 7; i++) {
      const d = addDay(ST.today, i);
      const tt = tasks.filter(t => t.due === d), ag = agendaChips(d);
      if (!tt.length && !ag) continue;
      any = true;
      h += `<div class="sec"><span>${esc(dayName(d))}</span></div>${ag}${tt.map(t => taskRow(t)).join('')}`;
    }
    if (!any) h += '<div class="empty">Nada nos próximos 7 dias.</div>';
    h += addRow;
  } else {
    const groups = [['Atrasadas', tasks.filter(t => t.due && t.due < ST.today)], ['Hoje', tasks.filter(t => t.due === ST.today)], ['Próximos dias', tasks.filter(t => t.due > ST.today)], ['Sem data', tasks.filter(t => !t.due)]];
    for (const [name, tt] of groups) if (tt.length) h += `<div class="sec"><span>${name}</span><span>${tt.length}</span></div>${tt.map(t => taskRow(t, name === 'Próximos dias')).join('')}`;
    if (!tasks.length) h += '<div class="empty">Não há tarefas por fazer.</div>';
  }
  if (ST.feeds.old.length && tab === 'today') h += `<p class="note">As tarefas que crio ainda ficam só no Mac. <button class="linkbtn" type="button" data-gosettings>Pôr também no telemóvel…</button></p>`;
  if (!ST.feeds.count) h += '<p class="note">Para ver a agenda e as tarefas do Google, liga as contas na página principal do Zeus (Agenda e tarefas de hoje).</p>';
  for (const e of ST.errors || []) h += `<p class="err">${esc(e.label)}: ${esc(e.error)}</p>`;
  $('#list').innerHTML = h;
  renderChat();
  renderCtx();
}
function renderChat() {
  const c = $('#chat');
  const msgs = ST.chat || [];
  let h = '';
  if (!msgs.length) {
    h = `<div class="hello"><b>Olá, João.</b><span>Diz-me o que tens de fazer e eu lembro-te. Experimenta:</span>
      ${ST.page ? '<button type="button" data-say="Resume esta página.">Resume esta página</button>' : ''}
      <button type="button" data-say="O que tenho hoje?">O que tenho hoje?</button>
      <button type="button" data-say="Lembra-me de responder a isto amanhã às 10">Lembra-me de responder a isto amanhã às 10</button>
      <button type="button" data-say="Que tarefas ficaram da última reunião?">Que tarefas ficaram da última reunião?</button></div>`;
  }
  for (const m of msgs) {
    if (m.role === 'me') { h += `<div class="me">${m.voice ? '<span class="vo">🎙</span>' : ''}${esc(m.text)}</div>`; continue; }
    h += `<div class="ai ${m.err ? 'err' : ''}">${md(m.text)}${(m.made || []).map(t => `<div class="made"><span class="ck"></span><div>${esc(t.title)}<small>${[t.due ? dayName(t.due) : 'Sem data', t.time ? 'às ' + t.time : '', t.link ? 'com a página ligada' : ''].filter(Boolean).join(' · ')}</small></div></div>`).join('')}${(m.steps || []).length ? `<div class="steps">${m.steps.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}${(m.notes || []).map(n => `<button type="button" class="notelink" data-note="${esc(n.id)}">📝 ${esc(n.title)}</button>`).join(' ')}${m.err && !ST.key ? '<div class="row"><button class="b p" type="button" data-gokey>Pôr a chave</button></div>' : ''}</div>`;
  }
  for (const a of panelAlerts) h += `<div class="ai"><b>${esc(a.title)}</b>${a.text ? '\n' + esc(a.text) : ''}<div class="acts">${a.actions.map((x, i) => `<button class="b ${x.primary ? 'p' : ''}" type="button" data-pact="${esc(a.id)}|${i}">${esc(x.label)}</button>`).join('')}</div></div>`;
  if (thinking) h += '<div class="ai think">A pensar<span class="dots"></span></div>';
  c.innerHTML = h;
  c.scrollTop = c.scrollHeight;
}
function renderCtx() {
  const b = $('#ctx'), p = ST && ST.page;
  b.hidden = !p; $('#sumBtn').hidden = !p || thinking;
  if (p) { b.textContent = '📄 ' + (p.title || hostOf(p.url)); b.classList.toggle('off', !ctxOn); b.title = ctxOn ? 'O MacGyver pode ver esta página. Carrega para não a usar nesta conversa.' : 'O MacGyver não vai ver esta página. Carrega para voltar a usar.'; }
}
function renderSettings() {
  const s = ST.settings, f = ST.feeds;
  const sw = (k, on) => `<input class="sw" type="checkbox" data-set="${k}" ${on ? 'checked' : ''}>`;
  let google;
  if (!f.count) google = '<p class="note">Nenhuma conta Google ligada. Liga-as na página principal do Zeus (Agenda e tarefas de hoje): o MacGyver passa a ver a agenda e as tarefas do Google.</p>';
  else if (f.write) google = `<p class="note">As tarefas que crio vão também para o <b>Google Tasks</b> de <b>${esc(f.write)}</b> — aparecem no telemóvel.</p>${f.all.filter(x => x.v >= 2).length > 1 ? `<div class="opt">Conta onde crio tarefas <select data-set="feed">${f.all.filter(x => x.v >= 2).map(x => `<option value="${esc(x.id)}" ${x.label === f.write ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>` : ''}`;
  else google = '';
  if (f.old.length) google += `<p class="note">Para as minhas tarefas aparecerem também no telemóvel (Google Tasks), o código do Apps Script de <b>${esc(f.old.join(', '))}</b> tem de ser atualizado. Carrega no botão: copio o código novo e abro o Apps Script — cola-o por cima do antigo, guarda, e em <b>Implementar › Gerir implementações</b> edita a implementação com <b>Versão: Nova versão</b>.</p><div class="row"><button class="b p" type="button" data-script>Copiar o código e abrir o Apps Script</button></div>`;
  const v = ST.voice;
  $('#settings').innerHTML = `
    ${f.old.length ? `<h3>Telemóvel</h3>${google}` : ''}
    <h3>Avisos</h3>
    <label class="opt"><span>Resumo da manhã<small>A primeira vez que abres o Zeus depois das 7h</small></span>${sw('morning', s.morning)}</label>
    <div class="opt"><span>Antes das reuniões<small>Com a agenda das contas Google</small></span><span style="display:flex;gap:8px;align-items:center"><select data-set="meetingLead">${[5, 10, 15].map(n => `<option value="${n}" ${s.meetingLead === n ? 'selected' : ''}>${n} min</option>`).join('')}</select>${sw('meetings', s.meetings)}</span></div>
    <div class="opt"><span>Balanço do fim do dia<small>O que ficou por fazer, para passar para amanhã</small></span><span style="display:flex;gap:8px;align-items:center"><select data-set="eveningAt">${['17:30', '18:00', '18:30', '19:00', '19:30', '20:00'].map(x => `<option ${s.eveningAt === x ? 'selected' : ''}>${x}</option>`).join('')}</select>${sw('evening', s.evening)}</span></div>
    <h3>Voz</h3>
    <label class="opt"><span>Responder em voz alta<small>Quando lhe falas (⌥ Espaço ou o micro)</small></span>${sw('speak', s.speak)}</label>
    ${v.ok ? '<p class="note">Carrega em <b>⌥ Espaço</b> e fala: envio quando parares (ou carrega outra vez). A voz é transcrita no próprio Mac.</p>' : `<p class="note">${esc(v.why)}</p>${v.model ? '<div class="row"><button class="b" type="button" data-notas>Abrir as Notas</button></div>' : ''}`}
    ${f.old.length ? '' : `<h3>Google</h3>${google}`}
    <h3>Claude</h3>
    ${ST.key ? '<p class="note">A conversa usa a chave da API da Anthropic guardada nas Notas.</p>' : '<p class="note">Para conversar, cola aqui a chave da API da Anthropic (fica guardada no Porta-chaves, a mesma das Notas).</p><input class="key" id="keyIn" type="password" placeholder="sk-ant-…" autocomplete="off"><div class="row"><button class="b p" type="button" data-savekey>Guardar a chave</button></div><p class="err" id="keyErr" hidden></p>'}
    <div class="row" style="margin-top:18px"><button class="b" type="button" data-clear>Começar conversa nova</button><button class="b" type="button" data-hide>Esconder a bolinha</button></div>
    <p class="note">Para voltar a mostrar a bolinha: menu Ver › MacGyver (⇧⌘M).</p>`;
}

/* ---------- conversa ---------- */
async function send(text, opts = {}) {
  text = String(text || '').trim();
  if (!text || thinking) return;
  if (!ST.key) { settingsOpen = true; if (mode !== 'panel') setMode('panel'); else renderPanel(); return; }
  ST.chat.push({ role: 'me', text, voice: !!opts.voice, at: Date.now() });
  thinking = true; startLoop();
  if (mode === 'panel') renderChat();
  const r = await MG.ask(text, { page: ctxOn, voice: !!opts.voice });
  thinking = false;
  ctxOn = true;
  await refresh(true);
  if (mode === 'panel') renderPanel();
  else if (bubble && bubble.type === 'voice') { bubble.answer = r && r.msg ? r.msg : { text: (r && r.error) || 'Não consegui responder.', err: true }; renderBubble(); }
}
const q = $('#q');
function grow() { q.style.height = 'auto'; q.style.height = Math.min(110, q.scrollHeight) + 'px'; $('#mic').classList.toggle('send', !!q.value.trim() && !listening); $('#mic').title = q.value.trim() ? 'Enviar (Enter)' : 'Falar (⌥ Espaço)'; }
q.addEventListener('input', grow);
q.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const t = q.value; q.value = ''; grow(); send(t); }
});
$('#mic').addEventListener('click', () => {
  if (q.value.trim() && !listening) { const t = q.value; q.value = ''; grow(); send(t); return; }
  if (listening) listenStop(false); else listenStart('click');
});
$('#ctx').addEventListener('click', () => { ctxOn = !ctxOn; renderCtx(); });
$('#sumBtn').addEventListener('click', () => { ctxOn = true; send('Resume esta página.'); });

/* ---------- cliques no painel ---------- */
$('#orb').addEventListener('click', () => {
  if (listening) { listenStop(false); return; }
  if (mode === 'panel') { setMode(bubble ? 'bubble' : 'orb'); return; }
  // o aviso que estava no balão passa para o painel
  if (bubble && bubble.type === 'alert') { panelAlerts.push(bubble); alertQ.splice(0).forEach(a => panelAlerts.push(a)); bubble = null; }
  else if (bubble && bubble.type !== 'listen') bubble = null;
  refresh(); setMode('panel');
});
$('#closeBtn').addEventListener('click', () => { settingsOpen = false; setMode('orb'); });
$('#setBtn').addEventListener('click', () => { settingsOpen = !settingsOpen; renderPanel(); });
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; renderPanel(); } });
$('#panel').addEventListener('click', async e => {
  const t = e.target;
  const row = t.closest('.task');
  if (t.closest('[data-done]') && row) {
    const id = row.dataset.id; doneLocal.add(id); row.classList.add('done'); renderBadge();
    const r = await MG.done(id);
    if (!r.ok) { doneLocal.delete(id); row.classList.remove('done'); renderBadge(); flashErr(r.error); }
    else setTimeout(() => refresh(), 900);
    return;
  }
  if (t.closest('[data-tomorrow]') && row) { const r = await MG.change(row.dataset.id, { due: ST.tomorrow }); if (!r.ok) flashErr(r.error); refresh(); return; }
  if (t.closest('[data-del]') && row) { row.style.opacity = '.4'; const r = await MG.remove(row.dataset.id); if (!r.ok) { row.style.opacity = ''; flashErr(r.error); } refresh(); return; }
  if (t.closest('[data-open]')) { MG.open(t.closest('[data-open]').dataset.open); return; }
  if (t.closest('[data-say]')) { send(t.closest('[data-say]').dataset.say); return; }
  if (t.closest('[data-note]')) { MG.openNote(t.closest('[data-note]').dataset.note); return; }
  if (t.closest('[data-gokey]') || t.closest('[data-gosettings]')) { settingsOpen = true; renderPanel(); $('#settings').scrollTop = 0; return; }
  const pa = t.closest('[data-pact]');
  if (pa) { const [id, i] = pa.dataset.pact.split('|'); const a = panelAlerts.find(x => x.id === id); if (a) { panelAlerts.splice(panelAlerts.indexOf(a), 1); await doAct(a, a.actions[+i]); renderChat(); } return; }
  if (t.closest('[data-script]')) { const r = await MG.scriptUpdate(); if (r && r.error) flashErr(r.error); return; }
  if (t.closest('[data-notas]')) { MG.openNotas(); return; }
  if (t.closest('[data-clear]')) { await MG.clearChat(); settingsOpen = false; await refresh(); renderPanel(); return; }
  if (t.closest('[data-hide]')) { settingsOpen = false; mode = 'orb'; $('#panel').hidden = true; await MG.setting('hidden', true); return; }
  if (t.closest('[data-savekey]')) {
    const r = await MG.setKey($('#keyIn').value);
    if (!r.ok) { const er = $('#keyErr'); er.textContent = r.error; er.hidden = false; return; }
    settingsOpen = false; await refresh(); renderPanel(); return;
  }
});
$('#panel').addEventListener('change', async e => {
  const s = e.target.closest('[data-set]'); if (!s) return;
  const v = s.type === 'checkbox' ? s.checked : s.value;
  ST.settings = await MG.setting(s.dataset.set, v);
});
$('#panel').addEventListener('keydown', async e => {
  if (e.target.id === 'addIn' && e.key === 'Enter' && e.target.value.trim()) {
    const title = e.target.value; e.target.value = '';
    const r = await MG.add({ title, due: tab === 'next' ? ST.tomorrow : ST.today });
    if (!r.ok) flashErr(r.error);
    await refresh(); renderPanel(); setTimeout(() => { const i = $('#addIn'); if (i) i.focus(); }, 30);
  }
});
function flashErr(msg) {
  if (!msg) return;
  if (mode === 'panel') { const p = document.createElement('p'); p.className = 'err'; p.textContent = msg; $('#list').appendChild(p); setTimeout(() => p.remove(), 6000); }
  else showInfo('Não consegui', msg);
}

/* ---------- balão ---------- */
const X = '<button class="x" type="button" data-bx aria-label="Fechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
const WHO = (what) => `<div class="who"><span class="mini"><canvas class="oc" width="88" height="88"></canvas></span>MacGyver · ${what}${X}</div>`;
function renderBubble() {
  const b = $('#bubble');
  if (!bubble) { if (mode === 'bubble') setMode('orb'); return; }
  let h = '';
  if (bubble.type === 'alert') {
    const a = bubble;
    h = WHO('agora') + `<h4>${esc(a.title)}</h4>${a.text ? `<p>${esc(a.text)}</p>` : ''}${a.source ? `<span class="src">${esc(a.source)}</span>` : ''}
      <div class="acts">${a.actions.map((x, i) => `<button class="b ${x.primary ? 'p' : ''}" type="button" data-act="${i}">${esc(x.label)}</button>`).join('')}${alertQ.length ? `<span class="more">+${alertQ.length}</span>` : ''}</div>`;
  } else if (bubble.type === 'listen') {
    h = WHO(transcribing ? 'a perceber' : 'a ouvir') + (transcribing ? '<p class="q">A transcrever<span class="dots"></span></p>' : `<div class="acts" style="align-items:center;margin-top:4px"><div class="wave">${'<i></i>'.repeat(15)}</div><span class="hint">Envio quando parares de falar · Esc cancela</span></div>`);
  } else if (bubble.type === 'voice') {
    const a = bubble.answer;
    h = WHO(a ? 'agora' : 'a pensar') + `<p class="q">“${esc(bubble.text)}”</p>`;
    if (!a) h += '<p>A pensar<span class="dots"></span></p>';
    else h += `<p ${a.err ? 'style="color:var(--late)"' : ''}>${md(a.text)}</p>${(a.made || []).map(t => `<div class="made"><span class="ck"></span><div>${esc(t.title)}<small>${[t.due ? dayName(t.due) : 'Sem data', t.time ? 'às ' + t.time : ''].filter(Boolean).join(' · ')}</small></div></div>`).join('')}<div class="acts"><button class="b p" type="button" data-bopen>Abrir a conversa</button><button class="b" type="button" data-bx>Ok</button></div>`;
  } else if (bubble.type === 'info') {
    h = WHO('agora') + `<h4>${esc(bubble.title)}</h4>${bubble.text ? `<p>${esc(bubble.text)}</p>` : ''}${(bubble.actions || []).length ? `<div class="acts">${bubble.actions.map((x, i) => `<button class="b ${x.primary ? 'p' : ''}" type="button" data-iact="${i}">${esc(x.label)}</button>`).join('')}</div>` : ''}`;
  }
  b.innerHTML = h;
  if (mode !== 'panel') setMode('bubble'); else relayout();
  drawAll(performance.now()); startLoop();
}
let infoT = null;
function showInfo(title, text, actions, ms) {
  if (mode === 'panel') { panelAlerts.push({ id: 'i' + Date.now(), title, text, actions: actions || [{ id: 'ok', label: 'Ok' }] }); renderChat(); return; }
  bubble = { type: 'info', title, text, actions: actions || [] };
  renderBubble();
  clearTimeout(infoT);
  if (ms) infoT = setTimeout(() => { if (bubble && bubble.type === 'info') closeBubble(); }, ms);
}
function closeBubble() {
  bubble = null;
  if (alertQ.length) { bubble = Object.assign({ type: 'alert' }, alertQ.shift()); renderBubble(); return; }
  if (mode === 'bubble') setMode('orb');
}
async function doAct(a, x) {
  if (!x) return;
  if (a.kind === 'confirm') { await MG.confirmReply(a.cid, x.id === 'yes'); return; }
  if (x.id === 'day') { if (bubble === a) bubble = null; tab = 'today'; await refresh(true); setMode('panel'); return; }
  if (x.id === 'ok') return;
  const r = await MG.act({ kind: a.kind, task: a.task }, x);
  await refresh(true);
  if (r && r.toast) showInfo(r.toast, '', [], 2600);
  else if (r && r.error) showInfo('Não consegui', r.error, [], 5000);
}
$('#bubble').addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('[data-bx]')) { if (bubble && bubble.type === 'listen') { listenStop(true); return; } closeBubble(); return; }
  if (t.closest('[data-bopen]')) { bubble = null; await refresh(); setMode('panel'); return; }
  const ia = t.closest('[data-iact]');
  if (ia && bubble) { const x = bubble.actions[+ia.dataset.iact]; closeBubble(); if (x.id === 'notas') MG.openNotas(); if (x.id === 'settings') { settingsOpen = true; await refresh(); setMode('panel'); } return; }
  const ab = t.closest('[data-act]');
  if (ab && bubble && bubble.type === 'alert') {
    const a = bubble, x = a.actions[+ab.dataset.act];
    if (x.id !== 'day') closeBubble();
    await doAct(a, x);
  }
});

/* ---------- avisos vindos do processo principal ---------- */
MG.onAlert(async a => {
  startLoop();
  // pedido de confirmação a meio de uma conversa: vai sempre para o painel, à vista
  if (a.kind === 'confirm') {
    if (!panelAlerts.some(x => x.id === a.id)) panelAlerts.push(a);
    if (mode !== 'panel') { if (bubble && bubble.type === 'voice') bubble = null; await refresh(); setMode('panel'); } else renderChat();
    return;
  }
  if (mode === 'panel') { if (!panelAlerts.some(x => x.id === a.id)) panelAlerts.push(a); renderChat(); return; }
  if (bubble && bubble.type === 'alert' && bubble.id === a.id) return;
  if (bubble && (bubble.type === 'alert' || bubble.type === 'listen' || (bubble.type === 'voice' && !bubble.answer))) { if (!alertQ.some(x => x.id === a.id)) alertQ.push(a); renderBubble(); return; }
  bubble = Object.assign({ type: 'alert' }, a);
  renderBubble();
});
MG.onToggle(async () => {
  if (mode === 'panel') { setMode(bubble ? 'bubble' : 'orb'); return; }
  await refresh(); setMode('panel');
});

/* ---------- voz ---------- */
let stream = null, actx = null, node = null;
async function listenStart(by) {
  if (listening || transcribing) return;
  const v = await MG.listenStart();
  if (!v.ok) { showInfo('Falar com o MacGyver', v.why, v.model ? [{ id: 'notas', label: 'Abrir as Notas', primary: true }, { id: 'ok', label: 'Ok' }] : [], v.model ? 0 : 6000); return; }
  const acc = await MG.micAccess();
  if (acc !== 'granted') { await MG.listenStop(true); showInfo('Sem acesso ao microfone', 'Ativa o Zeus em Definições do Sistema › Privacidade e segurança › Microfone.', [], 7000); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    actx = new AudioContext();
    await actx.audioWorklet.addModule('rec-worklet.js');
    const src = actx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(actx, 'zeus-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    const mute = actx.createGain(); mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(actx.destination);
    node.port.onmessage = e => { if (e.data.pcm) MG.pcm(e.data.pcm); if (e.data.level != null) micLevel = e.data.level; };
  } catch (e) {
    cleanupMic(); await MG.listenStop(true);
    showInfo('Não consegui usar o microfone', e.message || e.name, [], 6000); return;
  }
  listening = true; listenBy = by; micLevel = 0; heard = 0; quietSince = 0; listenAt = performance.now();
  startLoop();
  if (mode === 'panel') { $('#mic').classList.add('on'); q.placeholder = 'A ouvir… envio quando parares de falar'; }
  else { bubble = { type: 'listen' }; renderBubble(); }
}
function cleanupMic() {
  try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ok */ }
  try { if (actx) actx.close(); } catch (e) { /* ok */ }
  stream = null; actx = null; node = null;
}
async function listenStop(cancel) {
  if (!listening) return;
  listening = false;
  if (node && !cancel) await new Promise(res => { const n = node; const t = setTimeout(res, 400); n.port.onmessage = e => { if (e.data.pcm) MG.pcm(e.data.pcm); if (e.data.done) { clearTimeout(t); res(); } }; n.port.postMessage('flush'); });
  cleanupMic();
  $('#mic').classList.remove('on'); q.placeholder = 'Escreve, ou carrega no micro…';
  if (cancel) { await MG.listenStop(true); if (bubble && bubble.type === 'listen') closeBubble(); return; }
  transcribing = true;
  if (bubble && bubble.type === 'listen') renderBubble(); else if (mode === 'panel') q.placeholder = 'A transcrever…';
  const r = await MG.listenStop(false);
  transcribing = false;
  q.placeholder = 'Escreve, ou carrega no micro…';
  if (!r.ok) { if (mode === 'panel') flashErr(r.error); else showInfo('Não percebi', r.error, [], 5000); return; }
  if (!r.text) { if (mode === 'panel') flashErr('Não ouvi nada.'); else showInfo('Não ouvi nada.', 'Carrega em ⌥ Espaço, fala, e larga no fim.', [], 3500); return; }
  if (mode === 'panel') { send(r.text, { voice: true }); return; }
  bubble = { type: 'voice', text: r.text };
  renderBubble();
  send(r.text, { voice: true });
}
// quando o João se cala (depois de ter falado), envia sozinho
let heard = 0, quietSince = 0, listenAt = 0;
function vad() {
  if (!listening) return;
  const now = performance.now(), loud = micLevel > 0.018;
  if (loud) { heard++; quietSince = 0; }
  else if (!quietSince) quietSince = now;
  if (heard > 6 && quietSince && now - quietSince > 1500) { listenStop(false); return; }
  if (!heard && now - listenAt > 8000) { listenStop(true).then(() => showInfo('Não ouvi nada.', 'Carrega em ⌥ Espaço e fala — envio quando parares.', [], 3500)); return; }
  if (now - listenAt > 90000) listenStop(false);
}
function updateWave() {
  vad();
  const bars = document.querySelectorAll('.wave i'); if (!bars.length) return;
  const lv = Math.min(1, micLevel * 7), t = performance.now();
  bars.forEach((b, i) => { b.style.height = Math.max(3, Math.round(4 + lv * 22 * (0.45 + 0.55 * Math.abs(Math.sin(t * 0.012 + i * 0.9))))) + 'px'; });
}
MG.onListen(d => { if (d.toggle) { if (listening) listenStop(false); else if (!transcribing) listenStart('key'); } });

/* ---------- teclado ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (listening) { listenStop(true); return; }
    if (speaking) MG.stopSpeaking();
    if (mode === 'panel') { if (settingsOpen) { settingsOpen = false; renderPanel(); return; } setMode(bubble ? 'bubble' : 'orb'); return; }
    if (bubble) closeBubble();
  }
});
// com o painel aberto, clicar fora (na página) fecha-o — a não ser que esteja a meio de alguma coisa
window.addEventListener('blur', () => {
  setTimeout(() => {
    if (document.hasFocus() || mode !== 'panel' || listening || thinking || q.value.trim() || settingsOpen || panelAlerts.length) return;
    setMode(bubble ? 'bubble' : 'orb');
  }, 120);
});

/* ---------- arranque ---------- */
refresh().then(() => { relayout(); drawAll(performance.now()); startLoop(); });
setInterval(() => { if (mode === 'panel' && !thinking) refresh(); else renderBadge(); }, 60000);

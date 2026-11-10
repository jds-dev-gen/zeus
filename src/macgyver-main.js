'use strict';
/*
 * MacGyver — o agente pessoal do João dentro do Zeus.
 *
 * Uma bolinha (bola de energia) no canto inferior direito da página. Organiza as tarefas, lembra-as à hora certa,
 * avisa antes das reuniões, faz o resumo da manhã e o balanço do fim do dia, e conversa (por escrito ou por voz)
 * com o Claude, que pode ver e mexer nas tarefas, na agenda, nas Notas e na página aberta.
 *
 * Onde ficam as coisas:
 *  - tarefas do MacGyver: no próprio Mac (macgyver.json) e, quando o Apps Script da página principal já está na
 *    versão 2, também no Google Tasks da conta — é assim que aparecem no telemóvel;
 *  - agenda e tarefas do Google: lidas pelo mesmo Apps Script da página principal (contas ligadas);
 *  - voz: transcrita no próprio Mac pelo mesmo Whisper das Notas; respostas em voz alta com a voz portuguesa do macOS;
 *  - conversa: API da Anthropic, com a chave que já está guardada nas Notas.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const MODEL = 'claude-sonnet-5-5';
const DAY = 86400000;

function setupMacGyver(x) {
  const { app, ipcMain, net, Notification, systemPreferences } = x;
  const UD = app.getPath('userData');
  const FILE = path.join(UD, 'macgyver.json');

  /* ---------- estado guardado ---------- */
  const DEF_SET = { morning: true, meetings: true, meetingLead: 10, evening: true, eveningAt: '18:30', speak: true, hidden: false, feed: '' };
  let D = { tasks: [], areas: [], chat: [], chatId: '', convs: [], settings: Object.assign({}, DEF_SET), mem: { lastMorning: '', lastEvening: '', ev: {} } };
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    D = Object.assign(D, j); D.settings = Object.assign({}, DEF_SET, j.settings || {}); D.mem = Object.assign({ lastMorning: '', lastEvening: '', ev: {} }, j.mem || {});
    if (!Array.isArray(D.tasks)) D.tasks = []; if (!Array.isArray(D.chat)) D.chat = []; if (!Array.isArray(D.convs)) D.convs = []; if (!Array.isArray(D.areas)) D.areas = [];
  } catch (e) { /* primeira vez */ }
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      // tarefas feitas há mais de 30 dias deixam de se guardar
      const old = Date.now() - 30 * DAY;
      D.tasks = D.tasks.filter(t => !t.done || (t.doneAt || 0) > old);
      D.chat = D.chat.slice(-80);
      D.convs = D.convs.sort((a, b) => b.last - a.last).slice(0, 150);
      for (const k of Object.keys(D.mem.ev)) if (D.mem.ev[k] < Date.now() - 2 * DAY) delete D.mem.ev[k];
      try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(D)); fs.renameSync(tmp, FILE); } catch (e) { /* tenta na próxima */ }
    }, 300);
  }

  /* ---------- datas ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const WD = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const longDate = s => { const d = new Date(s + 'T12:00:00'); return `${WD[d.getDay()]}, ${d.getDate()} de ${MES[d.getMonth()]}`; };
  const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
  const okTime = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? pad(+m[1]) + ':' + m[2] : ''; };
  const evDay = e => ymd(new Date(e.start));
  const str = (v, n = 500) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const uid = () => 'm' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

  /* ---------- Google (agenda e tarefas, pelo Apps Script da página principal) ---------- */
  const feeds = () => x.feeds() || [];
  const feedLabel = f => f.label || f.account || 'Google';
  // a conta onde o MacGyver escreve tarefas: a escolhida, senão a primeira com o código novo (versão 2)
  const writeFeed = () => { const all = feeds().filter(f => (f.v || 1) >= 2); return all.find(f => f.id === D.settings.feed) || all[0] || null; };
  let G = { t: 0, events: [], tasks: [], errors: [], ok: new Set() };
  let gBusy = null;
  async function fetchGoogle(force) {
    if (!force && Date.now() - G.t < 2 * 60 * 1000) return G;
    if (gBusy) return gBusy;
    gBusy = (async () => {
      const date = ymd();
      const res = await Promise.all(feeds().map(f => x.callFeed(f, { date, days: 8 }).then(d => ({ f, d }), e => ({ f, e }))));
      const out = { t: Date.now(), events: [], tasks: [], errors: [], ok: new Set() };
      for (const { f, d, e } of res) {
        if (e) { out.errors.push({ feed: f.id, label: feedLabel(f), error: e.message }); continue; }
        x.noteFeed(f, d);
        (d.events || []).forEach(ev => out.events.push(Object.assign({}, ev, { feed: f.id, label: feedLabel(f) })));
        if (d.tasksError) { out.errors.push({ feed: f.id, label: feedLabel(f), error: d.tasksError }); continue; }
        out.ok.add(f.id);
        (d.tasks || []).forEach(t => out.tasks.push(Object.assign({}, t, { feed: f.id, label: feedLabel(f), v: d.v || 1 })));
      }
      out.events.sort((a, b) => a.start.localeCompare(b.start));
      // tarefas do MacGyver que estão no Google e já lá não aparecem: foram feitas noutro sítio (ex.: no telemóvel)
      const upto = addDays(date, 7);
      let changed = false;
      for (const t of D.tasks) {
        if (t.done || !t.g || !t.due || t.due > upto || !out.ok.has(t.g.feed)) continue;
        if (Date.now() - (t.gAt || 0) < 3 * 60 * 1000) continue;   // acabada de criar: o Google pode ainda não a mostrar
        if (!out.tasks.some(g => g.id === t.g.id)) { t.done = true; t.doneAt = Date.now(); t.doneElsewhere = true; changed = true; }
      }
      if (changed) { save(); x.tasksChanged(); }
      G = out;
      return G;
    })();
    try { return await gBusy; } finally { gBusy = null; }
  }
  async function gCall(feedId, params) {
    const f = feeds().find(z => z.id === feedId);
    if (!f) throw new Error('A conta Google desta tarefa já não está ligada.');
    return x.callFeed(f, params);
  }
  const gNotes = t => [t.time ? `⏰ ${t.time}` : '', t.notes || '', t.link && t.link.url ? t.link.url : '', 'Criada pelo MacGyver (Zeus)'].filter(Boolean).join('\n');
  // envia uma tarefa do MacGyver para o Google Tasks (sem esperar; se falhar, fica só no Mac)
  async function pushToGoogle(t) {
    const f = writeFeed(); if (!f || t.g) return;
    try {
      const r = await x.callFeed(f, { action: 'add', title: t.title, notes: gNotes(t), due: t.due || '' });
      if (r && r.id) { t.g = { feed: f.id, list: r.list || '@default', id: r.id }; t.gAt = Date.now(); save(); }
    } catch (e) { /* fica só no Mac */ }
  }
  function syncGoogle(t, what) {
    if (!t.g) return;
    const p = what === 'done' ? { action: 'done', list: t.g.list, task: t.g.id }
      : what === 'delete' ? { action: 'delete', list: t.g.list, task: t.g.id }
        : what === 'undo' ? { action: 'update', list: t.g.list, task: t.g.id, status: 'needsAction' }
          : { action: 'update', list: t.g.list, task: t.g.id, title: t.title, due: t.due || '', notes: gNotes(t) };
    gCall(t.g.feed, p).catch(() => {});
    G.t = 0;
  }

  /* ---------- tarefas (as do MacGyver e as do Google, numa lista só) ---------- */
  function unified(today = ymd()) {
    const out = [];
    const mine = new Set();
    for (const t of D.tasks) {
      if (t.done) continue;
      if (t.g) mine.add(t.g.id);
      out.push({ id: t.id, title: t.title, due: t.due || '', time: t.time || '', notes: t.notes || '', link: t.link || null, source: t.source || '', origin: 'mg', synced: !!t.g, overdue: !!t.due && (t.due < today || (t.due === today && t.time && t.time < hm(new Date()))), area: areaOk(t.area), prio: t.prio || '', order: t.order || 0, created: t.created || 0 });
    }
    for (const g of G.tasks) {
      if (mine.has(g.id)) continue;
      out.push({ id: 'g:' + g.feed + '|' + g.list + '|' + g.id, title: g.title, due: g.due, time: '', notes: g.notes || '', link: null, source: 'Google Tasks' + (feeds().length > 1 ? ' · ' + g.label : '') + (g.listName ? ' · ' + g.listName : ''), origin: 'google', synced: true, overdue: g.due < today, v: g.v, area: '', prio: '', order: 1e12, created: 0 });
    }
    out.sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || a.due.localeCompare(b.due) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title, 'pt'));
    return out;
  }
  const findLocal = id => D.tasks.find(t => t.id === id);

  /* ---------- temas (áreas), como no Apolo ---------- */
  const AREA_COLORS = ['ouro', 'salva', 'azul', 'rosa', 'lavanda', 'terracota', 'petroleo', 'grafite'];
  const PRIOS = ['alta', 'media', 'baixa'];
  const fold = v => String(v || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const areaOk = id => (id && D.areas.some(a => a.id === id) ? id : '');
  const areaName = id => { const a = D.areas.find(z => z.id === id); return a ? a.name : ''; };
  function findArea(v) { if (!v) return null; return D.areas.find(a => a.id === v) || D.areas.find(a => fold(a.name) === fold(v)) || null; }
  function addArea(name, color) {
    name = str(name, 60); if (!name) throw new Error('O tema precisa de um nome.');
    const ex = findArea(name); if (ex) return ex;
    const a = { id: 'a' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), name, color: AREA_COLORS.includes(color) ? color : AREA_COLORS[D.areas.length % AREA_COLORS.length], order: D.areas.length };
    D.areas.push(a); save(); x.tasksChanged();
    return a;
  }
  function changeArea(id, o) {
    const a = D.areas.find(z => z.id === id); if (!a) throw new Error('Tema não encontrado.');
    if (o.name != null && str(o.name, 60)) a.name = str(o.name, 60);
    if (o.color && AREA_COLORS.includes(o.color)) a.color = o.color;
    if (o.move) { const list = D.areas.slice().sort((p, q) => p.order - q.order); const i = list.indexOf(a), j = i + (o.move < 0 ? -1 : 1); if (j >= 0 && j < list.length) { list.splice(i, 1); list.splice(j, 0, a); list.forEach((z, k) => { z.order = k; }); } }
    save(); x.tasksChanged(); return a;
  }
  function removeArea(id) {
    D.areas = D.areas.filter(a => a.id !== id);
    D.tasks.forEach(t => { if (t.area === id) t.area = ''; });
    save(); x.tasksChanged(); return true;
  }
  const areasSorted = () => D.areas.slice().sort((a, b) => a.order - b.order);
  const nextOrder = area => 1 + Math.max(0, ...D.tasks.filter(t => (t.area || '') === (area || '') && !t.done).map(t => t.order || 0));
  // uma tarefa do Google que se põe num tema passa a ser do Zeus (ligada à do Google, que continua igual)
  function adopt(id) {
    const g = parseG(id); if (!g) return null;
    const gt = G.tasks.find(z => z.id === g.id); if (!gt) return null;
    const t = { id: uid(), title: gt.title, due: gt.due || '', time: '', notes: gt.notes || '', link: null, source: 'Google Tasks' + (gt.listName ? ' · ' + gt.listName : ''), created: Date.now(), done: false, g: { feed: g.feed, list: g.list, id: g.id }, gAt: Date.now(), area: '', prio: '', order: 0 };
    D.tasks.push(t);
    return t;
  }
  const parseG = id => { const m = /^g:([^|]+)\|([^|]+)\|(.+)$/.exec(String(id)); return m ? { feed: m[1], list: m[2], id: m[3] } : null; };
  function addTask(o) {
    const title = str(o.title, 300);
    if (!title) throw new Error('A tarefa precisa de um título.');
    let area = '';
    if (o.area) { const a = findArea(o.area) || (o.newArea ? addArea(o.area) : null); area = a ? a.id : ''; }
    const t = { id: uid(), title, due: okDate(o.due), time: okTime(o.time), notes: String(o.notes || '').slice(0, 4000), link: o.link && /^https?:/.test(o.link.url || '') ? { url: String(o.link.url).slice(0, 2000), title: str(o.link.title, 200) } : null, source: str(o.source, 120), created: Date.now(), done: false, area, prio: PRIOS.includes(o.prio) ? o.prio : '', order: nextOrder(area) };
    if (t.time && !t.due) t.due = ymd();
    D.tasks.push(t); save(); x.tasksChanged();
    pushToGoogle(t);
    return t;
  }
  async function doneTask(id, undo) {
    const t = findLocal(id);
    if (t) { t.done = !undo; t.doneAt = undo ? 0 : Date.now(); save(); syncGoogle(t, undo ? 'undo' : 'done'); x.tasksChanged(); return true; }
    const g = parseG(id); if (!g) throw new Error('Não encontrei essa tarefa.');
    await gCall(g.feed, undo ? { action: 'update', list: g.list, task: g.id, status: 'needsAction' } : { action: 'done', list: g.list, task: g.id });
    G.tasks = G.tasks.filter(z => z.id !== g.id); G.t = 0; x.tasksChanged();
    return true;
  }
  async function changeTask(id, o) {
    let t = findLocal(id);
    if (!t && (o.area !== undefined || o.prio !== undefined || o.order !== undefined)) t = adopt(id);
    if (t) {
      if (o.area !== undefined) { const a = o.area ? findArea(o.area) || (o.newArea ? addArea(o.area) : null) : null; const na = a ? a.id : ''; if (na !== (t.area || '')) { t.area = na; if (o.order === undefined) t.order = nextOrder(na); } }
      if (o.prio !== undefined) t.prio = PRIOS.includes(o.prio) ? o.prio : '';
      if (o.order !== undefined && isFinite(+o.order)) t.order = +o.order;
      if (o.link !== undefined) t.link = o.link && /^https?:/.test(o.link.url || '') ? { url: String(o.link.url).slice(0, 2000), title: str(o.link.title, 200) } : null;
      if (o.title != null && str(o.title)) t.title = str(o.title, 300);
      if (o.due !== undefined) t.due = okDate(o.due);
      if (o.time !== undefined) { t.time = okTime(o.time); if (t.time && !t.due) t.due = ymd(); }
      if (o.notes != null) t.notes = String(o.notes).slice(0, 4000);
      delete t.notified;
      save(); syncGoogle(t, 'update'); x.tasksChanged();
      return t;
    }
    const g = parseG(id); if (!g) throw new Error('Não encontrei essa tarefa.');
    const gt = G.tasks.find(z => z.id === g.id);
    if (gt && (gt.v || 1) < 2) throw new Error('Para mudar tarefas do Google, o Apps Script da página principal tem de ser atualizado (Definições do MacGyver › Atualizar o código).');
    await gCall(g.feed, { action: 'update', list: g.list, task: g.id, title: o.title ? str(o.title, 300) : '', due: o.due !== undefined ? okDate(o.due) : '' });
    if (gt) { if (o.title) gt.title = str(o.title, 300); if (okDate(o.due)) gt.due = okDate(o.due); }
    G.t = 0; x.tasksChanged();
    return gt || { id };
  }
  async function removeTask(id) {
    const i = D.tasks.findIndex(t => t.id === id);
    if (i > -1) { const [t] = D.tasks.splice(i, 1); save(); syncGoogle(t, 'delete'); x.tasksChanged(); return true; }
    const g = parseG(id); if (!g) throw new Error('Não encontrei essa tarefa.');
    await gCall(g.feed, { action: 'delete', list: g.list, task: g.id });
    G.tasks = G.tasks.filter(z => z.id !== g.id); x.tasksChanged();
    return true;
  }
  const uById = id => unified().find(t => t.id === id);
  function reorder(area, ids) {
    let n = 0;
    for (const id of ids || []) { let t = findLocal(id) || adopt(id); if (!t) continue; t.area = areaOk(area); t.order = ++n; }
    save(); x.tasksChanged(); return true;
  }
  const doneRecent = () => D.tasks.filter(t => t.done && (t.doneAt || 0) > Date.now() - 30 * DAY).sort((a, b) => b.doneAt - a.doneAt).map(t => ({ id: t.id, title: t.title, due: t.due || '', time: t.time || '', notes: t.notes || '', link: t.link || null, source: t.source || '', origin: 'mg', synced: !!t.g, done: true, doneAt: t.doneAt, area: areaOk(t.area), prio: t.prio || '', order: t.order || 0, created: t.created || 0 }));

  /* ---------- a página principal do Zeus mostra também as tarefas do MacGyver ---------- */
  function homeTasks(today = ymd()) {
    return D.tasks.filter(t => !t.done && t.due && t.due <= today).map(t => ({ id: t.id, list: 'mg', feed: 'mg', title: t.time ? `${t.time} · ${t.title}` : t.title, due: t.due, overdue: t.due < today, listName: 'MacGyver', label: 'MacGyver', g: t.g ? t.g.id : '' }));
  }

  /* ---------- conversas: a atual e o histórico ---------- */
  const FRESH_AFTER = 5 * 60 * 1000;   // ao abrir o painel, conversa nova se a última mensagem tem mais de 5 minutos
  function archive() {
    if (D.chat.length) {
      const first = D.chat.find(m => m.role === 'me') || D.chat[0];
      const c = { id: D.chatId || uid(), title: str(first.text, 70), started: D.chat[0].at || Date.now(), last: D.chat[D.chat.length - 1].at || Date.now(), msgs: D.chat };
      const i = D.convs.findIndex(z => z.id === c.id);
      if (i > -1) D.convs[i] = c; else D.convs.unshift(c);
    }
    D.chat = []; D.chatId = uid(); save();
  }
  function fresh() {
    const last = D.chat[D.chat.length - 1];
    if (last && Date.now() - (last.at || 0) > FRESH_AFTER && !asking) archive();
  }
  function openConv(id) {
    const c = D.convs.find(z => z.id === id); if (!c) return false;
    if (D.chatId !== id) archive();
    D.convs = D.convs.filter(z => z.id !== id);
    D.chat = c.msgs || []; D.chatId = c.id; save();
    return true;
  }
  function historyList() {
    return D.convs.slice().sort((a, b) => b.last - a.last).map(c => {
      const ai = [...(c.msgs || [])].reverse().find(m => m.role === 'ai' && !m.err);
      return { id: c.id, title: c.title, started: c.started, last: c.last, n: (c.msgs || []).length, preview: ai ? str(ai.text.replace(/\*\*/g, ''), 110) : '', voice: (c.msgs || []).some(m => m.voice), text: (c.msgs || []).map(m => m.text).join(' ').slice(0, 3000) };
    });
  }

  /* ---------- a página aberta ---------- */
  async function pageNow() { try { return (await x.currentPage()) || null; } catch (e) { return null; } }

  /* ---------- Claude ---------- */
  const TOOLS = [
    { name: 'ver_tarefas', description: 'Lista as tarefas por fazer (as do MacGyver e as do Google Tasks), com id, título, data, hora, origem e se estão atrasadas. Por omissão até daqui a 7 dias, mais as que não têm data.', input_schema: { type: 'object', properties: { ate: { type: 'string', description: 'Até esta data (AAAA-MM-DD), inclusive.' } } } },
    { name: 'ver_temas', description: 'Os temas (áreas) em que as tarefas do João estão arrumadas, com quantas tarefas por fazer tem cada um.', input_schema: { type: 'object', properties: {} } },
    { name: 'criar_tema', description: 'Cria um tema novo. Só quando o João pede, ou ao trazer tarefas do Apolo com temas que ainda não existem.', input_schema: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } },
    { name: 'criar_tarefa', description: 'Cria uma tarefa ou um lembrete. Com hora, o MacGyver avisa a essa hora. Usa ligar_pagina quando o pedido se refere à página aberta ("isto", "esta página", "este email"). Põe-na no tema que encaixa (nome de ver_temas) e com prioridade quando for claro.', input_schema: { type: 'object', properties: { tema: { type: 'string', description: 'Nome de um tema existente.' }, prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] }, titulo: { type: 'string', description: 'Curto e claro, começado por um verbo (ex.: "Responder ao Pedro sobre o orçamento").' }, data: { type: 'string', description: 'AAAA-MM-DD. Omitir se não houver data.' }, hora: { type: 'string', description: 'HH:MM, 24 h. Só se o utilizador indicou hora ou um momento claro.' }, notas: { type: 'string' }, ligar_pagina: { type: 'boolean', description: 'Guardar o endereço da página aberta na tarefa.' }, origem: { type: 'string', description: 'De onde veio (ex.: "Notas · Reunião de direção de 2 nov").' } }, required: ['titulo'] } },
    { name: 'alterar_tarefa', description: 'Muda o título, a data, a hora, o tema, a prioridade ou as notas de uma tarefa (por id). Para tirar a hora, hora = ""; para tirar do tema, tema = "".', input_schema: { type: 'object', properties: { id: { type: 'string' }, titulo: { type: 'string' }, data: { type: 'string' }, hora: { type: 'string' }, tema: { type: 'string' }, prioridade: { type: 'string', enum: ['alta', 'media', 'baixa', ''] }, notas: { type: 'string' } }, required: ['id'] } },
    { name: 'concluir_tarefa', description: 'Marca uma tarefa como feita (por id).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'apagar_tarefa', description: 'Apaga uma tarefa (por id). Só quando o utilizador pede para apagar ou desistir dela.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'ver_agenda', description: 'Compromissos do calendário (contas Google ligadas ao Zeus) a partir de uma data, até 8 dias.', input_schema: { type: 'object', properties: { data: { type: 'string', description: 'AAAA-MM-DD; por omissão hoje.' }, dias: { type: 'integer', minimum: 1, maximum: 8 } } } },
    { name: 'procurar_notas', description: 'Procura nas Notas do Zeus (notas e reuniões gravadas, com resumos, decisões e tarefas). Devolve as mais recentes que têm todas as palavras.', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
    { name: 'notas_recentes', description: 'As notas e reuniões mais recentes (título, data, início do texto).', input_schema: { type: 'object', properties: { quantas: { type: 'integer', minimum: 1, maximum: 15 } } } },
    { name: 'ler_nota', description: 'Lê o texto de uma nota (por id).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'pagina_aberta', description: 'Título, endereço, texto selecionado e o texto da página que o utilizador tem aberta no Zeus. Usa-a para resumir ou responder sobre a página.', input_schema: { type: 'object', properties: {} } },
    { name: 'elementos_da_pagina', description: 'Lista os elementos onde se pode mexer na página aberta (ligações, botões, campos, opções), cada um com um id. Os visíveis no ecrã vêm primeiro. Com "procurar", só os que têm essas palavras.', input_schema: { type: 'object', properties: { procurar: { type: 'string' } } } },
    { name: 'clicar', description: 'Carrega num elemento da página aberta (id de elementos_da_pagina). Se o clique enviar, publicar, comprar, apagar ou aceitar alguma coisa, o Zeus pede primeiro confirmação ao João.', input_schema: { type: 'object', properties: { id: { type: 'integer' }, para_que: { type: 'string', description: 'O que este clique faz, em poucas palavras (ex.: "enviar o email ao Pedro").' } }, required: ['id', 'para_que'] } },
    { name: 'escrever', description: 'Escreve texto num campo da página aberta (id de elementos_da_pagina). Nunca palavras-passe nem dados de pagamento.', input_schema: { type: 'object', properties: { id: { type: 'integer' }, texto: { type: 'string' }, apagar_antes: { type: 'boolean', description: 'Substituir o que lá está.' }, enter: { type: 'boolean', description: 'Carregar em Enter no fim (ex.: numa pesquisa).' } }, required: ['id', 'texto'] } },
    { name: 'deslizar', description: 'Desliza a página aberta: para baixo, para cima, para o topo, para o fim, ou até um texto.', input_schema: { type: 'object', properties: { direcao: { type: 'string', enum: ['baixo', 'cima', 'topo', 'fim'] }, ate_texto: { type: 'string' } } } },
    { name: 'abrir_pagina', description: 'Abre um endereço (ou uma pesquisa na web) num separador novo do Zeus, que passa a ser a página aberta.', input_schema: { type: 'object', properties: { endereco: { type: 'string' } }, required: ['endereco'] } },
    { name: 'abrir_app', description: 'Abre uma das apps da barra da esquerda do Zeus (ex.: Player, Radar, Notas, Tarefas, Disco, Editor, Zoom, Email, WhatsApp, Calendário, Apolo…), em página inteira. Usa o nome tal como aparece na barra.', input_schema: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } },
    { name: 'fechar_app', description: 'Fecha a app que está aberta em página inteira e volta ao separador (página) onde o João estava.', input_schema: { type: 'object', properties: {} } },
    { name: 'voltar_atras', description: 'Volta à página anterior no separador aberto.', input_schema: { type: 'object', properties: {} } }
  ];
  // cliques que mudam alguma coisa no mundo: o João confirma antes
  const RISKY = /\b(enviar|envia|send|submeter|submit|publicar|publish|post(ar)?|tweet|responder a todos|comprar|buy|pagar|pay|encomendar|order|checkout|finalizar|apagar|eliminar|delete|remove|remover|excluir|aceitar|accept|confirmar|confirm|subscrever|subscribe|assinar|sign|transferir|transfer|reservar|book|partilhar|share|convidar|invite|arquivar|archive|sair|log ?out|terminar sessão)\b/i;
  const confirms = new Map();
  function confirmAsk(text, detail) {
    const id = uid();
    return new Promise(res => {
      const t = setTimeout(() => { confirms.delete(id); res(false); }, 3 * 60 * 1000);
      confirms.set(id, ok => { clearTimeout(t); confirms.delete(id); res(!!ok); });
      x.send('alert', { id, kind: 'confirm', cid: id, title: text, text: detail || '', actions: [{ id: 'yes', label: 'Sim, pode', primary: true }, { id: 'no', label: 'Não' }] });
    });
  }
  function system() {
    const now = new Date();
    return `És o MacGyver, o agente pessoal do João, dentro do Zeus (o browser dele). O João é subdiretor do Observador (jornal digital português) e coordena também a produção de podcasts e rádio.
O teu trabalho: organizar-lhe o dia e lembrá-lo do que tem a fazer — criar, mudar e fechar tarefas, ver a agenda, ir buscar compromissos às notas das reuniões, e responder a perguntas sobre o dia dele.
Agora: ${longDate(ymd(now))} de ${now.getFullYear()}, ${hm(now)} (hora de Lisboa).

Regras:
- Escreves em português europeu, curto e direto, como um bom assistente. Uma a três frases, salvo se pedir mais. Sem listas longas nem títulos.
- Para mexer em tarefas usa as ferramentas; nunca digas que fizeste algo que não fizeste. Antes de mudar ou fechar uma tarefa existente, vê o id com ver_tarefas.
- Datas relativas ("amanhã", "sexta", "para a semana") convertem-se a partir de hoje. "De manhã" sem hora = 10:00; "à tarde" = 15:00; "ao fim do dia" = 18:00. Se não houver momento nenhum, cria sem hora.
- "Isto", "esta página", "este email", "este artigo" referem-se à página aberta: usa ligar_pagina e, se precisares de perceber o que é, pagina_aberta.
- Quando te pedem para tirar tarefas de uma reunião, procura a nota, lê-a e cria só as tarefas que são do João (ou sem responsável), com o prazo que lá estiver.
- Se faltar informação essencial, pergunta numa frase. Se a API do Google falhar, diz isso claramente.
- Não inventes compromissos nem tarefas.
- As tarefas estão arrumadas por temas (como no Apolo). Ao criar, põe no tema que encaixa claramente (vê-os com ver_temas); na dúvida, sem tema. Prioridade só quando o João a diz ou é evidente ("urgente" = alta).
- Para trazer tarefas do Diário do Apolo: o João abre o Apolo no Zeus; lês a página com pagina_aberta e crias cada tarefa com o tema e a prioridade que lá estão (cria os temas que faltarem com criar_tema). Não dupliques as que já existem.

Apps do Zeus (barra da esquerda): ${x.apps().map(a => a.name).join(', ')}. Abre-as com abrir_app quando o João pede ("abre o Player", "mostra-me o Radar"); fechar_app volta à página.

Páginas (o Zeus é um browser):
- Para resumir a página aberta, usa pagina_aberta e responde com 3 a 6 pontos curtos começados por "• " (o essencial, números e nomes concretos), mais uma frase final se houver alguma coisa a fazer. Sem títulos.
- Podes também mexer na página como o João faria: vê os elementos com elementos_da_pagina, depois clicar, escrever, deslizar; abrir_pagina abre um endereço ou uma pesquisa. Depois de cada ação confirma o resultado (título e endereço) antes da próxima; se a página mudou, volta a ver os elementos.
- Cliques que enviam, publicam, compram, pagam, apagam, aceitam ou partilham alguma coisa: o Zeus pergunta ao João antes. Se ele disser que não, paras e dizes que não fizeste. Nunca escrevas palavras-passe, códigos ou dados de pagamento; nunca inicies sessão por ele.
- Quando escreveres um email ou mensagem por ele, deixa-o pronto mas não envies sem ele pedir expressamente.
- No fim diz em poucas palavras o que fizeste.`;
  }
  async function runTool(name, inp, ctx) {
    inp = inp || {};
    if (name === 'ver_tarefas') {
      await fetchGoogle();
      const ate = okDate(inp.ate) || addDays(ymd(), 7);
      return unified().filter(t => !t.due || t.due <= ate).slice(0, 120).map(t => ({ id: t.id, titulo: t.title, tema: areaName(t.area) || null, prioridade: t.prio || null, data: t.due || null, hora: t.time || null, atrasada: t.overdue, origem: t.source || (t.origin === 'mg' ? 'MacGyver' : 'Google Tasks'), pagina: t.link ? t.link.title || t.link.url : undefined, notas: t.notes ? t.notes.slice(0, 200) : undefined }));
    }
    if (name === 'criar_tarefa') {
      let link = null;
      if (inp.ligar_pagina) { const p = ctx.page || await pageNow(); if (p && /^https?:/.test(p.url || '')) link = { url: p.url, title: p.title }; }
      const t = addTask({ title: inp.titulo, due: inp.data, time: inp.hora, notes: inp.notas, link, source: inp.origem, area: inp.tema, prio: inp.prioridade });
      if (inp.tema && !t.area) ctx.steps.push(`O tema “${str(inp.tema, 40)}” não existe; ficou sem tema`);
      ctx.made.push(t.id);
      return { ok: true, id: t.id, titulo: t.title, data: t.due || null, hora: t.time || null, pagina: link ? link.title : null, google: writeFeed() ? 'também no Google Tasks' : 'só no Mac (Google Tasks não ligado para escrita)' };
    }
    if (name === 'alterar_tarefa') {
      const o = {}; if (inp.titulo) o.title = inp.titulo; if (inp.data !== undefined) o.due = inp.data; if (inp.hora !== undefined) o.time = inp.hora;
      if (inp.tema !== undefined) o.area = inp.tema; if (inp.prioridade !== undefined) o.prio = inp.prioridade; if (inp.notas !== undefined) o.notes = inp.notas;
      await fetchGoogle();
      await changeTask(inp.id, o); ctx.made.push(inp.id);
      return { ok: true };
    }
    if (name === 'ver_temas') { await fetchGoogle(); const u = unified(); return areasSorted().map(a => ({ nome: a.name, por_fazer: u.filter(t => t.area === a.id).length })).concat([{ nome: '(sem tema)', por_fazer: u.filter(t => !t.area).length }]); }
    if (name === 'criar_tema') { const a = addArea(inp.nome); ctx.steps.push(`Criei o tema «${a.name}»`); return { ok: true, nome: a.name }; }
    if (name === 'concluir_tarefa') { await fetchGoogle(); await doneTask(inp.id); ctx.done.push(inp.id); return { ok: true }; }
    if (name === 'apagar_tarefa') { await fetchGoogle(); await removeTask(inp.id); return { ok: true }; }
    if (name === 'ver_agenda') {
      const from = okDate(inp.data) || ymd(), n = Math.max(1, Math.min(8, inp.dias | 0 || 1));
      if (!feeds().length) return { erro: 'Nenhuma conta Google está ligada à página principal do Zeus, por isso não vejo a agenda.' };
      let evs;
      if (from >= ymd() && addDays(from, n - 1) <= addDays(ymd(), 7)) { await fetchGoogle(); evs = G.events; }
      else {
        evs = [];
        for (const f of feeds()) { try { const d = await x.callFeed(f, { date: from, days: n }); (d.events || []).forEach(e => evs.push(Object.assign({}, e, { label: feedLabel(f) }))); } catch (e) { /* segue */ } }
      }
      const to = addDays(from, n);
      return evs.filter(e => evDay(e) >= from && evDay(e) < to)
        .map(e => ({ titulo: e.title, inicio: e.allDay ? evDay(e) + ' (todo o dia)' : ymd(new Date(e.start)) + ' ' + hm(new Date(e.start)), fim: e.allDay ? undefined : hm(new Date(e.end)), local: e.location || undefined, meet: e.meet || undefined, calendario: e.calendar }));
    }
    if (name === 'procurar_notas' || name === 'notas_recentes') {
      const N = x.notas(); if (!N) return { erro: 'As Notas não estão disponíveis.' };
      await N.scan();
      let items = [...N.index.values()];
      if (name === 'procurar_notas') { const ids = N.search(inp.texto || '') || []; items = items.filter(n => ids.includes(n.id)); }
      return items.sort((a, b) => b.updated - a.updated).slice(0, name === 'notas_recentes' ? Math.min(15, inp.quantas || 8) : 8)
        .map(n => ({ id: n.id, titulo: n.title, pasta: n.folder || undefined, atualizada: ymd(new Date(n.updated)), inicio: (n.excerpt || '').slice(0, 200) }));
    }
    if (name === 'ler_nota') {
      const N = x.notas(); if (!N) return { erro: 'As Notas não estão disponíveis.' };
      await N.scan();
      const n = N.info(inp.id); if (!n) return { erro: 'Nota não encontrada.' };
      ctx.notes.push({ id: n.id, title: n.title });
      return { titulo: n.title, atualizada: ymd(new Date(n.updated)), texto: (n.text || '').slice(0, 14000) };
    }
    if (name === 'pagina_aberta') {
      const p = ctx.acted ? await pageNow() : (ctx.page || await pageNow());
      if (!p) return { erro: 'Não há nenhuma página aberta (o João está na página principal ou numa app do Zeus).' };
      return { titulo: p.title, endereco: p.url, selecao: p.selection || undefined, texto: (p.text || '').slice(0, 40000) };
    }
    if (name === 'elementos_da_pagina') return x.pageAct('elements', { q: inp.procurar || '' });
    if (name === 'clicar') {
      const el = await x.pageAct('inspect', { id: inp.id });
      if (!el) return { erro: 'Esse elemento já não está na página (vê outra vez os elementos).' };
      const why = str(inp.para_que, 120);
      const risky = (el.submits && (el.post || el.pwd)) || RISKY.test(el.label) || RISKY.test(why);
      if (risky) {
        const ok = await confirmAsk(`Carrego em “${el.label || 'este botão'}”?`, why ? `Para ${why.replace(/^para /i, '')}.` : '');
        if (!ok) { ctx.steps.push(`Não carreguei em «${el.label}» (o João disse que não)`); return { recusado: true, nota: 'O João disse que não. Não carregues e não tentes outra forma.' }; }
      }
      const r = await x.pageAct('click', { id: inp.id });
      ctx.acted = true;
      if (r.ok) ctx.steps.push(`Carreguei em «${r.carregou_em || el.label}»`);
      return r;
    }
    if (name === 'escrever') {
      const r = await x.pageAct('type', { id: inp.id, text: String(inp.texto || '').slice(0, 5000), clear: !!inp.apagar_antes, enter: !!inp.enter });
      ctx.acted = true;
      if (r.ok) ctx.steps.push(`Escrevi “${str(inp.texto, 40)}${String(inp.texto || '').length > 40 ? '…' : ''}”`);
      return r;
    }
    if (name === 'deslizar') return x.pageAct('scroll', { dir: inp.direcao || 'baixo', text: inp.ate_texto || '' });
    if (name === 'abrir_pagina') {
      const r = await x.pageAct('open', { url: inp.endereco });
      ctx.acted = true;
      if (r.ok) ctx.steps.push(`Abri ${r.titulo || r.endereco}`);
      return r;
    }
    if (name === 'abrir_app') {
      const apps = x.apps();
      const q = fold(inp.nome).replace(/^(a|o|as|os) /, '');
      const a = apps.find(z => fold(z.name) === q) || apps.find(z => fold(z.id) === q) || apps.find(z => fold(z.name).startsWith(q) || q.startsWith(fold(z.name))) || apps.find(z => fold(z.name).includes(q));
      if (!a) return { erro: 'Não encontrei essa app.', apps: apps.map(z => z.name) };
      x.openApp(a.id); ctx.acted = true;
      ctx.steps.push(`Abri ${a.name}`);
      return { ok: true, app: a.name };
    }
    if (name === 'fechar_app') { x.closeApps(); ctx.acted = true; ctx.steps.push('Voltei à página'); return { ok: true }; }
    if (name === 'voltar_atras') { const r = await x.pageAct('back', {}); ctx.acted = true; if (r.ok) ctx.steps.push('Voltei à página anterior'); return r; }
    return { erro: 'Ferramenta desconhecida.' };
  }
  async function api(body, key) {
    const base = (!app.isPackaged && process.env.ZEUS_TEST_ANTHROPIC) || 'https://api.anthropic.com';
    let res;
    try {
      res = await net.fetch(base + '/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error(/INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/.test(String(e.message)) ? 'Não há ligação à internet.' : 'Não consegui falar com o Claude (' + e.message + ').');
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j && j.error && j.error.message ? j.error.message : 'HTTP ' + res.status;
      if (res.status === 401) throw new Error('A chave da API da Anthropic não é válida.');
      if (res.status === 402 || /credit|billing/i.test(msg)) throw new Error('A conta da API da Anthropic não tem saldo.');
      if (res.status === 429 || res.status === 529) throw new Error('O Claude está sobrecarregado. Tenta daqui a um minuto.');
      throw new Error(msg);
    }
    return j;
  }
  let asking = false;
  async function ask(text, opts = {}) {
    text = String(text || '').trim().slice(0, 4000);
    if (!text) return { ok: false };
    const key = x.getKey();
    if (!key) return { ok: false, needKey: true, error: 'Para conversar, o MacGyver precisa da chave da API da Anthropic (a mesma das Notas).' };
    if (asking) return { ok: false, error: 'Ainda estou a responder à pergunta anterior.' };
    asking = true; x.send('state', { thinking: true });
    const ctx = { made: [], done: [], notes: [], steps: [], acted: false, page: opts.page === false ? null : await pageNow() };
    const me = { role: 'me', text, at: Date.now(), voice: !!opts.voice };
    D.chat.push(me); save();
    try {
      // conversa recente (só o texto), para perceber "e essa?" ou "muda para as 11"
      const hist = [];
      for (const m of D.chat.slice(-17, -1)) { if (m.err) continue; const role = m.role === 'me' ? 'user' : 'assistant'; if (hist.length && hist[hist.length - 1].role === role) hist[hist.length - 1].content += '\n' + m.text; else hist.push({ role, content: m.text }); }
      while (hist.length && hist[0].role !== 'user') hist.shift();
      if (hist.length && hist[hist.length - 1].role === 'user') hist.pop();
      const pageHint = ctx.page ? `\n\n[Página aberta no Zeus: “${ctx.page.title || ''}” — ${ctx.page.url}${ctx.page.selection ? ` — texto selecionado: “${ctx.page.selection.slice(0, 600)}”` : ''}]` : '\n\n[Sem página aberta: o João está na página principal ou numa app do Zeus.]';
      const msgs = hist.concat([{ role: 'user', content: text + pageHint }]);
      let out = '';
      const sys = system();   // as mesmas instruções em todos os passos deste pedido
      for (let step = 0; step < 16; step++) {
        let j;
        try { j = await api({ model: MODEL, max_tokens: 1600, system: sys, tools: TOOLS, messages: msgs }, key); }
        catch (e) {
          // blocos de "pensamento" de um passo anterior que a API já não aceita: tira-os e tenta outra vez
          if (!/signature|thinking/i.test(e.message)) throw e;
          for (const m of msgs) if (m.role === 'assistant' && Array.isArray(m.content)) m.content = m.content.filter(c => c.type !== 'thinking' && c.type !== 'redacted_thinking');
          j = await api({ model: MODEL, max_tokens: 1600, system: sys, tools: TOOLS, messages: msgs }, key);
        }
        const content = j.content || [];
        const txt = content.filter(c => c.type === 'text').map(c => c.text).join('').trim();
        const uses = content.filter(c => c.type === 'tool_use');
        if (!uses.length || j.stop_reason !== 'tool_use') { out = txt; break; }
        msgs.push({ role: 'assistant', content });
        const results = [];
        for (const u of uses) {
          let r; try { r = await runTool(u.name, u.input, ctx); } catch (e) { r = { erro: e.message }; }
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r).slice(0, 45000) });
        }
        msgs.push({ role: 'user', content: results });
        if (step === 15) out = txt || 'Fiz o que consegui, mas o pedido ficou a meio.';
      }
      const made = [...new Set(ctx.made)].map(id => uById(id) || (findLocal(id) && Object.assign({}, findLocal(id), { origin: 'mg' }))).filter(Boolean);
      const ai = { role: 'ai', text: out || 'Feito.', at: Date.now(), made: made.map(t => ({ id: t.id, title: t.title, due: t.due, time: t.time, link: t.link })), notes: ctx.notes.slice(0, 3), steps: ctx.steps.slice(0, 12) };
      D.chat.push(ai); save();
      if (opts.voice && D.settings.speak) speak(ai.text);
      return { ok: true, msg: ai };
    } catch (e) {
      const ai = { role: 'ai', text: e.message, at: Date.now(), err: true };
      D.chat.push(ai); save();
      return { ok: false, msg: ai, error: e.message };
    } finally { asking = false; x.send('state', { thinking: false }); }
  }

  /* ---------- voz: ouvir (Whisper das Notas) e falar (voz do macOS) ---------- */
  let pcm = [], pcmBytes = 0, listening = false;
  function voiceState() {
    const v = x.whisper ? x.whisper() : null;
    if (!v) return { ok: false, why: 'Não encontrei o programa de transcrição.' };
    if (!fs.existsSync(v.bin)) return { ok: false, why: 'O programa de transcrição não está incluído nesta versão do Zeus.' };
    if (!fs.existsSync(v.model)) return { ok: false, why: 'Para falar com o MacGyver, descarrega primeiro o modelo de transcrição nas Notas (Definições das Notas).', model: true };
    return { ok: true };
  }
  function wav(buf) {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36); h.writeUInt32LE(buf.length, 40);
    return Buffer.concat([h, buf]);
  }
  async function transcribe(buf) {
    const v = x.whisper();
    const base = path.join(os.tmpdir(), 'zeus-macgyver-' + Date.now());
    await fsp.writeFile(base + '.wav', wav(buf));
    const threads = String(Math.max(2, Math.min(6, (os.cpus() || []).length - 2)));
    return new Promise((resolve, reject) => {
      const p = spawn(v.bin, ['-m', v.model, '-f', base + '.wav', '-l', 'pt', '-nt', '-np', '-otxt', '-of', base, '-t', threads], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; p.stderr.on('data', d => { err = (err + d).slice(-1500); });
      const kill = setTimeout(() => p.kill(), 60000);
      p.on('error', reject);
      p.on('close', async code => {
        clearTimeout(kill);
        fsp.unlink(base + '.wav').catch(() => {});
        if (code !== 0) return reject(new Error('A transcrição falhou.'));
        try { const t = await fsp.readFile(base + '.txt', 'utf8'); fsp.unlink(base + '.txt').catch(() => {}); resolve(t.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()); }
        catch (e) { reject(new Error('A transcrição falhou.')); }
      });
    });
  }
  let sayProc = null, sayVoice;
  function findVoice() {
    if (sayVoice !== undefined || process.platform !== 'darwin') return Promise.resolve(sayVoice || null);
    return new Promise(res => execFile('say', ['-v', '?'], (e, out) => {
      const lines = String(out || '').split('\n');
      const pt = lines.filter(l => /\bpt_PT\b/.test(l)).map(l => l.split(/\s{2,}/)[0].trim());
      const pref = ['Joana (Enhanced)', 'Joana (Premium)', 'Catarina (Enhanced)', 'Joana', 'Catarina'];
      sayVoice = pref.find(v => pt.includes(v)) || pt[0] || null;
      res(sayVoice);
    }));
  }
  async function speak(text) {
    stopSpeaking();
    if (process.platform !== 'darwin') return;
    const v = await findVoice();
    const clean = String(text || '').replace(/\*\*?|__|`|#+\s/g, '').replace(/https?:\/\/\S+/g, '').slice(0, 1200);
    if (!clean.trim()) return;
    sayProc = spawn('say', [...(v ? ['-v', v] : []), '-r', '195', clean], { stdio: 'ignore' });
    x.send('state', { speaking: true });
    const me = sayProc;
    me.on('close', () => { if (sayProc === me) { sayProc = null; x.send('state', { speaking: false }); } });
  }
  function stopSpeaking() { if (sayProc) { try { sayProc.kill(); } catch (e) { /* ok */ } sayProc = null; x.send('state', { speaking: false }); } }

  // ⌥ Espaço: a página da bolinha decide (começa a ouvir, ou envia o que já ouviu)
  function listenKey() { x.show(); x.send('listen', { toggle: true }); }

  /* ---------- avisos ---------- */
  const alerts = [];
  function alert(a) {
    a.id = a.id || uid(); a.at = Date.now();
    alerts.push(a); while (alerts.length > 8) alerts.shift();
    x.send('alert', a);
    x.show();
    // com o Zeus noutra janela ou escondido: notificação do macOS
    if (!x.focused() && Notification && Notification.isSupported()) {
      try {
        const n = new Notification({ title: 'MacGyver — ' + a.title, body: a.text || '', silent: false });
        n.on('click', () => { x.focusWin(); x.send('alert', a); });
        n.show();
      } catch (e) { /* ok */ }
    }
  }
  const fmtWhen = t => !t.due ? '' : (t.due === ymd() ? 'hoje' : t.due === addDays(ymd(), 1) ? 'amanhã' : t.due.split('-').reverse().slice(0, 2).join('/')) + (t.time ? ' às ' + t.time : '');
  function taskAlert(t) {
    const acts = [{ id: 'done', label: 'Já fiz', primary: !t.link }, { id: 'snooze', label: 'Daqui a 1 h' }, { id: 'tomorrow', label: 'Amanhã' }];
    if (t.link) acts.unshift({ id: 'open', label: 'Abrir a página', primary: true });
    alert({ kind: 'task', task: t.id, title: t.title, text: t.notes ? t.notes.slice(0, 220) : (t.link ? t.link.title || t.link.url : ''), source: t.source || '', actions: acts });
  }
  async function morning() {
    await fetchGoogle(true).catch(() => {});
    const today = ymd();
    const evs = G.events.filter(e => evDay(e) === today);
    const timed = evs.filter(e => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
    const ts = unified().filter(t => t.due && t.due <= today);
    const late = ts.filter(t => t.due < today).length;
    const parts = [];
    if (timed.length) parts.push(`${timed.length === 1 ? 'uma reunião' : timed.length + ' compromissos'} (${timed.length === 1 ? 'às' : 'o primeiro às'} ${hm(new Date(timed[0].start))} — ${timed[0].title})`);
    else parts.push('nada marcado na agenda');
    parts.push(ts.length ? `${ts.length === 1 ? 'uma tarefa' : ts.length + ' tarefas'}${late ? ` (${late === 1 ? 'uma atrasada' : late + ' atrasadas'})` : ''}` : 'nenhuma tarefa para hoje');
    alert({ kind: 'morning', title: 'Bom dia, João.', text: `Hoje tens ${parts.join(' e ')}.`, actions: [{ id: 'day', label: 'Ver o dia', primary: true }, { id: 'ok', label: 'Ok' }] });
  }
  async function evening() {
    await fetchGoogle(true).catch(() => {});
    const ts = unified().filter(t => t.due && t.due <= ymd());
    if (!ts.length) return;
    alert({ kind: 'evening', title: ts.length === 1 ? 'Ficou uma tarefa por fazer hoje.' : `Ficaram ${ts.length} tarefas por fazer hoje.`, text: ts.slice(0, 3).map(t => '• ' + t.title).join('\n') + (ts.length > 3 ? `\n… e mais ${ts.length - 3}` : ''), actions: [{ id: 'roll', label: 'Passar para amanhã', primary: true }, { id: 'day', label: 'Ver a lista' }, { id: 'ok', label: 'Deixar' }] });
  }
  let ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const now = new Date(), today = ymd(now), nowHM = hm(now);
      // lembretes com hora
      for (const t of D.tasks) {
        if (t.done || !t.time || !t.due) continue;
        const slot = t.due + 'T' + t.time;
        const at = new Date(slot + ':00').getTime();
        if (at <= now.getTime() && now.getTime() - at < 6 * 3600 * 1000 && t.notified !== slot) { t.notified = slot; save(); taskAlert(t); }
      }
      if (!x.active()) return;   // o resto só com o Zeus a ser usado (para não avisar com o Mac a dormir)
      if (feeds().length) await fetchGoogle().catch(() => {});
      // reuniões
      if (D.settings.meetings) {
        const lead = (D.settings.meetingLead || 10) * 60000;
        for (const e of G.events) {
          if (e.allDay) continue;
          const st = new Date(e.start).getTime(), k = e.id + '@' + e.start;
          if (st - now.getTime() > 0 && st - now.getTime() <= lead && !D.mem.ev[k]) {
            D.mem.ev[k] = Date.now(); save();
            const mins = Math.max(1, Math.round((st - now.getTime()) / 60000));
            const acts = []; if (e.meet) acts.push({ id: 'meet', label: 'Entrar no Meet', url: e.meet, primary: true });
            acts.push({ id: 'ok', label: 'Ok', primary: !e.meet });
            const pend = unified().filter(t => t.due && t.due <= today).length;
            alert({ kind: 'meeting', title: `Daqui a ${mins} minuto${mins === 1 ? '' : 's'}: ${e.title}`, text: [hm(new Date(e.start)) + '–' + hm(new Date(e.end)), e.location].filter(Boolean).join(' · ') + (pend ? `\nTens ${pend === 1 ? 'uma tarefa' : pend + ' tarefas'} por fazer hoje.` : ''), source: e.calendar || '', actions: acts });
          }
        }
      }
      // manhã: a primeira vez que o Zeus é usado depois das 7h
      const anyTime = !app.isPackaged && process.env.ZEUS_TEST_MG_ANYTIME;   // só nos testes
      if (D.settings.morning && ((now.getHours() >= 7 && now.getHours() < 13) || anyTime === 'manha') && D.mem.lastMorning !== today) { D.mem.lastMorning = today; save(); await morning(); }
      // fim do dia
      if (D.settings.evening && ((nowHM >= (D.settings.eveningAt || '18:30') && now.getHours() < 23) || anyTime === 'noite') && D.mem.lastEvening !== today) { D.mem.lastEvening = today; save(); await evening(); }
    } finally { ticking = false; }
  }
  setTimeout(tick, 8000);
  setInterval(tick, 20000);

  async function act(a, action) {
    a = a || {};
    const id = action && action.id;
    if (id === 'done' && a.task) { await doneTask(a.task); return { ok: true, toast: 'Feito.' }; }
    if (id === 'snooze' && a.task) { const d = new Date(Date.now() + 3600000); await changeTask(a.task, { due: ymd(d), time: hm(d) }); return { ok: true, toast: 'Volto a lembrar às ' + hm(d) + '.' }; }
    if (id === 'tomorrow' && a.task) { const t = findLocal(a.task); await changeTask(a.task, { due: addDays(ymd(), 1), time: t && t.time ? t.time : '' }); return { ok: true, toast: 'Passou para amanhã.' }; }
    if (id === 'open' && a.task) { const t = findLocal(a.task); if (t && t.link) x.openURL(t.link.url); return { ok: true }; }
    if (id === 'meet' && action.url) { x.openURL(action.url); return { ok: true }; }
    if (id === 'roll') {
      const ts = unified().filter(t => t.due && t.due <= ymd());
      let n = 0, fail = 0;
      for (const t of ts) { try { await changeTask(t.id, { due: addDays(ymd(), 1) }); n++; } catch (e) { fail++; } }
      return { ok: true, toast: `${n === 1 ? 'Uma tarefa passou' : n + ' tarefas passaram'} para amanhã.` + (fail ? ` ${fail} do Google ficaram (o Apps Script precisa de ser atualizado).` : '') };
    }
    return { ok: true };
  }

  /* ---------- ponte com a página das Tarefas ---------- */
  const fromT = e => { const wc = x.getTarefasWC && x.getTarefasWC(); return wc && e.sender === wc && e.senderFrame === e.sender.mainFrame; };
  const ht = (name, fn) => ipcMain.handle('tarefas:' + name, async (e, ...a) => { if (!fromT(e)) throw new Error('origem não autorizada'); try { return await fn(...a); } catch (err) { return { ok: false, error: err.message }; } });
  ht('state', async force => {
    if (force || Date.now() - G.t > 2 * 60 * 1000) await fetchGoogle(force).catch(() => {});
    const today = ymd();
    return { today, tomorrow: addDays(today, 1), tasks: unified(today), done: doneRecent(), areas: areasSorted(), colors: AREA_COLORS, errors: G.errors, feeds: feedInfo(), dark: x.isDark() };
  });
  ht('add', o => { const t = addTask(o || {}); return { ok: true, id: t.id }; });
  ht('change', async (id, o) => { await changeTask(String(id), o || {}); return { ok: true }; });
  ht('done', async (id, undo) => { await doneTask(String(id), !!undo); return { ok: true }; });
  ht('remove', async id => { await removeTask(String(id)); return { ok: true }; });
  ht('reorder', (area, ids) => reorder(String(area || ''), (ids || []).map(String)));
  ht('addArea', (name, color) => ({ ok: true, area: addArea(name, color) }));
  ht('changeArea', (id, o) => ({ ok: true, area: changeArea(String(id), o || {}) }));
  ht('removeArea', id => removeArea(String(id)));
  ht('open', url => { if (/^https?:/.test(String(url || ''))) x.openURL(String(url)); return true; });
  ht('macgyver', () => { x.toggleMg(); return true; });

  /* ---------- ponte com a página da bolinha ---------- */
  const from = e => { const wc = x.getWC(); return wc && e.sender === wc && e.senderFrame === e.sender.mainFrame; };
  const h = (name, fn) => ipcMain.handle('macgyver:' + name, (e, ...a) => { if (!from(e)) throw new Error('origem não autorizada'); return fn(...a); });
  function feedInfo() {
    const fs_ = feeds();
    return { count: fs_.length, write: writeFeed() ? feedLabel(writeFeed()) : '', old: fs_.filter(f => (f.v || 1) < 2).map(feedLabel), all: fs_.map(f => ({ id: f.id, label: feedLabel(f), v: f.v || 1 })) };
  }
  async function snapshot(force) {
    if (force || Date.now() - G.t > 2 * 60 * 1000) await fetchGoogle(force).catch(() => {});
    const today = ymd();
    return {
      today, todayLong: longDate(today), tomorrow: addDays(today, 1),
      tasks: unified(today),
      areas: areasSorted(),
      events: G.events.filter(e => evDay(e) >= today && evDay(e) <= addDays(today, 7)).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, meet: e.meet || '', location: e.location || '', label: e.label })),
      errors: G.errors,
      chat: D.chat.slice(-40),
      lastConv: (() => { const c = D.convs.slice().sort((a, b) => b.last - a.last)[0]; return c && Date.now() - c.last < 3 * 3600 * 1000 ? { id: c.id, title: c.title, last: c.last } : null; })(),
      convCount: D.convs.length,
      settings: D.settings,
      key: !!x.getKey(),
      voice: voiceState(),
      feeds: feedInfo(),
      dark: x.isDark(),
      page: x.pageLite ? x.pageLite() : null,
      version: app.getVersion(),
      mac: process.platform === 'darwin'
    };
  }
  h('state', force => snapshot(!!force));
  h('ask', (text, opts) => ask(text, opts || {}));
  h('done', (id, undo) => doneTask(String(id), !!undo).then(() => ({ ok: true }), e => ({ ok: false, error: e.message })));
  h('change', (id, o) => changeTask(String(id), o || {}).then(() => ({ ok: true }), e => ({ ok: false, error: e.message })));
  h('remove', id => removeTask(String(id)).then(() => ({ ok: true }), e => ({ ok: false, error: e.message })));
  h('add', o => { try { const t = addTask(o || {}); return { ok: true, id: t.id }; } catch (e) { return { ok: false, error: e.message }; } });
  h('open', id => { const t = uById(String(id)) || findLocal(String(id)); if (t && t.link) x.openURL(t.link.url); return true; });
  h('openNote', id => { x.openNote(String(id)); return true; });
  h('act', (a, action) => act(a, action).catch(e => ({ ok: false, error: e.message })));
  h('layout', (mode, height) => { x.layout(['orb', 'bubble', 'panel'].includes(mode) ? mode : 'orb', Math.max(0, Math.min(1200, height | 0))); return true; });
  h('setting', (k, v) => {
    if (!(k in DEF_SET)) return D.settings;
    if (k === 'eveningAt') v = okTime(v) || '18:30';
    else if (k === 'meetingLead') v = [5, 10, 15].includes(+v) ? +v : 10;
    else if (k === 'feed') v = String(v || '');
    else v = !!v;
    D.settings[k] = v; save();
    if (k === 'hidden') x.layout('orb', 0);
    return D.settings;
  });
  h('clearChat', () => { archive(); return true; });
  h('fresh', () => { fresh(); return true; });
  h('history', () => historyList());
  h('openConv', id => openConv(String(id)));
  h('deleteConv', id => { D.convs = D.convs.filter(z => z.id !== String(id)); save(); return true; });
  h('setKey', k => { k = String(k || '').trim(); if (!/^sk-ant-[\w-]{20,}$/.test(k)) return { ok: false, error: 'Isto não parece uma chave da API da Anthropic (começa por sk-ant-).' }; x.setKey(k); return { ok: true }; });
  h('micAccess', async () => {
    if (process.platform !== 'darwin') return 'granted';
    let st = systemPreferences.getMediaAccessStatus('microphone');
    if (st === 'not-determined') st = (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied';
    return st;
  });
  h('listenStart', () => { const v = voiceState(); if (!v.ok) return v; stopSpeaking(); pcm = []; pcmBytes = 0; listening = true; return { ok: true }; });
  ipcMain.on('macgyver:pcm', (e, buf) => { if (from(e) && listening && buf && buf.byteLength && pcmBytes < 32000 * 120) { pcm.push(Buffer.from(buf)); pcmBytes += buf.byteLength; } });
  h('listenStop', async cancel => {
    listening = false;
    const buf = Buffer.concat(pcm); pcm = []; pcmBytes = 0;
    if (cancel) return { ok: true, text: '' };
    if (buf.length < 32000 * 0.4) return { ok: true, text: '' };   // menos de meio segundo
    try { return { ok: true, text: await transcribe(buf) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  h('stopSpeaking', () => { stopSpeaking(); return true; });
  h('confirmReply', (id, ok) => { const f = confirms.get(String(id)); if (f) f(!!ok); return true; });
  h('speak', t => { speak(t); return true; });
  h('openNotas', () => { x.openNotas(); return true; });
  h('openSetup', () => { x.openSetup(); return true; });
  h('scriptUpdate', () => x.scriptUpdate());

  return {
    listenKey,
    homeTasks,
    homeDone: id => doneTask(id),
    hidden: () => !!D.settings.hidden,
    setHidden: v => { D.settings.hidden = !!v; save(); },
    refreshGoogle: () => { G.t = 0; },
    tick
  };
}

module.exports = { setupMacGyver };

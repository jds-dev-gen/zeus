'use strict';
/*
 * Futebol em direto — resultados dos jogos das equipas que o João segue, vindos do Sofascore.
 *
 * Como funciona:
 *  - De 15 em 15 minutos vê o próximo jogo e o último jogo de cada equipa (/team/{id}/events/next/0 e /last/0).
 *  - Um jogo "interessa" se está a decorrer, se começa dentro de uma hora, ou se acabou há pouco.
 *  - Enquanto houver um jogo a decorrer (ou prestes a começar) pergunta pelo resultado a cada 20 segundos (/event/{id}).
 *  - Quando o resultado muda: avisa a barra de baixo (o golo pisca) e, se estiver ligado, mostra uma notificação do Mac.
 *
 * O Sofascore não tem uma API oficial: o Zeus usa a mesma que o site deles usa. Primeiro tenta um pedido direto;
 * se o site o recusar, faz o pedido de dentro de uma página escondida do sofascore.com (como um browser normal).
 */
const SOFA = 'https://www.sofascore.com/api/v1';
const SCHEDULE_EVERY = 15 * 60e3;
const LIVE_EVERY = 20e3;
const POST_WINDOW = 45 * 60e3;         // e jogos que acabaram há menos de 45 min (contado a partir de quando o Zeus viu o fim)

const LIVE_CODES = new Set([6, 7, 41, 42, 50]);   // 1.ª parte, 2.ª parte, prolongamento, penáltis
const BREAK_CODES = new Set([31, 32, 33, 34]);    // intervalo e pausas antes do prolongamento/penáltis

class Scores {
  constructor({ session, BrowserWindow, onChange, onGoal, base, log }) {
    this.ses = session; this.BW = BrowserWindow;
    this.onChange = onChange; this.onGoal = onGoal;
    this.base = base || SOFA;
    this.log = log || (() => {});
    this.teams = [];
    this.events = new Map();     // id -> evento do Sofascore
    this.endedAt = new Map();    // id -> quando o Zeus viu o jogo acabar
    this.timers = { sched: null, live: null };
    this.page = null; this.pageReady = null; this.pageIdle = null;
    this.direct = true;          // passa a false se o Sofascore recusar pedidos diretos
    this.lastSent = '';
  }

  setTeams(teams) {
    this.teams = (teams || []).filter(t => t && t.id);
    const ids = new Set(this.teams.map(t => t.id));
    for (const [id, ev] of this.events) if (!ids.has(ev.homeTeam.id) && !ids.has(ev.awayTeam.id)) this.events.delete(id);
    this.refreshSchedule();
  }
  start(teams) {
    this.teams = (teams || []).filter(t => t && t.id);
    clearInterval(this.timers.sched);
    this.timers.sched = setInterval(() => this.refreshSchedule(), SCHEDULE_EVERY);
    setTimeout(() => this.refreshSchedule(), 4000);
  }

  /* ---------- pedidos ---------- */
  async get(path) {
    const url = this.base + path;
    if (this.direct) {
      try {
        const headers = { Accept: 'application/json' };
        if (url.startsWith('https://www.sofascore.com/')) headers.Referer = 'https://www.sofascore.com/';   // o Chromium recusa um referer de outro site
        const r = await this.ses.fetch(url, { headers, credentials: 'include' });
        if (r.status === 404) return null;
        const type = r.headers.get('content-type') || '';
        if (r.ok && type.includes('json')) return await r.json();
        if (r.status === 403 || r.status === 429 || !type.includes('json')) { this.direct = false; this.log('sofascore: pedido direto recusado (' + r.status + '), a usar a página escondida'); }
        else return null;
      } catch (e) { /* tenta pela página */ }
    }
    return this.viaPage(url);
  }
  async viaPage(url) {
    if (this.base !== SOFA) return null;   // só para o Sofascore verdadeiro
    if (!this.page || this.page.isDestroyed()) {
      this.page = new this.BW({ show: false, width: 800, height: 600, webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      this.page.webContents.setAudioMuted(true);
      this.pageReady = this.page.loadURL('https://www.sofascore.com/').catch(() => {});
    }
    clearTimeout(this.pageIdle);
    this.pageIdle = setTimeout(() => { try { this.page.destroy(); } catch (e) { /* ok */ } this.page = null; this.direct = true; }, 30 * 60e3);
    await this.pageReady;
    try {
      const r = await this.page.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}, { credentials: 'include', headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null).catch(() => null)`);
      return r;
    } catch (e) { return null; }
  }

  async search(q) {
    q = String(q || '').trim(); if (q.length < 2) return [];
    const j = await this.get('/search/all?q=' + encodeURIComponent(q) + '&page=0');
    const res = (j && j.results) || [];
    return res.filter(r => r.type === 'team' && r.entity && (!r.entity.sport || r.entity.sport.slug === 'football'))
      .slice(0, 15)
      .map(r => ({ id: r.entity.id, name: r.entity.name, country: (r.entity.country && r.entity.country.name) || '', women: r.entity.gender === 'F', national: !!r.entity.national, logo: teamLogo(r.entity.id) }));
  }

  /* ---------- calendário ---------- */
  async refreshSchedule() {
    if (!this.teams.length) { this.events.clear(); this.stopLive(); this.emit(); return; }
    for (const t of this.teams) {
      const [next, last] = await Promise.all([this.get(`/team/${t.id}/events/next/0`), this.get(`/team/${t.id}/events/last/0`)]);
      const n = next && next.events && next.events[0];
      const l = last && last.events && last.events[last.events.length - 1];
      for (const ev of [n, l]) if (ev && ev.id) this.store(ev, false);
    }
    this.prune(); this.emit(); this.planLive();
  }
  prune() {
    const now = Date.now();
    for (const [id, ev] of this.events) {
      const start = ev.startTimestamp * 1000;
      if (ev.status.type === 'notstarted' && start - now > 3 * 86400e3) continue;   // fica guardado, mas não aparece
      if (ev.status.type === 'finished' && !this.endedAt.has(id) && now - start > 4 * 3600e3) this.events.delete(id);
      if (this.endedAt.has(id) && now - this.endedAt.get(id) > 6 * 3600e3) { this.events.delete(id); this.endedAt.delete(id); }
    }
  }
  store(ev, live) {
    const old = this.events.get(ev.id);
    if (old && live) {
      const oh = score(old.homeScore), oa = score(old.awayScore), nh = score(ev.homeScore), na = score(ev.awayScore);
      if ((nh > oh || na > oa) && (isLive(ev) || ev.status.type === 'finished')) {
        ev.__goalAt = Date.now(); ev.__goalSide = nh > oh ? 'home' : 'away';
        this.onGoal && this.onGoal(this.view(ev));
      } else if (old.__goalAt) { ev.__goalAt = old.__goalAt; ev.__goalSide = old.__goalSide; }
    }
    if (ev.status.type === 'finished' && !this.endedAt.has(ev.id) && (live || (old && old.status.type !== 'finished'))) this.endedAt.set(ev.id, Date.now());
    this.events.set(ev.id, ev);
  }

  /* ---------- jogos a decorrer ---------- */
  relevant() {
    const now = Date.now();
    return [...this.events.values()].filter(ev => {
      const start = ev.startTimestamp * 1000;
      if (isLive(ev) || BREAK_CODES.has(ev.status.code)) return true;
      // jogos marcados para hoje aparecem logo, com a hora prevista (e ficam se o início atrasar)
      if (ev.status.type === 'notstarted') return new Date(start).toDateString() === new Date(now).toDateString() || (start <= now && now - start < 3 * 3600e3);
      if (ev.status.type === 'finished') return this.endedAt.has(ev.id) ? now - this.endedAt.get(ev.id) < POST_WINDOW : now - start < 2 * 3600e3 + POST_WINDOW;
      return false;
    }).sort((a, b) => a.startTimestamp - b.startTimestamp);
  }
  planLive() {
    const now = Date.now();
    const hot = [...this.events.values()].filter(ev => isLive(ev) || BREAK_CODES.has(ev.status.code) ||
      (ev.status.type === 'notstarted' && ev.startTimestamp * 1000 - now < 10 * 60e3 && now - ev.startTimestamp * 1000 < 3 * 3600e3) ||
      (ev.status.type === 'inprogress'));
    if (hot.length && !this.timers.live) {
      this.timers.live = setInterval(() => this.pollLive(), LIVE_EVERY);
      this.pollLive();
    } else if (!hot.length) this.stopLive();
    // um jogo vai começar em breve, mas ainda faltam mais de 10 min: volta a ver o calendário um pouco antes
    const soon = [...this.events.values()].filter(ev => ev.status.type === 'notstarted').map(ev => ev.startTimestamp * 1000 - now - 9 * 60e3).filter(ms => ms > 0 && ms < SCHEDULE_EVERY);
    clearTimeout(this.timers.soon);
    if (soon.length) this.timers.soon = setTimeout(() => this.planLive(), Math.min(...soon) + 1000);
  }
  stopLive() { clearInterval(this.timers.live); this.timers.live = null; }
  async pollLive() {
    const now = Date.now();
    const ids = [...this.events.values()].filter(ev => ev.status.type === 'inprogress' || BREAK_CODES.has(ev.status.code) ||
      (ev.status.type === 'notstarted' && ev.startTimestamp * 1000 - now < 10 * 60e3 && now - ev.startTimestamp * 1000 < 3 * 3600e3)).map(ev => ev.id);
    if (!ids.length) { this.stopLive(); this.emit(); return; }
    for (const id of ids) {
      const j = await this.get(`/event/${id}`);
      if (j && j.event) this.store(j.event, true);
    }
    this.emit(); this.planLive();
  }

  /* ---------- o que vai para a barra ---------- */
  view(ev) {
    const mine = new Set(this.teams.map(t => t.id));
    const st = ev.status || {};
    let state = 'pre', label = '';
    if (isLive(ev)) { state = 'live'; label = minute(ev) || st.description || 'Ao vivo'; }
    else if (st.code === 31) { state = 'break'; label = 'Intervalo'; }
    else if (BREAK_CODES.has(st.code)) { state = 'break'; label = 'Pausa'; }
    else if (st.type === 'finished') { state = 'ft'; label = st.code === 110 ? 'Final (prol.)' : st.code === 120 ? 'Final (pen.)' : 'Final'; }
    else if (st.type === 'notstarted') { state = 'pre'; label = hhmm(ev.startTimestamp * 1000); }
    else { state = 'other'; label = st.description || ''; }
    const side = t => ({ id: t.id, name: t.shortName || t.name, full: t.name, mine: mine.has(t.id), logo: teamLogo(t.id) });
    return {
      id: ev.id, state, label,
      home: { ...side(ev.homeTeam), score: score(ev.homeScore) },
      away: { ...side(ev.awayTeam), score: score(ev.awayScore) },
      pens: ev.homeScore && ev.homeScore.penalties != null ? `${ev.homeScore.penalties}–${ev.awayScore.penalties}` : '',
      comp: (ev.tournament && ((ev.tournament.uniqueTournament && ev.tournament.uniqueTournament.name) || ev.tournament.name)) || '',
      start: ev.startTimestamp * 1000,
      goalAt: ev.__goalAt || 0, goalSide: ev.__goalSide || '',
      url: matchURL(ev)
    };
  }
  list() { return this.relevant().map(ev => this.view(ev)); }
  emit() {
    const list = this.list();
    const key = JSON.stringify(list);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.onChange && this.onChange(list);
  }
  url(id) { const ev = this.events.get(+id); return ev ? matchURL(ev) : null; }
  stop() { clearInterval(this.timers.sched); this.stopLive(); clearTimeout(this.timers.soon); try { if (this.page) this.page.destroy(); } catch (e) { /* ok */ } }
}

const score = s => (s && typeof s.current === 'number' ? s.current : (s && typeof s.display === 'number' ? s.display : null));
const isLive = ev => ev && ev.status && (LIVE_CODES.has(ev.status.code) || (ev.status.type === 'inprogress' && !BREAK_CODES.has(ev.status.code)));
const teamLogo = id => `https://img.sofascore.com/api/v1/team/${id}/image`;
const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function minute(ev) {
  const t = ev.time || {};
  if (ev.status.code === 50) return 'Penáltis';
  if (!t.currentPeriodStartTimestamp) return '';
  const base = Math.floor((t.initial || 0) / 60);
  const max = t.max ? Math.floor(t.max / 60) : base + 45;
  const m = base + Math.floor((Date.now() / 1000 - t.currentPeriodStartTimestamp) / 60) + 1;
  if (m > max) return `${max}+${Math.min(m - max, 15)}'`;
  return `${Math.max(1, m)}'`;
}
function matchURL(ev) {
  return ev.slug && ev.customId ? `https://www.sofascore.com/football/match/${ev.slug}/${ev.customId}#id:${ev.id}` : `https://www.sofascore.com/event/${ev.id}`;
}

module.exports = { Scores };

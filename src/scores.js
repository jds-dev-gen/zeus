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
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

const LIVE_CODES = new Set([6, 7, 41, 42, 50]);   // 1.ª parte, 2.ª parte, prolongamento, penáltis
const BREAK_CODES = new Set([31, 32, 33, 34]);    // intervalo e pausas antes do prolongamento/penáltis

/* Jogos grandes: os dois clubes são "grandes" e o jogo é numa das principais competições europeias */
const BIG_TOURNAMENTS = new Set([17, 8, 23, 35, 34, 238, 7, 679]);   // Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Liga Portugal, Liga dos Campeões, Liga Europa
const BIG_TOURNAMENT_NAMES = /^(premier league|laliga|la liga|serie a|bundesliga|ligue 1|liga portugal( betclic)?|uefa champions league|uefa europa league)$/i;
const BIG_CLUBS = [
  /^arsenal( fc)?$/, /^chelsea( fc)?$/, /^liverpool( fc)?$/, /^manchester city( fc)?$/, /^manchester united( fc)?$/, /^tottenham( hotspur)?( fc)?$/, /^newcastle united( fc)?$/,
  /^real madrid( cf)?$/, /^(fc )?barcelona$/, /^atletico( de)? madrid$/,
  /^(fc )?internazionale( milano)?$|^inter$/, /^(ac )?milan$/, /^juventus( fc)?$/, /^(ssc )?napoli$/, /^(as )?roma$/,
  /^(fc )?bayern( munchen| munich)?$/, /^borussia dortmund$/, /^bayer (04 )?leverkusen$/,
  /^paris saint-germain( fc)?$|^psg$/, /^(olympique de )?marseille$/,
  /^(sl )?benfica$/, /^(fc )?porto$/, /^sporting( cp| clube de portugal)?$/, /^(sc )?braga$/
];
const fold = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const isBigClub = t => t && t.gender !== 'F' && BIG_CLUBS.some(re => re.test(fold(t.name)));
const ut = ev => (ev.tournament && ev.tournament.uniqueTournament) || {};
const isBigEvent = ev => ev && (BIG_TOURNAMENTS.has(ut(ev).id) || BIG_TOURNAMENT_NAMES.test(ut(ev).name || '')) && isBigClub(ev.homeTeam) && isBigClub(ev.awayTeam);
const BIG_EVERY = 30 * 60e3;

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
    this.big = true; this.bigAt = 0;
    this.diag = { okAt: 0, err: '', errAt: 0, via: 'direto', bigAt: 0, bigTotal: 0, bigFound: [], bigErr: '' };   // para as Definições
  }
  status() { return { ...this.diag, via: this.direct ? 'direto' : 'página escondida', teams: this.teams.length, big: this.big }; }
  async refreshNow() { this.bigAt = 0; await this.refreshSchedule(); return this.status(); }
  setBig(on) {
    this.big = on !== false;
    if (!this.big) for (const [id, ev] of this.events) if (ev.__big && !this.isMine(ev)) this.events.delete(id);
    this.bigAt = 0; this.refreshSchedule();
  }
  isMine(ev) { const ids = new Set(this.teams.map(t => t.id)); return ids.has(ev.homeTeam.id) || ids.has(ev.awayTeam.id); }

  setTeams(teams) {
    this.teams = (teams || []).filter(t => t && t.id);
    const ids = new Set(this.teams.map(t => t.id));
    for (const [id, ev] of this.events) if (!ids.has(ev.homeTeam.id) && !ids.has(ev.awayTeam.id) && !ev.__big) this.events.delete(id);
    this.refreshSchedule();
  }
  start(teams, big) {
    this.teams = (teams || []).filter(t => t && t.id);
    this.big = big !== false;
    clearInterval(this.timers.sched);
    this.timers.sched = setInterval(() => this.refreshSchedule(), SCHEDULE_EVERY);
    setTimeout(() => this.refreshSchedule(), 4000);
    this.atMidnight();
  }
  // à meia-noite, os jogos do dia anterior saem da barra
  atMidnight() {
    const m = new Date(); m.setHours(24, 0, 5, 0);
    clearTimeout(this.timers.midnight);
    this.timers.midnight = setTimeout(() => { this.prune(); this.emit(); this.refreshSchedule(); this.atMidnight(); }, m - Date.now());
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
        if (r.ok && type.includes('json')) { const j = await r.json(); this.diag.okAt = Date.now(); return j; }
        this.diag.err = `O Sofascore respondeu ${r.status} (${type.split(';')[0] || 'sem tipo'})`; this.diag.errAt = Date.now();
        if (r.status === 403 || r.status === 429 || !type.includes('json')) { this.direct = false; this.log('sofascore: pedido direto recusado (' + r.status + '), a usar a página escondida'); }
        else return null;
      } catch (e) { this.diag.err = 'Sem ligação ao Sofascore (' + (e && e.message || e) + ')'; this.diag.errAt = Date.now(); }
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
      const r = await this.page.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}, { credentials: 'include', headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : (r.status === 404 ? null : { __status: r.status })).catch(e => ({ __status: 'rede' }))`);
      if (r && r.__status) { this.diag.err = 'A página do Sofascore respondeu ' + r.__status; this.diag.errAt = Date.now(); return null; }
      if (r) this.diag.okAt = Date.now();
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
    if (!this.teams.length && !this.big) { this.events.clear(); this.stopLive(); this.emit(); return; }
    if (this.big && Date.now() - this.bigAt > BIG_EVERY) await this.loadBig();
    for (const t of this.teams) {
      const [next, last] = await Promise.all([this.get(`/team/${t.id}/events/next/0`), this.get(`/team/${t.id}/events/last/0`)]);
      const n = next && next.events && next.events[0];
      const l = last && last.events && last.events[last.events.length - 1];
      for (const ev of [n, l]) if (ev && ev.id) this.store(ev, false);
    }
    this.prune(); this.emit(); this.planLive();
  }
  // os jogos de hoje das principais ligas europeias entre clubes grandes
  // o Sofascore deixou de ter a lista de todos os jogos do dia (/sport/football/scheduled-events/{dia} dá 404):
  // pede-se a lista de hoje de cada competição principal (/unique-tournament/{id}/scheduled-events/{dia})
  async loadBig() {
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const res = await Promise.all([...BIG_TOURNAMENTS].map(id => this.get(`/unique-tournament/${id}/scheduled-events/${day}`).catch(() => null)));
    const ok = res.filter(j => j && Array.isArray(j.events));
    if (!ok.length) { this.diag.bigErr = 'Não consegui ler os jogos de hoje das ligas. ' + (this.diag.err || ''); return; }
    this.bigAt = Date.now();
    const found = [];
    let total = 0;
    for (const j of ok) for (const ev of j.events) {
      if (!ev || !ev.id || new Date(ev.startTimestamp * 1000).toDateString() !== d.toDateString()) continue;
      total++;
      if (isBigEvent(ev)) { ev.__big = true; this.store(ev, false); found.push(`${ev.homeTeam.shortName || ev.homeTeam.name}–${ev.awayTeam.shortName || ev.awayTeam.name}`); }
    }
    this.diag.bigAt = Date.now(); this.diag.bigTotal = total; this.diag.bigFound = found; this.diag.bigErr = '';
    this.diag.bigLeagues = ok.length;
  }
  prune() {
    const now = Date.now();
    for (const [id, ev] of this.events) {
      const start = ev.startTimestamp * 1000;
      if (ev.status.type === 'notstarted' && start - now > 3 * 86400e3) continue;   // fica guardado, mas não aparece
      // jogos acabados ficam até ao fim do dia do jogo
      if (ev.status.type === 'finished' && !sameDay(this.endedAt.get(id) || start, now)) { this.events.delete(id); this.endedAt.delete(id); }
    }
  }
  store(ev, live) {
    const old = this.events.get(ev.id);
    if (old && old.__big) ev.__big = true;
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
      if (ev.status.type === 'finished') return sameDay(this.endedAt.get(ev.id) || start, now);   // o resultado final fica até mudar o dia
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
    // vários jogos ao mesmo tempo: um só pedido com todos os jogos a decorrer; os restantes (a começar ou acabados) um a um
    let rest = ids;
    if (ids.length > 2) {
      const live = await this.get('/sport/football/events/live');
      if (live && Array.isArray(live.events)) {
        const want = new Set(ids), got = new Set();
        for (const ev of live.events) if (want.has(ev.id)) { this.store(ev, true); got.add(ev.id); }
        rest = ids.filter(id => !got.has(id));
      }
    }
    for (const id of rest) {
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
      big: !!ev.__big && !mine.has(ev.homeTeam.id) && !mine.has(ev.awayTeam.id),
      url: matchURL(ev)
    };
  }
  // primeiro os jogos das equipas seguidas, depois os jogos grandes (cada grupo por hora de início)
  list() { const v = this.relevant().map(ev => this.view(ev)); return [...v.filter(m => !m.big), ...v.filter(m => m.big)]; }
  emit() {
    const list = this.list();
    const key = JSON.stringify(list);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.onChange && this.onChange(list);
  }
  url(id) { const ev = this.events.get(+id); return ev ? matchURL(ev) : null; }
  /* Página de detalhe: golos, cartões, substituições e estatísticas de cada jogo da barra */
  async details() {
    const list = this.relevant();
    this.detCache = this.detCache || new Map();
    const out = await Promise.all(list.map(async ev => {
      const v = this.view(ev);
      const extra = {
        venue: (ev.venue && ((ev.venue.stadium && ev.venue.stadium.name) || ev.venue.name)) || '',
        city: (ev.venue && ev.venue.city && ev.venue.city.name) || '',
        referee: (ev.referee && ev.referee.name) || '',
        round: (ev.roundInfo && (ev.roundInfo.name || (ev.roundInfo.round ? 'Jornada ' + ev.roundInfo.round : ''))) || ''
      };
      if (ev.status.type === 'notstarted') return { ...v, ...extra, incidents: [], stats: [] };
      // jogos acabados não mudam: guardados; a decorrer: no máximo de 20 em 20 s
      const c = this.detCache.get(ev.id);
      const fresh = c && (ev.status.type === 'finished' ? c.final : Date.now() - c.at < 20e3);
      let det = fresh ? c.det : null;
      if (!det) {
        const [inc, sta] = await Promise.all([this.get(`/event/${ev.id}/incidents`), this.get(`/event/${ev.id}/statistics`)]);
        det = { incidents: simplifyIncidents(inc), stats: simplifyStats(sta) };
        this.detCache.set(ev.id, { at: Date.now(), det, final: ev.status.type === 'finished' });
      }
      return { ...v, ...extra, ...det };
    }));
    return out.sort((a, b) => (a.big === b.big ? 0 : a.big ? 1 : -1));
  }
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
const KIND = { regular: 'goal', ownGoal: 'own', penalty: 'pen', yellow: 'yellow', red: 'red', yellowRed: 'yellowred' };
function simplifyIncidents(j) {
  const inc = (j && j.incidents) || [];
  return inc.filter(i => ['goal', 'card', 'substitution', 'period', 'varDecision'].includes(i.incidentType)).map(i => {
    const who = p => (p && (p.shortName || p.name)) || '';
    const base = { min: i.time != null ? i.time : null, add: i.addedTime || 0, home: !!i.isHome };
    if (i.incidentType === 'goal') return { ...base, type: KIND[i.incidentClass] === 'own' ? 'own' : KIND[i.incidentClass] === 'pen' ? 'pen' : 'goal', player: who(i.player) || i.playerName || '', assist: who(i.assist1), score: i.homeScore != null ? `${i.homeScore}–${i.awayScore}` : '' };
    if (i.incidentType === 'card') return { ...base, type: KIND[i.incidentClass] || 'yellow', player: who(i.player) || i.playerName || '' };
    if (i.incidentType === 'substitution') return { ...base, type: 'sub', player: who(i.playerIn), out: who(i.playerOut) };
    if (i.incidentType === 'varDecision') return { ...base, type: 'var', player: who(i.player), text: i.incidentClass || '' };
    return { ...base, type: 'period', text: i.text || '', score: i.homeScore != null ? `${i.homeScore}–${i.awayScore}` : '' };
  });
}
const STAT_PT = { 'Ball possession': 'Posse de bola', 'Expected goals': 'Golos esperados (xG)', 'Big chances': 'Grandes oportunidades', 'Total shots': 'Remates', 'Shots on target': 'Remates à baliza', 'Corner kicks': 'Cantos', 'Fouls': 'Faltas', 'Offsides': 'Foras de jogo', 'Yellow cards': 'Amarelos', 'Red cards': 'Vermelhos', 'Goalkeeper saves': 'Defesas do guarda-redes', 'Passes': 'Passes' };
function simplifyStats(j) {
  const all = ((j && j.statistics) || []).find(p => p.period === 'ALL');
  if (!all) return [];
  const items = new Map();
  for (const g of all.groups || []) for (const it of g.statisticsItems || []) if (STAT_PT[it.name] && !items.has(it.name)) items.set(it.name, it);
  return Object.keys(STAT_PT).filter(k => items.has(k)).map(k => {
    const it = items.get(k);
    const hv = typeof it.homeValue === 'number' ? it.homeValue : parseFloat(it.home) || 0, av = typeof it.awayValue === 'number' ? it.awayValue : parseFloat(it.away) || 0;
    return { label: STAT_PT[k], home: String(it.home), away: String(it.away), hv, av };
  });
}
function matchURL(ev) {
  return ev.slug && ev.customId ? `https://www.sofascore.com/football/match/${ev.slug}/${ev.customId}#id:${ev.id}` : `https://www.sofascore.com/event/${ev.id}`;
}

module.exports = { Scores, isBigEvent };

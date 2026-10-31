'use strict';
/*
 * Radar — feed de notícias do Zeus, por colunas.
 * Cada coluna junta as notícias das suas fontes (RSS/Atom), da mais recente para a mais antiga.
 * Tudo fica guardado no ficheiro radar.json do Zeus (fontes, últimas notícias, o que já foi lido).
 * Os feeds são pedidos pelo processo principal (sem cookies), porque uma página não os pode ler diretamente.
 */
const R = window.radar;
const $ = s => document.querySelector(s);

const REFRESH_EVERY = 15 * 60e3;   // atualiza sozinho a cada 15 min (se estiver aberto)
const STALE = 10 * 60e3;           // ao voltar ao Radar, atualiza se já passaram 10 min
const PER_FEED = 30, PER_COL = 120, KEEP_READ_DAYS = 21;

const F = (title, url, site) => ({ title, url, site });
const DEFAULT_COLS = [
  { id: 'pt', name: 'Nacionais', sources: [
    F('Observador', 'https://observador.pt/feed/', 'observador.pt'),
    F('Público', 'https://feeds.feedburner.com/PublicoRSS', 'publico.pt'),
    F('RTP Notícias', 'https://www.rtp.pt/noticias/rss', 'rtp.pt'),
    F('ECO', 'https://eco.sapo.pt/feed/', 'eco.sapo.pt')
  ] },
  { id: 'int', name: 'Internacionais', sources: [
    F('BBC News — World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'bbc.com'),
    F('The Guardian — World', 'https://www.theguardian.com/world/rss', 'theguardian.com'),
    F('The New York Times — World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'nytimes.com'),
    F('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'aljazeera.com')
  ] },
  { id: 'ia', name: 'Inteligência Artificial', sources: [
    F('The Verge — AI', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'theverge.com'),
    F('TechCrunch — AI', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'techcrunch.com'),
    F('MIT Technology Review — AI', 'https://www.technologyreview.com/topic/artificial-intelligence/feed', 'technologyreview.com'),
    F('Simon Willison', 'https://simonwillison.net/atom/everything/', 'simonwillison.net')
  ] },
  { id: 'desp', name: 'Desporto', sources: [
    F('Observador — Desporto', 'https://observador.pt/seccao/desporto/feed/', 'observador.pt'),
    F('Record', 'https://www.record.pt/rss', 'record.pt'),
    F('Maisfutebol', 'https://maisfutebol.iol.pt/rss', 'maisfutebol.iol.pt'),
    F('BBC Sport — Football', 'https://feeds.bbci.co.uk/sport/football/rss.xml', 'bbc.com')
  ] }
];
const SUGGEST = {
  pt: [F('Expresso', 'https://expresso.pt/rss', 'expresso.pt'), F('SIC Notícias', 'https://sicnoticias.pt/rss', 'sicnoticias.pt'), F('Diário de Notícias', 'https://www.dn.pt/rss', 'dn.pt'), F('Jornal de Negócios', 'https://www.jornaldenegocios.pt/rss', 'jornaldenegocios.pt'), F('Notícias ao Minuto', 'https://www.noticiasaominuto.com/rss/ultima-hora', 'noticiasaominuto.com'), F('Observador — Política', 'https://observador.pt/seccao/politica/feed/', 'observador.pt')],
  int: [F('Le Monde — International', 'https://www.lemonde.fr/international/rss_full.xml', 'lemonde.fr'), F('El País', 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', 'elpais.com'), F('Politico Europe', 'https://www.politico.eu/feed/', 'politico.eu'), F('NPR — World', 'https://feeds.npr.org/1004/rss.xml', 'npr.org'), F('DW — News', 'https://rss.dw.com/rdf/rss-en-all', 'dw.com'), F('Observador — Mundo', 'https://observador.pt/seccao/mundo/feed/', 'observador.pt')],
  ia: [F('Ars Technica — AI', 'https://arstechnica.com/ai/feed/', 'arstechnica.com'), F('VentureBeat — AI', 'https://venturebeat.com/category/ai/feed/', 'venturebeat.com'), F('OpenAI — News', 'https://openai.com/news/rss.xml', 'openai.com'), F('Google — AI', 'https://blog.google/technology/ai/rss/', 'blog.google'), F('Hugging Face — Blog', 'https://huggingface.co/blog/feed.xml', 'huggingface.co'), F('Import AI', 'https://importai.substack.com/feed', 'importai.substack.com')],
  desp: [F('O Jogo', 'https://www.ojogo.pt/rss', 'ojogo.pt'), F('A Bola', 'https://www.abola.pt/rss', 'abola.pt'), F('The Guardian — Football', 'https://www.theguardian.com/football/rss', 'theguardian.com'), F('ESPN', 'https://www.espn.com/espn/rss/news', 'espn.com'), F('BBC Sport', 'https://feeds.bbci.co.uk/sport/rss.xml', 'bbc.com')]
};

let D = null;              // { v, cols, cache: {url: {at, ok, error, items}}, read: {link: ts}, lastRefresh }
let busy = false, saveT = null, modalCol = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => R.save(D), 400); };

/* ---------- utilidades ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const fav = host => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host || '')}&sz=32`;
const httpOnly = u => (/^https?:\/\//i.test(u || '') ? u : null);
function ago(ms) {
  const d = Date.now() - ms;
  if (!ms || isNaN(d)) return '';
  if (d < 60e3) return 'agora';
  if (d < 3600e3) return `há ${Math.floor(d / 60e3)} min`;
  if (d < 86400e3) return `há ${Math.floor(d / 3600e3)} h`;
  const day = new Date(ms), y = new Date(); y.setDate(y.getDate() - 1);
  if (day.toDateString() === y.toDateString()) return 'ontem';
  return day.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }).replace('.', '');
}
function plain(html) {
  if (!html) return '';
  const t = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  return t.replace(/\s+/g, ' ').trim();
}

/* ---------- ler feeds (RSS 2.0, RSS 1.0/RDF e Atom) ---------- */
const kids = (el, ...names) => [...el.children].filter(c => names.includes(c.nodeName.toLowerCase()) || names.includes((c.localName || '').toLowerCase()));
const txt = (el, ...names) => { const c = kids(el, ...names)[0]; return c ? c.textContent.trim() : ''; };
function parseFeed(text, base) {
  if (!text || !/<(rss|feed|rdf:RDF|channel)[\s>]/i.test(text.slice(0, 5000))) return null;
  let doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(text, 'text/html');
  const atom = doc.getElementsByTagName('entry').length > 0 && doc.getElementsByTagName('item').length === 0;
  const chan = doc.getElementsByTagName('channel')[0] || doc.getElementsByTagName('feed')[0];
  const title = chan ? txt(chan, 'title') : '';
  let siteLink = '';
  if (chan) {
    const l = kids(chan, 'link').find(x => !x.getAttribute('rel') || x.getAttribute('rel') === 'alternate');
    siteLink = l ? (l.getAttribute('href') || l.textContent.trim()) : '';
  }
  const items = [];
  for (const it of [...doc.getElementsByTagName(atom ? 'entry' : 'item')].slice(0, PER_FEED)) {
    let link = '';
    if (atom) {
      const l = kids(it, 'link').find(x => !x.getAttribute('rel') || x.getAttribute('rel') === 'alternate') || kids(it, 'link')[0];
      link = l ? l.getAttribute('href') || '' : '';
    } else {
      link = txt(it, 'link');
      if (!link) { const g = kids(it, 'guid')[0]; if (g && /^https?:/.test(g.textContent.trim())) link = g.textContent.trim(); }
      if (!link) { const l = kids(it, 'link')[0]; if (l && l.nextSibling && l.nextSibling.nodeType === 3) link = l.nextSibling.textContent.trim(); }
    }
    try { link = new URL(link, base).href; } catch (e) { link = ''; }
    if (!httpOnly(link)) continue;
    const rawDate = txt(it, 'pubdate', 'published', 'updated', 'dc:date', 'date');
    let date = Date.parse(rawDate);
    if (isNaN(date)) date = 0;
    const body = txt(it, 'content:encoded', 'encoded') || txt(it, 'description', 'summary', 'content');
    let img = '';
    const mc = [...it.getElementsByTagName('media:content'), ...it.getElementsByTagName('media:thumbnail')]
      .find(m => m.getAttribute('url') && (!m.getAttribute('medium') || m.getAttribute('medium') === 'image') && !/^(video|audio)/.test(m.getAttribute('type') || ''));
    if (mc) img = mc.getAttribute('url');
    if (!img) { const enc = kids(it, 'enclosure').find(e => /^image\//.test(e.getAttribute('type') || '') && e.getAttribute('url')); if (enc) img = enc.getAttribute('url'); }
    if (!img) { const m = /<img[^>]+src=["']([^"']+)["']/i.exec(body); if (m) img = m[1].replace(/&amp;/g, '&'); }
    try { img = img ? new URL(img, link).href : ''; } catch (e) { img = ''; }
    const t = plain(txt(it, 'title')) || '(sem título)';
    items.push({ link, title: t, date, img: httpOnly(img) || '', summary: plain(body).slice(0, 280) });
  }
  if (!chan && !items.length) return null;
  return { title: plain(title), site: siteLink, items };
}

async function loadFeed(src) {
  const r = await R.fetch(src.url);
  const c = D.cache[src.url] || {};
  if (!r || !r.text) { D.cache[src.url] = { ...c, at: Date.now(), ok: false, error: (r && r.error) || `O site respondeu com erro ${r && r.status || ''}`.trim() }; return; }
  const f = parseFeed(r.text, r.url);
  if (!f) { D.cache[src.url] = { ...c, at: Date.now(), ok: false, error: r.ok ? 'Este endereço não é um feed RSS.' : `O site respondeu com erro ${r.status}.` }; return; }
  const now = Date.now();
  // notícias sem data ficam com a hora em que o Radar as viu pela primeira vez
  const seen = new Map((c.items || []).map(i => [i.link, i.date]));
  f.items.forEach(i => { if (!i.date) i.date = seen.get(i.link) || now; if (i.date > now + 3600e3) i.date = now; });
  D.cache[src.url] = { at: now, ok: true, items: f.items };
  if (!src.site && f.site) src.site = hostOf(f.site);
}

async function refresh(force) {
  if (busy) return;
  const all = D.cols.flatMap(c => c.sources);
  const todo = all.filter(s => force || !D.cache[s.url] || Date.now() - (D.cache[s.url].at || 0) > STALE);
  if (!todo.length) { status(); return; }
  busy = true; $('#refresh').classList.add('spin'); $('#refresh').disabled = true;
  let done = 0;
  status(`A atualizar ${todo.length} fontes…`);
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      try { await loadFeed(s); } catch (e) { D.cache[s.url] = { ...(D.cache[s.url] || {}), at: Date.now(), ok: false, error: 'Não foi possível ler este feed.' }; }
      done++;
      status(`A atualizar… ${done}/${todo.length}`);
      renderCols();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  D.lastRefresh = Date.now();
  busy = false; $('#refresh').classList.remove('spin'); $('#refresh').disabled = false;
  pruneRead(); save(); renderCols(); status();
}
function pruneRead() {
  const lim = Date.now() - KEEP_READ_DAYS * 86400e3;
  for (const [k, t] of Object.entries(D.read)) if (t < lim) delete D.read[k];
  // fontes que já não estão em nenhuma coluna saem da memória
  const used = new Set(D.cols.flatMap(c => c.sources.map(s => s.url)));
  for (const k of Object.keys(D.cache)) if (!used.has(k)) delete D.cache[k];
}
function status(msg) {
  if (msg) { $('#status').textContent = msg; return; }
  $('#status').textContent = D.lastRefresh ? `Atualizado ${ago(D.lastRefresh) === 'agora' ? 'agora mesmo' : ago(D.lastRefresh)}` : '';
}

/* ---------- colunas ---------- */
function colItems(col) {
  const out = [], seen = new Set();
  for (const s of col.sources) {
    const c = D.cache[s.url];
    for (const it of (c && c.items) || []) {
      if (seen.has(it.link)) continue; seen.add(it.link);
      out.push({ ...it, src: s });
    }
  }
  return out.sort((a, b) => b.date - a.date).slice(0, PER_COL);
}
function renderCols() {
  const box = $('#cols');
  const unreadOnly = $('#unreadOnly').checked;
  box.style.setProperty('--n', D.cols.length);
  const scroll = [...box.querySelectorAll('.c-list')].map(l => l.scrollTop);
  box.replaceChildren(...D.cols.map((col, ci) => {
    let items = colItems(col);
    const unread = items.filter(i => !D.read[i.link]).length;
    if (unreadOnly) items = items.filter(i => !D.read[i.link]);
    const errs = col.sources.filter(s => D.cache[s.url] && D.cache[s.url].ok === false);
    const list = h('div', { class: 'c-list' },
      !col.sources.length
        ? h('p', { class: 'c-empty' }, 'Ainda não há fontes nesta coluna. ', h('button', { type: 'button', onclick: () => openModal(col.id) }, 'Adicionar fontes'))
        : !items.length
          ? h('p', { class: 'c-empty' }, busy || col.sources.some(s => !D.cache[s.url]) ? 'A carregar…' : unreadOnly ? 'Já leste tudo nesta coluna.' : 'Sem notícias de momento.')
          : items.map(itemEl),
      errs.length ? h('button', { class: 'c-err', type: 'button', onclick: () => openModal(col.id) }, errs.length === 1 ? `Não foi possível ler “${errs[0].title}”.` : `${errs.length} fontes com problemas.`, ' Ver fontes') : null
    );
    return h('section', { class: 'col' },
      h('div', { class: 'c-head' },
        h('span', { class: 'c-name', title: col.name }, col.name, unread ? h('em', {}, String(unread)) : null),
        h('button', { class: 'c-add', type: 'button', title: 'Fontes desta coluna', onclick: () => openModal(col.id) }, '+ Fontes')),
      list);
  }));
  box.querySelectorAll('.c-list').forEach((l, i) => { if (scroll[i]) l.scrollTop = scroll[i]; });
}
function itemEl(it) {
  const host = it.src.site || hostOf(it.link);
  const fresh = Date.now() - it.date < 3600e3 && !D.read[it.link];
  const open = bg => { D.read[it.link] = Date.now(); save(); R.open(it.link, bg); renderCols(); };
  return h('a', {
    class: 'it' + (D.read[it.link] ? ' read' : ''), href: it.link, title: it.summary || it.title,
    onclick: e => { e.preventDefault(); open(e.metaKey || e.ctrlKey); },
    onauxclick: e => { if (e.button === 1) { e.preventDefault(); open(true); } }
  },
  h('div', { class: 'it-main' },
    h('div', { class: 'it-meta' }, fresh ? h('i', { class: 'new', title: 'Na última hora' }) : null,
      h('img', { src: fav(host), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), h('b', {}, it.src.title), h('span', {}, '· ' + ago(it.date))),
    h('div', { class: 'it-title' }, it.title)),
  it.img ? h('img', { class: 'it-thumb', src: it.img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => e.target.remove() }) : null);
}

/* ---------- janela das fontes ---------- */
const colById = id => D.cols.find(c => c.id === id);
function openModal(id) {
  modalCol = id;
  $('#modal').hidden = false;
  $('#mResults').replaceChildren();
  $('#mQuery').value = '';
  renderModal();
  setTimeout(() => $('#mQuery').focus(), 30);
}
function closeModal() { $('#modal').hidden = true; modalCol = null; renderCols(); }
function renderModal() {
  const col = colById(modalCol); if (!col) return;
  $('#mTitle').textContent = 'Fontes · ' + col.name;
  $('#mSources').replaceChildren(...(col.sources.length ? col.sources.map(s => {
    const c = D.cache[s.url];
    const info = !c ? 'Ainda não carregada' : c.ok === false ? c.error : `${(c.items || []).length} notícias · ${hostOf(s.url)}`;
    return h('li', {},
      h('img', { src: fav(s.site || hostOf(s.url)), alt: '', referrerpolicy: 'no-referrer' }),
      h('div', { class: 's-txt' }, h('b', {}, s.title), h('small', { class: c && c.ok === false ? 'bad' : '', title: s.url }, info)),
      h('button', { class: 'icon', type: 'button', title: 'Tirar esta fonte', 'aria-label': 'Tirar ' + s.title, onclick: () => removeSource(col, s.url) }, '✕'));
  }) : [h('li', { class: 'hint' }, 'Nenhuma fonte ainda.')]));
  const have = new Set(D.cols.flatMap(c => c.sources.map(s => s.url)));
  const sug = (SUGGEST[col.id] || []).filter(s => !have.has(s.url));
  $('#mSuggestWrap').hidden = !sug.length;
  $('#mSuggest').replaceChildren(...sug.map(s => resultEl(s)));
}
function resultEl(s, note) {
  const inCol = colById(modalCol).sources.some(x => x.url === s.url);
  return h('li', {},
    h('img', { src: s.icon || fav(s.site || hostOf(s.url)), alt: '', referrerpolicy: 'no-referrer', onerror: e => { e.target.src = fav(hostOf(s.url)); } }),
    h('div', { class: 's-txt' }, h('b', {}, s.title || hostOf(s.url)), h('small', { title: s.url }, note || s.site || hostOf(s.url))),
    inCol ? h('span', { class: 'added' }, 'Adicionada') : h('button', { class: 'btn small', type: 'button', onclick: e => addSource(s, e.target) }, '+ Adicionar'));
}
async function addSource(s, btn) {
  const col = colById(modalCol); if (!col || col.sources.some(x => x.url === s.url)) return;
  const src = { title: s.title || hostOf(s.url), url: s.url, site: s.site ? hostOf(/^https?:/.test(s.site) ? s.site : 'https://' + s.site) || s.site : hostOf(s.url) };
  col.sources.push(src);
  if (btn) { btn.disabled = true; btn.textContent = 'A ler…'; }
  await loadFeed(src).catch(() => {});
  save(); renderModal(); renderCols();
  // os resultados da pesquisa passam a dizer "Adicionada"
  [...$('#mResults').querySelectorAll('li')].forEach(li => { const b = li.querySelector('button'); if (b && li.querySelector('small') && li.querySelector('small').title === s.url) b.replaceWith(h('span', { class: 'added' }, 'Adicionada')); });
}
function removeSource(col, url) {
  col.sources = col.sources.filter(s => s.url !== url);
  if (!D.cols.some(c => c.sources.some(s => s.url === url))) delete D.cache[url];
  save(); renderModal(); renderCols();
}

/* procurar: um endereço → descobrir o feed do site; um nome → pesquisa no catálogo do Feedly */
const looksLikeURL = q => /^https?:\/\//i.test(q) || (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(q));
async function search(q) {
  q = q.trim(); if (!q) return;
  const box = $('#mResults');
  box.replaceChildren(h('li', { class: 'hint' }, 'A procurar…'));
  let found = [];
  if (looksLikeURL(q)) found = await discover(/^https?:/i.test(q) ? q : 'https://' + q);
  if (!found.length) found = await feedly(looksLikeURL(q) ? hostOf(/^https?:/i.test(q) ? q : 'https://' + q) : q);
  if (!found.length) { box.replaceChildren(h('li', { class: 'hint' }, looksLikeURL(q) ? 'Não encontrei nenhum feed RSS neste site. Experimenta o nome do site, ou o endereço de uma secção.' : 'Sem resultados. Experimenta o endereço do site (ex.: publico.pt).')); return; }
  box.replaceChildren(...found.map(s => resultEl(s, s.note)));
}
async function discover(url) {
  const r = await R.fetch(url);
  if (!r || !r.text) return [];
  const direct = parseFeed(r.text, r.url);
  if (direct) return [{ title: direct.title || hostOf(r.url), url: r.url, site: hostOf(direct.site || r.url), note: `${direct.items.length} notícias · ${hostOf(r.url)}` }];
  const doc = new DOMParser().parseFromString(r.text, 'text/html');
  let cands = [...doc.querySelectorAll('link[rel~="alternate"]')]
    .filter(l => /(rss|atom|xml)/i.test(l.getAttribute('type') || '') && l.getAttribute('href') && !/comments/i.test(l.getAttribute('href')))
    .map(l => { try { return { url: new URL(l.getAttribute('href'), r.url).href, title: (l.getAttribute('title') || '').trim() }; } catch (e) { return null; } })
    .filter(Boolean);
  if (!cands.length) {
    const o = new URL(r.url).origin;
    cands = ['/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/feeds/posts/default'].map(p => ({ url: o + p, title: '' }));
  }
  const uniq = [...new Map(cands.map(c => [c.url, c])).values()].slice(0, 8);
  const ok = await Promise.all(uniq.map(async c => {
    const fr = await R.fetch(c.url); const f = fr && fr.text && parseFeed(fr.text, fr.url);
    return f ? { title: c.title && !/^(rss|atom|feed)/i.test(c.title) ? c.title : f.title || hostOf(c.url), url: fr.url || c.url, site: hostOf(r.url), note: `${f.items.length} notícias · ${hostOf(c.url)}` } : null;
  }));
  return [...new Map(ok.filter(Boolean).map(x => [x.url, x])).values()];
}
async function feedly(q) {
  const r = await R.fetch(`https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(q)}&count=15&locale=pt`);
  if (!r || !r.ok || !r.text) return [];
  try {
    const j = JSON.parse(r.text);
    return (j.results || []).filter(x => /^feed\/https?:/.test(x.feedId || '')).map(x => ({
      title: x.title || '', url: x.feedId.slice(5), site: hostOf(x.website || x.feedId.slice(5)), icon: httpOnly(x.iconUrl || x.visualUrl || '') || '',
      note: [hostOf(x.website || x.feedId.slice(5)), x.subscribers ? `${x.subscribers.toLocaleString('pt-PT')} leitores no Feedly` : ''].filter(Boolean).join(' · ')
    }));
  } catch (e) { return []; }
}

/* ---------- arranque ---------- */
async function start() {
  const t = await R.theme(); if (t) document.documentElement.dataset.theme = t;
  R.onTheme(t2 => { document.documentElement.dataset.theme = t2; });
  const saved = await R.load();
  D = saved && Array.isArray(saved.cols) ? saved : { v: 1, cols: JSON.parse(JSON.stringify(DEFAULT_COLS)), cache: {}, read: {}, lastRefresh: 0 };
  D.cache = D.cache || {}; D.read = D.read || {};
  try { $('#unreadOnly').checked = localStorage.getItem('radar.unreadOnly') === '1'; } catch (e) { /* ok */ }
  renderCols(); status();
  refresh(false);
  setInterval(() => { if (!document.hidden && Date.now() - (D.lastRefresh || 0) > REFRESH_EVERY) refresh(false); status(); }, 60e3);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && D && Date.now() - (D.lastRefresh || 0) > STALE) refresh(false); });
window.addEventListener('focus', () => { if (D && !busy && Date.now() - (D.lastRefresh || 0) > STALE) refresh(false); if (D) status(); });
$('#refresh').addEventListener('click', () => refresh(true));
$('#unreadOnly').addEventListener('change', e => { try { localStorage.setItem('radar.unreadOnly', e.target.checked ? '1' : '0'); } catch (x) { /* ok */ } renderCols(); });
$('#mClose').addEventListener('click', closeModal);
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
$('#mSearch').addEventListener('submit', e => { e.preventDefault(); search($('#mQuery').value); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); refresh(true); }
});
start();

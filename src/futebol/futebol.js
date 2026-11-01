'use strict';
/* Futebol hoje: cada jogo da barra de resultados numa coluna — marcadores (e assistências), cartões e estatísticas. */
const F = window.futebol;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const minOf = i => (i.min == null ? '' : `${i.min}${i.add ? '+' + i.add : ''}'`);
const ICON = { goal: '⚽', pen: '⚽', own: '⚽', yellow: '<i class="card y"></i>', red: '<i class="card r"></i>', yellowred: '<i class="card yr"></i>' };

function evHTML(i) {
  const goal = i.type === 'goal' || i.type === 'pen' || i.type === 'own';
  const note = i.type === 'pen' ? ' (g.p.)' : i.type === 'own' ? ' (p.b.)' : '';
  return `<div class="ev ${goal ? 'goal' : 'cardev'}"><b>${minOf(i)}</b><span class="ic">${ICON[i.type] || ''}</span><span class="who"><span class="name">${esc(i.player)}${note}</span>${i.assist ? `<small>assist. ${esc(i.assist)}</small>` : ''}</span></div>`;
}
function column(m) {
  const fresh = m.goalAt && Date.now() - m.goalAt < 60e3;
  const team = t => `<div class="team ${t.mine ? 'mine' : ''}"><img src="${esc(t.logo)}" alt="" referrerpolicy="no-referrer"><span>${esc(t.full || t.name)}</span></div>`;
  // só marcadores (com assistências) e cartões, por ordem do jogo
  const evs = [...(m.incidents || [])].filter(i => ['goal', 'pen', 'own', 'yellow', 'red', 'yellowred'].includes(i.type))
    .sort((a, b) => (a.min || 0) - (b.min || 0) || (a.add || 0) - (b.add || 0));
  const home = evs.filter(i => i.home), away = evs.filter(i => !i.home);
  const events = evs.length ? `<div><span class="lbl">Golos e cartões</span><div class="evs"><div class="side h">${home.map(evHTML).join('')}</div><div class="side a">${away.map(evHTML).join('')}</div></div></div>` : '';
  const stats = (m.stats || []).length ? `<div><span class="lbl">Estatísticas</span>${m.stats.map(x => { const tot = (x.hv + x.av) || 1; return `<div class="stat"><div class="sv"><b>${esc(x.home)}</b><span>${esc(x.label)}</span><b>${esc(x.away)}</b></div><div class="bar"><i style="width:${Math.round(x.hv / tot * 100)}%"></i><i style="width:${Math.round(x.av / tot * 100)}%"></i></div></div>`; }).join('')}</div>` : '';
  const info = [m.round, m.venue && (m.venue + (m.city ? ', ' + m.city : '')), m.referee && 'Árbitro: ' + m.referee].filter(Boolean);
  return `<section class="col ${m.state} ${fresh ? 'flash' : ''}">
    <div class="comp"><span>${esc(m.comp)}</span>${m.big ? '<span>Liga europeia</span>' : ''}</div>
    <div class="head">${team(m.home)}
      <div class="score"><b>${m.state === 'pre' ? esc(m.label) : `${m.home.score ?? 0}<span>–</span>${m.away.score ?? 0}`}</b>
        <small>${m.state === 'live' ? '<i class="dot"></i>' : ''}${m.state === 'pre' ? 'Hoje' : esc(m.label)}${m.pens ? ' · pen. ' + esc(m.pens) : ''}</small></div>
      ${team(m.away)}</div>
    <div class="body">
      ${m.state === 'pre' ? '<p class="hint" style="padding:0">O jogo ainda não começou. Os golos, cartões e estatísticas aparecem aqui quando começar.</p>' : ''}
      ${events || (m.state !== 'pre' ? '<p class="hint" style="padding:0">Ainda sem golos nem cartões.</p>' : '')}
      ${stats}
      ${info.length ? `<div><span class="lbl">Jogo</span>${info.map(x => `<p class="info">${esc(x)}</p>`).join('')}</div>` : ''}
    </div>
    <button class="open" type="button" data-open="${m.id}">Abrir no Sofascore</button>
  </section>`;
}
let busy = false;
async function load() {
  if (busy || document.hidden) return;
  busy = true;
  try {
    const list = await F.details();
    const box = $('#cols'), keep = box.scrollLeft;
    box.innerHTML = list && list.length ? list.map(column).join('') : '<p class="hint">Não há jogos hoje das tuas equipas nem jogos grandes das ligas europeias.</p>';
    box.scrollLeft = keep;
    $('#status').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) { $('#status').textContent = 'Não foi possível carregar os jogos.'; }
  busy = false;
}
document.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);
$('#cols').addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (o) F.open(+o.dataset.open); });
$('#cols').addEventListener('wheel', e => { const c = e.currentTarget; if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.target.closest('.body')) { c.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
$('#close').addEventListener('click', () => F.close());
document.addEventListener('keydown', e => { if (e.key === 'Escape') F.close(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
F.onChanged(() => load());
F.onTheme(t => { document.documentElement.dataset.theme = t; });
F.theme().then(t => { if (t) document.documentElement.dataset.theme = t; });
setInterval(load, 20e3);
load();

'use strict';
/* Barra flutuante: botão Olimpo, espaço atual, apps com ponto "a correr", "+", disposição e hora. */
(() => {
  const api = window.olimpo;
  const nav = document.getElementById('dock');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icons = new Map();
  let st = null;
  const OL = '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7cc8f5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-5 9 5M5 9v9M9 9v9M15 9v9M19 9v9M3 21h18M3 18h18"/></svg>';
  const INT = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="3"/></svg>';
  const LADO = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M14 4v16"/></svg>';
  const hora = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  function render() {
    if (!st) return;
    const p = st.painel || {};
    const disp = p.aberto === 'zeus' || p.aberto === 'apolo';
    nav.innerHTML = `
      <button class="ic casa" data-casa aria-label="Voltar ao ecrã principal do Olimpo" title="Olimpo">${OL}</button>
      <button class="esp" data-esp aria-label="Mudar de espaço (agora: ${esc(st.espaco)})"><i aria-hidden="true"></i>${esc(st.espaco)}</button>
      <span class="sep" aria-hidden="true"></span>
      ${st.apps.map(a => `<div class="app"><button class="ic ${a.frente ? 'frente' : ''}" data-app="${esc(a.id)}" aria-label="${a.aberta ? 'Mudar para ' : 'Abrir '}${esc(a.nome)}" title="${esc(a.nome)} — ${a.tipo === 'mac' ? 'App do Mac' : 'Dentro do Olimpo'}">${a.caminho && icons.get(a.caminho) ? `<img src="${icons.get(a.caminho)}" alt="">` : esc(a.mark)}</button><span class="dot ${a.aberta ? (a.frente ? 'frente' : 'on') : ''}" aria-hidden="true"></span></div>`).join('')}
      <span class="sep" aria-hidden="true"></span>
      <button class="ic mais" data-mais aria-label="Acrescentar app">+</button>
      ${disp ? `<div class="seg" role="group" aria-label="Disposição"><button data-disp="full" aria-label="Ecrã inteiro" aria-pressed="${!p.split}">${INT}</button><button data-disp="split" aria-label="Lado a lado com o Apolo" aria-pressed="${!!p.split}">${LADO}</button></div>` : ''}
      <div class="hora" data-barra title="Barra do Claude"><b>${hora()}</b><small>⌥ Espaço</small></div>`;
    for (const a of st.apps) if (a.caminho && !icons.has(a.caminho)) {
      icons.set(a.caminho, null);
      api.call('apps:icon', a.caminho).then(u => { icons.set(a.caminho, u || null); if (u) render(); });
    }
    report();
  }
  function report() {
    const r = nav.getBoundingClientRect();
    api.call('dock:size', { width: r.width + 16, height: r.height + 12 });
  }
  nav.addEventListener('click', ev => {
    const t = ev.target.closest('button, [data-barra]'); if (!t) return;
    if (t.dataset.casa != null) api.call('dock:casa');
    else if (t.dataset.esp != null) { const i = st.espacos.findIndex(e => e.id === st.espacoId); api.call('dock:espaco', st.espacos[(i + 1) % st.espacos.length].id); }
    else if (t.dataset.app) api.call('dock:abrir', t.dataset.app);
    else if (t.dataset.mais != null) api.call('dock:acrescentar');
    else if (t.dataset.disp) api.call('dock:disposicao', t.dataset.disp === 'split');
    else if (t.dataset.barra != null) api.call('dock:barra');
  });
  api.on('dock', s => { st = s; render(); });
  api.call('dock:state').then(s => { if (!st) { st = s; render(); } });
  setInterval(() => { const b = nav.querySelector('.hora b'); if (b) b.textContent = hora(); }, 15000);
})();

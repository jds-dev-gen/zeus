'use strict';
/*
 * Painéis dentro do Olimpo (ZeusAberto.dc.html): Zeus com separadores, Apolo ao lado,
 * apps web e projetos (quadro do Apolo + ficheiros da pasta do projeto).
 * O vidro é desenhado aqui; as páginas são vistas Chromium que o processo principal
 * coloca por cima, nos retângulos marcados com data-view.
 */
(() => {
  const O = window.O, esc = O.esc;
  const ZCOL = { wa: { nome: 'WhatsApp', url: 'https://web.whatsapp.com/' } };
  O.painel = null;   // { tipo: 'zeus'|'apolo'|'web'|'projeto', id, split, claude, zapp }

  /* ---------- colocar as vistas web ---------- */
  O.web = {
    sync: () => {
      if (!O.api) return;
      const list = [];
      const tapado = O.temFolha() || O._menu || O.vista !== 'painel';
      if (!tapado) {
        O.$$('#paineis [data-view]').forEach(el => {
          if (el.closest('.abrir, .animando')) return;   // ainda a animar
          const r = el.getBoundingClientRect();
          if (r.width > 10 && r.height > 10) list.push({ key: el.dataset.view, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, radius: 14 });
        });
      }
      O.api.call('web:layout', list);
    }
  };
  window.addEventListener('resize', O.debounce(() => O.web.sync(), 30));

  const apoloURL = () => O.S.definicoes.apoloUrl || '';
  const zcolApps = () => (O.S.zeus.coluna || []).map(id => {
    const a = O.S.apps[id] || ZCOL[id];
    return a ? { id, nome: a.nome, url: a.url } : null;
  }).filter(Boolean);

  /* ---------- abrir ---------- */
  O.abrirPainel = (p, deEl) => {
    const antes = O.painel;
    O.painel = Object.assign({ split: false, claude: false, zapp: null }, p);
    if (antes && antes.tipo === 'zeus' && p.tipo === 'zeus') { O.painel.split = antes.split; O.painel.claude = antes.claude; }
    O.irPara('painel');
    render(deEl);
    informar();
    // Zeus sem separadores: abre um em branco, com a barra de endereço pronta a escrever
    if (p.tipo === 'zeus' && !O.painel.zapp && O.webState && !(O.webState.tabs || []).length) {
      O.api.call('web:newTab', '').then(() => setTimeout(() => { const i = O.$('#z-end'); if (i) i.focus(); }, 750));
    }
  };
  function informar() {
    const p = O.painel;
    O.api.call('painel', { aberto: p ? (p.tipo === 'web' || p.tipo === 'projeto' ? (p.tipo === 'web' ? p.id : 'apolo') : p.tipo) : (O.vista === 'ficheiros' ? 'ficheiros' : null), split: !!(p && p.split) });
  }
  O.informarPainel = informar;
  O.disposicao = modo => {
    if (!O.painel) return;
    if (O.painel.tipo !== 'zeus') { O.abrirPainel({ tipo: 'zeus', split: modo === 'split' }); return; }
    O.painel.split = modo === 'split';
    render(); informar();
  };

  /* ---------- desenhar ---------- */
  function render(deEl) {
    const p = O.painel, box = O.$('#paineis');
    if (!p) { box.innerHTML = ''; return; }
    let html = '';
    if (p.tipo === 'zeus') html = zeusHTML() + (p.split ? apoloLadoHTML() : '');
    else if (p.tipo === 'apolo') html = webHTML('apolo', 'Apolo', apoloURL(), 'A');
    else if (p.tipo === 'web') { const a = O.S.apps[p.id] || {}; html = webHTML(p.id, a.nome || p.id, a.url, (a.nome || '?')[0]); }
    else if (p.tipo === 'projeto') html = projetoHTML();
    box.innerHTML = html;
    const main = O.$('.painel', box);
    if (deEl && main) animarDe(main, deEl);
    // o Apolo ao lado entra a deslizar: as páginas só se colocam no fim
    O.$$('.painel.lado', box).forEach(el => { el.classList.add('animando'); el.addEventListener('animationend', () => { el.classList.remove('animando'); O.web.sync(); }, { once: true }); });
    ligar(box);
    carregarVistas();
    if (p.tipo === 'projeto') O.projetoFicheiros();
    requestAnimationFrame(() => O.web.sync());
  }
  O.renderPainel = () => render();

  function animarDe(el, de) {
    const a = de.getBoundingClientRect(), b = el.getBoundingClientRect();
    if (!a.width || !b.width) { el.classList.add('abrir'); }
    else {
      el.style.transformOrigin = '0 0';
      el.style.setProperty('--de', `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`);
      el.classList.add('abrir');
    }
    el.addEventListener('animationend', () => { el.classList.remove('abrir'); el.style.transformOrigin = ''; O.web.sync(); }, { once: true });
  }

  function zeusHTML() {
    const p = O.painel, w = O.webState || { tabs: [], pagina: null, apps: {} };
    const zapps = zcolApps();
    return `<section class="painel" aria-label="Zeus">
      <nav class="zcol" aria-label="Apps do Zeus">
        <span class="zlogo" aria-hidden="true">${O.ic.zeus({ s: 22, c: '#04060a', w: 1.8 })}</span>
        <span class="zsep" aria-hidden="true"></span>
        <button class="zapp ol-h" data-z="apolo" aria-pressed="${!!p.split}" aria-label="${p.split ? 'Fechar o Apolo ao lado' : 'Abrir o Apolo ao lado'}" title="Apolo ao lado">A</button>
        ${zapps.map(a => `<button class="zapp ol-h" data-z="app:${esc(a.id)}" aria-pressed="${p.zapp === a.id}" aria-label="${esc(a.nome)}" title="${esc(a.nome)}">${esc(a.nome[0])}</button>`).join('')}
        <button class="zapp ol-h" data-z="claude" aria-pressed="${!!p.claude}" aria-label="${p.claude ? 'Fechar o Claude' : 'Abrir o Claude nesta página'}" title="Claude nesta página">${O.ic.claude({ s: 22 })}</button>
        <button class="zapp mais ol-h" data-z="mais" aria-label="Acrescentar app ao Zeus" title="Acrescentar app web">+</button>
      </nav>
      <div class="zmain">
        <div class="separadores" role="tablist" aria-label="Separadores" id="z-seps">${separadoresHTML(w)}</div>
        <div class="endereco">
          <button class="navb" data-nav="back" aria-label="Voltar" ${navInfo().back ? '' : 'disabled'}>${O.ic.esq({ s: 18 })}</button>
          <button class="navb" data-nav="forward" aria-label="Avançar" ${navInfo().fwd ? '' : 'disabled'}>${O.ic.dir({ s: 18 })}</button>
          <button class="navb" data-nav="reload" aria-label="Recarregar">${O.ic.recarregar({ s: 16 })}</button>
          <input id="z-end" type="text" aria-label="Endereço ou pesquisa" placeholder="Escreve um endereço ou pesquisa" spellcheck="false" autocomplete="off" value="${esc(navInfo().url)}">
          <button class="navb" data-nav="externo" aria-label="Abrir no browser do sistema" title="Abrir no browser do sistema">${O.ic.externo({ s: 16 })}</button>
        </div>
        <div class="zcorpo">
          <div class="pagina" ${zKey() ? `data-view="${zKey()}"` : ''}>${paginaVazia()}</div>
          ${p.claude ? claudeLadoHTML() : ''}
        </div>
      </div>
    </section>`;
  }
  const zKey = () => {
    const p = O.painel, w = O.webState;
    if (p.zapp) return 'app:' + p.zapp;
    if (!w || !w.pagina || !w.pagina.url) return null;
    return 'tab';
  };
  function navInfo() {
    const p = O.painel, w = O.webState || {};
    if (p.zapp) return (w.apps && w.apps[p.zapp]) || { url: '' };
    return w.pagina || { url: '' };
  }
  function paginaVazia() {
    if (zKey()) return `<div class="esqueleto" aria-hidden="true"><i style="height:22px;width:42%"></i><i style="height:12px;width:70%"></i><i style="flex:1"></i></div>`;
    return `<div class="aviso"><h3>Separador novo</h3><div>Escreve um endereço ou uma pesquisa na barra de cima.</div></div>`;
  }
  function separadoresHTML(w) {
    const p = O.painel;
    return (w.tabs || []).map(t => {
      const on = !p.zapp && t.id === w.atual;
      return `<button class="sep ol-h" role="tab" aria-selected="${on}" data-tab="${esc(t.id)}" title="${esc(t.titulo)}">
        ${t.favicon ? `<img class="fav" src="${esc(t.favicon)}" alt="">` : '<span class="fav" aria-hidden="true"></span>'}
        <span class="t">${esc(t.titulo)}</span><span class="x" data-fecha="${esc(t.id)}" role="button" aria-label="Fechar separador">${O.ic.x({ s: 9 })}</span></button>`;
    }).join('') + `<button class="sep-novo ol-h" data-novo aria-label="Novo separador">+</button>`;
  }
  function claudeLadoHTML() {
    const projs = O.S.projetos.filter(x => x.espaco === O.S.espacoAtual);
    const r = O.zClaude;
    return `<aside class="claude-lado" aria-label="Claude no Zeus">
      <div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:500"><span style="color:#7cc8f5">✦</span>Claude</div>
      ${r ? '' : '<div style="font-size:13px;color:rgba(255,255,255,.72);line-height:1.45">Pergunta sobre esta página, resume-a ou guarda o essencial no Apolo.</div>'}
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="acao-c ol-h" data-c="resumir">Resume esta página</button>
        <button class="acao-c ol-h" data-c="apolo">Guarda no Apolo${projs[0] ? ' · ' + esc(projs[0].nome) : ''}</button>
      </div>
      <div class="saida" aria-live="polite" id="z-saida">${r ? zSaida(r) : ''}</div>
      <label class="campo" style="height:44px;border-radius:12px;padding:0 12px"><input id="z-perg" type="text" aria-label="Pergunta ao Claude" placeholder="Pergunta ao Claude…" style="font-size:14px"></label>
    </aside>`;
  }
  function zSaida(r) {
    return `${O.md(r.texto)}${!r.fim ? (r.texto ? '<span class="cursor"></span>' : '<p style="color:var(--t2)">A ler a página… <span class="cursor"></span></p>') : ''}${r.erro ? `<p class="erro-txt">${esc(r.erro)}</p>` : ''}
      ${r.fim && r.texto ? '<div style="display:flex;gap:6px;margin-top:6px"><button class="btn peq" data-c="copiar">Copiar</button></div>' : ''}${!r.fim ? '<button class="btn peq" data-c="parar" style="margin-top:6px">Parar</button>' : ''}`;
  }

  function apoloLadoHTML() {
    const url = apoloURL();
    return `<section class="painel lado" aria-label="Apolo">
      <div class="cab-painel"><span class="marca" aria-hidden="true">A</span><span class="t">Apolo</span>
        <span class="acoes"><button class="ico-btn" data-z="apolo" aria-label="Fechar Apolo">${O.ic.x({ s: 12 })}</button></span></div>
      <div class="pagina" style="flex:1" ${url ? 'data-view="app:apolo"' : ''}>${url ? '' : semApolo()}</div>
    </section>`;
  }
  function semApolo() {
    return `<div class="aviso"><h3>Onde está o Apolo?</h3><div>Indica o endereço do Apolo (por exemplo, o da Netlify). Fica guardado nas definições.</div>
      <form class="campo" data-form-apolo><input name="url" type="url" placeholder="https://…" aria-label="Endereço do Apolo" required><button class="btn peq prim">Guardar</button></form></div>`;
  }

  function webHTML(id, nome, url, mark) {
    const info = (O.webState && O.webState.apps && O.webState.apps[id]) || {};
    return `<section class="painel" aria-label="${esc(nome)}" style="flex-direction:column">
      <div class="cab-painel"><span class="marca" aria-hidden="true">${esc(mark)}</span><span class="t">${esc(nome)}</span>
        <span class="acoes">
          <button class="navb" data-nav="back" data-key="app:${esc(id)}" aria-label="Voltar" ${info.back ? '' : 'disabled'}>${O.ic.esq({ s: 18 })}</button>
          <button class="navb" data-nav="reload" data-key="app:${esc(id)}" aria-label="Recarregar">${O.ic.recarregar({ s: 16 })}</button>
          ${id === 'apolo' ? `<button class="btn peq" data-z="zeus-lado">Zeus ao lado</button>` : ''}
        </span></div>
      <div class="pagina" style="flex:1" ${url ? `data-view="app:${esc(id)}"` : ''}>${url ? '' : (id === 'apolo' ? semApolo() : '<div class="aviso">Esta app não tem endereço.</div>')}</div>
    </section>`;
  }

  function projetoHTML() {
    const pr = O.S.projetos.find(x => x.id === O.painel.id);
    if (!pr) return '<section class="painel"><div class="aviso">Projeto não encontrado.</div></section>';
    const url = pr.quadroApolo || apoloURL();
    return `<section class="painel" aria-label="Projeto ${esc(pr.nome)}" style="flex-direction:column">
      <div class="cab-painel"><span class="marca" aria-hidden="true">${O.ic.apolo({ s: 18, c: '#7cc8f5' })}</span><span class="t">${esc(pr.nome)}</span><span class="pilula">Projeto</span>
        <span class="acoes">
          <button class="btn peq" data-proj="pasta">Abrir pasta</button>
          <button class="btn peq" data-proj="finder">Mostrar no Finder</button>
          <button class="ico-btn" data-proj="editar" aria-label="Editar projeto">${O.ic.mais({ s: 16 })}</button>
        </span></div>
      <div style="flex:1;min-height:0;display:flex">
        <div class="pagina" style="flex:1" ${url ? 'data-view="app:apolo"' : ''}>${url ? '' : semApolo()}</div>
        <div class="proj-fich" aria-label="Ficheiros do projeto">
          <div style="padding:14px 18px 6px;display:flex;align-items:center;justify-content:space-between"><span class="rotulo2">Ficheiros</span><span style="font-size:12px;color:var(--t3)">${esc(pr.pasta)}</span></div>
          <div class="lista" id="proj-lista"><div class="vazio">A carregar…</div></div>
        </div>
      </div>
    </section>`;
  }

  O.projetoFicheiros = async () => {
    const pr = O.S.projetos.find(x => O.painel && x.id === O.painel.id); if (!pr) return;
    const l = await O.api.call('files:list', pr.pasta);
    const box = O.$('#proj-lista'); if (!box) return;
    box.innerHTML = l.length ? l.map(f => O.linhaFicheiro(f, { compacto: true })).join('') : '<div class="vazio">A pasta ainda está vazia. Arrasta ficheiros para aqui ou arruma-os a partir da Entrada.</div>';
    O.ligarFicheiros(box, l);
    O.preencherMiniaturas(box);
  };

  /* garante que as vistas web existem com o endereço certo */
  function carregarVistas() {
    const p = O.painel;
    if (p.tipo === 'zeus') {
      if (p.split && apoloURL()) O.api.call('web:app', 'apolo', apoloURL());
      if (p.zapp) { const a = zcolApps().find(x => x.id === p.zapp); if (a) O.api.call('web:app', a.id, a.url); }
    } else if (p.tipo === 'apolo' && apoloURL()) O.api.call('web:app', 'apolo', apoloURL());
    else if (p.tipo === 'web') { const a = O.S.apps[p.id]; if (a && a.url) O.api.call('web:app', p.id, a.url); }
    else if (p.tipo === 'projeto') { const pr = O.S.projetos.find(x => x.id === p.id); const u = pr && (pr.quadroApolo || apoloURL()); if (u) O.api.call('web:app', 'apolo', u); }
  }

  /* ---------- eventos ---------- */
  function ligar(box) {
    box.onclick = async ev => {
      const t = ev.target;
      const fecha = t.closest('[data-fecha]');
      if (fecha) { ev.stopPropagation(); O.api.call('web:close', fecha.dataset.fecha); return; }
      const tab = t.closest('[data-tab]');
      if (tab) { O.painel.zapp = null; O.api.call('web:select', tab.dataset.tab); render(); return; }
      if (t.closest('[data-novo]')) { O.painel.zapp = null; await O.api.call('web:newTab', ''); setTimeout(() => { const i = O.$('#z-end'); if (i) i.focus(); }, 80); return; }
      const nav = t.closest('[data-nav]');
      if (nav) {
        const key = nav.dataset.key || zKey() || 'tab';
        if (nav.dataset.nav === 'externo') O.api.call('web:externo', key); else O.api.call('web:nav', key, nav.dataset.nav);
        return;
      }
      const z = t.closest('[data-z]');
      if (z) {
        const k = z.dataset.z, p = O.painel;
        if (k === 'apolo') { if (p.tipo !== 'zeus') { O.abrirPainel({ tipo: 'apolo' }); return; } p.split = !p.split; }
        else if (k === 'claude') p.claude = !p.claude;
        else if (k === 'mais') { O.folhaAppZeus(); return; }
        else if (k === 'zeus-lado') { O.abrirPainel({ tipo: 'zeus', split: true }); return; }
        else if (k.startsWith('app:')) { const id = k.slice(4); p.zapp = p.zapp === id ? null : id; }
        render(); informar(); return;
      }
      const c = t.closest('[data-c]');
      if (c) { claudeAcao(c.dataset.c); return; }
      const pj = t.closest('[data-proj]');
      if (pj) {
        const pr = O.S.projetos.find(x => x.id === O.painel.id);
        if (pj.dataset.proj === 'pasta') O.abrirFicheiros({ pasta: pr.pasta });
        else if (pj.dataset.proj === 'finder') O.api.call('files:reveal', pr.pasta);
        else if (pj.dataset.proj === 'editar') O.folhaProjeto(pr);
      }
    };
    box.onsubmit = async ev => {
      const f = ev.target.closest('[data-form-apolo]');
      if (!f) return;
      ev.preventDefault();
      let url = f.url.value.trim(); if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      await O.api.call('definicoes:guardar', { definicoes: { apoloUrl: url } });
      O.S.definicoes.apoloUrl = url;
      render();
    };
    const end = O.$('#z-end', box);
    if (end) {
      end.onkeydown = ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); O.api.call('web:navigate', end.value, zKey() && O.painel.zapp ? zKey() : 'tab'); end.blur(); }
        if (ev.key === 'Escape') { end.value = navInfo().url || ''; end.blur(); }
      };
      end.onfocus = () => end.select();
    }
    const perg = O.$('#z-perg', box);
    if (perg) perg.onkeydown = ev => { if (ev.key === 'Enter' && perg.value.trim()) { const q = perg.value.trim(); perg.value = ''; zPerguntar(q, false); } };
  }

  /* ---------- Claude nesta página ---------- */
  O.zClaude = null;
  function zPerguntar(q, apolo) {
    const runId = 'z' + Date.now().toString(36);
    const continuar = !!(O.zClaude && O.zClaude.fim && !apolo);
    O.zClaude = { runId, q, texto: '', fim: false, erro: null, apolo };
    O.claudeRuns[runId] = ev => {
      const r = O.zClaude; if (!r || r.runId !== runId) return;
      if (ev.type === 'text') r.texto += ev.delta;
      else if (ev.type === 'turn' && r.texto && !/\n\n$/.test(r.texto)) r.texto += '\n\n';
      else if (ev.type === 'error') r.erro = ev.message;
      else if (ev.type === 'done') {
        r.fim = true;
        if (r.apolo && r.texto) {
          O.api.call('copiar', r.texto);
          O.toast('Nota copiada — cola-a no quadro do Apolo.');
          if (O.painel && O.painel.tipo === 'zeus' && !O.painel.split) { O.painel.split = true; render(); informar(); return; }
        }
      }
      const s = O.$('#z-saida'); if (s) { s.innerHTML = zSaida(r); s.scrollTop = s.scrollHeight; }
    };
    const s = O.$('#z-saida'); if (s) s.innerHTML = zSaida(O.zClaude);
    O.api.call('claude:ask', runId, q, { pagina: zKey() || 'tab', continuar });
  }
  function claudeAcao(k) {
    const r = O.zClaude;
    if (k === 'resumir') zPerguntar('Resume esta página em poucos pontos, em português de Portugal.', false);
    else if (k === 'apolo') {
      const pr = O.S.projetos.find(x => x.espaco === O.S.espacoAtual);
      zPerguntar(`Escreve uma nota curta para guardar no quadro do Apolo${pr ? ' do projeto ' + pr.nome : ''}: um título numa linha, depois 3 a 5 pontos com o essencial desta página e o endereço no fim. Só a nota, sem introdução.`, true);
    } else if (k === 'copiar' && r) { O.api.call('copiar', r.texto); O.toast('Copiado.'); }
    else if (k === 'parar' && r) O.api.call('claude:stop', r.runId);
  }

  /* ---------- atualizações do processo principal ---------- */
  O.aoWeb = w => {
    O.webState = w;
    if (O.vista !== 'painel' || !O.painel) return;
    const p = O.painel;
    if (p.tipo === 'zeus') {
      const seps = O.$('#z-seps'); if (seps) seps.innerHTML = separadoresHTML(w);
      const end = O.$('#z-end');
      const info = navInfo();
      if (end && document.activeElement !== end) end.value = info.url || '';
      const b = O.$('[data-nav="back"]'), f = O.$('[data-nav="forward"]');
      if (b) b.disabled = !info.back; if (f) f.disabled = !info.fwd;
      const pag = O.$('.zcorpo .pagina');
      const key = zKey();
      if (pag && (pag.dataset.view || null) !== key) { if (key) pag.dataset.view = key; else delete pag.dataset.view; pag.innerHTML = paginaVazia(); O.web.sync(); }
    } else {
      const id = p.tipo === 'projeto' ? 'apolo' : p.tipo === 'apolo' ? 'apolo' : p.id;
      const info = (w.apps && w.apps[id]) || {};
      const b = O.$('[data-nav="back"]'); if (b) b.disabled = !info.back;
    }
  };
})();

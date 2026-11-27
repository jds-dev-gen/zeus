'use strict';
/* Arranque da interface do Olimpo: estado, navegação entre vistas, atalhos e eventos do processo principal. */
(() => {
  const O = window.O;
  O.claudeRuns = {};
  O.vista = 'casa';

  O.espaco = () => O.S.espacos.find(e => e.id === O.S.espacoAtual) || O.S.espacos[0];

  O.irPara = v => {
    O.vista = v;
    O.$('#casa').hidden = v !== 'casa';
    O.$('#paineis').hidden = v !== 'painel';
    O.$('#ficheiros').hidden = v !== 'ficheiros';
    O.$('#editar').hidden = v !== 'editar';
    if (v !== 'painel') O.painel = null;
    if (v === 'casa') { O.casa.render(); O.casa.continuar(); O.casa.entrada(); }
    O.informarPainel();
    O.web.sync();
  };

  O.mudarEspaco = async id => {
    if (id === O.S.espacoAtual) return;
    await O.api.call('espaco:set', id);
  };

  /* Abrir qualquer coisa que venha da barra, de um módulo ou do Continuar */
  O.abrirAlvo = (alvo, deEl) => {
    if (!alvo) return;
    const S = O.S;
    if (alvo.app) {
      const id = alvo.app, a = S.apps[id];
      if (id === 'zeus') {
        const n = ((O.webState && O.webState.tabs) || []).length;
        O.abrirPainel({ tipo: 'zeus' }, deEl);
        if (n) O.api.call('atividade', { tipo: 'zeus', id: 'zeus', titulo: `${n} ${n === 1 ? 'separador aberto' : 'separadores abertos'}`, alvo: { app: 'zeus' } });
        return;
      }
      if (id === 'apolo') { O.abrirPainel({ tipo: 'apolo' }, deEl); O.api.call('atividade', { tipo: 'apolo', id: 'apolo', titulo: 'Quadros', alvo: { app: 'apolo' } }); return; }
      if (id === 'ficheiros') { O.abrirFicheiros({}, deEl); return; }
      if (a && a.tipo === 'web') { O.abrirPainel({ tipo: 'web', id }, deEl); O.api.call('atividade', { tipo: 'web', id: 'app:' + id, titulo: a.nome, app: a.nome, sub: 'App web', alvo: { app: id } }); return; }
      O.api.call('open', { app: id });
      return;
    }
    if (alvo.mac) { O.api.call('open', { mac: alvo.mac }); return; }
    if (alvo.projeto) { O.abrirProjeto(alvo.projeto, deEl); return; }
    if (alvo.ficheiro) { O.api.call('files:open', alvo.ficheiro); return; }
    if (alvo.url) { O.api.call('web:newTab', alvo.url).then(() => O.abrirPainel({ tipo: 'zeus' }, deEl)); return; }
    if (alvo.acao) { O.acao(alvo.acao, deEl); return; }
    if (alvo.espaco) { O.mudarEspaco(alvo.espaco); }
  };

  O.abrirProjeto = (id, deEl) => {
    const p = O.S.projetos.find(x => x.id === id); if (!p) return;
    if (p.espaco !== O.S.espacoAtual) O.api.call('espaco:set', p.espaco);
    O.abrirPainel({ tipo: 'projeto', id }, deEl);
    O.api.call('atividade', { tipo: 'projeto', id: 'projeto:' + id, titulo: p.nome, sub: 'Quadro e ficheiros', alvo: { projeto: id }, espaco: p.espaco });
  };

  O.acao = (id, deEl) => {
    switch (id) {
      case 'ficheiros': return O.abrirFicheiros({ tab: 'encontrar' }, deEl);
      case 'espaco': return O.abrirFicheiros({ tab: 'espaco' }, deEl);
      case 'entrada': return O.abrirFicheiros({ entrada: true }, deEl);
      case 'novo-projeto': return O.folhaProjeto();
      case 'novo-quadro': return O.abrirPainel({ tipo: 'apolo' }, deEl);
      case 'acrescentar-app': return O.folhaAcrescentar();
      case 'editar-espaco': return O.editar.abrir();
      case 'todas-apps': return O.folhaTodas();
      case 'definicoes': return O.folhaDefinicoes();
      case 'separador': return O.api.call('web:newTab', '').then(() => { O.abrirPainel({ tipo: 'zeus' }); setTimeout(() => { const i = O.$('#z-end'); if (i) i.focus(); }, 120); });
    }
  };

  /* ---------- comandos do processo principal (atalho global, barra flutuante, Claude) ---------- */
  function aoComando(c) {
    if (O.temFolha() && (c.casa || c.barra)) O.fecharFolha();
    if (c.casa) { if (O.vista !== 'casa') O.irPara('casa'); }
    if (c.barra) { if (O.vista !== 'casa') O.irPara('casa'); setTimeout(() => O.casa.focar(), 30); }
    if (c.atalho) {
      const i = O.$('#cmd');
      if (O.vista === 'casa' && document.activeElement === i && !i.value) O.api.call('app:esconder');
      else { if (O.vista !== 'casa') O.irPara('casa'); O.casa.focar(); }
    }
    if (c.abrir) O.abrirAlvo({ app: c.abrir });
    if (c.projeto) O.abrirProjeto(c.projeto);
    if (c.pasta) O.abrirFicheiros({ pasta: c.pasta });
    if (c.acao) O.acao(c.acao);
    if (c.disposicao) O.disposicao(c.disposicao);
    if (c.endereco) {
      const go = () => { const i = O.$('#z-end'); if (i) { i.focus(); i.select(); } };
      if (c.novo) O.api.call('web:newTab', '').then(() => { if (!O.painel || O.painel.tipo !== 'zeus') O.abrirPainel({ tipo: 'zeus' }); setTimeout(go, 100); });
      else go();
    }
  }

  /* só redesenha o ecrã principal quando muda o que lá aparece (não a cada tecla da nota) */
  const assinatura = S => JSON.stringify([S.nome, S.espacoAtual, S.espacos, S.projetos, S.apps, S.definicoes.atalho, S.definicoes.cidade]);
  let ultima = '', ultimaAtividade = '';
  function aoEstado(st) {
    const antes = O.S;
    O.S = st.S; O.plataforma = st.plataforma; O.versao = st.versao; O.home = st.home;
    const sig = assinatura(O.S);
    const mudou = sig !== ultima;
    ultima = sig;
    const at = JSON.stringify((O.S.atividade || []).slice(0, 8).map(a => a.id + a.t));
    if (O.vista === 'casa') {
      if (mudou) O.casa.render();
      else if (at !== ultimaAtividade) O.casa.continuar();
    } else if (O.vista === 'painel' && antes && (antes.espacoAtual !== O.S.espacoAtual || JSON.stringify(antes.projetos) !== JSON.stringify(O.S.projetos) || antes.definicoes.apoloUrl !== O.S.definicoes.apoloUrl || JSON.stringify(antes.zeus.coluna) !== JSON.stringify(O.S.zeus.coluna))) {
      if (O.painel && O.painel.tipo === 'projeto' && !O.S.projetos.some(p => p.id === O.painel.id)) O.irPara('casa'); else O.renderPainel();
    }
    ultimaAtividade = at;
  }

  /* ---------- teclado ---------- */
  document.addEventListener('keydown', ev => {
    const tag = (ev.target.tagName || '').toLowerCase();
    const escrever = tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target.isContentEditable;
    if (ev.key === 'Escape') {
      if (O._menu) { O.fecharMenu(); return; }
      if (O.temFolha()) { O.fecharFolha(); return; }
      if (!escrever && (O.vista === 'painel' || O.vista === 'ficheiros')) { O.irPara('casa'); return; }
      if (!escrever && O.vista === 'casa') { O.casa.escape(); return; }
    }
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if (O.vista !== 'casa') O.irPara('casa'); O.casa.focar(); return; }
    if (mod && /^[1-9]$/.test(ev.key) && !ev.altKey) { const e = O.S.espacos[+ev.key - 1]; if (e) { ev.preventDefault(); O.mudarEspaco(e.id); } return; }
    if (mod && ev.key.toLowerCase() === 't' && O.vista === 'painel') { ev.preventDefault(); O.acao('separador'); return; }
    if (mod && ev.key === ',') { ev.preventDefault(); O.folhaDefinicoes(); return; }
    // no ecrã principal, escrever em qualquer sítio vai para a barra do Claude
    if (O.vista === 'casa' && !escrever && !mod && !ev.altKey && ev.key.length === 1 && !O.temFolha()) O.$('#cmd').focus();
  });

  /* ---------- arranque ---------- */
  async function iniciar() {
    if (!O.api) { document.body.innerHTML = '<p style="padding:40px">O Olimpo tem de abrir dentro da app.</p>'; return; }
    const st = await O.api.call('state:get');
    aoEstado(st);
    O.webState = await O.api.call('web:state');
    O.irPara('casa');
    O.api.on('state', aoEstado);
    O.api.on('web', O.aoWeb);
    O.api.on('cmd', aoComando);
    O.api.on('claude', ({ runId, ev }) => { const h = O.claudeRuns[runId]; if (h) h(ev); if (ev.type === 'done') setTimeout(() => { delete O.claudeRuns[runId]; }, 60000); });
    O.api.on('space', ev => O.aoEspaco(ev));
    O.api.on('entrada', () => { O.casa.entrada(); O.aoEntrada(); });
    setTimeout(() => O.casa.focar(), 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();

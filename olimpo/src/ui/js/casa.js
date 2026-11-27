'use strict';
/* Ecrã principal (Simplificado.dc.html): saudação, barra do Claude, Continuar e módulos do espaço. */
(() => {
  const O = window.O, esc = O.esc;

  /* ---------- catálogo de módulos (também usado no Editar espaço) ---------- */
  O.CATALOGO = {
    continuar: { nome: 'Continuar', desc: 'As últimas coisas que usaste', mark: 'C', def: 'L', tamanhos: ['L'] },
    zeus: { nome: 'Zeus', desc: 'Browser', mark: 'Z', def: 'G', app: 'zeus' },
    apolo: { nome: 'Apolo', desc: 'Projetos e quadros', mark: 'A', def: 'G', app: 'apolo' },
    entrada: { nome: 'Entrada', desc: 'Ficheiros novos por arrumar', mark: 'E', def: 'P' },
    'todas-apps': { nome: 'Todas as apps', desc: 'Do Mac e web', mark: '▦', def: 'P' },
    ficheiros: { nome: 'Ficheiros', desc: 'Recentes e espaço livre', mark: 'F', def: 'M' },
    relogio: { nome: 'Relógio', desc: 'Hora, data e saudação', mark: 'R', def: 'M' },
    meteo: { nome: 'Meteorologia', desc: 'Tempo onde estás', mark: 'M', def: 'P' },
    nota: { nome: 'Nota rápida', desc: 'Escreve sem abrir apps', mark: 'N', def: 'M' },
    'apps-mac': { nome: 'Apps do Mac', desc: 'Atalhos para as apps deste espaço', mark: '+', def: 'M' },
    compras: { nome: 'Compras', desc: 'Lista do Overview', mark: 'C', breve: true },
    tarefas: { nome: 'Tarefas', desc: 'Do Apolo', mark: 'T', breve: true },
    musica: { nome: 'Música', desc: 'O que está a tocar', mark: '♪', breve: true },
    jornal: { nome: 'Jornal da manhã', desc: 'O Globo', mark: 'G', breve: true },
    agenda: { nome: 'Agenda', desc: 'Próximos eventos', mark: 'A', breve: true },
    noticias: { nome: 'Notícias', desc: 'Dos teus feeds', mark: 'N', breve: true },
    pluto: { nome: 'Finanças (Pluto)', desc: 'Resumo do mês', mark: 'P', breve: true }
  };
  O.chaveModulo = m => m.tipo === 'app' ? m.app : m.tipo;

  /* ---------- desenho ---------- */
  O.casa = {};
  const C = O.casa;

  C.render = () => {
    const S = O.S, e = O.espaco();
    const root = O.$('#casa');
    if (!root.dataset.feito) {
      root.innerHTML = `
        <header class="topo">
          <div class="lado">${O.ic.olimpo({ s: 22, c: '#7cc8f5' })}<span class="logo">OLIMPO</span></div>
          <div style="display:flex;align-items:center;gap:10px">
            <nav aria-label="Espaços" class="segm" id="espacos"></nav>
            <button class="mais-btn" id="mais" aria-label="Mais opções" aria-haspopup="menu" aria-expanded="false">${O.ic.mais({ s: 18 })}</button>
          </div>
          <div class="lado dir"><span><span class="hora" id="hora"></span><span id="data"></span></span></div>
        </header>
        <h1 class="saudacao ol-in" id="saudacao"></h1>
        <div class="cmd-zona">
          <label class="cmd ol-in">
            ${O.ic.claude({ s: 24, c: '#7cc8f5' })}
            <input type="text" id="cmd" aria-label="Abre, procura ou pede ao Claude" placeholder="Abre, procura ou pede ao Claude…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="resultados">
            <span class="kbd" id="cmd-kbd">⌥ Espaço</span>
          </label>
          <div class="resultados" id="resultados" role="listbox" aria-label="Resultados" hidden></div>
          <div class="resposta" id="resposta" hidden></div>
        </div>
        <div id="mods" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
        <div class="rodape" id="rodape">⌥ Espaço traz esta barra para a frente em qualquer app</div>`;
      root.dataset.feito = '1';
      ligarCmd();
      O.$('#mais').onclick = ev => O.menuMais(ev.currentTarget);
      setInterval(relogio, 10000);
    }
    O.$('#espacos').innerHTML = S.espacos.map(x => `<button aria-pressed="${x.id === e.id}" data-espaco="${esc(x.id)}">${esc(x.nome)}</button>`).join('');
    O.$$('#espacos button').forEach(b => b.onclick = () => O.mudarEspaco(b.dataset.espaco));
    const atalho = (S.definicoes.atalho || 'Alt+Space').replace('Alt', '⌥').replace('CommandOrControl', '⌘').replace('Command', '⌘').replace('Control', 'Ctrl').replace('Space', 'Espaço').replace(/\+/g, ' ');
    O.$('#cmd-kbd').textContent = atalho;
    O.$('#rodape').textContent = atalho + ' traz esta barra para a frente em qualquer app';
    relogio();
    renderModulos();
  };

  function relogio() {
    const S = O.S; if (!S) return;
    const h = O.$('#hora'); if (!h) return;
    h.textContent = O.hora(); O.$('#data').textContent = O.data();
    O.$('#saudacao').textContent = `${O.saudacao()}, ${S.nome}.`;
    O.$$('[data-relogio]').forEach(el => { el.textContent = O.hora(); });
  }

  /* Os módulos dividem-se em faixas: "Continuar" ocupa uma faixa inteira; os outros vão para a grelha. */
  function renderModulos() {
    const e = O.espaco();
    const mods = e.modulos;
    const box = O.$('#mods');
    if (!mods.length) {
      box.innerHTML = `<div class="vazio" style="text-align:center;margin-top:60px">Este espaço ainda está vazio. <button class="btn" id="ed-vazio" style="margin-left:8px">Pôr módulos</button></div>`;
      O.$('#ed-vazio').onclick = () => O.editar.abrir();
      return;
    }
    let html = '', grid = [];
    const flush = () => { if (grid.length) { html += `<section class="modulos" aria-label="Essencial">${grid.join('')}</section>`; grid = []; } };
    let delay = 80;
    for (const m of mods) {
      const cat = O.CATALOGO[O.chaveModulo(m)] || {};
      if (m.tipo === 'continuar') { flush(); html += modContinuar(); continue; }
      if (cat.breve) continue;
      grid.push(`<div class="mod ol-in" data-t="${m.tamanho || cat.def || 'M'}" style="animation-delay:${delay}ms">${modHTML(m)}</div>`);
      delay += 40;
    }
    flush();
    box.innerHTML = html;
    // a faixa "Continuar" é mais baixa: a grelha a seguir começa logo depois
    O.$$('.modulos', box).forEach((g, i) => { if (i > 0 || box.firstElementChild !== g) g.style.marginTop = '22px'; });
    if (box.firstElementChild && box.firstElementChild.classList.contains('modulos')) box.firstElementChild.style.marginTop = '';
    ligarModulos(box);
    C.continuar();
    C.entrada();
    O.preencherIcones(box);
  }

  function modContinuar() {
    return `<section aria-label="Continuar" class="continuar-band" style="margin-top:clamp(28px,5.5vh,56px);flex:none">
      <h2 class="rotulo">Continuar</h2>
      <div class="continuar-mod"><div class="fila" id="fila-continuar" style="height:150px">${'<div class="cont fantasma"></div>'.repeat(5)}</div></div>
    </section>`;
  }

  function cartaoApp(id, t) {
    const S = O.S, a = S.apps[id] || {};
    const peq = t === 'P';
    if (id === 'zeus') {
      const n = (O.webState && O.webState.tabs ? O.webState.tabs.length : 0);
      const sub = n ? `Browser · ${n} ${n === 1 ? 'separador aberto' : 'separadores abertos'}` : 'Browser';
      return `<button class="cartao vidro ol-t ${peq ? 'peq' : ''}" data-abrir="zeus" aria-label="Abrir Zeus">
        <span class="icone">${O.ic.zeus({ s: 26, c: '#7cc8f5' })}</span>
        <span><span class="tit">Zeus</span><span class="sub">${esc(sub)}</span></span></button>`;
    }
    if (id === 'apolo') {
      const projs = S.projetos.filter(p => p.espaco === S.espacoAtual);
      const max = t === 'G' || t === 'A' ? 4 : 2;
      const btns = projs.slice(0, max).map(p => `<button class="ol-t" data-projeto="${esc(p.id)}" aria-label="Abrir projeto ${esc(p.nome)}: quadro e ficheiros">${esc(p.nome)}</button>`).join('') +
        (projs.length < max ? `<button class="novo" data-acao="novo-projeto">+ Projeto</button>` : '');
      if (peq) return `<button class="cartao vidro ol-t peq" data-abrir="apolo"><span class="icone">${O.ic.apolo({ s: 26, c: '#7cc8f5' })}</span><span><span class="tit">Apolo</span><span class="sub">${projs.length} projetos</span></span></button>`;
      return `<div class="cartao vidro" data-abrir="apolo" role="button" tabindex="0" aria-label="Abrir Apolo">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;min-height:0">
          <span class="icone">${O.ic.apolo({ s: 26, c: '#7cc8f5' })}</span>
          <div class="projetos-mini">${btns}</div>
        </div>
        <div><div class="tit">Apolo</div><div class="sub">Cada projeto abre o quadro e os seus ficheiros</div></div></div>`;
    }
    const mk = a.tipo === 'mac' ? `<span class="icone letra" data-icone="${esc(a.caminho)}">${esc((a.nome || '?')[0])}</span>` : `<span class="icone" style="font:600 22px var(--display);color:#7cc8f5">${esc((a.nome || '?')[0])}</span>`;
    return `<button class="cartao vidro ol-t ${peq ? 'peq' : ''}" data-abrir="${esc(id)}">${mk}
      <span><span class="tit">${esc(a.nome || id)}</span><span class="sub">${a.tipo === 'mac' ? 'App do Mac' : 'App web'}</span></span></button>`;
  }

  function modHTML(m) {
    const t = m.tamanho || (O.CATALOGO[O.chaveModulo(m)] || {}).def;
    const S = O.S;
    switch (m.tipo) {
      case 'app': return cartaoApp(m.app, t);
      case 'entrada':
        return `<button class="cartao entrada ol-t peq" data-acao="entrada" style="border-radius:24px">
          <span class="num" data-entrada-n>·</span>
          <span><span class="tit" style="display:block;font:500 16px var(--corpo)">Na Entrada</span><span class="sub" data-entrada-sub>Ficheiros novos por arrumar</span></span></button>`;
      case 'todas-apps':
        return `<button class="cartao ol-t peq" data-acao="todas-apps" style="border-radius:24px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);backdrop-filter:var(--blur)">
          ${O.ic.grelha({ s: 26, c: '#fff' })}
          <span><span class="tit" style="display:block;font:500 16px var(--corpo)">Todas as apps</span><span class="sub">Do Mac e web</span></span></button>`;
      case 'ficheiros':
        return `<div class="cartao vidro" data-abrir="ficheiros" role="button" tabindex="0">
          <div style="display:flex;justify-content:space-between;align-items:flex-start"><span class="icone">${O.ic.pasta({ s: 26, c: '#7cc8f5' })}</span><span class="pilula" data-livre>…</span></div>
          <div><div class="tit" style="font-size:24px">Ficheiros</div><div class="sub">Encontrar e espaço em disco</div></div></div>`;
      case 'relogio':
        return `<div class="cartao vidro relogio-mod" style="justify-content:center"><div class="h" data-relogio>${O.hora()}</div><div class="sub" style="font-size:15px;margin-top:10px">${esc(O.data())}</div></div>`;
      case 'meteo':
        return `<div class="cartao vidro" data-meteo style="padding:20px 22px"><span class="sub">${esc((S.definicoes.cidade || {}).nome || '')}</span><span class="tit" data-meteo-t>…</span></div>`;
      case 'nota':
        return `<div class="cartao vidro nota-mod" style="justify-content:flex-start"><span class="rotulo2">Nota rápida</span><textarea data-nota aria-label="Nota rápida" placeholder="Escreve uma nota…">${esc((S.notas || {})[S.espacoAtual] || '')}</textarea></div>`;
      case 'apps-mac': {
        const ids = O.espaco().apps.filter(id => S.apps[id] && S.apps[id].tipo === 'mac');
        return `<div class="cartao vidro" style="justify-content:flex-start"><span class="rotulo2">Apps do Mac</span>
          <div class="lista-mod">${ids.length ? ids.map(id => `<button data-abrir="${esc(id)}">${esc(S.apps[id].nome)}</button>`).join('') : '<button data-acao="acrescentar-app">+ Acrescentar apps</button>'}</div></div>`;
      }
      default: return '';
    }
  }

  function ligarModulos(box) {
    box.onclick = ev => {
      const pj = ev.target.closest('[data-projeto]');
      if (pj) { ev.stopPropagation(); O.abrirProjeto(pj.dataset.projeto, pj); return; }
      const ac = ev.target.closest('[data-acao]');
      if (ac) { ev.stopPropagation(); O.acao(ac.dataset.acao, ac); return; }
      const ct = ev.target.closest('[data-cont]');
      if (ct) { const it = C._cont[+ct.dataset.cont]; if (it) O.abrirAlvo(it.alvo, ct); return; }
      const ab = ev.target.closest('[data-abrir]');
      if (ab) { O.abrirAlvo({ app: ab.dataset.abrir }, ab); }
    };
    box.onkeydown = ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role="button"]')) { ev.preventDefault(); ev.target.click(); } };
    const nota = O.$('[data-nota]', box);
    if (nota) nota.oninput = O.debounce(() => O.api.call('nota:guardar', O.S.espacoAtual, nota.value), 500);
    if (O.$('[data-meteo]', box)) O.api.call('meteo').then(m => { const el = O.$('[data-meteo-t]'); if (el) el.textContent = m ? `${m.temp}°` : '—'; });
    if (O.$('[data-livre]', box)) O.api.call('space:state').then(s => { const el = O.$('[data-livre]'); if (el && s) el.textContent = O.gb(s.disk.livre) + ' GB livres'; });
  }

  /* ---------- Continuar ---------- */
  C._cont = [];
  C.continuar = async () => {
    const fila = O.$('#fila-continuar'); if (!fila) return;
    const list = await O.api.call('continuar');
    C._cont = list;
    const cards = list.map((c, i) => {
      const mk = c.tipo === 'mac' && O.S.apps[c.alvo.mac] ? `<span class="marca letra" data-icone="${esc(O.S.apps[c.alvo.mac].caminho)}">${esc(c.mark)}</span>`
        : c.tipo === 'ficheiro' && c.ext ? `<span class="marca" style="font-size:9px;letter-spacing:.04em">${esc(c.ext.toUpperCase().slice(0, 4))}</span>` : `<span class="marca">${esc(c.mark)}</span>`;
      return `<button class="cont ol-t ol-in" data-cont="${i}" style="animation-delay:${80 + i * 40}ms" title="${esc(c.titulo)}">
        <span class="app">${mk}<span>${esc(c.app)}</span></span>
        <span class="titulo">${esc(c.titulo)}</span>
        <span class="quando">${esc(O.quando(c.t))}</span></button>`;
    });
    while (cards.length < 5) cards.push(`<div class="cont fantasma">${cards.length === list.length ? 'O que usares aparece aqui' : ''}</div>`);
    fila.innerHTML = cards.join('');
    O.preencherIcones(fila);
  };

  C.entrada = async () => {
    const n = O.$('[data-entrada-n]'); if (!n) return;
    const l = await O.api.call('files:entrada');
    O.entradaN = l.length;
    n.textContent = l.length;
    const s = O.$('[data-entrada-sub]'); if (s) s.textContent = l.length ? (l.length === 1 ? 'Ficheiro novo por arrumar' : 'Ficheiros novos por arrumar') : 'Está tudo arrumado';
  };

  /* ================================================================ */
  /* Barra do Claude                                                   */
  /* ================================================================ */
  const st = { q: '', res: null, sel: 0, flat: [], runId: null, run: null, conversa: false };
  C.cmd = st;

  function ligarCmd() {
    const input = O.$('#cmd');
    const procurar = O.debounce(async q => {
      const r = await O.api.call('search:local', q);
      if (input.value.trim() !== q) return;
      st.res = r; st.sel = 0;
      desenharResultados();
    }, 70);
    input.addEventListener('input', () => {
      const q = input.value.trim();
      st.q = q;
      if (!q) { fecharResultados(); return; }
      O.$('#resposta').hidden = true;
      // primeiro, logo, a opção do Claude; os resultados locais chegam a seguir
      if (!st.res || st.res.q !== q) { st.res = { q, grupos: (st.res && st.res.grupos) || [], pergunta: false }; desenharResultados(); }
      procurar(q);
    });
    input.addEventListener('keydown', ev => {
      const aberto = !O.$('#resultados').hidden;
      if (ev.key === 'ArrowDown' && aberto) { ev.preventDefault(); mover(1); }
      else if (ev.key === 'ArrowUp' && aberto) { ev.preventDefault(); mover(-1); }
      else if (ev.key === 'Enter') { ev.preventDefault(); if (aberto) ativar(st.flat[st.sel]); else if (input.value.trim()) perguntar(input.value.trim()); }
      else if (ev.key === 'Escape') { ev.preventDefault(); C.escape(); }
      else if (ev.key === 'Tab' && aberto && st.flat.length) { ev.preventDefault(); mover(ev.shiftKey ? -1 : 1); }
    });
    input.addEventListener('focus', () => { if (input.value.trim() && O.$('#resposta').hidden) desenharResultados(); });
    document.addEventListener('mousedown', ev => {
      if (!ev.target.closest('.cmd-zona')) { O.$('#resultados').hidden = true; input.setAttribute('aria-expanded', 'false'); }
    });
  }

  C.escape = async () => {
    const input = O.$('#cmd');
    if (!O.$('#resultados').hidden) { fecharResultados(); return; }
    if (!O.$('#resposta').hidden) { fecharResposta(); return; }
    if (input.value) { input.value = ''; st.q = ''; return; }
    // chamado pelo atalho a partir de outra app: volta para lá
    if (await O.api.call('app:atalhoUsado')) O.api.call('app:esconder');
    input.blur();
  };

  function fecharResultados() { O.$('#resultados').hidden = true; O.$('#cmd').setAttribute('aria-expanded', 'false'); }
  function fecharResposta() {
    if (st.runId && st.run && !st.run.fim) O.api.call('claude:stop', st.runId);
    O.$('#resposta').hidden = true; st.conversa = false; st.run = null;
  }

  function mover(d) {
    if (!st.flat.length) return;
    st.sel = (st.sel + d + st.flat.length) % st.flat.length;
    O.$$('#resultados .res').forEach((el, i) => el.setAttribute('aria-selected', String(i === st.sel)));
    const el = O.$$('#resultados .res')[st.sel]; if (el) el.scrollIntoView({ block: 'nearest' });
  }

  const MARK = { App: 'A', Projeto: 'P', Ficheiro: 'F', 'Ação': '+' };
  function desenharResultados() {
    const box = O.$('#resultados');
    const r = st.res; if (!r) return;
    const claudeRow = { tipo: 'Claude', nome: st.conversa ? `Continuar a conversa: “${r.q}”` : `Perguntar ao Claude: “${r.q}”`, claude: true };
    const flat = [];
    let html = '';
    const linha = (it, i) => {
      const sel = i === st.sel;
      if (it.claude) return `<div class="res claude" role="option" aria-selected="${sel}" data-i="${i}"><span class="marca" aria-hidden="true">✦</span><span class="txt"><span class="nome">${esc(it.nome)}</span>${st.conversa ? '' : '<span class="sub">Pergunta ou pedido</span>'}</span><span class="pilula">Claude</span></div>`;
      const a = O.S.apps[it.id];
      const mk = it.caminho || (a && a.caminho) ? `<span class="marca letra" data-icone="${esc(it.caminho || a.caminho)}">${esc(it.nome[0])}</span>`
        : it.tipo === 'Ficheiro' ? `<span class="marca" style="font-size:9px">${esc((it.ext || 'F').toUpperCase().slice(0, 4))}</span>`
        : `<span class="marca">${esc(it.id === 'zeus' ? 'Z' : it.id === 'apolo' ? 'A' : it.tipo === 'Ação' ? '+' : (it.nome[0] || MARK[it.tipo]))}</span>`;
      return `<div class="res" role="option" aria-selected="${sel}" data-i="${i}">${mk}<span class="txt"><span class="nome">${esc(it.nome)}</span><span class="sub">${esc(it.sub || '')}</span></span><span class="pilula">${esc(it.tipo === 'Ação' ? 'Ação' : it.tipo)}</span></div>`;
    };
    const temLocal = r.grupos.some(g => g.itens.length);
    if (r.pergunta || st.conversa || !temLocal) { flat.push(claudeRow); html += linha(claudeRow, 0); }
    for (const g of r.grupos) {
      if (r.grupos.length > 1) html += `<div class="grupo-tit">${esc(g.tipo === 'Ficheiro' ? 'Ficheiros' : g.tipo === 'Projeto' ? 'Projetos' : g.tipo === 'App' ? 'Apps' : 'Ações')}</div>`;
      for (const it of g.itens) { html += linha(it, flat.length); flat.push(it); }
    }
    if (!(r.pergunta || st.conversa || !temLocal)) { html += linha(claudeRow, flat.length); flat.push(claudeRow); }
    st.flat = flat;
    if (st.sel >= flat.length) st.sel = 0;
    box.innerHTML = html;
    box.hidden = false;
    O.$('#cmd').setAttribute('aria-expanded', 'true');
    O.preencherIcones(box);
    box.onmousedown = ev => ev.preventDefault();
    box.onclick = ev => { const el = ev.target.closest('.res'); if (el) ativar(st.flat[+el.dataset.i]); };
  }

  function ativar(it) {
    if (!it) return;
    const input = O.$('#cmd');
    if (it.claude) { perguntar(st.q || input.value.trim()); return; }
    fecharResultados();
    input.value = ''; st.q = '';
    input.blur();
    O.abrirAlvo(it.alvo);
  }

  /* ---------- perguntar ao Claude (resposta em streaming, com botão para parar) ---------- */
  function perguntar(q, extra = {}) {
    if (!q) return;
    const continuar = st.conversa;
    fecharResultados();
    const runId = 'r' + Date.now().toString(36);
    st.runId = runId;
    st.run = { q, texto: '', passos: [], propostas: [], fim: false, erro: null };
    st.conversa = true;
    O.$('#cmd').value = '';
    st.q = '';
    desenharResposta();
    O.claudeRuns[runId] = ev => aoEvento(runId, ev);
    O.api.call('claude:ask', runId, q, Object.assign({ continuar }, extra));
  }
  C.perguntar = perguntar;

  const NOMES_PASSO = { procurar_ficheiros: 'A procurar ficheiros', ficheiros_recentes: 'A ver os recentes', ver_entrada: 'A ver a Entrada', listar_projetos: 'A ver os projetos', espaco_em_disco: 'A ver o espaço em disco', abrir: 'A abrir', propor_mover: 'A preparar uma proposta', propor_lixo: 'A preparar uma proposta', Read: 'A ler um ficheiro', Glob: 'A procurar nomes', Grep: 'A procurar texto' };
  function aoEvento(runId, ev) {
    if (runId !== st.runId || !st.run) return;
    const r = st.run;
    if (ev.type === 'text') r.texto += ev.delta;
    else if (ev.type === 'turn') { if (r.texto && !/\n\n$/.test(r.texto)) r.texto += '\n\n'; }
    else if (ev.type === 'tool') r.passos.push(NOMES_PASSO[ev.name] || ev.name);
    else if (ev.type === 'proposta') r.propostas.push(ev.proposta);
    else if (ev.type === 'error') r.erro = ev.message;
    else if (ev.type === 'done') { r.fim = true; if (ev.parado) r.parado = true; }
    desenharResposta();
  }

  function desenharResposta() {
    const box = O.$('#resposta');
    const r = st.run; if (!r) { box.hidden = true; return; }
    box.hidden = false;
    const passos = r.passos.length && !r.fim ? `<div>${[...new Set(r.passos)].slice(-3).map(p => `<span class="passo">${O.ic.claude({ s: 12, c: '#7cc8f5' })}${esc(p)}…</span>`).join('')}</div>` : '';
    box.innerHTML = `
      <div class="cab"><span style="color:#7cc8f5">✦</span><span class="q">${esc(r.q)}</span>
        ${r.fim ? `<button class="btn peq fantasma" data-novo>Nova pergunta</button>` : `<button class="btn peq" data-parar>Parar</button>`}
        <button class="ico-btn" style="width:32px;height:32px" aria-label="Fechar resposta" data-fechar-r>${O.ic.x({ s: 12 })}</button></div>
      <div class="corpo" aria-live="polite">${passos}${O.md(r.texto)}${!r.fim && !r.texto ? '<p style="color:var(--t2)">A pensar… <span class="cursor"></span></p>' : !r.fim ? '<span class="cursor"></span>' : ''}
        ${r.propostas.map(propostaHTML).join('')}
        ${r.erro ? `<p class="erro-txt">${esc(r.erro)}</p>` : ''}
        ${r.parado ? '<p style="color:var(--t3)">Parado.</p>' : ''}
        ${r.fim && !r.erro ? '<p style="color:var(--t3);font-size:12px;margin-top:6px">Escreve na barra para continuar a conversa.</p>' : ''}
      </div>`;
    const corpo = O.$('.corpo', box); corpo.scrollTop = corpo.scrollHeight;
    const parar = O.$('[data-parar]', box); if (parar) parar.onclick = () => O.api.call('claude:stop', st.runId);
    O.$('[data-fechar-r]', box).onclick = () => fecharResposta();
    const novo = O.$('[data-novo]', box); if (novo) novo.onclick = () => { fecharResposta(); O.$('#cmd').focus(); };
    ligarPropostas(box, r);
  }

  O.propostaHTML = propostaHTML;
  function propostaHTML(p) {
    const tit = p.tipo === 'mover' ? `Mover ${p.itens.length} ${p.itens.length === 1 ? 'ficheiro' : 'ficheiros'}` : `Mandar ${p.itens.length} ${p.itens.length === 1 ? 'item' : 'itens'} para o Lixo` + (p.itens.some(i => i.size) ? ` (${O.bytes(p.itens.reduce((t, i) => t + (i.size || 0), 0))})` : '');
    return `<div class="proposta ${p.estado === 'feita' ? 'feita' : ''}" data-proposta="${esc(p.id)}">
      <div style="font-weight:500">${esc(tit)}</div>${p.motivo ? `<div style="font-size:12px;color:var(--t2);margin-top:3px">${esc(p.motivo)}</div>` : ''}
      <div class="lista">${p.itens.map(i => `<div><span>${esc(i.nome)}</span><span>${p.tipo === 'mover' ? '→ ' + esc(i.destinoNome) : esc(i.onde)}</span></div>`).join('')}</div>
      ${p.estado === 'feita' ? `<div style="font-size:12px;color:var(--ok)">✓ ${esc(p.resultado || 'Feito')}</div>` : p.estado === 'cancelada' ? '<div style="font-size:12px;color:var(--t3)">Cancelado</div>'
        : `<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn peq fantasma" data-cancelar>Cancelar</button><button class="btn peq prim" data-confirmar>Confirmar</button></div>`}
    </div>`;
  }
  O.ligarPropostas = ligarPropostas;
  function ligarPropostas(box, r) {
    O.$$('[data-proposta]', box).forEach(el => {
      const p = r.propostas.find(x => x.id === el.dataset.proposta); if (!p) return;
      const c = O.$('[data-confirmar]', el), x = O.$('[data-cancelar]', el);
      if (c) c.onclick = async () => {
        c.disabled = true;
        const res = await O.api.call('proposta:confirmar', p.id);
        p.estado = 'feita';
        p.resultado = res.ok ? (p.tipo === 'mover' ? `${res.feitos} movido(s)` : `${res.feitos} no Lixo — ${res.nota}`) : (res.error || res.erros.join('; '));
        el.outerHTML = propostaHTML(p);
        C.entrada();
      };
      if (x) x.onclick = async () => { await O.api.call('proposta:cancelar', p.id); p.estado = 'cancelada'; el.outerHTML = propostaHTML(p); };
    });
  }

  C.focar = () => { const i = O.$('#cmd'); if (i) { i.focus(); i.select(); } };
})();

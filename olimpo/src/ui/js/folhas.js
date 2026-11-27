'use strict';
/* Folhas por cima do Olimpo (AdicionarApp.dc.html, Definições, Projeto) e Editar espaço (EditarEspaco.dc.html). */
(() => {
  const O = window.O, esc = O.esc;
  const fechar = `<button class="fechar" data-fechar aria-label="Fechar">${O.ic.x({ s: 18, w: 1.8 })}</button>`;

  const WEB = [
    ['notion', 'Notion', 'https://www.notion.so/'], ['waweb', 'WhatsApp Web', 'https://web.whatsapp.com/'], ['gmail', 'Gmail', 'https://mail.google.com/'],
    ['pmail', 'Proton Mail', 'https://mail.proton.me/'], ['gcal', 'Calendário Google', 'https://calendar.google.com/'], ['spotify', 'Spotify', 'https://open.spotify.com/'],
    ['youtube', 'YouTube', 'https://www.youtube.com/'], ['drive', 'Google Drive', 'https://drive.google.com/'], ['claudeai', 'Claude', 'https://claude.ai/'],
    ['observador', 'Observador', 'https://observador.pt/'], ['linkedin', 'LinkedIn', 'https://www.linkedin.com/'], ['figma', 'Figma', 'https://www.figma.com/']
  ];

  /* ---------- Acrescentar app ---------- */
  O.folhaAcrescentar = async () => {
    const st = { tab: 'mac', q: '', espaco: O.S.espacoAtual, mac: new Set(), web: new Set(), proprias: [] };
    const instaladas = await O.api.call('apps:installed');
    const f = O.folha(`
      <div class="cab"><div><h1>Acrescentar app</h1><p class="desc">Escolhe as apps que queres ter neste espaço.</p></div>${fechar}</div>
      <div style="display:flex;gap:12px;align-items:center">
        <label class="campo" style="flex:1">${O.ic.lupa({ s: 18, w: 1.7 })}<input type="text" id="aa-q" aria-label="Procurar apps" placeholder="Procurar apps…"></label>
        <div class="segm peq" role="group" aria-label="Tipo de app" style="border-radius:14px;padding:4px"><button data-t="mac" style="border-radius:10px">Apps do Mac</button><button data-t="web" style="border-radius:10px">Apps web</button></div>
      </div>
      <div class="grelha-apps" id="aa-grelha"></div>
      <div class="rodape-f">
        <div style="display:flex;align-items:center;gap:12px"><span style="font-size:14px;color:rgba(255,255,255,.72)">Acrescentar a</span>
          <div class="segm peq" role="group" aria-label="Espaço" id="aa-esp">${O.S.espacos.map(e => `<button data-e="${esc(e.id)}">${esc(e.nome)}</button>`).join('')}</div></div>
        <button class="btn prim" id="aa-ok" style="padding:14px 24px;border-radius:16px;font-size:15px">Escolhe uma app</button>
      </div>`, { classe: 'alta' });
    const grelha = O.$('#aa-grelha', f);
    const desenhar = () => {
      O.$$('[data-t]', f).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === st.tab)));
      O.$$('[data-e]', f).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.e === st.espaco)));
      const q = st.q.toLowerCase();
      const ja = new Set(O.S.espacos.find(e => e.id === st.espaco).apps);
      let html = '';
      if (st.tab === 'mac') {
        html = instaladas.filter(a => !q || a.nome.toLowerCase().includes(q)).map(a => {
          const on = st.mac.has(a.id) || ja.has(a.id);
          return `<button class="app-c" data-mac="${esc(a.id)}" aria-pressed="${on}" ${ja.has(a.id) ? 'disabled title="Já está neste espaço"' : ''}>
            <span class="mk letra" data-icone="${esc(a.caminho)}">${esc(a.nome[0])}</span><span class="nm">${esc(a.nome)}</span>${on ? `<span class="ok">${O.ic.ok({ s: 12, c: '#04060a' })}</span>` : ''}</button>`;
        }).join('') || '<div class="vazio">Nenhuma app com esse nome.</div>';
      } else {
        const lista = WEB.concat(st.proprias.map(p => [p.id, p.nome, p.url]));
        html = lista.filter(([, n]) => !q || n.toLowerCase().includes(q)).map(([id, n]) => {
          const key = 'web-' + id, on = st.web.has(id) || ja.has(key);
          return `<button class="app-c" data-web="${esc(id)}" aria-pressed="${on}"><span class="mk letra">${esc(n[0])}</span><span class="nm">${esc(n)}</span>${on ? `<span class="ok">${O.ic.ok({ s: 12, c: '#04060a' })}</span>` : ''}</button>`;
        }).join('') + `<button class="app-c" data-propria style="border-style:dashed"><span class="mk">+</span><span class="nm">Outro site…</span></button>`;
      }
      grelha.innerHTML = html;
      O.preencherIcones(grelha);
      const n = st.mac.size + st.web.size;
      const ok = O.$('#aa-ok', f);
      ok.disabled = !n; ok.textContent = !n ? 'Escolhe uma app' : n === 1 ? 'Acrescentar 1 app' : `Acrescentar ${n} apps`;
    };
    O.$('#aa-q', f).oninput = ev => { st.q = ev.target.value.trim(); desenhar(); };
    O.$$('[data-t]', f).forEach(b => b.onclick = () => { st.tab = b.dataset.t; desenhar(); });
    O.$$('[data-e]', f).forEach(b => b.onclick = () => { st.espaco = b.dataset.e; desenhar(); });
    grelha.onclick = ev => {
      const m = ev.target.closest('[data-mac]'), w = ev.target.closest('[data-web]');
      if (m) { const id = m.dataset.mac; st.mac.has(id) ? st.mac.delete(id) : st.mac.add(id); desenhar(); }
      else if (w) { const id = w.dataset.web; st.web.has(id) ? st.web.delete(id) : st.web.add(id); desenhar(); }
      else if (ev.target.closest('[data-propria]')) {
        // formulário no lugar do cartão (o Electron não tem prompt())
        const card = ev.target.closest('[data-propria]');
        const form = document.createElement('form');
        form.style.cssText = 'grid-column:1/-1;display:flex;gap:10px;align-items:center';
        form.innerHTML = `<span class="campo" style="flex:1"><input name="nome" required placeholder="Nome da app" aria-label="Nome da app"></span>
          <span class="campo" style="flex:2"><input name="url" required placeholder="https://app.exemplo.pt" aria-label="Endereço"></span><button class="btn prim">Juntar</button>`;
        card.replaceWith(form);
        form.nome.focus();
        form.onsubmit = e2 => {
          e2.preventDefault();
          const nome = form.nome.value.trim();
          let url = form.url.value.trim(); if (!/^https?:\/\//.test(url)) url = 'https://' + url;
          const id = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
          st.proprias.push({ id, nome, url }); st.web.add(id); desenhar();
        };
      }
    };
    O.$('#aa-ok', f).onclick = async () => {
      const lista = WEB.concat(st.proprias.map(p => [p.id, p.nome, p.url]));
      const webApps = [...st.web].map(id => { const w = lista.find(x => x[0] === id); return { id: 'web-' + id, nome: w[1], url: w[2] }; });
      await O.api.call('apps:add', { mac: [...st.mac], webApps, espaco: st.espaco });
      O.fecharFolha();
      O.toast(`${st.mac.size + st.web.size === 1 ? 'App acrescentada' : 'Apps acrescentadas'} a ${O.S.espacos.find(e => e.id === st.espaco).nome}.`);
    };
    desenhar();
  };

  /* ---------- Todas as apps ---------- */
  O.folhaTodas = async () => {
    const instaladas = await O.api.call('apps:installed');
    const S = O.S, e = O.espaco();
    const doEspaco = e.apps.filter(id => S.apps[id]).map(id => ({ id, nome: S.apps[id].nome, tipo: S.apps[id].tipo, caminho: S.apps[id].caminho }));
    const olimpo = ['zeus', 'apolo', 'ficheiros'].map(id => ({ id, nome: S.apps[id].nome, tipo: 'painel' }));
    let q = '';
    const f = O.folha(`
      <div class="cab"><div><h1>Todas as apps</h1><p class="desc">Do Olimpo, deste espaço e do Mac.</p></div>${fechar}</div>
      <label class="campo">${O.ic.lupa({ s: 18, w: 1.7 })}<input type="text" id="ta-q" aria-label="Procurar apps" placeholder="Procurar apps…" autofocus></label>
      <div style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:18px" id="ta-corpo"></div>
      <div class="rodape-f"><span style="font-size:13px;color:var(--t3)">Clique direito numa app do espaço para a tirar.</span><button class="btn" id="ta-mais">+ Acrescentar app</button></div>`, { classe: 'alta' });
    const card = a => {
      const mk = a.id === 'zeus' ? O.ic.zeus({ s: 22, c: '#7cc8f5' }) : a.id === 'apolo' ? O.ic.apolo({ s: 22, c: '#7cc8f5' }) : a.id === 'ficheiros' ? O.ic.pasta({ s: 22, c: '#7cc8f5' }) : esc(a.nome[0]);
      return `<button class="app-c" data-app="${esc(a.id)}" data-tipo="${esc(a.tipo || 'mac')}"><span class="mk letra" ${a.caminho ? `data-icone="${esc(a.caminho)}"` : ''}>${mk}</span><span class="nm">${esc(a.nome)}</span></button>`;
    };
    const desenhar = () => {
      const fl = l => l.filter(a => !q || a.nome.toLowerCase().includes(q));
      const sec = (t, l) => l.length ? `<div><div class="rotulo2" style="margin-bottom:10px">${esc(t)}</div><div class="grelha-apps" style="overflow:visible">${l.map(card).join('')}</div></div>` : '';
      O.$('#ta-corpo', f).innerHTML = sec('Olimpo', fl(olimpo)) + sec(e.nome, fl(doEspaco)) + sec('Apps do Mac', fl(instaladas.filter(a => !e.apps.includes(a.id))));
      O.preencherIcones(f);
    };
    O.$('#ta-q', f).oninput = ev => { q = ev.target.value.trim().toLowerCase(); desenhar(); };
    O.$('#ta-mais', f).onclick = () => O.folhaAcrescentar();
    f.addEventListener('click', ev => {
      const b = ev.target.closest('[data-app]'); if (!b) return;
      O.fecharFolha();
      const id = b.dataset.app;
      if (S.apps[id]) O.abrirAlvo({ app: id }); else O.abrirAlvo({ mac: id });
    });
    f.addEventListener('contextmenu', ev => {
      const b = ev.target.closest('[data-app]'); if (!b || !e.apps.includes(b.dataset.app)) return;
      ev.preventDefault();
      O.menu(b, [{ label: `Tirar de ${e.nome}`, run: async () => { await O.api.call('apps:remove', b.dataset.app, e.id); O.fecharFolha(); O.folhaTodas(); } }]);
    });
    desenhar();
  };

  /* ---------- app na coluna do Zeus ---------- */
  O.folhaAppZeus = () => {
    const f = O.folha(`<div class="cab"><div><h1 style="font-size:22px">Acrescentar ao Zeus</h1><p class="desc">Uma app web que fica na coluna do Zeus e abre no lugar da página.</p></div>${fechar}</div>
      <form class="form" id="az"><label>Nome<span class="campo"><input name="nome" required placeholder="Ex.: Gmail"></span></label>
      <label>Endereço<span class="campo"><input name="url" required placeholder="https://mail.google.com"></span></label>
      <div class="rodape-f"><span></span><button class="btn prim">Acrescentar</button></div></form>`, { classe: 'estreita' });
    O.$('#az', f).onsubmit = async ev => {
      ev.preventDefault();
      let url = ev.target.url.value.trim(); if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      await O.api.call('zeus:coluna', { nome: ev.target.nome.value.trim(), url });
      O.fecharFolha();
    };
  };

  /* ---------- Projeto (novo / editar) ---------- */
  O.folhaProjeto = pr => {
    const novo = !pr;
    pr = pr || { nome: '', espaco: O.S.espacoAtual, pasta: '', quadroApolo: '' };
    const f = O.folha(`<div class="cab"><div><h1 style="font-size:24px">${novo ? 'Novo projeto' : esc(pr.nome)}</h1><p class="desc">Cada projeto junta um quadro do Apolo e uma pasta de ficheiros.</p></div>${fechar}</div>
      <form class="form" id="pj">
        <label>Nome<span class="campo"><input name="nome" required value="${esc(pr.nome)}" placeholder="Ex.: Podcast Plus" autofocus></span></label>
        <label>Espaço<span class="campo"><select name="espaco">${O.S.espacos.map(e => `<option value="${esc(e.id)}" ${e.id === pr.espaco ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select></span></label>
        <label>Pasta<span class="linha"><span class="campo" style="flex:1"><input name="pasta" value="${esc(pr.pasta)}" placeholder="${esc(O.S.ficheiros.pastaProjetos)}/<nome>"></span><button type="button" class="btn" data-escolher>Escolher…</button></span><span class="dica">Se ficar em branco, é criada em ${esc(O.S.ficheiros.pastaProjetos)}.</span></label>
        <label>Quadro no Apolo<span class="campo"><input name="quadro" value="${esc(pr.quadroApolo || '')}" placeholder="Endereço do quadro (opcional)"></span><span class="dica">Abre o quadro e copia o endereço do Zeus. Sem endereço, abre a página principal do Apolo.</span></label>
        <div class="rodape-f">${novo ? '<span></span>' : '<button type="button" class="btn fantasma" data-tirar>Tirar do Olimpo</button>'}<button class="btn prim">${novo ? 'Criar projeto' : 'Guardar'}</button></div>
      </form>`, { classe: 'estreita' });
    O.$('[data-escolher]', f).onclick = async () => { const p = await O.api.call('projetos:escolherPasta'); if (p) f.querySelector('[name=pasta]').value = p; };
    const tirar = O.$('[data-tirar]', f);
    if (tirar) tirar.onclick = async () => {
      if (!await O.confirmar({ titulo: `Tirar “${pr.nome}” do Olimpo?`, texto: 'A pasta e os ficheiros ficam onde estão; só deixa de aparecer no Olimpo.', ok: 'Tirar' })) return;
      await O.api.call('projetos:tirar', pr.id);
      O.irPara('casa');
    };
    O.$('#pj', f).onsubmit = async ev => {
      ev.preventDefault();
      const x = ev.target;
      let quadro = x.quadro.value.trim(); if (quadro && !/^https?:\/\//.test(quadro)) quadro = 'https://' + quadro;
      const dados = { nome: x.nome.value.trim(), espaco: x.espaco.value, pasta: x.pasta.value.trim(), quadroApolo: quadro };
      try {
        if (novo) { const id = await O.api.call('projetos:criar', dados); O.fecharFolha(); O.toast('Projeto criado.'); setTimeout(() => O.abrirProjeto(id), 50); }
        else { await O.api.call('projetos:editar', pr.id, Object.assign(dados, { pasta: dados.pasta || pr.pasta })); O.fecharFolha(); }
      } catch (e) { O.toast('Não consegui: ' + e.message); }
    };
  };

  /* ---------- Definições ---------- */
  O.folhaDefinicoes = async () => {
    const S = O.S, d = S.definicoes, c = await O.api.call('claude:status');
    const mac = O.plataforma === 'darwin';
    const estadoClaude = c.executavel || c.incluido
      ? `<span class="estado-ok">Claude Code encontrado${c.executavel ? ' (' + esc(c.executavel) + ')' : ' (incluído)'}.</span> Usa a sessão iniciada com <code>claude login</code> — a subscrição, sem chave de API.`
      : '<span class="estado-mau">Não encontrei o Claude Code.</span> Instala-o e, no Terminal, escreve <code>claude login</code>.';
    const aviso = c.chaveNoAmbiente || c.chaveNosFicheiros.length
      ? `<div class="dica estado-mau">Há uma ANTHROPIC_API_KEY ${c.chaveNosFicheiros.length ? 'em ' + esc(c.chaveNosFicheiros.join(', ')) : 'no ambiente'}. O Olimpo ignora-a para usar a subscrição, mas convém tirá-la para o Claude Code também não a usar.</div>` : '';
    const f = O.folha(`<div class="cab"><div><h1>Definições</h1><p class="desc">Olimpo ${esc(O.versao)}</p></div>${fechar}</div>
      <form class="form" id="df" style="overflow:auto;padding-right:4px">
        <label>O teu nome<span class="campo"><input name="nome" value="${esc(S.nome)}"></span></label>
        <label>Endereço do Apolo<span class="campo"><input name="apolo" value="${esc(d.apoloUrl)}" placeholder="https://…"></span></label>
        <label>Pastas da Entrada<span class="campo"><input name="entrada" value="${esc(S.ficheiros.entrada.join(', '))}"></span><span class="dica">Separadas por vírgulas. Ficheiros novos dos últimos <input name="dias" type="number" min="1" max="90" value="${S.ficheiros.entradaDias}" style="width:48px;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.3);color:#fff"> dias.</span></label>
        <label>Pasta dos projetos<span class="campo"><input name="projetos" value="${esc(S.ficheiros.pastaProjetos)}"></span></label>
        <label>Cache do DaVinci Resolve<span class="campo"><input name="davinci" value="${esc(S.ficheiros.cacheDaVinci || '')}" placeholder="Ex.: ~/Movies/CacheClip (o Olimpo também procura sozinho)"></span></label>
        <label>Atalho da barra do Claude<span class="campo"><input name="atalho" value="${esc(d.atalho)}"></span><span class="dica">Ex.: Alt+Space (⌥ Espaço). O Ctrl Espaço do Mac está ocupado pela troca de idioma.</span></label>
        <label>Claude<span class="dica" style="font-size:13px;color:var(--t2)">${estadoClaude}</span>${aviso}</label>
        <div class="linha"><label style="flex:1">Modelo<span class="campo"><select name="modelo">${['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'].map(m => `<option ${m === d.modeloClaude ? 'selected' : ''}>${m}</option>`).join('')}</select></span></label>
          <label style="flex:1">Esforço<span class="campo"><select name="esforco">${[['low', 'Rápido'], ['medium', 'Normal'], ['high', 'Mais cuidado']].map(([v, n]) => `<option value="${v}" ${v === d.esforcoClaude ? 'selected' : ''}>${n}</option>`).join('')}</select></span></label></div>
        <label class="linha" style="color:#fff;font-size:14px"><input type="checkbox" name="arranque" ${d.arranque ? 'checked' : ''}> Abrir o Olimpo quando o computador liga</label>
        ${mac ? `<div class="caixa" style="display:grid;gap:10px"><b style="font-weight:500">Secretária do Mac</b><span class="dica" style="font-size:13px">Esconde a Dock (a barra do Olimpo substitui-a) e os ícones da secretária. Podes desfazer aqui a qualquer momento.</span>
          <div class="linha"><button type="button" class="btn" data-limpar>Esconder Dock e secretária</button><button type="button" class="btn fantasma" data-desfazer>Desfazer</button></div></div>` : ''}
        <div class="rodape-f"><button type="button" class="btn fantasma" data-sair>Sair do Olimpo</button><button class="btn prim">Guardar</button></div>
      </form>`, { classe: 'alta' });
    O.$('#df', f).onsubmit = async ev => {
      ev.preventDefault();
      const x = ev.target;
      let apolo = x.apolo.value.trim(); if (apolo && !/^https?:\/\//.test(apolo)) apolo = 'https://' + apolo;
      await O.api.call('definicoes:guardar', {
        nome: x.nome.value,
        definicoes: { apoloUrl: apolo, atalho: x.atalho.value.trim() || 'Alt+Space', modeloClaude: x.modelo.value, esforcoClaude: x.esforco.value, arranque: x.arranque.checked },
        ficheiros: { entrada: x.entrada.value.split(',').map(s => s.trim()).filter(Boolean), entradaDias: Math.max(1, +x.dias.value || 14), pastaProjetos: x.projetos.value.trim() || '~/Projetos', cacheDaVinci: x.davinci.value.trim() }
      });
      O.fecharFolha(); O.toast('Guardado.');
    };
    const lim = O.$('[data-limpar]', f);
    if (lim) lim.onclick = async () => {
      if (!await O.confirmar({ titulo: 'Esconder a Dock e a secretária?', texto: 'A Dock passa a esconder-se sozinha e os ícones da secretária deixam de aparecer (os ficheiros ficam onde estão). O Finder e a Dock reiniciam.', ok: 'Esconder' })) return;
      const r = await O.api.call('mac:limparSecretaria', false); O.toast(r.ok ? 'Feito.' : 'Não consegui: ' + r.error);
    };
    const des = O.$('[data-desfazer]', f);
    if (des) des.onclick = async () => { const r = await O.api.call('mac:limparSecretaria', true); O.toast(r.ok ? 'Dock e secretária de volta.' : 'Não consegui: ' + r.error); };
    O.$('[data-sair]', f).onclick = () => O.api.call('app:sair');
  };

  /* ---------- menu ⋯ do ecrã principal ---------- */
  O.menuMais = anchor => O.menu(anchor, [
    { label: 'Editar espaço', run: () => O.editar.abrir() },
    { label: 'Novo projeto', run: () => O.folhaProjeto() },
    { label: 'Acrescentar app', run: () => O.folhaAcrescentar() },
    { label: 'Ficheiros', run: () => O.abrirFicheiros() },
    '-',
    { label: 'Definições', run: () => O.folhaDefinicoes() },
    { label: 'Esconder o Olimpo', run: () => O.api.call('app:esconder') }
  ]);

  /* ================================================================ */
  /* Editar espaço                                                     */
  /* ================================================================ */
  const TAM = [['P', 'pequeno'], ['M', 'médio'], ['A', 'alto'], ['G', 'grande']];
  O.editar = {
    abrir: () => {
      const S = O.S;
      O.editar.st = { espacos: JSON.parse(JSON.stringify(S.espacos.map(e => ({ id: e.id, nome: e.nome, modulos: e.modulos })))), atual: S.espacoAtual, drag: null };
      O.irPara('editar');
      O.editar.render();
    },
    render: () => {
      const st = O.editar.st, e = st.espacos.find(x => x.id === st.atual);
      const box = O.$('#editar');
      const usados = new Set(e.modulos.map(O.chaveModulo));
      const appsEspaco = (O.S.espacos.find(x => x.id === e.id) || { apps: [] }).apps.filter(id => O.S.apps[id]);
      const catalogo = Object.entries(O.CATALOGO).concat(appsEspaco.map(id => [id, { nome: O.S.apps[id].nome, desc: O.S.apps[id].tipo === 'mac' ? 'App do Mac' : 'App web', mark: O.S.apps[id].nome[0], def: 'M', app: id }]));
      box.innerHTML = `
        <header>
          <div style="display:flex;align-items:center;gap:20px"><div class="logo" style="font-size:16px">OLIMPO</div><span class="pilula" style="background:rgba(124,200,245,.18);color:#b6e2fb;border:0;font-size:13px;padding:6px 12px">A editar</span></div>
          <nav class="segm" aria-label="Espaços">${st.espacos.map(x => `<button aria-pressed="${x.id === e.id}" data-esp="${esc(x.id)}">${esc(x.nome)}</button>`).join('')}
            <button data-novo-esp aria-label="Criar novo espaço" style="border:1px dashed rgba(255,255,255,.3);width:42px;padding:0">+</button></nav>
          <div style="display:flex;gap:10px"><button class="btn" data-cancelar style="padding:12px 18px;border-radius:14px;font-size:14px">Cancelar</button><button class="btn prim" data-ok style="padding:12px 20px;border-radius:14px;font-size:14px">Concluído</button></div>
        </header>
        <div class="editar-corpo">
          <main class="ed-grelha" aria-label="Módulos do espaço ${esc(e.nome)}">
            <div style="display:flex;align-items:center;gap:10px;margin:0 0 14px 4px"><span style="font-size:13px;color:var(--t2)">Nome do espaço</span>
              <input data-nome value="${esc(e.nome)}" style="background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.25);outline:none;color:#fff;font:500 15px var(--corpo);padding:4px 2px;width:200px">
              ${st.espacos.length > 1 ? '<button class="btn peq fantasma" data-apagar-esp style="margin-left:auto">Apagar este espaço</button>' : ''}</div>
            <div class="modulos" style="grid-auto-rows:150px">${e.modulos.map((m, i) => modEd(m, i)).join('') || '<div class="vazio" style="grid-column:1/-1">Toca num módulo à direita para o pôr aqui.</div>'}</div>
          </main>
          <aside class="catalogo vidro"><div><h2>Módulos</h2><p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.7)">Toca para pôr ou tirar deste espaço. Máximo 4–5 por espaço: na dúvida, simplificar.</p></div>
            <div class="cat-lista">${catalogo.map(([k, c]) => `<button class="cat" data-cat="${esc(k)}" aria-pressed="${usados.has(k)}" ${c.breve ? 'disabled' : ''}>
              <span class="mk">${esc(c.mark)}</span><span class="tx"><b>${esc(c.nome)}</b><small>${esc(c.breve ? 'Em breve' : c.desc)}</small></span><span aria-hidden="true" style="font-size:18px;color:${usados.has(k) ? '#7cc8f5' : 'rgba(255,255,255,.7)'}">${usados.has(k) ? '✓' : c.breve ? '' : '+'}</span></button>`).join('')}</div></aside>
        </div>
        <div style="display:flex;justify-content:center;gap:28px;font-size:13px;color:rgba(255,255,255,.72)"><span>Arrasta um módulo para o mudar de sítio</span><span aria-hidden="true">·</span><span>P · M · A · G muda o tamanho</span><span aria-hidden="true">·</span><span>× tira-o do espaço</span></div>`;
      ligarEd(box, e, catalogo);
    }
  };
  function modEd(m, i) {
    const k = O.chaveModulo(m);
    const c = O.CATALOGO[k] || (O.S.apps[k] ? { nome: O.S.apps[k].nome, mark: O.S.apps[k].nome[0], desc: '' } : { nome: k, mark: '?' });
    const t = m.tamanho || c.def || 'M';
    const so = c.tamanhos && c.tamanhos.length === 1;
    return `<div class="mod" data-t="${t}" style="${t === 'L' ? 'grid-row:span 1' : ''}"><div class="ed-mod" draggable="true" data-i="${i}">
      <div class="top"><span class="marca" aria-hidden="true">${esc(c.mark)}</span><span class="nm">${esc(c.nome)}</span>
        ${so ? '' : `<button class="ed-x" data-tam="${i}" aria-label="Tamanho ${(TAM.find(x => x[0] === t) || ['', ''])[1]} — mudar">${t}</button>`}
        <button class="ed-x" data-tirar="${i}" aria-label="Tirar ${esc(c.nome)} do espaço">${O.ic.x({ s: 12 })}</button></div>
      <div style="flex:1;display:flex;align-items:flex-end;font-size:13px;color:var(--t2)">${esc(c.desc || '')}</div></div></div>`;
  }
  function ligarEd(box, e, catalogo) {
    const st = O.editar.st;
    box.onclick = async ev => {
      const t = ev.target;
      const esp = t.closest('[data-esp]'); if (esp) { st.atual = esp.dataset.esp; O.editar.render(); return; }
      if (t.closest('[data-novo-esp]')) { const id = 'e' + Date.now().toString(36); st.espacos.push({ id, nome: 'Espaço ' + (st.espacos.length + 1), modulos: [{ uid: id + '1', tipo: 'continuar', tamanho: 'L' }] }); st.atual = id; O.editar.render(); setTimeout(() => O.$('[data-nome]').select(), 30); return; }
      if (t.closest('[data-cancelar]')) { O.irPara('casa'); return; }
      if (t.closest('[data-ok]')) { await O.api.call('espacos:guardar', st.espacos); O.irPara('casa'); return; }
      if (t.closest('[data-apagar-esp]')) {
        if (!await O.confirmar({ titulo: `Apagar o espaço “${e.nome}”?`, texto: 'Só sai a disposição deste espaço. Apps, projetos e ficheiros não são apagados.', ok: 'Apagar espaço' })) return;
        st.espacos = st.espacos.filter(x => x.id !== e.id); st.atual = st.espacos[0].id; O.editar.render(); return;
      }
      const tam = t.closest('[data-tam]');
      if (tam) { const m = e.modulos[+tam.dataset.tam]; const ord = ['P', 'M', 'A', 'G']; m.tamanho = ord[(ord.indexOf(m.tamanho) + 1) % 4]; O.editar.render(); return; }
      const tirar = t.closest('[data-tirar]');
      if (tirar) { e.modulos.splice(+tirar.dataset.tirar, 1); O.editar.render(); return; }
      const cat = t.closest('[data-cat]');
      if (cat && !cat.disabled) {
        const k = cat.dataset.cat;
        const i = e.modulos.findIndex(m => O.chaveModulo(m) === k);
        if (i >= 0) e.modulos.splice(i, 1);
        else {
          const c = (catalogo.find(x => x[0] === k) || [])[1] || {};
          const m = { uid: 'm' + Date.now().toString(36), tamanho: c.def || 'M' };
          if (c.app) { m.tipo = 'app'; m.app = c.app; if (c.app === 'apolo') m.mostrarProjetos = true; } else m.tipo = k;
          if (k === 'continuar') e.modulos.unshift(m); else e.modulos.push(m);
        }
        O.editar.render();
      }
    };
    O.$('[data-nome]', box).oninput = ev => { e.nome = ev.target.value.trim() || e.nome; O.$$('[data-esp]', box).forEach(b => { if (b.dataset.esp === e.id) b.textContent = ev.target.value; }); };
    // arrastar para reordenar
    box.addEventListener('dragstart', ev => { const m = ev.target.closest('.ed-mod'); if (!m) return; st.drag = +m.dataset.i; m.classList.add('arrastar'); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(st.drag)); });
    box.addEventListener('dragend', () => { O.$$('.ed-mod', box).forEach(x => x.classList.remove('arrastar', 'alvo')); });
    box.addEventListener('dragover', ev => { const m = ev.target.closest('.ed-mod'); if (!m) return; ev.preventDefault(); O.$$('.ed-mod', box).forEach(x => x.classList.toggle('alvo', x === m)); });
    box.addEventListener('drop', ev => {
      const m = ev.target.closest('.ed-mod'); if (!m || st.drag == null) return;
      ev.preventDefault();
      const to = +m.dataset.i;
      const [it] = e.modulos.splice(st.drag, 1); e.modulos.splice(to, 0, it);
      st.drag = null; O.editar.render();
    });
  }
})();

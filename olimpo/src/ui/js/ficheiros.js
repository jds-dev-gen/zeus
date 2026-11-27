'use strict';
/* Ficheiros (FicheirosV2.dc.html): Encontrar (pesquisa, filtros, recentes, projetos, Entrada) e Espaço. */
(() => {
  const O = window.O, esc = O.esc;
  const F = O.fich = { tab: 'encontrar', q: '', chip: null, pasta: null, entrada: false, caminho: [], sel: null, pend: null, feitas: {}, espaco: null };
  const COR = { video: 'var(--c-video)', audio: 'var(--c-audio)', apps: 'var(--c-apps)', doc: 'var(--c-doc)', img: 'var(--c-img)', outros: 'var(--c-outros)' };
  const HEX = { video: '#4fa9dc', audio: '#8c82e6', apps: '#7a8194', doc: '#46b48c', img: '#d98fb0', outros: '#c7a35a', acento: '#7cc8f5' };
  const CHIPS = [['doc', 'Documentos'], ['img', 'Imagens'], ['audio', 'Áudio'], ['video', 'Vídeo'], ['hoje', 'Hoje'], ['grandes', 'Grandes (+1 GB)']];

  O.abrirFicheiros = (opts = {}, deEl) => {
    if (opts.pasta) { F.tab = 'encontrar'; F.pasta = opts.pasta; F.entrada = false; F.q = ''; F.chip = null; }
    if (opts.entrada) { F.tab = 'encontrar'; F.entrada = true; F.pasta = null; }
    if (opts.tab) F.tab = opts.tab;
    O.painel = null;
    O.irPara('ficheiros');
    render(deEl);
    O.informarPainel();
  };

  function render(deEl) {
    const root = O.$('#ficheiros');
    root.innerHTML = `<section class="fich" aria-label="Ficheiros">
      <header>
        <div style="display:flex;align-items:center;gap:12px;width:300px">${O.ic.pasta({ s: 24, c: '#7cc8f5' })}<h1>Ficheiros</h1></div>
        <div class="segm" role="tablist" aria-label="Vista">
          <button role="tab" aria-selected="${F.tab === 'encontrar'}" data-tab="encontrar" style="padding:10px 22px">Encontrar</button>
          <button role="tab" aria-selected="${F.tab === 'espaco'}" data-tab="espaco" style="padding:10px 22px">Espaço</button>
        </div>
        <button class="livre-btn ol-h" data-tab="espaco" aria-label="Ver espaço em disco">
          <span style="text-align:right;line-height:1.25"><span style="display:block;font-size:15px;font-weight:500" id="f-livre">… GB livres</span><span style="display:block;font-size:12px;color:rgba(255,255,255,.7)" id="f-total"></span></span>
          <span class="anel" id="f-anel" aria-hidden="true"><i></i></span>
        </button>
      </header>
      <div id="f-corpo" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
    </section>`;
    if (deEl) { const s = O.$('.fich', root); s.classList.add('painel', 'abrir'); s.addEventListener('animationend', () => s.classList.remove('painel', 'abrir'), { once: true }); }
    O.$$('[data-tab]', root).forEach(b => b.onclick = () => { F.tab = b.dataset.tab; render(); });
    disco();
    if (F.tab === 'encontrar') encontrar(); else espaco();
  }
  O.renderFicheiros = () => { if (O.vista === 'ficheiros') render(); };

  async function disco() {
    const s = await O.api.call('space:state');
    F.espaco = s;
    const el = O.$('#f-livre'); if (!el) return;
    const used = s.disk.total - s.disk.livre, pct = Math.round(used / s.disk.total * 100);
    el.textContent = O.gb(s.disk.livre) + ' GB livres';
    O.$('#f-total').textContent = 'de ' + O.gb(s.disk.total) + ' GB';
    O.$('#f-anel').style.background = `conic-gradient(#7cc8f5 0 ${pct}%, rgba(255,255,255,.12) ${pct}% 100%)`;
    return s;
  }

  /* ---------- linha de ficheiro (reutilizada nos projetos e na Entrada) ---------- */
  O.linhaFicheiro = (f, { compacto = false, acoes = '' } = {}) =>
    `<div class="fl ${compacto ? 'compacto' : ''}" data-f="${esc(f.path)}" draggable="${f.kind !== 'pasta'}" tabindex="0">
      ${O.ext(f)}
      <span class="txt"><span class="n">${esc(f.nome)}</span><span class="w">${esc(f.onde || '')}</span></span>
      ${acoes ? `<span class="acts">${acoes}</span>` : ''}
      ${compacto ? '' : `<span class="tam">${f.size != null ? esc(O.bytes(f.size)) : ''}</span><span class="qd">${esc(O.quandoCurto(f.usado || f.mtime))}</span>`}
    </div>`;
  O.ligarFicheiros = (box, list, extra) => {
    const byP = new Map(list.map(f => [f.path, f]));
    box.addEventListener('click', ev => {
      const row = ev.target.closest('[data-f]'); if (!row) return;
      const act = ev.target.closest('[data-act]');
      const f = byP.get(row.dataset.f); if (!f) return;
      if (act) { ev.stopPropagation(); if (extra) extra(act.dataset.act, f, act); return; }
      if (f.kind === 'pasta') O.abrirFicheiros({ pasta: f.path }); else O.api.call('files:open', f.path);
    });
    box.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('[data-f]')) ev.target.click(); });
    box.addEventListener('contextmenu', ev => {
      const row = ev.target.closest('[data-f]'); if (!row) return;
      ev.preventDefault();
      const f = byP.get(row.dataset.f);
      O.menuFicheiro(row, f);
    });
    // arrastar para outras apps (Mail, WhatsApp, DaVinci…)
    box.addEventListener('dragstart', ev => {
      const row = ev.target.closest('[data-f]'); if (!row) return;
      ev.preventDefault();
      O.api.drag(row.dataset.f);
    });
  };
  O.menuFicheiro = (anchor, f) => {
    const projs = O.S.projetos;
    O.menu(anchor, [
      { label: 'Abrir', run: () => O.api.call('files:open', f.path) },
      { label: 'Mostrar no Finder', run: () => O.api.call('files:reveal', f.path) },
      ...(projs.length ? [{ label: 'Arrumar num projeto…', run: () => O.folhaArrumar(f) }] : []),
      '-',
      { label: 'Mover para o Lixo…', run: () => lixo([f]) }
    ]);
  };
  async function lixo(items) {
    const ok = await O.confirmar({ titulo: items.length === 1 ? `Mover “${items[0].nome}” para o Lixo?` : `Mover ${items.length} itens para o Lixo?`, texto: 'Ficam no Lixo e podes recuperá-los.', lista: items.map(i => ({ nome: i.nome, meta: i.size ? O.bytes(i.size) : '' })), ok: 'Mover para o Lixo' });
    if (!ok) return;
    const r = await O.api.call('files:trash', items.map(i => ({ path: i.path, size: i.size })));
    O.toast(r.erros.length ? 'Alguns itens não saíram: ' + r.erros[0] : `No Lixo — ${r.nota}.`);
    if (O.vista === 'ficheiros') render();
    if (O.painel && O.painel.tipo === 'projeto') O.projetoFicheiros();
  }
  O.lixo = lixo;

  /* ================================================================ */
  /* Encontrar                                                         */
  /* ================================================================ */
  function encontrar() {
    const box = O.$('#f-corpo');
    box.innerHTML = `<div class="encontrar ol-in">
      <label class="procura">${O.ic.lupa({ s: 22, c: '#7cc8f5', w: 1.8 })}
        <input id="f-q" type="text" aria-label="Procurar ficheiros" placeholder="Procura por nome, tipo ou escreve o que procuras — “o áudio da entrevista de ontem”" value="${esc(F.q)}" spellcheck="false" autocomplete="off"></label>
      <div class="chips">${CHIPS.map(([id, l]) => `<button class="chip ol-h" aria-pressed="${F.chip === id}" data-chip="${id}">${esc(l)}</button>`).join('')}</div>
      <div id="f-res"></div>
    </div>`;
    const q = O.$('#f-q');
    q.oninput = O.debounce(() => { F.q = q.value.trim(); if (F.q) { F.pasta = null; F.entrada = false; } resultados(); }, 160);
    q.onkeydown = ev => { if (ev.key === 'Escape') { if (q.value) { q.value = ''; F.q = ''; resultados(); } else O.irPara('casa'); } };
    O.$$('[data-chip]', box).forEach(b => b.onclick = () => { F.chip = F.chip === b.dataset.chip ? null : b.dataset.chip; F.pasta = null; F.entrada = false; O.$$('[data-chip]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.chip === F.chip))); resultados(); });
    resultados();
    if (!F.pasta && !F.entrada) setTimeout(() => q.focus(), 50);
  }

  let pedido = 0;
  async function resultados() {
    const box = O.$('#f-res'); if (!box) return;
    const n = ++pedido;
    if (F.entrada) return entradaVista(box);
    if (F.pasta) return pastaVista(box);
    if (F.q || F.chip) {
      box.innerHTML = '<div class="vazio">A procurar…</div>';
      const opts = { q: F.q, limit: 60 };
      if (['doc', 'img', 'audio', 'video'].includes(F.chip)) opts.kind = F.chip;
      if (F.chip === 'hoje') opts.hoje = true;
      if (F.chip === 'grandes') opts.grandes = true;
      const l = await O.api.call('files:search', opts);
      if (n !== pedido) return;
      box.innerHTML = `<div class="rotulo2" style="margin-bottom:6px">${l.length} ${l.length === 1 ? 'resultado' : 'resultados'}</div>
        <div id="f-lista">${l.map(f => O.linhaFicheiro(f)).join('')}</div>
        ${!l.length || F.q ? `<button class="btn fantasma" id="f-claude" style="margin-top:8px;text-align:left"><span style="color:#7cc8f5">✦ </span>${l.length ? 'Não é nenhum destes? Pedir ao Claude para procurar pelo conteúdo' : 'Nada com esse nome. Pedir ao Claude para procurar pelo conteúdo?'}</button>` : ''}`;
      O.ligarFicheiros(O.$('#f-lista'), l);
      O.preencherMiniaturas(box);
      const c = O.$('#f-claude'); if (c) c.onclick = () => { O.irPara('casa'); O.casa.perguntar(`Procura nos meus ficheiros: ${F.q || CHIPS.find(x => x[0] === F.chip)[1]}`); };
      return;
    }
    // início: recentes, projetos, Entrada
    box.innerHTML = `<div style="display:flex;flex-direction:column;gap:22px">
      <div><div class="rotulo2" style="margin-bottom:12px">Recentes</div><div class="grelha4" id="f-recentes">${'<div class="recente" style="opacity:.3"></div>'.repeat(4)}</div></div>
      <div><div class="rotulo2" style="margin-bottom:12px">Projetos</div><div class="grelha4" id="f-projetos"></div></div>
      <button class="entrada-b ol-h" id="f-entrada"><span style="font:400 26px var(--display);color:#7cc8f5" id="f-entrada-n">·</span>
        <span style="flex:1"><span style="display:block;font-size:15px;font-weight:500">Na Entrada</span><span style="display:block;font-size:13px;color:rgba(255,255,255,.72)">Ficheiros novos à espera de serem arrumados num projeto</span></span>
        <span style="font-size:14px;color:#b6e2fb">Arrumar →</span></button>
      <div><div class="rotulo2" style="margin-bottom:12px">Pastas</div><div class="chips" id="f-pastas"></div></div>
    </div>`;
    O.$('#f-entrada').onclick = () => { F.entrada = true; resultados(); };
    projetosCartoes();
    O.api.call('files:entrada').then(l => { const el = O.$('#f-entrada-n'); if (el) el.textContent = l.length; });
    const pastas = [['Secretária', '~/Desktop'], ['Documentos', '~/Documents'], ['Transferências', '~/Downloads'], ['Imagens', '~/Pictures'], ['Vídeos', O.plataforma === 'darwin' ? '~/Movies' : '~/Videos'], ['Música', '~/Music'], ['Projetos', O.S.ficheiros.pastaProjetos]];
    O.$('#f-pastas').innerHTML = pastas.map(([n, p]) => `<button class="chip ol-h" data-pasta="${esc(p)}">${esc(n)}</button>`).join('');
    O.$$('#f-pastas [data-pasta]').forEach(b => b.onclick = () => { F.pasta = b.dataset.pasta; resultados(); });
    const rec = await O.api.call('files:recent', { limit: 4 });
    if (n !== pedido) return;
    const rb = O.$('#f-recentes');
    rb.innerHTML = rec.length ? rec.map(f => `<button class="recente ol-h" data-f="${esc(f.path)}">${O.ext(f)}<span><span class="n">${esc(f.nome)}</span><span class="w">${esc(O.quando(f.usado || f.mtime))}</span></span></button>`).join('') : '<div class="vazio">Ainda sem ficheiros recentes.</div>';
    rb.onclick = ev => { const b = ev.target.closest('[data-f]'); if (b) O.api.call('files:open', b.dataset.f); };
    rb.oncontextmenu = ev => { const b = ev.target.closest('[data-f]'); if (!b) return; ev.preventDefault(); const f = rec.find(x => x.path === b.dataset.f); O.menuFicheiro(b, f); };
    O.preencherMiniaturas(rb);
  }

  function projetosCartoes() {
    const box = O.$('#f-projetos'); if (!box) return;
    const cores = [HEX.audio, HEX.doc, HEX.acento, HEX.outros, HEX.img, HEX.video];
    const S = O.S;
    const nodeSize = p => {
      const s = F.espaco; if (!s || !s.roots) return null;
      const abs = p.replace(/^~/, O.home || '');
      const find = n => { if (n.path === abs) return n; for (const c of n.children || []) if (abs === c.path || abs.startsWith(c.path + '/')) { const f = find(c); if (f) return f; } return null; };
      for (const r of s.roots) { const f = find(r); if (f) return f; }
      return null;
    };
    box.innerHTML = S.projetos.map((p, i) => {
      const nd = nodeSize(p.pasta);
      const meta = nd ? `${O.bytes(nd.size)} · ${nd.n.toLocaleString('pt-PT')} ficheiros` : (S.espacos.find(e => e.id === p.espaco) || {}).nome || '';
      return `<button class="projeto-c ol-h" data-projeto="${esc(p.id)}"><span class="n"><span class="cor" style="background:${cores[i % cores.length]}"></span><span>${esc(p.nome)}</span></span><span class="m">${esc(meta)}</span></button>`;
    }).join('') + `<button class="projeto-c ol-h" data-novo-proj style="border-style:dashed;justify-content:center;align-items:center;color:var(--t2)">+ Novo projeto</button>`;
    box.onclick = ev => {
      const b = ev.target.closest('[data-projeto]'); if (b) { O.abrirProjeto(b.dataset.projeto, b); return; }
      if (ev.target.closest('[data-novo-proj]')) O.folhaProjeto();
    };
  }

  async function pastaVista(box) {
    const p = F.pasta;
    const partes = p.split('/').filter(Boolean);
    const acum = [];
    const mig = partes.map((x, i) => { acum.push(x); const caminho = (p.startsWith('/') ? '/' : '') + acum.join('/'); return `<button data-ir="${esc(caminho)}">${esc(x === '~' ? 'Início' : x)}</button>${i < partes.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`; }).join('');
    box.innerHTML = `<div class="migalhas" style="margin-bottom:10px"><button data-voltar>${O.ic.esq({ s: 14 })} Voltar</button><span aria-hidden="true">·</span>${mig}
      <span style="flex:1"></span><button data-finder>Mostrar no Finder</button></div><div id="f-lista"><div class="vazio">A carregar…</div></div>`;
    O.$('[data-voltar]', box).onclick = () => { F.pasta = null; resultados(); };
    O.$('[data-finder]', box).onclick = () => O.api.call('files:reveal', p);
    O.$$('[data-ir]', box).forEach(b => b.onclick = () => { F.pasta = b.dataset.ir; resultados(); });
    const l = await O.api.call('files:list', p);
    const lb = O.$('#f-lista'); if (!lb) return;
    lb.innerHTML = l.length ? l.map(f => O.linhaFicheiro(f)).join('') : '<div class="vazio">Pasta vazia.</div>';
    O.ligarFicheiros(lb, l);
    O.preencherMiniaturas(lb);
  }

  /* ---------- Entrada: arrumar por projeto ---------- */
  async function entradaVista(box) {
    const l = await O.api.call('files:entrada');
    const projs = O.S.projetos;
    const sel = `<select class="btn peq" data-arrumar aria-label="Arrumar num projeto"><option value="">→ projeto…</option>${projs.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('')}</select>`;
    box.innerHTML = `<div class="migalhas" style="margin-bottom:10px"><button data-voltar>${O.ic.esq({ s: 14 })} Voltar</button><span aria-hidden="true">·</span><span>Entrada</span>
        <span style="flex:1"></span>${l.length && projs.length ? '<button class="btn peq" data-claude-arrumar><span style="color:#7cc8f5">✦</span> Arrumar com o Claude</button>' : ''}</div>
      <p style="margin:0 0 12px;color:var(--t2);font-size:13px">Ficheiros novos das últimas ${O.S.ficheiros.entradaDias} dias em ${esc(O.S.ficheiros.entrada.join(', '))}. Arruma cada um num projeto, ou deixa-o ficar onde está.</p>
      <div id="f-lista">${l.length ? l.map(f => O.linhaFicheiro(f, { acoes: (projs.length ? sel : '') + `<button class="btn peq" data-act="ficar" title="Tirar da Entrada sem mexer no ficheiro">Deixar ficar</button><button class="btn peq" data-act="lixo" aria-label="Mover para o Lixo">${O.ic.lixo({ s: 14 })}</button>` })).join('')
        : '<div class="vazio">Está tudo arrumado.</div>'}</div>
      ${!projs.length && l.length ? '<p class="vazio">Cria um projeto para poderes arrumar os ficheiros nele.</p>' : ''}`;
    O.$('[data-voltar]', box).onclick = () => { F.entrada = false; resultados(); };
    const c = O.$('[data-claude-arrumar]', box);
    if (c) c.onclick = () => { O.irPara('casa'); O.casa.perguntar('Arruma a minha Entrada por projeto: vê os ficheiros da Entrada e os projetos, e propõe para onde mover cada ficheiro que encaixe claramente num projeto.'); };
    const lb = O.$('#f-lista');
    O.ligarFicheiros(lb, l, async (act, f) => {
      if (act === 'ficar') { await O.api.call('files:dispensar', f.path); resultados(); }
      if (act === 'lixo') lixo([f]);
    });
    lb.addEventListener('change', async ev => {
      const s = ev.target.closest('[data-arrumar]'); if (!s || !s.value) return;
      const row = s.closest('[data-f]');
      const pr = projs.find(p => p.id === s.value);
      try { await O.api.call('files:arrumar', row.dataset.f, s.value); O.toast(`Arrumado em ${pr.nome}.`); resultados(); }
      catch (e) { O.toast('Não consegui mover: ' + e.message); }
    });
    lb.addEventListener('click', ev => { if (ev.target.closest('select')) ev.stopPropagation(); }, true);
    O.preencherMiniaturas(lb);
  }

  O.folhaArrumar = f => {
    const projs = O.S.projetos;
    const el = O.folha(`<div class="cab"><div><h1 style="font-size:22px">Arrumar “${esc(f.nome)}”</h1><p class="desc">Vai para a pasta do projeto.</p></div><button class="fechar" data-fechar aria-label="Fechar">${O.ic.x({ s: 16, w: 1.8 })}</button></div>
      <div style="display:grid;gap:8px">${projs.map(p => `<button class="cat" data-p="${esc(p.id)}"><span class="mk">${esc(p.nome[0])}</span><span class="tx"><b>${esc(p.nome)}</b><small>${esc(p.pasta)}</small></span></button>`).join('')}</div>`, { classe: 'estreita' });
    el.onclick = async ev => {
      const b = ev.target.closest('[data-p]'); if (!b) return;
      try { await O.api.call('files:arrumar', f.path, b.dataset.p); O.fecharFolha(); O.toast('Arrumado.'); O.renderFicheiros(); }
      catch (e) { O.toast('Não consegui mover: ' + e.message); }
    };
  };

  /* ================================================================ */
  /* Espaço                                                            */
  /* ================================================================ */
  async function espaco() {
    const box = O.$('#f-corpo');
    const s = F.espaco || await O.api.call('space:state');
    F.espaco = s;
    const used = s.disk.total - s.disk.livre;
    const freed = Object.values(F.feitas).reduce((t, x) => t + x, 0);
    let cats = [];
    if (s.byKind) {
      const k = s.byKind;
      const known = k.video + k.audio + k.apps + k.doc + k.img;
      cats = [['video', 'Vídeo', k.video], ['apps', 'Apps', k.apps], ['outros', 'Sistema e outros', Math.max(0, used - known)], ['audio', 'Áudio', k.audio], ['doc', 'Documentos', k.doc], ['img', 'Imagens', k.img]];
    }
    box.innerHTML = `<div class="espaco ol-in">
      <div class="esq">
        <div>
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
            <div><span class="ocupado">${O.gb(used)} GB</span><span style="font-size:15px;color:rgba(255,255,255,.72)"> ocupados de ${O.gb(s.disk.total)} GB</span></div>
            <div style="font-size:14px;color:rgba(255,255,255,.75)">${freed ? O.bytes(freed) + ' libertados agora' : O.gb(s.disk.livre) + ' GB livres'}</div>
          </div>
          <div class="barra-tipos" aria-hidden="true">${cats.length ? cats.map(([id, , b]) => `<i style="width:${(b / s.disk.total * 100).toFixed(2)}%;background:${COR[id]}"></i>`).join('') : `<i style="width:${(used / s.disk.total * 100).toFixed(1)}%;background:#7cc8f5"></i>`}</div>
          <div class="legenda">${cats.map(([id, n, b]) => `<span><b style="background:${COR[id]}"></b>${esc(n)} · ${O.gb(b)} GB</span>`).join('')}</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div class="rotulo2">Onde está o espaço <span style="letter-spacing:0;text-transform:none;color:rgba(255,255,255,.6)"> · quanto maior o bloco, mais ocupa</span></div>
          <div style="display:flex;gap:8px;align-items:center">${s.scannedAt ? `<span style="font-size:12px;color:var(--t3)">Visto ${esc(O.quando(s.scannedAt).toLowerCase())}</span>` : ''}<button class="btn peq" data-scan ${s.progress ? 'disabled' : ''}>${s.progress ? 'A ver…' : s.scannedAt ? 'Atualizar' : 'Ver agora'}</button></div>
        </div>
        ${F.caminho.length ? `<div class="migalhas" style="margin-top:-8px"><button data-sobe="-1">Tudo</button>${F.caminho.map((n, i) => `<span aria-hidden="true">›</span><button data-sobe="${i}">${esc(n.nome)}</button>`).join('')}</div>` : ''}
        ${s.progress ? `<div><div class="progresso"><i></i></div><div style="font-size:12px;color:var(--t3);margin-top:6px">${s.progress.files ? s.progress.files.toLocaleString('pt-PT') + ' ficheiros · ' + O.bytes(s.progress.bytes) : 'A começar…'} — em segundo plano, podes continuar a usar o Olimpo.</div></div>` : ''}
        <div class="mapa" id="mapa">${s.roots ? '' : `<div class="vazio" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center">${s.progress ? 'A ver o que ocupa espaço…' : 'Ainda não vi o que ocupa espaço. Carrega em “Ver agora” — demora alguns minutos e corre em segundo plano.'}</div>`}</div>
      </div>
      <aside aria-label="Arrumar">
        <div class="caixa" id="selecionado"></div>
        <div class="rotulo2" style="margin-top:4px">Sugestões para libertar espaço</div>
        <div id="sugestoes" style="display:flex;flex-direction:column;gap:10px">${s.suggestions.length ? '' : `<div class="vazio">${s.roots ? 'Nada de óbvio para tirar. Bom sinal.' : 'Aparecem depois de ver o espaço.'}</div>`}</div>
      </aside>
    </div>`;
    O.$('[data-scan]', box).onclick = async () => { await O.api.call('space:scan'); F.espaco = null; espaco(); };
    O.$$('[data-sobe]', box).forEach(b => b.onclick = () => { const i = +b.dataset.sobe; F.caminho = F.caminho.slice(0, i + 1); F.sel = null; espaco(); });
    mapa(s, used);
    sugestoes(s);
  }

  function corDe(n, i) {
    const nm = n.nome.toLowerCase();
    if (/v[ií]deo|movies|davinci|cache/.test(nm)) return HEX.video;
    if (/m[uú]sica|music|podcast|[aá]udio/.test(nm)) return HEX.audio;
    if (/aplica|applications|biblioteca|library/.test(nm)) return HEX.apps;
    if (/document/.test(nm)) return HEX.doc;
    if (/imagens|pictures|fotos|photos/.test(nm)) return HEX.img;
    return [HEX.outros, HEX.acento, HEX.doc, HEX.audio, HEX.img, HEX.video][i % 6];
  }

  function nivelAtual(s, used) {
    if (!F.caminho.length) {
      const items = (s.roots || []).slice();
      const soma = items.reduce((t, r) => t + r.size, 0);
      if (used - soma > 1e9) items.push({ nome: 'Sistema e outros', path: '', size: used - soma, sistema: true });
      return items;
    }
    const n = F.caminho[F.caminho.length - 1];
    return (n.children || []).filter(c => c.size > 0);
  }

  function mapa(s, used) {
    const box = O.$('#mapa'); if (!box || !s.roots) return;
    const W = box.clientWidth, H = box.clientHeight;
    const items = nivelAtual(s, used);
    const tiles = O.squarify(items.map((it, i) => Object.assign({}, it, { i })), W, H);
    if (!F.sel && tiles.length) { const t0 = tiles.find(t => !t.sistema) || tiles[0]; F.sel = t0.path || t0.nome; }
    box.innerHTML = tiles.map(t => {
      const c = corDe(t, t.i);
      const on = (t.path || t.nome) === F.sel;
      const area = t.w * t.h, mini = t.w < 90 || t.h < 54;
      return `<button class="bloco ${mini ? 'mini' : ''}" data-k="${esc(t.path || t.nome)}" data-i="${t.i}" aria-pressed="${on}" aria-label="${esc(t.nome)}, ${esc(O.bytes(t.size))}" title="${esc(t.nome)} · ${esc(O.bytes(t.size))}"
        style="left:${t.x + 3}px;top:${t.y + 3}px;width:${Math.max(0, t.w - 6)}px;height:${Math.max(0, t.h - 6)}px;background:linear-gradient(160deg, ${c}55, ${c}26)">
        <span class="n" style="font-size:${area > 60000 ? 18 : 14}px">${esc(t.nome)}</span><span class="g">${esc(O.bytes(t.size))}</span></button>`;
    }).join('');
    const byK = new Map(tiles.map(t => [t.path || t.nome, t]));
    box.onclick = ev => {
      const b = ev.target.closest('.bloco'); if (!b) return;
      const t = byK.get(b.dataset.k);
      if (F.sel === b.dataset.k && t.children && t.children.length && !t.resto) { F.caminho.push(t); F.sel = null; espaco(); return; }
      F.sel = b.dataset.k;
      O.$$('.bloco', box).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.k === F.sel)));
      selecionado(t, s);
    };
    box.ondblclick = ev => {
      const b = ev.target.closest('.bloco'); if (!b) return;
      const t = byK.get(b.dataset.k);
      if (t.children && t.children.length && !t.resto) { F.caminho.push(t); F.sel = null; espaco(); }
      else if (t.mais) entrarMais(t);
    };
    selecionado(byK.get(F.sel) || tiles[0], s);
  }

  /* nível mais fundo do que veio na primeira resposta: pede-o ao processo principal */
  async function entrarMais(t) {
    const n = await O.api.call('space:node', t.path);
    if (n && n.children) { F.caminho.push(n); F.sel = null; espaco(); }
  }

  function selecionado(t, s) {
    const box = O.$('#selecionado'); if (!box || !t) return;
    const pct = (t.size / s.disk.total * 100);
    const temFilhos = (t.children && t.children.length) || t.mais;
    box.innerHTML = `<div class="rotulo2">Selecionado</div>
      <div style="font:500 22px var(--display);margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.nome)}</div>
      <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:4px">${esc(O.bytes(t.size))} · ${pct < 1 ? '<1' : pct.toFixed(0)}% do disco${t.n ? ' · ' + t.n.toLocaleString('pt-PT') + ' ficheiros' : ''}${t.sistema ? ' · macOS, apps do sistema e ficheiros a que o Olimpo não tem acesso' : ''}</div>
      ${t.sistema ? '' : `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        ${temFilhos && !t.resto ? '<button class="btn peq" style="flex:1" data-sel="entrar">Ver por dentro</button>' : ''}
        <button class="btn peq" style="flex:1" data-sel="pasta">Abrir pasta</button>
        <button class="btn peq" style="flex:1" data-sel="maiores">Maiores ficheiros</button></div>`}`;
    box.onclick = async ev => {
      const b = ev.target.closest('[data-sel]'); if (!b) return;
      if (b.dataset.sel === 'entrar') { if (t.children && t.children.length) { F.caminho.push(t); F.sel = null; espaco(); } else entrarMais(t); }
      if (b.dataset.sel === 'pasta') { F.tab = 'encontrar'; F.pasta = t.path; render(); }
      if (b.dataset.sel === 'maiores') maiores(t);
    };
  }

  async function maiores(t) {
    const l = await O.api.call('space:biggest', t.path);
    const f = O.folha(`<div class="cab"><div><h1 style="font-size:22px">Maiores ficheiros em ${esc(t.nome)}</h1><p class="desc">Ficheiros com mais de 100 MB. Escolhe os que queres mandar para o Lixo.</p></div><button class="fechar" data-fechar aria-label="Fechar">${O.ic.x({ s: 16, w: 1.8 })}</button></div>
      <div style="flex:1;min-height:0;overflow:auto" id="m-lista">${l.length ? l.map((x, i) => `<label class="fl compacto" style="cursor:default"><input type="checkbox" data-i="${i}"><span class="txt"><span class="n">${esc(x.nome)}</span><span class="w">${esc(x.onde)} · aberto ${esc(O.quando(x.usado).toLowerCase())}</span></span><span class="tam">${esc(O.bytes(x.size))}</span></label>`).join('') : '<div class="vazio">Nenhum ficheiro com mais de 100 MB aqui.</div>'}</div>
      <div class="rodape-f"><button class="btn" data-finder>Mostrar a pasta no Finder</button><button class="btn prim" data-lixo disabled>Mover para o Lixo</button></div>`, { classe: 'alta' });
    const btn = O.$('[data-lixo]', f);
    f.addEventListener('change', () => { const n = O.$$('input:checked', f).length; btn.disabled = !n; btn.textContent = n ? `Mover ${n} para o Lixo` : 'Mover para o Lixo'; });
    O.$('[data-finder]', f).onclick = () => O.api.call('files:reveal', t.path);
    btn.onclick = () => { const its = O.$$('input:checked', f).map(c => l[+c.dataset.i]); O.fecharFolha(); lixo(its); };
  }

  /* ---------- sugestões: rever, confirmar, Lixo ---------- */
  function sugestoes(s) {
    const box = O.$('#sugestoes'); if (!box || !s.suggestions.length) return;
    box.innerHTML = s.suggestions.map(g => {
      const feita = F.feitas[g.id] != null, conf = F.pend === g.id && !feita;
      const txt = g.id === 'davinci' ? `Mover ${O.bytes(g.size)} de cache para o Lixo?` : g.id === 'duplicados' ? `Mover ${g.itens.length} cópias (${O.bytes(g.size)}) para o Lixo? Fica sempre um exemplar.` : `Mover ${O.bytes(g.size)} para o Lixo?`;
      return `<div class="sug ${feita ? 'feita' : conf ? 'confirmar' : ''}" data-sug="${esc(g.id)}">
        <div style="display:flex;align-items:flex-start;gap:12px"><div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:500">${esc(g.nome)}</div><div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:3px">${esc(g.porque)}</div></div>
          <div class="gb" style="color:${feita ? 'var(--ok)' : '#fff'}">${esc(O.bytes(feita ? F.feitas[g.id] : g.size))}</div></div>
        ${feita ? `<div style="margin-top:8px;font-size:12px;color:var(--ok)">✓ ${esc(O.bytes(F.feitas[g.id]))} ${esc(s.trashNote)}</div>`
          : conf ? `<div style="display:flex;align-items:center;gap:8px;margin-top:10px"><span style="flex:1;font-size:12px;color:var(--aviso)">${esc(txt)}</span><button class="btn peq fantasma" data-s="cancelar">Cancelar</button><button class="btn peq prim" data-s="ok">Confirmar</button></div>`
          : `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn peq" data-s="rever">Rever</button><button class="btn peq" data-s="pedir" style="border:0;background:rgba(255,255,255,.12)">${esc(g.acao)}</button></div>`}
      </div>`;
    }).join('');
    box.onclick = async ev => {
      const b = ev.target.closest('[data-s]'); if (!b) return;
      const g = s.suggestions.find(x => x.id === b.closest('[data-sug]').dataset.sug);
      const a = b.dataset.s;
      if (a === 'pedir') { F.pend = g.id; sugestoes(s); }
      else if (a === 'cancelar') { F.pend = null; sugestoes(s); }
      else if (a === 'ok') { F.pend = null; await libertar(g, g.itens, s); }
      else if (a === 'rever') rever(g, s);
    };
  }

  async function libertar(g, itens, s) {
    const r = await O.api.call('files:trash', itens.map(i => ({ path: i.path, size: i.size, conteudo: !!i.conteudo })));
    F.feitas[g.id] = (F.feitas[g.id] || 0) + r.bytes;
    if (r.erros.length) O.toast('Alguns itens não saíram: ' + r.erros[0]);
    s.trashNote = r.nota;
    F.espaco = Object.assign(await O.api.call('space:state'), {});
    // a sugestão fica marcada como feita, com o que saiu
    F.espaco.suggestions = s.suggestions;
    espaco();
  }

  function rever(g, s) {
    const f = O.folha(`<div class="cab"><div><h1 style="font-size:22px">${esc(g.nome)}</h1><p class="desc">${esc(g.porque)}. Tira o visto ao que queres manter. Tudo o que sair vai para o Lixo.</p></div><button class="fechar" data-fechar aria-label="Fechar">${O.ic.x({ s: 16, w: 1.8 })}</button></div>
      <div style="flex:1;min-height:0;overflow:auto">${g.itens.map((x, i) => `<label class="fl compacto" style="cursor:default"><input type="checkbox" data-i="${i}" checked>
        <span class="txt"><span class="n">${esc(x.nome)}</span><span class="w">${esc(x.onde)}${x.fica ? ' · fica: ' + esc(x.fica) : ''}${x.usado ? ' · aberto ' + esc(O.quando(x.usado).toLowerCase()) : ''}${x.conteudo ? ' · só o conteúdo da pasta' : ''}</span></span>
        <button class="btn peq" data-ver="${i}" type="button">Mostrar</button><span class="tam">${esc(O.bytes(x.size))}</span></label>`).join('')}</div>
      <div class="rodape-f"><span id="r-total" style="font-size:14px;color:var(--t2)"></span><div style="display:flex;gap:8px"><button class="btn" data-fechar>Cancelar</button><button class="btn prim" data-ok>Mover para o Lixo</button></div></div>`, { classe: 'alta' });
    const total = () => { const its = O.$$('input:checked', f).map(c => g.itens[+c.dataset.i]); O.$('#r-total').textContent = `${its.length} de ${g.itens.length} · ${O.bytes(its.reduce((t, i) => t + (i.size || 0), 0))}`; O.$('[data-ok]', f).disabled = !its.length; return its; };
    total();
    f.addEventListener('change', total);
    f.addEventListener('click', ev => { const v = ev.target.closest('[data-ver]'); if (v) { ev.preventDefault(); O.api.call('files:reveal', g.itens[+v.dataset.ver].path); } });
    O.$('[data-ok]', f).onclick = async () => { const its = total(); O.fecharFolha(); await libertar(g, its, s); };
  }

  O.aoEspaco = ev => {
    if (ev.type === 'progress' && F.espaco) F.espaco.progress = ev.progress;
    if (O.vista !== 'ficheiros') return;
    if (ev.type === 'done' || ev.type === 'error') { F.espaco = null; F.caminho = []; if (F.tab === 'espaco') espaco(); disco(); if (ev.type === 'error') O.toast('Não consegui ver o espaço: ' + ev.error); return; }
    if (F.tab === 'espaco' && ev.type === 'progress') {
      const p = O.$('.espaco .progresso'); if (!p) { espaco(); return; }
      const t = p.nextElementSibling; if (t) t.textContent = `${ev.progress.files.toLocaleString('pt-PT')} ficheiros · ${O.bytes(ev.progress.bytes)} — em segundo plano, podes continuar a usar o Olimpo.`;
    }
  };
  O.aoEntrada = () => { if (O.vista === 'ficheiros' && F.tab === 'encontrar' && (F.entrada || (!F.q && !F.chip && !F.pasta))) resultados(); };
})();

'use strict';
/* Utilidades comuns da interface do Olimpo. Tudo fica em window.O. */
window.O = window.O || {};
(() => {
  const O = window.O;
  O.api = window.olimpo;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  O.esc = esc;
  O.$ = (sel, root = document) => root.querySelector(sel);
  O.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* tamanhos: "1,2 GB", "84 KB" (como nos desenhos) */
  O.bytes = (n, casas) => {
    if (n == null) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = n;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    const d = casas != null ? casas : (v < 10 && i >= 2 ? 1 : 0);
    return v.toLocaleString('pt-PT', { maximumFractionDigits: d, minimumFractionDigits: 0 }) + ' ' + u[i];
  };
  O.gb = n => Math.round((n || 0) / 1e9);

  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const DIAS_C = ['Dom.', 'Seg.', 'Ter.', 'Qua.', 'Qui.', 'Sex.', 'Sáb.'];
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES_C = ['Jan.', 'Fev.', 'Mar.', 'Abr.', 'Mai.', 'Jun.', 'Jul.', 'Ago.', 'Set.', 'Out.', 'Nov.', 'Dez.'];
  const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  O.hora = (d = new Date()) => hm(d);
  O.data = (d = new Date()) => DIAS[d.getDay()] + ', ' + d.getDate() + ' ' + MESES[d.getMonth()];
  O.saudacao = (d = new Date()) => { const h = d.getHours(); return h < 6 ? 'Boa noite' : h < 13 ? 'Bom dia' : h < 20 ? 'Boa tarde' : 'Boa noite'; };
  /* "Há 10 min", "Hoje, 09:02", "Ontem" */
  O.quando = t => {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    const min = Math.round((now - d) / 60000);
    if (min < 1) return 'Agora';
    if (min < 60) return 'Há ' + min + ' min';
    const hoje = new Date(now); hoje.setHours(0, 0, 0, 0);
    if (d >= hoje && min < 180) return 'Há ' + Math.round(min / 60) + ' h';
    if (d >= hoje) return 'Hoje, ' + hm(d);
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    if (d >= ontem) return 'Ontem';
    if (now - d < 6 * 86400000) return DIAS_C[d.getDay()];
    if (d.getFullYear() === now.getFullYear()) return d.getDate() + ' ' + MESES_C[d.getMonth()].toLowerCase();
    return MESES_C[d.getMonth()] + ' ' + d.getFullYear();
  };
  /* para a coluna "quando" dos ficheiros: Hoje / Ontem / Seg. / Out. */
  O.quandoCurto = t => {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    const hoje = new Date(now); hoje.setHours(0, 0, 0, 0);
    if (d >= hoje) return 'Hoje';
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    if (d >= ontem) return 'Ontem';
    if (now - d < 6 * 86400000) return DIAS_C[d.getDay()];
    if (d.getFullYear() === now.getFullYear()) return MESES_C[d.getMonth()];
    return String(d.getFullYear());
  };

  /* ---------- ícones (traço 1,6, como nos desenhos) ---------- */
  const sv = (d, { s = 24, c = 'currentColor', w = 1.6, fill = 'none', extra = '' } = {}) =>
    `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="${fill}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  O.ic = {
    olimpo: (o) => sv('<path d="M3 9l9-5 9 5M5 9v9M9 9v9M15 9v9M19 9v9M3 21h18M3 18h18"/>', o),
    claude: (o) => sv('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', o),
    zeus: (o) => sv('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', o),
    apolo: (o) => sv('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', o),
    grelha: (o) => sv('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>', o),
    pasta: (o) => sv('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', o),
    lupa: (o) => sv('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', o),
    x: (o) => sv('<path d="M6 6l12 12M18 6L6 18"/>', Object.assign({ w: 2.4 }, o)),
    esq: (o) => sv('<path d="M15 6l-6 6 6 6"/>', Object.assign({ w: 2 }, o)),
    dir: (o) => sv('<path d="M9 6l6 6-6 6"/>', Object.assign({ w: 2 }, o)),
    recarregar: (o) => sv('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', Object.assign({ w: 1.8 }, o)),
    mais: (o) => sv('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>', o),
    externo: (o) => sv('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', o),
    ok: (o) => sv('<path d="M5 12l5 5 9-10"/>', Object.assign({ w: 3 }, o)),
    inteiro: (o) => sv('<rect x="3" y="4" width="18" height="16" rx="3"/>', o),
    lado: (o) => sv('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M14 4v16"/>', o),
    lixo: (o) => sv('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', o),
    finder: (o) => sv('<path d="M4 4h16v16H4z"/><path d="M12 4c-2 4-2 12 0 16M8 9v1M16 9v1M8 15c2.5 1.5 5.5 1.5 8 0"/>', o)
  };

  /* ---------- avisos e menus ---------- */
  let toastT = null;
  O.toast = (msg, ms = 3200) => {
    let el = O.$('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastT);
    toastT = setTimeout(() => el.remove(), ms);
  };

  O.menu = (anchor, items) => {
    O.fecharMenu();
    const m = document.createElement('div');
    m.className = 'menu'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button role="menuitem" data-i="${i}">${esc(it.label)}</button>`).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.min(window.innerWidth - w - 12, Math.max(12, r.right - w)) + 'px';
    m.style.top = (r.bottom + h + 8 > window.innerHeight ? r.top - h - 8 : r.bottom + 8) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    m.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const it = items[+b.dataset.i]; O.fecharMenu(); it.run(); });
    setTimeout(() => document.addEventListener('mousedown', O._menuOut = e => { if (!m.contains(e.target)) O.fecharMenu(); }), 0);
    O._menu = { m, anchor };
    O.web && O.web.sync();
    const first = m.querySelector('button'); if (first) first.focus();
  };
  O.fecharMenu = () => {
    if (!O._menu) return;
    O._menu.m.remove(); O._menu.anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', O._menuOut);
    O._menu = null;
    O.web && O.web.sync();
  };

  /* ---------- folha (janela por cima) ---------- */
  O.folha = (html, { classe = '', onClose } = {}) => {
    O.fecharFolha();
    const v = document.createElement('div');
    v.className = 'veu';
    v.innerHTML = `<section class="folha ${classe}" role="dialog" aria-modal="true">${html}</section>`;
    document.body.appendChild(v);
    v.addEventListener('mousedown', e => { if (e.target === v) O.fecharFolha(); });
    v.addEventListener('click', e => { if (e.target.closest('[data-fechar]')) O.fecharFolha(); });
    O._folha = { v, onClose };
    O.web && O.web.sync();
    setTimeout(() => { const f = v.querySelector('[autofocus], input, button.prim, button'); if (f) f.focus(); }, 30);
    return v.querySelector('.folha');
  };
  O.fecharFolha = () => {
    if (!O._folha) return;
    const { v, onClose } = O._folha;
    O._folha = null;
    v.remove();
    if (onClose) onClose();
    O.web && O.web.sync();
  };
  O.temFolha = () => !!O._folha;

  /* Confirmação: mostra sempre o que vai acontecer. Devolve uma Promise<boolean>. */
  O.confirmar = ({ titulo, texto = '', lista = [], ok = 'Confirmar', perigo = false }) => new Promise(res => {
    let done = false;
    const fim = v => { if (done) return; done = true; O.fecharFolha(); res(v); };
    const f = O.folha(`
      <div class="cab"><div><h1 style="font-size:22px">${esc(titulo)}</h1>${texto ? `<p class="desc">${esc(texto)}</p>` : ''}</div></div>
      ${lista.length ? `<div style="max-height:300px;overflow:auto;font-size:13px;display:grid;gap:4px">${lista.map(l => `<div style="display:flex;gap:10px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.nome)}</span><span style="color:var(--t3)">${esc(l.meta || '')}</span></div>`).join('')}</div>` : ''}
      <div class="rodape-f"><span></span><div style="display:flex;gap:8px"><button class="btn" data-n>Cancelar</button><button class="btn prim" data-s ${perigo ? 'style="background:#ffc57a"' : ''}>${esc(ok)}</button></div></div>`, { classe: 'estreita', onClose: () => fim(false) });
    f.querySelector('[data-n]').onclick = () => fim(false);
    f.querySelector('[data-s]').onclick = () => fim(true);
  });

  /* ---------- markdown mínimo (respostas do Claude) ---------- */
  O.md = src => {
    const lines = String(src || '').split('\n');
    let html = '', list = null, code = null;
    const inline = s => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>');
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      if (/^```/.test(raw)) { if (code != null) { html += `<pre><code>${esc(code)}</code></pre>`; code = null; } else { closeList(); code = ''; } continue; }
      if (code != null) { code += raw + '\n'; continue; }
      const line = raw.trimEnd();
      let m;
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
      closeList();
      if (!line.trim()) continue;
      if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { html += `<p><strong>${inline(m[1])}</strong></p>`; continue; }
      html += `<p>${inline(line)}</p>`;
    }
    if (code != null) html += `<pre><code>${esc(code)}</code></pre>`;
    closeList();
    return html;
  };

  /* marca de uma app: ícone do Mac (se houver) ou letra */
  const iconCache = new Map();
  O.icone = async caminho => {
    if (!caminho) return '';
    if (!iconCache.has(caminho)) iconCache.set(caminho, O.api.call('apps:icon', caminho).catch(() => ''));
    return iconCache.get(caminho);
  };
  O.preencherIcones = root => {
    O.$$('[data-icone]', root).forEach(async el => {
      const url = await O.icone(el.dataset.icone);
      if (url && el.isConnected) { el.innerHTML = `<img src="${url}" alt="">`; el.classList.remove('letra'); }
    });
  };

  /* miniatura de imagem/PDF/vídeo (Quick Look no Mac) */
  const thumbCache = new Map();
  O.preencherMiniaturas = root => {
    O.$$('[data-thumb]', root).forEach(async el => {
      const p = el.dataset.thumb;
      if (!thumbCache.has(p)) thumbCache.set(p, O.api.call('files:thumb', p, 120).catch(() => ''));
      const url = await thumbCache.get(p);
      if (url && el.isConnected) el.innerHTML = `<img src="${url}" alt="">`;
    });
  };

  /* emblema da extensão (PDF, WAV…) com a cor do tipo */
  O.ext = f => {
    const k = f.kind === 'outros' ? '' : f.kind;
    const label = f.kind === 'pasta' ? 'PASTA' : (f.ext || '?').toUpperCase().slice(0, 4);
    const thumb = (f.kind === 'img' || f.kind === 'video' || f.ext === 'pdf') && f.path ? ` data-thumb="${esc(f.path)}"` : '';
    return `<span class="ext ${k}"${thumb} aria-hidden="true">${esc(label)}</span>`;
  };

  O.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
})();

'use strict';
/* Zoom — os artigos guardados, por coleções, com notas, etiquetas e destaques. */
const Z = window.zoomApp;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const HL = { yellow: 'var(--hl-yellow)', green: 'var(--hl-green)', blue: 'var(--hl-blue)', pink: 'var(--hl-pink)', orange: 'var(--hl-orange)' };
const fav = site => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site || '')}&sz=32`;
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
function when(ms) {
  const d = new Date(ms), now = new Date(), y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'hoje';
  if (d.toDateString() === y.toDateString()) return 'ontem';
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).replace('.', '');
}

let D = { cols: [], items: [] };
let view = 'all';        // all | none | hl | <id da coleção>
let sel = null;          // id do artigo aberto no painel
let q = '';
let editingCol = null, addingCol = false, confirmDel = null;

async function load() {
  D = (await Z.data()) || { cols: [], items: [] };
  if (sel && !D.items.some(i => i.id === sel)) sel = null;
  render();
}
function filtered() {
  let items = D.items;
  if (view === 'none') items = items.filter(i => !i.col);
  else if (view === 'hl') items = items.filter(i => i.highlights.length);
  else if (view !== 'all') items = items.filter(i => i.col === view);
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length) items = items.filter(i => {
    const hay = fold([i.title, i.site, i.excerpt, i.note, (i.tags || []).join(' '), ...i.highlights.map(h => h.text + ' ' + (h.comment || ''))].join(' '));
    return words.every(w => hay.includes(w));
  });
  return items;
}
function render() { renderSide(); renderList(); renderDetail(); }

/* ---------- coleções ---------- */
function renderSide() {
  const count = f => D.items.filter(f).length;
  const row = (id, name, n, own) => `<div class="coll ${view === id ? 'on' : ''}" role="button" tabindex="0" data-view="${esc(id)}" ${own ? `data-drop="${esc(id)}"` : id === 'none' ? 'data-drop=""' : ''}>
    <span class="n">${esc(name)}</span><span class="c">${n}</span>
    ${own ? `<span class="ops"><button class="ico" type="button" data-up="${esc(id)}" title="Subir">↑</button><button class="ico" type="button" data-ren="${esc(id)}" title="Mudar o nome">✎</button><button class="ico" type="button" data-del="${esc(id)}" title="${confirmDel === id ? 'Carrega outra vez para apagar' : 'Apagar a coleção (os artigos ficam em Sem coleção)'}" style="${confirmDel === id ? 'color:var(--danger)' : ''}">✕</button></span>` : ''}</div>`;
  $('#side').innerHTML = row('all', 'Todos', D.items.length) + row('none', 'Sem coleção', count(i => !i.col)) + row('hl', 'Com destaques', count(i => i.highlights.length)) +
    `<div class="lbl">Coleções</div>` +
    D.cols.map(c => editingCol === c.id
      ? `<div class="newcol"><input id="renInput" value="${esc(c.name)}" data-renid="${esc(c.id)}"></div>`
      : row(c.id, c.name, count(i => i.col === c.id), true)).join('') +
    (addingCol ? `<div class="newcol"><input id="newColInput" placeholder="Nome da coleção"></div>` : `<button class="addcol" type="button" id="addCol">+ Nova coleção</button>`);
  const inp = $('#newColInput') || $('#renInput');
  if (inp) { inp.focus(); inp.select(); }
}
$('#side').addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('#addCol')) { addingCol = true; renderSide(); return; }
  const up = t.closest('[data-up]'); if (up) { e.stopPropagation(); await Z.moveCol(up.dataset.up, -1); return load(); }
  const ren = t.closest('[data-ren]'); if (ren) { e.stopPropagation(); editingCol = ren.dataset.ren; renderSide(); return; }
  const del = t.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    if (confirmDel !== del.dataset.del) { confirmDel = del.dataset.del; renderSide(); setTimeout(() => { confirmDel = null; renderSide(); }, 4000); return; }
    await Z.removeCol(del.dataset.del); confirmDel = null; if (view === del.dataset.del) view = 'all'; return load();
  }
  const v = t.closest('[data-view]'); if (v) { view = v.dataset.view; render(); }
});
$('#side').addEventListener('keydown', async e => {
  if (e.target.id === 'newColInput') {
    if (e.key === 'Enter') { const n = e.target.value.trim(); addingCol = false; if (n) { const c = await Z.addCol(n); if (c) view = c.id; } return load(); }
    if (e.key === 'Escape') { addingCol = false; renderSide(); }
  }
  if (e.target.id === 'renInput') {
    if (e.key === 'Enter') { await Z.renameCol(e.target.dataset.renid, e.target.value); editingCol = null; return load(); }
    if (e.key === 'Escape') { editingCol = null; renderSide(); }
  }
});
$('#side').addEventListener('focusout', e => {
  if (e.target.id === 'newColInput' && !e.target.value.trim()) { addingCol = false; setTimeout(renderSide, 0); }
  if (e.target.id === 'renInput') { const id = e.target.dataset.renid, v = e.target.value; editingCol = null; Z.renameCol(id, v).then(load); }
});
// arrastar um artigo para uma coleção
$('#side').addEventListener('dragover', e => { const d = e.target.closest('[data-drop]'); if (d) { e.preventDefault(); d.classList.add('drop'); } });
$('#side').addEventListener('dragleave', e => { const d = e.target.closest('[data-drop]'); if (d) d.classList.remove('drop'); });
$('#side').addEventListener('drop', async e => {
  const d = e.target.closest('[data-drop]'); if (!d) return;
  e.preventDefault(); d.classList.remove('drop');
  const id = e.dataTransfer.getData('text/zoom-id'); if (id) { await Z.update(id, { col: d.dataset.drop }); load(); }
});

/* ---------- lista ---------- */
function renderList() {
  const items = filtered();
  const colName = id => (D.cols.find(c => c.id === id) || {}).name || '';
  $('#status').textContent = D.items.length ? `${items.length} de ${D.items.length} artigos` : '';
  if (!items.length) {
    $('#list').innerHTML = `<div class="empty">${D.items.length
      ? (q ? `Nada encontrado para “${esc(q)}”.` : 'Ainda não há artigos aqui. Arrasta artigos para esta coleção, ou escolhe-a ao guardar.')
      : '<b>Ainda não guardaste nada.</b><br>Para guardar a página que estás a ler, carrega no marcador da barra de cima (ao lado das transferências), ou em "Guardar no Zoom" na pré-visualização do Radar.<br><br>Para destacar uma passagem, seleciona o texto na página e escolhe uma cor. Se quiseres, junta-lhe um comentário. A página fica guardada aqui com os destaques.'}</div>`;
    return;
  }
  $('#list').innerHTML = items.map(i => `<button class="card ${sel === i.id ? 'on' : ''}" type="button" data-id="${esc(i.id)}" draggable="true">
    <span class="card-x" role="button" data-x="${esc(i.id)}" title="Tirar do Zoom">✕</span>
    ${i.image ? `<div class="img" style="background-image:url('${esc(i.image).replace(/'/g, '%27')}')"></div>` : `<div class="img none">${esc(i.site || hostOf(i.url))}</div>`}
    <div class="body">
      <div class="meta"><img src="${fav(hostOf(i.url))}" alt="" referrerpolicy="no-referrer"><b>${esc(i.site || hostOf(i.url))}</b><span>· ${when(i.createdAt)}</span></div>
      <h3>${esc(i.title)}</h3>
      ${i.note ? `<p>📝 ${esc(i.note)}</p>` : i.excerpt ? `<p>${esc(i.excerpt)}</p>` : ''}
      <div class="chips">${i.col && view !== i.col ? `<span class="chip">${esc(colName(i.col))}</span>` : ''}${(i.tags || []).map(t => `<span class="chip">#${esc(t)}</span>`).join('')}
        ${i.highlights.length ? `<span class="chip dots">${i.highlights.slice(0, 6).map(h => `<i class="dot" style="background:${HL[h.color]}"></i>`).join('')} ${i.highlights.length} destaque${i.highlights.length > 1 ? 's' : ''}</span>` : ''}</div>
    </div></button>`).join('');
}
// O primeiro clique abre o painel de detalhes, o que encolhe a grelha e mexe os cartões
// debaixo do rato: o segundo clique cai noutro sítio e o "dblclick" do sistema perde-se.
// Por isso o duplo clique conta-se à mão, pelo cartão do primeiro clique.
let lastClick = { id: null, t: 0 };
$('#list').addEventListener('click', e => {
  if (PV) return;
  // ✕ no canto do cartão: tirar do Zoom, com confirmação (o segundo clique é que apaga)
  const x = e.target.closest('[data-x]');
  if (x) {
    e.preventDefault(); e.stopPropagation(); lastClick = { id: null, t: 0 };
    const id = x.dataset.x, key = 'card:' + id;
    if (confirmDel !== key) {
      confirmDel = key;
      $('#list').querySelectorAll('.card-x.confirm').forEach(o => { o.classList.remove('confirm'); o.textContent = '✕'; o.title = 'Tirar do Zoom'; });
      x.classList.add('confirm'); x.textContent = 'Apagar do Zoom?'; x.title = 'Carrega outra vez para apagar';
      setTimeout(() => { if (confirmDel === key) { confirmDel = null; if (x.isConnected) { x.classList.remove('confirm'); x.textContent = '✕'; x.title = 'Tirar do Zoom'; } } }, 4000);
      return;
    }
    confirmDel = null;
    Z.remove(id).then(() => { if (sel === id) sel = null; load(); });
    return;
  }
  const c = e.target.closest('[data-id]');
  const now = Date.now();
  if (lastClick.id && now - lastClick.t < 550 && (e.detail >= 2 || (c && c.dataset.id === lastClick.id))) {
    const id = lastClick.id; lastClick = { id: null, t: 0 }; openPreview(id); return;
  }
  if (!c) return;
  lastClick = { id: c.dataset.id, t: now };
  if (sel === c.dataset.id) return;
  sel = c.dataset.id;
  $('#list').querySelectorAll('.card.on').forEach(x => x.classList.remove('on'));
  c.classList.add('on');
  renderDetail();
});

/* ---------- ler o artigo dentro do Zoom (duplo clique), como no Radar ---------- */
let PV = null;
const slotRect = () => { const r = $('#pvSlot').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
function openPreview(id) {
  const it = D.items.find(i => i.id === id); if (!it) return;
  PV = id; sel = id;
  document.body.classList.add('previewing');
  $('#pv').hidden = false;
  $('#pvSite').textContent = (it.site || hostOf(it.url)) + ' · guardado ' + when(it.createdAt);
  $('#pvTitle').textContent = it.title;
  $('#pvSlot').classList.add('loading');
  renderList();
  requestAnimationFrame(() => {
    const c = document.querySelector('.card.on'); if (c) c.scrollIntoView({ block: 'nearest' });
    Z.preview(id, slotRect());
  });
}
function closePreview(fromMain) {
  if (!PV) return;
  PV = null;
  if (!fromMain) Z.previewClose();
  document.body.classList.remove('previewing');
  $('#pv').hidden = true;
  render();
}
function stepPreview(dir) {
  if (!PV) return;
  const ids = filtered().map(i => i.id), i = ids.indexOf(PV), n = ids[i + dir];
  if (n) openPreview(n);
}
$('#pvClose').addEventListener('click', () => closePreview());
$('#pvPrev').addEventListener('click', () => stepPreview(-1));
$('#pvNext').addEventListener('click', () => stepPreview(1));
$('#pvTab').addEventListener('click', async () => { if (!PV) return; PV = null; await Z.previewToTab(); document.body.classList.remove('previewing'); $('#pv').hidden = true; render(); });
// "Detalhes": fecha o artigo e mostra o painel com coleção, etiquetas, nota e destaques
$('#pvInfo').addEventListener('click', () => { const id = PV; closePreview(); sel = id; render(); });
Z.onPreviewClosed(() => closePreview(true));
Z.onPreviewState(st => { if (PV) $('#pvSlot').classList.toggle('loading', !!st.loading); });
new ResizeObserver(() => { if (PV) Z.previewRect(slotRect()); }).observe($('#pvSlot'));
// um clique noutro cartão, com um artigo aberto, abre esse artigo
$('#list').addEventListener('click', e => { if (!PV) return; const c = e.target.closest('[data-id]'); if (c && c.dataset.id !== PV) openPreview(c.dataset.id); }, true);
$('#list').addEventListener('dragstart', e => { const c = e.target.closest('[data-id]'); if (c) { e.dataTransfer.setData('text/zoom-id', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; } });

/* ---------- detalhe ---------- */
function renderDetail() {
  const box = $('#detail');
  const it = sel && D.items.find(i => i.id === sel);
  box.hidden = !it;
  if (!it) { box.innerHTML = ''; return; }
  const active = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.keep : null;
  box.innerHTML = `
    <div class="d-top"><h2>${esc(it.title)}</h2><button class="ico" type="button" data-close title="Fechar">✕</button></div>
    ${it.image ? `<div class="d-img" style="background-image:url('${esc(it.image).replace(/'/g, '%27')}')"></div>` : ''}
    <div class="d-site">${esc(it.site || hostOf(it.url))} · guardado ${when(it.createdAt)} · <a href="#" data-copyurl>copiar endereço</a></div>
    <div class="row"><button class="btn primary" type="button" data-read>Ler aqui</button><button class="btn" type="button" data-open>Abrir num separador</button><button class="btn" type="button" data-openbg title="Abre num separador por trás">Abrir por trás</button></div>
    <label class="field"><span>Coleção</span><select data-col data-keep="col"><option value="">Sem coleção</option>${D.cols.map(c => `<option value="${esc(c.id)}" ${it.col === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Etiquetas</span><input data-tags data-keep="tags" placeholder="separadas por vírgulas (ex.: ucrânia, defesa)" value="${esc((it.tags || []).join(', '))}"></label>
    <label class="field"><span>Nota</span><textarea data-note data-keep="note" placeholder="Porque guardaste este artigo, ideias, o que fazer com ele…">${esc(it.note || '')}</textarea></label>
    <div class="field"><span>Destaques (${it.highlights.length})</span>
      ${it.highlights.length ? `<div class="hls">${it.highlights.map(h => `<div class="hl" data-hl="${esc(h.id)}">
        <blockquote><span style="background:${HL[h.color]}">${esc(h.text)}</span></blockquote>
        <textarea data-hlc data-keep="hl-${esc(h.id)}" placeholder="Comentário…">${esc(h.comment || '')}</textarea>
        <div class="ops">${Object.keys(HL).map(k => `<button class="sw ${h.color === k ? 'on' : ''}" type="button" data-sw="${k}" style="background:${HL[k]}" title="Mudar a cor"></button>`).join('')}<span class="sp"></span>
          <button class="lnk" type="button" data-hlcopy>Copiar</button><button class="lnk" type="button" data-hldel>Tirar</button></div></div>`).join('')}</div>`
      : '<p class="muted">Sem destaques. Abre o artigo, seleciona uma passagem e escolhe uma cor.</p>'}</div>
    <div class="row" style="margin-top:6px"><button class="btn danger" type="button" data-remove>${confirmDel === 'item:' + it.id ? 'Carrega outra vez para tirar do Zoom' : 'Tirar do Zoom'}</button></div>`;
  if (active) { const el = box.querySelector(`[data-keep="${CSS.escape(active)}"]`); if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); } }
}
$('#detail').addEventListener('click', async e => {
  const it = D.items.find(i => i.id === sel); if (!it) return;
  const t = e.target;
  if (t.closest('[data-close]')) { sel = null; renderList(); renderDetail(); return; }
  if (t.closest('[data-read]')) return openPreview(it.id);
  if (t.closest('[data-open]')) return Z.open(it.id, false);
  if (t.closest('[data-openbg]')) return Z.open(it.id, true);
  if (t.closest('[data-copyurl]')) { e.preventDefault(); Z.copy(it.url); $('#status').textContent = 'Endereço copiado.'; return; }
  const hlEl = t.closest('[data-hl]');
  if (hlEl) {
    const hid = hlEl.dataset.hl, h = it.highlights.find(x => x.id === hid);
    if (t.closest('[data-sw]')) { await Z.updateHl(it.id, hid, { color: t.closest('[data-sw]').dataset.sw }); return load(); }
    if (t.closest('[data-hlcopy]')) { Z.copy(`“${h.text}”${h.comment ? '\n— ' + h.comment : ''}\n${it.url}`); $('#status').textContent = 'Destaque copiado.'; return; }
    if (t.closest('[data-hldel]')) { await Z.removeHl(it.id, hid); return load(); }
  }
  if (t.closest('[data-remove]')) {
    if (confirmDel !== 'item:' + it.id) { confirmDel = 'item:' + it.id; renderDetail(); setTimeout(() => { if (confirmDel === 'item:' + it.id) { confirmDel = null; renderDetail(); } }, 4000); return; }
    confirmDel = null; await Z.remove(it.id); sel = null; return load();
  }
});
$('#detail').addEventListener('change', async e => {
  const it = D.items.find(i => i.id === sel); if (!it) return;
  if (e.target.matches('[data-col]')) { await Z.update(it.id, { col: e.target.value }); load(); }
});
// notas, etiquetas e comentários guardam ao sair da caixa (e a cada pausa ao escrever)
let typeT = null;
function saveField(el) {
  const it = D.items.find(i => i.id === sel); if (!it) return;
  if (el.matches('[data-note]')) { it.note = el.value; Z.update(it.id, { note: el.value }); }
  else if (el.matches('[data-tags]')) { const tags = el.value.split(',').map(s => s.trim()).filter(Boolean); it.tags = tags; Z.update(it.id, { tags }); }
  else if (el.matches('[data-hlc]')) { const hid = el.closest('[data-hl]').dataset.hl; const h = it.highlights.find(x => x.id === hid); if (h) h.comment = el.value; Z.updateHl(it.id, hid, { comment: el.value }); }
}
$('#detail').addEventListener('input', e => { if (e.target.matches('[data-note],[data-hlc]')) { clearTimeout(typeT); const el = e.target; typeT = setTimeout(() => saveField(el), 700); } });
$('#detail').addEventListener('focusout', e => { if (e.target.matches('[data-note],[data-tags],[data-hlc]')) { clearTimeout(typeT); saveField(e.target); } });

/* ---------- arranque ---------- */
let qT = null;
$('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { q = e.target.value.trim(); renderList(); }, 120); });
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); }
  if (PV && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
    if (e.key === 'Escape') { closePreview(); return; }
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); stepPreview(1); return; }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); stepPreview(-1); return; }
  }
  if (e.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && sel) { sel = null; renderList(); renderDetail(); }
});
document.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);
// mudanças vindas de fora (guardar numa página, destaques novos): recarrega sem perder o que se está a escrever
Z.onChanged(() => { const typing = document.activeElement && $('#detail').contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName); if (typing) { Z.data().then(d => { D = d || D; renderSide(); renderList(); }); } else load(); });
Z.onTheme(t => { document.documentElement.dataset.theme = t; });
Z.theme().then(t => { if (t) document.documentElement.dataset.theme = t; });
load();

'use strict';
/*
 * "Continuar onde fiquei": histórico simples do que se abriu no Olimpo (páginas do Zeus,
 * projetos, ficheiros, apps), por espaço, completado com os ficheiros abertos recentemente no Mac.
 */
const path = require('path');

const MAX = 300;

function add(store, it) {
  if (!it || !it.id) return;
  store.change(s => {
    const espaco = it.espaco || s.espacoAtual;
    s.atividade = (s.atividade || []).filter(a => !(a.id === it.id && a.espaco === espaco));
    s.atividade.unshift({ ...it, espaco, t: Date.now() });
    if (s.atividade.length > MAX) s.atividade.length = MAX;
  });
}

const MARK = { zeus: 'Z', apolo: 'A', projeto: 'P', ficheiro: 'F', mac: null, web: null };
const APP = { zeus: 'Zeus', apolo: 'Apolo', projeto: 'Projeto', ficheiro: 'Ficheiro' };

/* As 5 últimas coisas deste espaço (o histórico do Olimpo primeiro; depois ficheiros recentes do sistema). */
function continuar(S, recentFiles = [], n = 5) {
  const espaco = S.espacoAtual;
  const mine = (S.atividade || []).filter(a => a.espaco === espaco);
  // páginas do Zeus: junta por site, para não encher a fila com o mesmo site
  const out = [];
  const seen = new Set();
  for (const a of mine) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({
      id: a.id, tipo: a.tipo, mark: MARK[a.tipo] || (a.titulo || '?')[0].toUpperCase(),
      app: a.app || APP[a.tipo] || a.titulo, titulo: a.tipo === 'mac' || a.tipo === 'web' ? (a.sub || 'App') : a.titulo, t: a.t, alvo: a.alvo, icone: a.icone || null
    });
    if (out.length >= n) break;
  }
  if (out.length < n) {
    for (const f of recentFiles) {
      if (out.length >= n) break;
      const id = 'ficheiro:' + f.path;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, tipo: 'ficheiro', mark: 'F', app: 'Ficheiro', titulo: f.nome, t: f.usado || f.mtime, alvo: { ficheiro: f.path }, ext: f.ext, onde: f.onde || path.dirname(f.path) });
    }
  }
  return out.slice(0, n);
}

module.exports = { add, continuar };

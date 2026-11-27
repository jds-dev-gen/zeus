'use strict';
/*
 * Barra do Claude — parte local. Tudo se resolve no computador, na hora:
 * apps (do Olimpo, do espaço e instaladas), projetos, ações e ficheiros (Spotlight).
 * O Claude só entra quando o texto é uma pergunta ou um pedido, ou quando o utilizador o escolhe.
 */
const apps = require('./apps');
const files = require('./files');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const ACOES = [
  { id: 'ficheiros', nome: 'Ficheiros', sub: 'Encontrar e arrumar', chaves: 'ficheiros finder explorador documentos pastas' },
  { id: 'espaco', nome: 'Espaço em disco', sub: 'Ver o que ocupa espaço e libertar', chaves: 'espaco disco limpar libertar armazenamento cheio' },
  { id: 'entrada', nome: 'Arrumar a Entrada', sub: 'Ficheiros novos por arrumar', chaves: 'entrada arrumar transferencias downloads novos' },
  { id: 'novo-projeto', nome: 'Novo projeto', sub: 'Pasta e quadro no Apolo', chaves: 'novo projeto criar pasta' },
  { id: 'novo-quadro', nome: 'Novo quadro no Apolo', sub: 'Abre o Apolo', chaves: 'novo quadro apolo' },
  { id: 'acrescentar-app', nome: 'Acrescentar app', sub: 'Do Mac ou da web', chaves: 'acrescentar adicionar app instalar' },
  { id: 'editar-espaco', nome: 'Editar espaço', sub: 'Pôr e tirar módulos', chaves: 'editar espaco modulos personalizar' },
  { id: 'todas-apps', nome: 'Todas as apps', sub: 'Do Mac e web', chaves: 'todas apps aplicacoes' },
  { id: 'definicoes', nome: 'Definições do Olimpo', sub: 'Apolo, Entrada, Claude, arranque', chaves: 'definicoes preferencias configurar' },
  { id: 'separador', nome: 'Novo separador no Zeus', sub: 'Abre o Zeus', chaves: 'novo separador zeus browser web' }
];

/* Pergunta ou pedido? (então o primeiro resultado é "Perguntar ao Claude") */
const VERBOS = /^(o que|que |qual|quais|quanto|quantos|quantas|como|porque|porquê|por que|quando|onde|quem|resume|resumir|explica|escreve|traduz|arruma|organiza|procura o|procura a|encontra o|encontra a|compara|diz-me|diz me|ajuda|faz|cria um|cria uma|posso|devo|lista|mostra-me|analisa|limpa)\b/i;
function isQuestion(q) {
  const t = q.trim();
  return /\?\s*$/.test(t) || VERBOS.test(norm(t)) || VERBOS.test(t) || t.split(/\s+/).length >= 6;
}

function score(hay, q) {
  const h = norm(hay), n = norm(q);
  if (!n) return 0;
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  if (h.split(/[\s\-—·_.]+/).some(w => w.startsWith(n))) return 60;
  if (h.includes(n)) return 40;
  // iniciais (ex.: "dr" -> DaVinci Resolve)
  const ini = h.split(/[\s\-]+/).map(w => w[0]).join('');
  if (n.length >= 2 && ini.startsWith(n)) return 35;
  return 0;
}

async function local(q, S, { withFiles = true } = {}) {
  q = String(q || '').trim();
  if (!q) return { q, grupos: [], pergunta: false };
  const espaco = S.espacoAtual;
  const out = { App: [], Projeto: [], Ficheiro: [], 'Ação': [] };

  // apps do Olimpo e do espaço
  const seen = new Set();
  for (const [id, a] of Object.entries(S.apps)) {
    const s = score(a.nome, q);
    if (s) { out.App.push({ tipo: 'App', id, nome: a.nome, sub: a.tipo === 'painel' ? (a.sub || 'Dentro do Olimpo') : a.tipo === 'web' ? 'App web' : 'App do Mac', s: s + 10, alvo: { app: id } }); seen.add(id); }
  }
  for (const a of apps.installed()) {
    if (seen.has(a.id)) continue;
    const s = score(a.nome, q);
    if (s) out.App.push({ tipo: 'App', id: a.id, nome: a.nome, sub: 'App do Mac', s, alvo: { mac: a.id }, caminho: a.caminho });
  }
  // projetos (os do espaço atual primeiro)
  for (const p of S.projetos) {
    const s = score(p.nome, q);
    if (s) out.Projeto.push({ tipo: 'Projeto', id: p.id, nome: p.nome, sub: 'Quadro e ficheiros' + (p.espaco !== espaco ? ' · ' + ((S.espacos.find(e => e.id === p.espaco) || {}).nome || '') : ''), s: s + (p.espaco === espaco ? 5 : 0), alvo: { projeto: p.id } });
  }
  // ações
  for (const a of ACOES) {
    const s = Math.max(score(a.nome, q), score(a.chaves, q) * 0.8);
    if (s) out['Ação'].push({ tipo: 'Ação', id: a.id, nome: a.nome, sub: a.sub, s, alvo: { acao: a.id } });
  }
  // espaços
  for (const e of S.espacos) {
    const s = score('espaço ' + e.nome, q) || score(e.nome, q);
    if (s && e.id !== espaco) out['Ação'].push({ tipo: 'Ação', id: 'espaco-' + e.id, nome: 'Mudar para ' + e.nome, sub: 'Espaço', s, alvo: { espaco: e.id } });
  }
  // ficheiros (Spotlight / índice)
  if (withFiles && q.length >= 2) {
    try {
      const fl = await files.search({ q, limit: 6, conteudo: false });
      for (const f of fl) out.Ficheiro.push({ tipo: 'Ficheiro', id: f.path, nome: f.nome, sub: f.onde, s: score(f.nome, q) || 20, alvo: { ficheiro: f.path }, ext: f.ext, kind: f.kind });
    } catch (e) { /* sem resultados */ }
  }
  const grupos = Object.entries(out)
    .map(([tipo, l]) => ({ tipo, itens: l.sort((a, b) => b.s - a.s).slice(0, tipo === 'Ficheiro' ? 5 : 4) }))
    .filter(g => g.itens.length);
  // o grupo com o melhor resultado vai à frente
  grupos.sort((a, b) => b.itens[0].s - a.itens[0].s);
  return { q, grupos, pergunta: isQuestion(q) };
}

module.exports = { local, isQuestion, ACOES };

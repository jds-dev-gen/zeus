'use strict';
/*
 * Estado guardado do Olimpo (um JSON na pasta de dados, escrito de forma atómica).
 * O formato segue o modelo de dados do brief: espaços com módulos, projetos, apps e ficheiros.
 */
const fs = require('fs');
const path = require('path');
const { dataDir, HOME } = require('./platform');

const VERSAO = 1;

const modulosBase = () => [
  { uid: 'm1', tipo: 'continuar', tamanho: 'L' },
  { uid: 'm2', tipo: 'app', app: 'zeus', tamanho: 'G' },
  { uid: 'm3', tipo: 'app', app: 'apolo', tamanho: 'G', mostrarProjetos: true },
  { uid: 'm4', tipo: 'entrada', tamanho: 'P' },
  { uid: 'm5', tipo: 'todas-apps', tamanho: 'P' }
];

function inicial() {
  return {
    versao: VERSAO,
    nome: 'João',
    espacoAtual: 'pessoal',
    espacos: [
      { id: 'pessoal', nome: 'Pessoal', modulos: modulosBase(), apps: [] },
      { id: 'trabalho', nome: 'Trabalho', modulos: modulosBase(), apps: [] }
    ],
    projetos: [],
    apps: {
      zeus: { nome: 'Zeus', tipo: 'painel', sub: 'Browser' },
      apolo: { nome: 'Apolo', tipo: 'painel', sub: 'Projetos e quadros' },
      ficheiros: { nome: 'Ficheiros', tipo: 'painel', sub: 'Encontrar e espaço' }
    },
    ficheiros: {
      entrada: ['~/Downloads', '~/Desktop'],
      entradaDias: 14,
      dispensados: [],
      pastaProjetos: '~/Projetos',
      cacheDaVinci: ''
    },
    atividade: [],
    zeus: { tabs: [], atual: {}, coluna: ['wa'] },
    definicoes: {
      apoloUrl: '',
      modeloClaude: 'claude-opus-5-5',
      esforcoClaude: 'medium',
      arranque: true,
      atalho: 'Alt+Space',
      cidade: { nome: 'Lisboa', lat: 38.7223, lon: -9.1393 }
    },
    notas: {}
  };
}

/* Junta o que vem do disco com os valores por omissão (para versões novas com campos novos). */
function completar(s) {
  const base = inicial();
  const out = Object.assign({}, base, s);
  out.apps = Object.assign({}, base.apps, s.apps || {});
  out.ficheiros = Object.assign({}, base.ficheiros, s.ficheiros || {});
  out.definicoes = Object.assign({}, base.definicoes, s.definicoes || {});
  out.zeus = Object.assign({}, base.zeus, s.zeus || {});
  if (!Array.isArray(out.espacos) || !out.espacos.length) out.espacos = base.espacos;
  out.espacos.forEach(e => { e.modulos = Array.isArray(e.modulos) ? e.modulos : []; e.apps = Array.isArray(e.apps) ? e.apps : []; });
  if (!out.espacos.some(e => e.id === out.espacoAtual)) out.espacoAtual = out.espacos[0].id;
  return out;
}

/* O endereço do Apolo já está guardado no Zeus: aproveita-o na primeira vez. */
function apoloDoZeus() {
  const cands = [
    path.join(HOME, 'Library', 'Application Support', 'Zeus', 'zeus-state.json'),
    path.join(HOME, '.config', 'Zeus', 'zeus-state.json')
  ];
  for (const f of cands) {
    try {
      const z = JSON.parse(fs.readFileSync(f, 'utf8'));
      const a = (z.apps || []).find(x => x.id === 'apolo');
      if (a && /^https?:\/\//.test(a.url || '')) return a.url;
    } catch (e) { /* sem Zeus neste computador */ }
  }
  return '';
}

class Store {
  constructor(dir = dataDir()) {
    this.dir = dir;
    this.file = path.join(dir, 'olimpo.json');
    this.timer = null;
    this.listeners = new Set();
    fs.mkdirSync(dir, { recursive: true });
    let s = null;
    try { s = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* primeira vez */ }
    this.s = completar(s || {});
    if (!s) { this.s.definicoes.apoloUrl = apoloDoZeus(); this.saveNow(); }
  }
  get() { return this.s; }
  change(fn) {
    fn(this.s);
    this.save();
    this.listeners.forEach(l => { try { l(this.s); } catch (e) { console.error(e); } });
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() { clearTimeout(this.timer); this.timer = setTimeout(() => this.saveNow(), 400); }
  saveNow() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.s, null, 1));
    fs.renameSync(tmp, this.file);
  }
  espaco(id = this.s.espacoAtual) { return this.s.espacos.find(e => e.id === id) || this.s.espacos[0]; }
}

module.exports = { Store, inicial, completar, VERSAO };

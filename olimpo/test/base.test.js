'use strict';
/* Testes do Olimpo que não precisam do Electron: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// pasta pessoal de teste (antes de carregar os módulos, que leem a HOME ao arrancar)
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'olimpo-home-'));
process.env.HOME = HOME;
for (const d of ['Desktop', 'Downloads', 'Documents', 'Projetos/Podcast Plus']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.writeFileSync(path.join(HOME, 'Downloads', 'Guião.docx'), 'x');
fs.writeFileSync(path.join(HOME, 'Downloads', 'antigo.pdf'), 'x');
const velho = new Date(Date.now() - 60 * 86400000);
fs.utimesSync(path.join(HOME, 'Downloads', 'antigo.pdf'), velho, velho);
fs.writeFileSync(path.join(HOME, 'Downloads', 'meio.crdownload'), 'x');
fs.writeFileSync(path.join(HOME, 'Documents', 'Entrevista bruta.wav'), 'x');

const { squarify } = require('../src/ui/js/treemap.js');
const { Store, completar } = require('../src/main/store');
const files = require('../src/main/files');
const search = require('../src/main/search');
const activity = require('../src/main/activity');
const { Claude } = require('../src/main/claude');

test('mapa de blocos: ocupa a área toda, sem sair dela, proporcional ao tamanho', () => {
  const items = [{ size: 120 }, { size: 64 }, { size: 74 }, { size: 58 }, { size: 31 }, { size: 28 }, { size: 22 }, { size: 21 }, { size: 0 }];
  const t = squarify(items, 1000, 600);
  assert.equal(t.length, 8, 'itens vazios ficam de fora');
  const area = t.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(Math.abs(area - 600000) < 1, 'soma das áreas = área total');
  for (const r of t) {
    assert.ok(r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= 1000.01 && r.y + r.h <= 600.01, 'dentro da área');
    assert.ok(Math.abs(r.w * r.h / 600000 - r.size / 418) < 1e-6, 'área proporcional');
  }
  assert.equal(t[0].size, 120, 'o maior primeiro');
});

test('estado: valores por omissão e espaços Pessoal/Trabalho', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olimpo-data-'));
  const st = new Store(dir);
  const S = st.get();
  assert.deepEqual(S.espacos.map(e => e.id), ['pessoal', 'trabalho']);
  assert.equal(S.espacoAtual, 'pessoal');
  assert.ok(fs.existsSync(path.join(dir, 'olimpo.json')));
  assert.deepEqual(Object.keys(S.apps).slice(0, 2), ['zeus', 'apolo']);
  const c = completar({ espacoAtual: 'nao-existe', definicoes: { atalho: 'Alt+K' } });
  assert.equal(c.espacoAtual, 'pessoal');
  assert.equal(c.definicoes.atalho, 'Alt+K');
  assert.equal(c.definicoes.modeloClaude, 'claude-opus-5-5');
});

test('barra do Claude: perguntas e pedidos vão para o Claude', () => {
  for (const q of ['o que posso apagar sem perder nada importante?', 'resume este PDF', 'Arruma a Entrada por projeto', 'quanto espaço tenho livre']) assert.ok(search.isQuestion(q), q);
  for (const q of ['zeus', 'pod', 'davinci', 'guião episódio 3']) assert.ok(!search.isQuestion(q), q);
});

test('barra do Claude: resultados locais agrupados (apps, projetos, ações)', async () => {
  const S = completar({ projetos: [{ id: 'pp', nome: 'Podcast Plus', espaco: 'trabalho', pasta: '~/Projetos/Podcast Plus' }] });
  let r = await search.local('pod', S, { withFiles: false });
  assert.equal(r.grupos[0].tipo, 'Projeto');
  assert.equal(r.grupos[0].itens[0].alvo.projeto, 'pp');
  r = await search.local('zeus', S, { withFiles: false });
  assert.equal(r.grupos[0].itens[0].alvo.app, 'zeus');
  r = await search.local('espaço', S, { withFiles: false });
  assert.ok(r.grupos.some(g => g.tipo === 'Ação' && g.itens.some(i => i.alvo.acao === 'espaco')));
  r = await search.local('trabalho', S, { withFiles: false });
  assert.ok(r.grupos.some(g => g.itens.some(i => i.alvo.espaco === 'trabalho')));
});

test('Entrada: ficheiros recentes das pastas vigiadas, sem transferências a meio nem dispensados', async () => {
  const cfg = { entrada: ['~/Downloads'], entradaDias: 14, dispensados: [] };
  // (a data que conta é a mais recente entre criação e modificação: um ficheiro antigo acabado de transferir também é novo)
  let l = await files.entrada(cfg);
  assert.ok(l.some(f => f.nome === 'Guião.docx' && f.kind === 'doc'));
  assert.ok(!l.some(f => f.nome.endsWith('.crdownload')), 'transferências a meio ficam de fora');
  cfg.dispensados = [path.join(HOME, 'Downloads', 'Guião.docx')];
  l = await files.entrada(cfg);
  assert.ok(!l.some(f => f.nome === 'Guião.docx'), 'dispensados ficam de fora');
  cfg.entradaDias = 0.0000001;
  assert.equal((await files.entrada(cfg)).length, 0, 'fora do prazo');
});

test('arrumar num projeto nunca escreve por cima de outro ficheiro', async () => {
  const dest = path.join(HOME, 'Projetos', 'Podcast Plus');
  fs.writeFileSync(path.join(HOME, 'Desktop', 'nota.txt'), 'a');
  fs.writeFileSync(path.join(dest, 'nota.txt'), 'original');
  const out = await files.moveTo(path.join(HOME, 'Desktop', 'nota.txt'), '~/Projetos/Podcast Plus');
  assert.equal(path.basename(out), 'nota (2).txt');
  assert.equal(fs.readFileSync(path.join(dest, 'nota.txt'), 'utf8'), 'original');
  assert.ok(!fs.existsSync(path.join(HOME, 'Desktop', 'nota.txt')));
});

test('procurar ficheiros (índice próprio, fora do Mac)', { skip: process.platform === 'darwin' }, async () => {
  await files.index.build([HOME]);
  const l = await files.search({ q: 'entrevista' });
  assert.equal(l[0].nome, 'Entrevista bruta.wav');
  const a = await files.search({ kind: 'audio' });
  assert.ok(a.every(f => f.kind === 'audio'));
});

test('Continuar: 5 últimas coisas do espaço, completadas com ficheiros recentes', () => {
  const S = completar({ espacoAtual: 'trabalho' });
  const st = { get: () => S, change: fn => fn(S) };
  activity.add(st, { tipo: 'projeto', id: 'projeto:pp', titulo: 'Podcast Plus', alvo: { projeto: 'pp' }, espaco: 'trabalho' });
  activity.add(st, { tipo: 'zeus', id: 'zeus:observador.pt', titulo: 'Observador', alvo: { url: 'https://observador.pt' }, espaco: 'trabalho' });
  activity.add(st, { tipo: 'zeus', id: 'zeus:x.pt', titulo: 'Outro', alvo: {}, espaco: 'pessoal' });
  activity.add(st, { tipo: 'projeto', id: 'projeto:pp', titulo: 'Podcast Plus', alvo: { projeto: 'pp' }, espaco: 'trabalho' });
  const rec = [1, 2, 3, 4].map(i => ({ path: '/f' + i, nome: 'f' + i, ext: 'pdf', mtime: i }));
  const l = activity.continuar(S, rec);
  assert.equal(l.length, 5);
  assert.equal(l[0].titulo, 'Podcast Plus', 'o mais recente primeiro, sem repetir');
  assert.equal(l[1].titulo, 'Observador');
  assert.ok(!l.some(x => x.titulo === 'Outro'), 'só o espaço atual');
  assert.equal(l[2].tipo, 'ficheiro');
});

test('Claude: só lê nas pastas do utilizador e só propõe (nunca move nem apaga sozinho)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olimpo-data-'));
  const store = new Store(dir);
  const c = new Claude({ store, space: { node: () => null }, dataDir: dir, onEvent: () => {}, openTarget: async () => '' });
  assert.ok(c.allowed(path.join(HOME, 'Downloads', 'Guião.docx')));
  assert.ok(c.allowed('~/Documents/x.md'));
  assert.ok(!c.allowed(path.join(HOME, '.ssh', 'id_ed25519')));
  assert.ok(!c.allowed('/etc/passwd'));
  assert.ok(!c.allowed(path.join(HOME, 'Library', 'Mail')));
  const can = c.canUseTool();
  assert.equal((await can('Read', { file_path: '/etc/hosts' })).behavior, 'deny');
  assert.equal((await can('Read', { file_path: path.join(HOME, 'Documents', 'a.md') })).behavior, 'allow');
  assert.equal((await can('Bash', { command: 'rm -rf ~' })).behavior, 'deny');
  assert.equal((await can('Write', { file_path: path.join(HOME, 'Documents', 'a.md') })).behavior, 'deny');
  assert.equal((await can('mcp__olimpo__propor_lixo', {})).behavior, 'allow');
});

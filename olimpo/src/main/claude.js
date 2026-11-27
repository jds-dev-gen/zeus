'use strict';
/*
 * Ligação ao Claude pelo Claude Agent SDK, com a subscrição Claude (sem chave de API):
 * o SDK usa a sessão iniciada no Claude Code deste computador (`claude login`).
 *
 * Regras (brief, secção 5):
 *  - corre só aqui, no processo principal; a interface fala por IPC;
 *  - ferramentas próprias e limitadas (nada de shell nem de escrever ficheiros);
 *  - leitura só nas pastas do utilizador que o Olimpo gere;
 *  - mover e mandar para o Lixo: o agente só PROPÕE; quem confirma é o utilizador, na interface;
 *  - respostas em streaming, com botão para parar.
 */
const fs = require('fs');
const path = require('path');
const { HOME, isMac, expand, tilde, findExecutable, userFolders } = require('./platform');
const files = require('./files');

let sdkPromise = null;
const sdk = () => (sdkPromise = sdkPromise || import('@anthropic-ai/claude-agent-sdk'));
let zodPromise = null;
const zod = () => (zodPromise = zodPromise || import('zod'));

const SYSTEM = nome => `És o Claude dentro do Olimpo, a interface pessoal do ${nome} no computador. O Olimpo substitui a secretária do Mac e junta apps, projetos, ficheiros e o Claude num só sítio.
Responde em português de Portugal, curto e direto (a resposta aparece numa barra pequena). Sem cabeçalhos; listas curtas quando ajudam.
Tens ferramentas do Olimpo para procurar ficheiros, ver a Entrada (ficheiros novos por arrumar), listar projetos, ver o espaço em disco e abrir coisas. Podes ler ficheiros (Read), procurar nomes (Glob) e procurar texto (Grep) só dentro das pastas do ${nome}; passa sempre caminhos absolutos.
Nunca mexes em ficheiros diretamente. Para mover ou mandar para o Lixo usa propor_mover ou propor_lixo: o ${nome} vê a proposta e confirma na interface. Nada se apaga: o que sai vai para o Lixo.
Quando sugerires o que apagar, sê prudente: prefere caches, cópias exatas, instaladores (.dmg, .pkg) e transferências antigas; nunca proponhas originais únicos de projetos, fotografias ou documentos pessoais sem o ${nome} pedir.`;

class Claude {
  constructor({ store, space, dataDir, onEvent, openTarget }) {
    this.store = store;
    this.space = space;
    this.cwd = path.join(dataDir, 'claude');
    fs.mkdirSync(this.cwd, { recursive: true });
    this.onEvent = onEvent;          // (runId, evento) -> interface
    this.openTarget = openTarget;    // abrir app/ficheiro/projeto
    this.runs = new Map();           // runId -> { abort }
    this.lastSession = null;
    this.proposals = new Map();      // id -> { tipo, itens }
  }

  executable() {
    return findExecutable('claude', [path.join(HOME, '.claude', 'local', 'node_modules', '.bin')]);
  }

  /* Estado da ligação, para as Definições (e para ajudar a ligar pela primeira vez). */
  status() {
    const exe = this.executable();
    const rcs = ['.zshrc', '.zprofile', '.bash_profile', '.bashrc', '.profile'].map(f => path.join(HOME, f));
    const keyInFiles = rcs.filter(f => { try { return /^\s*(export\s+)?ANTHROPIC_API_KEY\s*=/m.test(fs.readFileSync(f, 'utf8')); } catch (e) { return false; } }).map(tilde);
    let bundled = false;
    try { require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`); bundled = true; } catch (e) { /* não vem com a app */ }
    return {
      executavel: exe ? tilde(exe) : null,
      incluido: bundled,
      chaveNoAmbiente: !!process.env.ANTHROPIC_API_KEY,
      chaveNosFicheiros: keyInFiles,
      modelo: this.store.get().definicoes.modeloClaude
    };
  }

  /* Pastas que o Claude pode ler: as do utilizador, as dos projetos e as da Entrada. */
  allowedRoots() {
    const S = this.store.get();
    const roots = new Set(userFolders().map(f => f.path));
    roots.add(expand(S.ficheiros.pastaProjetos));
    for (const p of S.projetos) if (p.pasta) roots.add(expand(p.pasta));
    for (const e of S.ficheiros.entrada) roots.add(expand(e));
    return [...roots].map(r => path.resolve(r));
  }
  allowed(p) {
    if (!p || typeof p !== 'string') return false;
    const abs = path.resolve(expand(p));
    if (abs.split(path.sep).some(seg => seg.startsWith('.') && seg.length > 1)) return false;
    return this.allowedRoots().some(r => abs === r || abs.startsWith(r + path.sep));
  }

  async tools() {
    const { tool, createSdkMcpServer } = await sdk();
    const { z } = await zod();
    const S = () => this.store.get();
    const txt = o => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });
    const brief = l => l.map(f => ({ caminho: f.path, nome: f.nome, tamanho: f.size, modificado: f.mtime ? new Date(f.mtime).toISOString().slice(0, 16) : undefined, tipo: f.kind }));
    const proposal = (tipo, itens, motivo) => {
      const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this.proposals.set(id, { tipo, itens });
      this.onEvent(this.currentRun, { type: 'proposta', proposta: { id, tipo, motivo, itens: itens.map(i => ({ ...i, onde: tilde(path.dirname(i.path)) })) } });
      return id;
    };
    return createSdkMcpServer({
      name: 'olimpo',
      version: '0.1.0',
      tools: [
        tool('procurar_ficheiros', 'Procura ficheiros do utilizador pelo nome ou conteúdo (Spotlight). Filtros opcionais por tipo, hoje, grandes (+1 GB).', {
          texto: z.string().optional(), tipo: z.enum(['doc', 'img', 'audio', 'video']).optional(), hoje: z.boolean().optional(), grandes: z.boolean().optional()
        }, async a => txt(brief(await files.search({ q: a.texto || '', kind: a.tipo || null, hoje: !!a.hoje, grandes: !!a.grandes, limit: 30 })))),
        tool('ficheiros_recentes', 'Ficheiros abertos recentemente.', {}, async () => txt(brief(await files.recent({ limit: 20 })))),
        tool('ver_entrada', 'Ficheiros novos por arrumar (Transferências, capturas de ecrã…).', {}, async () => txt(brief(await files.entrada(S().ficheiros)))),
        tool('listar_projetos', 'Projetos do utilizador, com a pasta de cada um e o espaço (Pessoal, Trabalho…).', {}, async () =>
          txt(S().projetos.map(p => ({ id: p.id, nome: p.nome, espaco: p.espaco, pasta: expand(p.pasta) })))),
        tool('espaco_em_disco', 'Espaço ocupado e livre, o que ocupa mais (por pasta e por tipo) e sugestões para libertar espaço.', {
          pasta: z.string().optional().describe('Caminho absoluto para ver o tamanho das subpastas')
        }, async a => {
          const st = await this.space.state();
          const node = a.pasta ? this.space.node(path.resolve(expand(a.pasta))) : null;
          const sum = n => ({ nome: n.nome, caminho: n.path, bytes: n.size, subpastas: (n.children || []).slice(0, 15).map(c => ({ nome: c.nome, caminho: c.path, bytes: c.size })) });
          return txt({
            total: st.disk.total, livre: st.disk.livre, varrido_em: st.scannedAt ? new Date(st.scannedAt).toISOString() : 'ainda não',
            por_tipo: st.byKind, pasta: node ? sum(node) : undefined,
            pastas: node ? undefined : (st.roots || []).map(r => ({ nome: r.nome, caminho: r.path, bytes: r.size })),
            sugestoes: st.suggestions.map(s => ({ nome: s.nome, porque: s.porque, bytes: s.size, itens: s.itens.slice(0, 15).map(i => ({ caminho: i.path, bytes: i.size })) }))
          });
        }),
        tool('abrir', 'Abre um ficheiro (na app habitual), uma pasta, uma app ou um projeto do Olimpo.', {
          caminho: z.string().optional(), app: z.string().optional().describe('nome da app'), projeto: z.string().optional().describe('id ou nome do projeto')
        }, async a => {
          if (a.caminho && !this.allowed(a.caminho)) return txt('Esse caminho está fora das pastas que o Olimpo gere.');
          const r = await this.openTarget(a);
          return txt(r || 'Aberto.');
        }),
        tool('propor_mover', 'Propõe mover ficheiros para uma pasta de projeto (ou outra pasta do utilizador). Não move nada: o utilizador confirma na interface.', {
          itens: z.array(z.object({ caminho: z.string(), projeto: z.string().optional().describe('id ou nome do projeto de destino'), pasta: z.string().optional().describe('pasta de destino, se não for um projeto') })),
          motivo: z.string().optional()
        }, async a => {
          const itens = [];
          for (const it of a.itens) {
            if (!this.allowed(it.caminho) || !fs.existsSync(expand(it.caminho))) continue;
            let dest = null, destNome = '';
            if (it.projeto) {
              const p = S().projetos.find(x => x.id === it.projeto || x.nome.toLowerCase() === String(it.projeto).toLowerCase());
              if (p) { dest = expand(p.pasta); destNome = p.nome; }
            } else if (it.pasta && this.allowed(it.pasta)) { dest = path.resolve(expand(it.pasta)); destNome = tilde(dest); }
            if (dest) itens.push({ path: path.resolve(expand(it.caminho)), nome: path.basename(it.caminho), destino: dest, destinoNome: destNome });
          }
          if (!itens.length) return txt('Nenhum dos itens pode ser movido (caminhos ou destinos inválidos).');
          proposal('mover', itens, a.motivo || '');
          return txt(`Proposta para mover ${itens.length} ficheiro(s) mostrada ao utilizador. Ele confirma ou cancela na interface; não digas que já foi movido.`);
        }),
        tool('propor_lixo', 'Propõe mandar ficheiros para o Lixo (recuperáveis). Não apaga nada: o utilizador confirma na interface.', {
          caminhos: z.array(z.string()), motivo: z.string().optional()
        }, async a => {
          const itens = [];
          for (const c of a.caminhos) {
            const p = path.resolve(expand(c));
            if (!this.allowed(p) || this.allowedRoots().includes(p)) continue;   // nunca uma pasta raiz inteira
            let size = 0;
            try { const st = fs.statSync(p); size = st.isDirectory() ? (this.space.node(p) || {}).size || 0 : st.size; } catch (e) { continue; }
            itens.push({ path: p, nome: path.basename(p), size });
          }
          if (!itens.length) return txt('Nenhum dos caminhos pode ir para o Lixo (inexistentes ou fora das pastas permitidas).');
          proposal('lixo', itens, a.motivo || '');
          return txt(`Proposta para mandar ${itens.length} item(ns) para o Lixo mostrada ao utilizador. Ele confirma ou cancela; não digas que já foi feito.`);
        })
      ]
    });
  }

  /* Permissões: as ferramentas do Olimpo passam; ler/procurar só dentro das pastas permitidas. */
  canUseTool() {
    return async (toolName, input) => {
      if (toolName.startsWith('mcp__olimpo__')) return { behavior: 'allow', updatedInput: input };
      if (toolName === 'Read') {
        return this.allowed(input.file_path) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Só podes ler ficheiros nas pastas do utilizador geridas pelo Olimpo.' };
      }
      if (toolName === 'Glob' || toolName === 'Grep') {
        return input.path && this.allowed(input.path) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Indica um "path" absoluto dentro das pastas do utilizador.' };
      }
      return { behavior: 'deny', message: 'Ferramenta não disponível no Olimpo.' };
    };
  }

  async ask(runId, prompt, { continuar = false, contexto = '' } = {}) {
    const S = this.store.get();
    const abort = new AbortController();
    this.runs.set(runId, { abort });
    this.currentRun = runId;
    const send = ev => this.onEvent(runId, ev);
    try {
      const { query } = await sdk();
      const env = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'olimpo/' + require('../../package.json').version };
      delete env.ANTHROPIC_API_KEY;   // usar a subscrição, nunca a API paga por engano
      const exe = this.executable();
      if (exe) env.PATH = [path.dirname(exe), env.PATH || ''].join(path.delimiter);
      const options = {
        abortController: abort,
        cwd: this.cwd,
        env,
        model: S.definicoes.modeloClaude || undefined,
        effort: S.definicoes.esforcoClaude || undefined,
        systemPrompt: SYSTEM(S.nome || 'utilizador'),
        tools: ['Read', 'Glob', 'Grep'],
        mcpServers: { olimpo: await this.tools() },
        mcpServersDelivery: 'argv',
        canUseTool: this.canUseTool(),
        permissionMode: 'default',
        settingSources: [],
        includePartialMessages: true,
        maxTurns: 24
      };
      if (exe) options.pathToClaudeCodeExecutable = exe;
      if (continuar && this.lastSession) options.resume = this.lastSession;
      const fullPrompt = contexto ? `${contexto}\n\n${prompt}` : prompt;
      let streamed = false;
      for await (const m of query({ prompt: fullPrompt, options })) {
        if (m.type === 'stream_event' && !m.parent_tool_use_id) {
          const e = m.event;
          if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') { streamed = true; send({ type: 'text', delta: e.delta.text }); }
          if (e.type === 'message_start') send({ type: 'turn' });
        } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
          for (const b of (m.message && m.message.content) || []) {
            if (b.type === 'tool_use') send({ type: 'tool', name: b.name.replace(/^mcp__olimpo__/, ''), input: b.input });
            else if (b.type === 'text' && !streamed) send({ type: 'text', delta: b.text });
          }
          if (m.error) send({ type: 'error', message: errorText(m.error) });
        } else if (m.type === 'result') {
          this.lastSession = m.session_id || this.lastSession;
          if (m.subtype !== 'success') send({ type: 'error', message: m.subtype === 'error_max_turns' ? 'O Claude precisou de demasiados passos. Tenta um pedido mais curto.' : 'O Claude não conseguiu terminar.' });
          send({ type: 'done', custo: m.total_cost_usd, ms: m.duration_ms });
        } else if (m.type === 'auth_status' && m.error) {
          send({ type: 'error', message: 'Sem sessão iniciada no Claude Code. Abre o Terminal e escreve: claude login' });
        }
      }
    } catch (e) {
      if (abort.signal.aborted) send({ type: 'done', parado: true });
      else send({ type: 'error', message: friendly(e) });
    } finally {
      this.runs.delete(runId);
    }
  }

  stop(runId) { const r = this.runs.get(runId); if (r) r.abort.abort(); }
  takeProposal(id) { const p = this.proposals.get(id); this.proposals.delete(id); return p; }
}

function errorText(e) {
  const s = String(e && (e.message || e.type || e) || '');
  if (/auth|login|401/i.test(s)) return 'Sem sessão iniciada no Claude Code. No Terminal: claude login';
  if (/rate|limit|429/i.test(s)) return 'Chegaste ao limite de uso do plano por agora. Tenta mais tarde.';
  return 'Erro do Claude: ' + s;
}
function friendly(e) {
  const s = String((e && (e.stderr || e.message)) || e);
  if (/ENOENT|not found|spawn/i.test(s)) return 'Não encontrei o Claude Code neste computador. Instala-o (claude.ai/code) e faz "claude login" no Terminal.';
  if (/login|auth|credential|401/i.test(s)) return 'Sem sessão iniciada no Claude Code. No Terminal: claude login';
  return 'Não consegui falar com o Claude: ' + s.split('\n')[0];
}

module.exports = { Claude, isMac };

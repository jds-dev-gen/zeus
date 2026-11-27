# Olimpo

Interface pessoal que substitui a secretária do Mac: abre quando o Mac liga, ocupa o ecrã inteiro e passa a ser o sítio onde tudo acontece — apps, projetos, ficheiros e Claude. É uma app Electron nova, separada do Zeus, feita a partir da base dele (sessões web, início de sessão da Google, empacotamento e assinatura). Está escrita para correr também em Linux, a fase seguinte do Olimpo.

## Instalar

**Versão pronta:** em *Releases*, as versões `olimpo-v…` trazem `Olimpo-<versão>-mac-arm64.zip` (Apple Silicon) e `…-mac-x64.zip` (Intel). Abre o zip e arrasta o Olimpo para as Aplicações. Como a assinatura é ad-hoc (sem certificado da Apple), da primeira vez: clique direito › Abrir.

**A partir do código:**

```bash
cd olimpo
npm install
npm start
```

## Ligar o Claude (subscrição, sem chave de API)

1. Instala o Claude Code e inicia sessão: `claude login`.
2. Confirma que **não** há `ANTHROPIC_API_KEY` no `~/.zshrc` ou `~/.zprofile` (as Definições do Olimpo avisam se houver). O Olimpo tira-a do ambiente do Claude de qualquer forma, para nunca usar a API paga por engano.
3. Pronto: o Olimpo usa o Claude Code instalado no Mac através do Claude Agent SDK, no processo principal. O uso conta para o crédito do Agent SDK incluído no plano.

O Claude só é chamado para perguntas e pedidos. Tem ferramentas próprias e limitadas (procurar ficheiros, ver a Entrada, listar projetos, ver o espaço, abrir) e pode ler ficheiros só nas pastas do utilizador. Para mover ou mandar para o Lixo, **propõe** — quem confirma é o utilizador.

## Como se usa

| | |
|---|---|
| **⌥ Espaço** | Traz a barra do Claude de qualquer app (outra vez, ou Esc, volta para onde estavas) |
| Escrever no ecrã principal | Vai direto para a barra |
| **⌘K** | Barra do Claude |
| **⌘1 / ⌘2** | Pessoal / Trabalho |
| **Esc** | Volta ao ecrã principal |
| **⌘T / ⌘L / ⌘W** no Zeus | Separador novo / endereço / fechar separador |
| **⌘,** | Definições |

O menu **⋯** ao lado dos espaços tem Editar espaço, Novo projeto, Acrescentar app e Definições (onde também se esconde a Dock e os ícones da secretária, com confirmação e opção de desfazer).

## O que está feito (fases do brief)

1. **Esqueleto e ecrã principal** — janela sem moldura no ecrã inteiro, fiel a `Simplificado.dc.html`; Pessoal/Trabalho; arranque com o Mac.
2. **Barra do Claude (local)** — atalho global; apps, projetos, ficheiros (Spotlight) e ações, agrupados e instantâneos.
3. **Zeus e Apolo** — painéis de vidro dentro do Olimpo, a crescer a partir do mosaico; ecrã inteiro ou lado a lado; Claude na página (resumir, nota para o Apolo, perguntar).
4. **Continuar e Projetos** — histórico por espaço + ficheiros recentes do Mac; cada projeto junta o quadro do Apolo e a pasta.
5. **Ficheiros — Encontrar e Entrada** — pesquisa por nome ou conteúdo, filtros de um toque, recentes, projetos, pastas, Entrada com arrumar por projeto (à mão ou com o Claude), arrastar ficheiros para outras apps.
6. **Ficheiros — Espaço** — varrimento em segundo plano (worker), barra por tipo, mapa de blocos clicável (squarified), sugestões (cache do DaVinci, vídeos sem abrir há 1 ano, transferências antigas, duplicados por conteúdo), sempre com revisão e confirmação; tudo vai para o Lixo.
7. **Apps do Mac e barra flutuante** — Acrescentar app (Mac e web), barra que substitui a Dock com apps abertas e ponto "a correr".
8. **Claude Agent SDK** — perguntas e pedidos na barra, em streaming, com botão para parar e propostas para confirmar.
9. **Módulos e Editar espaço** — pôr/tirar, P·M·A·G, arrastar, criar e apagar espaços.
10. **Afinações** — limpeza da secretária feita; falta vibrancy nativa e o AeroSpace (opcional).

### Diferenças em relação aos desenhos e ao brief

- A grelha dos módulos tem **5 colunas** (o desenho do Editar fala em 4) para o ecrã principal ficar igual ao `Simplificado` (Zeus e Apolo largos, Entrada e Todas as apps empilhadas).
- O **Zeus dentro do Olimpo** é um browser novo feito com o código do Zeus (separadores, sessões, Google). As sessões não são partilhadas com o Zeus instalado: da primeira vez é preciso entrar de novo nos sites.
- **Guardar no Apolo**: o Apolo não tem uma API conhecida, por isso o Claude escreve a nota, o Olimpo copia-a e abre o Apolo ao lado para a colar.
- Módulos ainda sem dados (Compras, Tarefas, Música, Jornal, Agenda, Notícias, Finanças) aparecem no catálogo como "Em breve".
- A barra flutuante usa vidro desenhado em CSS (mais opaco), não a vibrancy nativa do macOS.

## Estrutura

```
src/main/      processo principal: main.js (janelas, atalho, IPC), web.js (Zeus/Apolo/apps web),
               files.js (Spotlight, Entrada, mover), space.js + scan-worker.js (espaço em disco),
               search.js (barra local), claude.js (Agent SDK), apps.js (apps do Mac/Linux),
               store.js (JSON em ~/Library/Application Support/Olimpo), activity.js (Continuar)
src/preload/   ponte para a interface e preload das páginas web (vem do Zeus)
src/ui/        ecrã principal, painéis, Ficheiros, folhas e Editar espaço (HTML/CSS/JS sem dependências)
src/dock/      barra flutuante
```

- `npm test` — testes que não precisam do Electron (mapa de blocos, barra, Entrada, mover sem escrever por cima, Continuar, limites do Claude).
- `node package-mac.js all` — empacota para Mac em `out/` (o executável do Claude Code incluído no SDK fica de fora; usa-se o do Mac).
- `OLIMPO_DATA=<pasta>` muda a pasta dos dados (útil para testar sem mexer nos teus).

Ao chegar ao ramo `main` com a versão de `olimpo/package.json` mudada, o GitHub Actions (`.github/workflows/olimpo.yml`) testa, compila para os dois Macs e publica `olimpo-v<versão>` em Releases, sem mexer na "última versão" do Zeus.

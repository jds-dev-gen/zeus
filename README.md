# Zeus

Browser pessoal do João, feito com Electron (Chromium).

## Como sai uma versão nova
1. Muda-se o código e sobe-se a versão em `package.json` (ex.: 0.2.0 → 0.2.1).
2. Ao chegar ao ramo `main`, o GitHub Actions (`.github/workflows/release.yml`) compila o Zeus para Mac (Apple Silicon e Intel), assina-o ad-hoc e publica a versão em *Releases*, com um `SHA256SUMS.txt`.
3. O Zeus instalado procura versões novas ao abrir e de 4 em 4 horas, descarrega-a, confirma a soma de verificação e instala-a ao reiniciar.

Todas as segundas-feiras o mesmo workflow verifica se há correções de segurança do Electron (`scripts/bump-electron.js`) e, se houver, publica uma versão nova sozinho.

## Para desenvolver
- `npm install`
- `npm start` — abre o Zeus a partir do código
- `node package-mac.js all` — empacota para Mac em `out/`

O repositório das atualizações é indicado em `package.json` (`zeus.updateRepo`) ou nas definições do Zeus.

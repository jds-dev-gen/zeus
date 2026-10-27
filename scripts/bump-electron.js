/*
 * Mantém o Electron (e com ele o Chromium) atualizado com as correções de segurança.
 *
 * Regras:
 *  - correções da mesma versão principal (ex.: 44.10.0 -> 44.10.2) entram logo;
 *  - uma versão principal nova (ex.: 45) só entra quando tiver pelo menos 21 dias,
 *    para dar tempo a que as primeiras falhas sejam corrigidas.
 * Se mudar alguma coisa, sobe a versão do Zeus (0.2.0 -> 0.2.1) para publicar uma atualização.
 * Escreve "changed=true|false" em $GITHUB_OUTPUT quando corre no GitHub Actions.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkgFile = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const current = pkg.devDependencies.electron.replace(/^[^\d]*/, '');
const times = JSON.parse(execSync('npm view electron time --json', { encoding: 'utf8' }));
const parse = v => v.split('.').map(n => parseInt(n, 10));
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const stable = Object.keys(times).filter(v => /^\d+\.\d+\.\d+$/.test(v));
const [curMajor] = parse(current);
const ageDays = v => (Date.now() - new Date(times[v]).getTime()) / 86400000;

let target = current;
for (const v of stable) {
  const [maj] = parse(v);
  const ok = maj === curMajor || (maj > curMajor && ageDays(stable.filter(x => parse(x)[0] === maj).sort(cmp)[0]) >= 21);
  if (ok && cmp(v, target) > 0) target = v;
}

const out = process.env.GITHUB_OUTPUT;
if (target === current) {
  console.log(`Electron ${current} já é o mais recente permitido.`);
  if (out) fs.appendFileSync(out, 'changed=false\n');
  process.exit(0);
}
const [ma, mi, pa] = parse(pkg.version);
pkg.version = `${ma}.${mi}.${pa + 1}`;
pkg.devDependencies.electron = target;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Electron ${current} -> ${target}; Zeus passa a ${pkg.version}.`);
if (out) fs.appendFileSync(out, `changed=true\nelectron=${target}\nversion=${pkg.version}\n`);

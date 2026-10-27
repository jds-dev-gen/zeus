'use strict';
/*
 * Atualizações automáticas do Zeus (macOS).
 *
 * De onde vêm: só das versões publicadas no repositório GitHub configurado
 * (GitHub Releases), por HTTPS. Cada versão traz um SHA256SUMS.txt; o ficheiro
 * descarregado tem de bater certo com ele e a app extraída tem de ser o Zeus
 * (identificador pt.joao.zeus) na versão anunciada.
 *
 * Como se instala: a app nova fica preparada em segundo plano. Ao reiniciar
 * (ou ao fechar o Zeus), um pequeno script espera que o Zeus feche, troca a
 * app antiga pela nova e, se pedido, volta a abri-la.
 */
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const BUNDLE_ID = 'pt.joao.zeus';
const EVERY_MS = 4 * 60 * 60 * 1000;

function newer(a, b) {
  const pa = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (err, out) => err ? rej(err) : res(out)));

class Updater {
  constructor({ getRepo, isEnabled, onStatus }) {
    this.getRepo = getRepo;
    this.isEnabled = isEnabled;
    this.onStatus = onStatus;
    this.status = { state: 'idle', current: app.getVersion() };
    this.pending = null;    // { version, appPath }
    this.busy = false;
    this.timer = null;
    this.installing = false;
  }

  set(st) { this.status = Object.assign({ current: app.getVersion() }, st); this.onStatus(this.status); }

  start() {
    setTimeout(() => this.check(false), 20 * 1000);
    this.timer = setInterval(() => this.check(false), EVERY_MS);
    // se fechar o Zeus com uma atualização pronta, instala-a sem reabrir
    app.on('will-quit', () => { if (this.pending && !this.installing) this.swap(false); });
  }

  supported() {
    if (process.platform !== 'darwin') return 'As atualizações automáticas ainda só existem no Mac.';
    if (!app.isPackaged) return 'As atualizações só funcionam na app instalada.';
    return null;
  }

  async check(manual) {
    if (this.busy) return this.status;
    if (!manual && !this.isEnabled()) return this.status;
    const why = this.supported();
    if (why) { this.set({ state: 'unsupported', message: why }); return this.status; }
    if (this.pending) { this.set({ state: 'ready', version: this.pending.version }); return this.status; }
    const repo = (this.getRepo() || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { this.set({ state: 'norepo', message: 'Falta indicar o repositório das atualizações.' }); return this.status; }
    this.busy = true;
    try {
      this.set({ state: 'checking' });
      const rel = await this.json(`https://api.github.com/repos/${repo}/releases/latest`);
      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (!version || !newer(version, app.getVersion())) { this.set({ state: 'uptodate', checkedAt: Date.now() }); return this.status; }
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const name = `Zeus-${version}-mac-${arch}.zip`;
      const asset = (rel.assets || []).find(a => a.name === name);
      const sums = (rel.assets || []).find(a => a.name === 'SHA256SUMS.txt');
      if (!asset || !sums) throw new Error('A versão ' + version + ' não tem os ficheiros esperados.');
      const sumsText = await this.text(sums.browser_download_url);
      const line = sumsText.split('\n').find(l => l.trim().endsWith(' ' + name) || l.trim().endsWith('*' + name));
      const expected = line && line.trim().split(/\s+/)[0].toLowerCase();
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Falta a soma de verificação da versão ' + version + '.');

      const dir = path.join(app.getPath('userData'), 'updates', version);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const zip = path.join(dir, name);
      this.set({ state: 'downloading', version, progress: 0 });
      const got = await this.download(asset.browser_download_url, zip, p => this.set({ state: 'downloading', version, progress: p }));
      if (got !== expected) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('O ficheiro descarregado não corresponde à versão publicada. Foi apagado.'); }

      await run('/usr/bin/ditto', ['-x', '-k', zip, dir]);
      const appPath = path.join(dir, 'Zeus.app');
      const plist = fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
      if (!plist.includes('<string>' + BUNDLE_ID + '</string>') || !plist.includes('<string>' + version + '</string>')) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error('A app descarregada não é a versão esperada do Zeus. Foi apagada.');
      }
      fs.rmSync(zip, { force: true });
      // descarregado pelo próprio Zeus, sem quarentena; ainda assim garante
      try { await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath]); } catch (e) { /* sem atributo */ }
      this.pending = { version, appPath };
      this.set({ state: 'ready', version });
    } catch (e) {
      this.set({ state: 'error', message: e.message || String(e) });
    } finally {
      this.busy = false;
    }
    return this.status;
  }

  async json(url) {
    const r = await net.fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Zeus-updater' }, cache: 'no-store' });
    if (r.status === 404) throw new Error('Ainda não há versões publicadas no repositório.');
    if (!r.ok) throw new Error('O GitHub respondeu com o erro ' + r.status + '.');
    return r.json();
  }
  async text(url) {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Zeus-updater' }, cache: 'no-store' });
    if (!r.ok) throw new Error('Não foi possível descarregar a lista de verificação (' + r.status + ').');
    return r.text();
  }
  async download(url, file, onProgress) {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Zeus-updater' }, cache: 'no-store' });
    if (!r.ok || !r.body) throw new Error('Não foi possível descarregar a atualização (' + r.status + ').');
    const total = parseInt(r.headers.get('content-length') || '0', 10);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    const reader = r.body.getReader();
    let done = 0, last = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      if (!out.write(buf)) await new Promise(res => out.once('drain', res));
      done += buf.length;
      if (total && Date.now() - last > 400) { last = Date.now(); onProgress(Math.round(done / total * 100)); }
    }
    await new Promise((res, rej) => out.end(err => err ? rej(err) : res()));
    return hash.digest('hex');
  }

  /* Troca a app instalada pela nova. relaunch=true volta a abrir o Zeus. */
  swap(relaunch) {
    if (!this.pending || this.installing) return { ok: false };
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    if (!bundle.endsWith('.app')) return { ok: false, error: 'Não encontrei a app instalada.' };
    try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); } catch (e) {
      return { ok: false, error: 'Não tenho permissão para atualizar o Zeus nesta pasta. Move o Zeus para a pasta Aplicações e volta a tentar.' };
    }
    if (bundle.includes('/AppTranslocation/')) return { ok: false, error: 'Move o Zeus para a pasta Aplicações e abre-o de lá; depois a atualização instala-se sozinha.' };
    const script = path.join(app.getPath('userData'), 'updates', 'instalar.sh');
    const old = bundle + '.antigo';
    fs.writeFileSync(script, [
      '#!/bin/sh',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      `rm -rf ${q(old)}`,
      `if mv ${q(bundle)} ${q(old)}; then`,
      `  if mv ${q(this.pending.appPath)} ${q(bundle)}; then rm -rf ${q(old)}; else mv ${q(old)} ${q(bundle)}; fi`,
      'fi',
      relaunch ? `open ${q(bundle)}` : '',
      `rm -rf ${q(path.dirname(this.pending.appPath))}`,
      ''
    ].join('\n'), { mode: 0o755 });
    this.installing = true;
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }

  install() {
    const r = this.swap(true);
    if (r.ok) setTimeout(() => app.quit(), 100);
    else if (r.error) this.set(Object.assign({}, this.status, { state: 'ready', message: r.error }));
    return r;
  }
}

module.exports = { Updater, newer };

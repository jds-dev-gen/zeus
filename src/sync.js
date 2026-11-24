'use strict';
/*
 * Sincronização com a Drive do João (desde a 0.23.0) — Zeus do Mac ⇄ Zeus do tablet.
 *
 * Cada "documento" (para já só o Zoom: artigos, coleções e destaques) é um ficheiro JSON na pasta
 * escondida da app na Drive (appDataFolder). Essa pasta não aparece na Drive, e o Zeus só pede
 * acesso a ela (drive.appdata): não vê nem mexe no resto da Drive. A app do tablet usa o mesmo
 * projeto Google, por isso vê a mesma pasta.
 *
 * Em cada sincronização: lê-se a cópia da Drive, junta-se com a do Mac (merge do documento,
 * a mesma regra nos dois aparelhos), a junção passa a ser a cópia do Mac e, se for diferente da
 * que estava na Drive, envia-se. Como os dois lados guardam o que mudaram e a junção é sempre a
 * mesma, mesmo que os dois enviem ao mesmo tempo tudo acerta na volta seguinte.
 *
 * Entrar com o Google: fluxo de "app de computador" (código + PKCE, resposta num endereço
 * 127.0.0.1 local). As credenciais do projeto (ID e segredo do cliente) e a chave de acesso
 * ficam cifradas com o porta-chaves do Mac (safeStorage), em sync-google.bin.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid email';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const EVERY = 2 * 60 * 1000;      // de 2 em 2 minutos
const AFTER_CHANGE = 4000;        // e 4 s depois de uma alteração no Mac

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const stable = o => JSON.stringify(o);

class Sync {
  /*
   * opts: { dir, fetch, safeStorage, openURL(url) → fecha() opcional, onStatus(status) }
   * documentos: register(name, { get() → objeto, merge(local, remoto) → objeto, apply(objeto) })
   */
  constructor(opts) {
    this.o = opts;
    this.file = path.join(opts.dir, 'sync-google.bin');
    this.docs = new Map();
    this.cfg = this.load();
    this.tok = null;                 // { access, exp }
    this.fileIds = {};
    this.st = { state: 'idle', lastOk: 0, error: '' };
    this.running = null; this.again = false;
    this.timer = null; this.soon = null;
  }

  /* ---------- credenciais (cifradas) ---------- */
  load() {
    try {
      const b = fs.readFileSync(this.file);
      const txt = b.subarray(0, 4).toString() === 'TXT:' ? b.subarray(4).toString() : this.o.safeStorage.decryptString(b);
      return JSON.parse(txt) || {};
    } catch (e) { return {}; }
  }
  store() {
    const txt = JSON.stringify(this.cfg);
    const ss = this.o.safeStorage;
    const data = ss.isEncryptionAvailable() ? ss.encryptString(txt) : Buffer.concat([Buffer.from('TXT:'), Buffer.from(txt)]);
    try { fs.writeFileSync(this.file, data, { mode: 0o600 }); } catch (e) { /* ok */ }
  }
  setClient(id, secret) {
    id = String(id || '').trim(); secret = String(secret || '').trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) return { ok: false, error: 'O ID do cliente deve acabar em .apps.googleusercontent.com.' };
    if (!secret) return { ok: false, error: 'Falta o segredo do cliente.' };
    const changed = id !== this.cfg.clientId;
    this.cfg = Object.assign({}, changed ? {} : this.cfg, { clientId: id, clientSecret: secret });
    this.tok = null; this.store(); this.emit();
    return { ok: true };
  }

  status() {
    return {
      configured: !!(this.cfg.clientId && this.cfg.clientSecret),
      connected: !!this.cfg.refresh,
      email: this.cfg.email || '',
      clientId: this.cfg.clientId || '',
      state: this.st.state, lastOk: this.st.lastOk, error: this.st.error
    };
  }
  emit() { try { this.o.onStatus && this.o.onStatus(this.status()); } catch (e) { /* ok */ } }
  set(state, error = '') { this.st.state = state; this.st.error = error; if (state === 'ok') this.st.lastOk = Date.now(); this.emit(); }

  /* ---------- entrar com o Google ---------- */
  connect() {
    if (!this.cfg.clientId) return Promise.resolve({ ok: false, error: 'Primeiro guarda o ID e o segredo do cliente.' });
    if (this.pending) return this.pending;
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    this.pending = new Promise(resolve => {
      let done = false, closeTab = null;
      const finish = (r, srv) => {
        if (done) return; done = true;
        clearTimeout(limit); try { srv.close(); } catch (e) { /* ok */ }
        this.pending = null;
        setTimeout(() => { try { closeTab && closeTab(); } catch (e) { /* ok */ } }, 1500);
        resolve(r);
      };
      const srv = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const page = (t, m) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>Zeus</title><body style="font:16px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;margin:0"><div style="text-align:center"><h2 style="margin:0 0 8px">${t}</h2><p style="color:#666;margin:0">${m}</p></div>`); };
        if (u.searchParams.get('state') !== state) { page('Pedido inválido', 'Tenta outra vez a partir das Definições do Zeus.'); return; }
        const err = u.searchParams.get('error'), code = u.searchParams.get('code');
        if (err || !code) { page('Não foi possível entrar', err === 'access_denied' ? 'O acesso não foi autorizado.' : 'Tenta outra vez.'); finish({ ok: false, error: err === 'access_denied' ? 'O acesso à Drive não foi autorizado.' : 'Não foi possível entrar.' }, srv); return; }
        try {
          const j = await this.tokenCall({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: `http://127.0.0.1:${srv.address().port}` });
          if (!j.refresh_token) throw new Error('A Google não devolveu a chave de acesso permanente.');
          this.cfg.refresh = j.refresh_token;
          this.cfg.email = emailOf(j.id_token);
          this.tok = { access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
          this.store();
          page('Zeus ligado à Drive', 'Já podes fechar este separador.');
          finish({ ok: true, email: this.cfg.email }, srv);
          this.start(); this.now();
        } catch (e) {
          page('Não foi possível entrar', String(e.message || e));
          finish({ ok: false, error: String(e.message || e) }, srv);
        }
      });
      const limit = setTimeout(() => finish({ ok: false, error: 'Passaram 5 minutos sem resposta da Google.' }, srv), 5 * 60 * 1000);
      srv.on('error', e => finish({ ok: false, error: 'Não consegui preparar a ligação: ' + e.message }, srv));
      srv.listen(0, '127.0.0.1', () => {
        const q = new URLSearchParams({
          client_id: this.cfg.clientId, redirect_uri: `http://127.0.0.1:${srv.address().port}`, response_type: 'code',
          scope: SCOPES, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state
        });
        closeTab = this.o.openURL(`${AUTH}?${q}`);
      });
    });
    return this.pending;
  }
  async disconnect() {
    const t = this.cfg.refresh;
    delete this.cfg.refresh; delete this.cfg.email;
    this.tok = null; this.fileIds = {}; this.store();
    clearInterval(this.timer); this.timer = null;
    this.set('idle');
    if (t) { try { await this.o.fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }); } catch (e) { /* ok */ } }
    return true;
  }

  async tokenCall(params) {
    const body = new URLSearchParams(Object.assign({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }, params));
    const r = await this.o.fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error_description || j.error || ('HTTP ' + r.status)); e.code = j.error; throw e; }
    return j;
  }
  async access() {
    if (this.tok && Date.now() < this.tok.exp) return this.tok.access;
    if (!this.cfg.refresh) throw new Error('Sem sessão Google.');
    try {
      const j = await this.tokenCall({ grant_type: 'refresh_token', refresh_token: this.cfg.refresh });
      this.tok = { access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
      return this.tok.access;
    } catch (e) {
      if (e.code === 'invalid_grant') {   // acesso retirado (ou projeto em "teste": expira ao fim de 7 dias)
        delete this.cfg.refresh; this.store();
        throw new Error('A Google pediu para voltares a entrar. Carrega em "Entrar com o Google".');
      }
      throw e;
    }
  }
  async api(url, init = {}, retry = true) {
    const t = await this.access();
    const r = await this.o.fetch(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + t }, init.headers || {}) }));
    if (r.status === 401 && retry) { this.tok = null; return this.api(url, init, false); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error((j.error && j.error.message) || ('Drive: HTTP ' + r.status));
    }
    return r;
  }

  /* ---------- ficheiros na pasta escondida da app ---------- */
  async findFile(name) {
    if (this.fileIds[name]) return this.fileIds[name];
    const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${name}' and trashed = false`, fields: 'files(id,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '10' });
    const j = await (await this.api(`${DRIVE}/files?${q}`)).json();
    const f = (j.files || [])[0];
    if (f) this.fileIds[name] = f.id;
    return f ? f.id : null;
  }
  async download(id) {
    const r = await this.api(`${DRIVE}/files/${id}?alt=media`);
    const txt = await r.text();
    try { return JSON.parse(txt); } catch (e) { return null; }
  }
  async upload(name, obj, id) {
    const json = JSON.stringify(obj);
    if (id) {
      await this.api(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json });
      return id;
    }
    const boundary = 'zeus' + crypto.randomBytes(8).toString('hex');
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const j = await (await this.api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
    this.fileIds[name] = j.id;
    return j.id;
  }

  /* ---------- documentos ---------- */
  register(name, doc) { this.docs.set(name, doc); }
  async syncDoc(name, doc) {
    const file = name + '.json';
    const id = await this.findFile(file);
    const local = doc.get();
    if (!id) { await this.upload(file, local, null); return; }
    let remote;
    try { remote = await this.download(id); } catch (e) { if (/404/.test(e.message)) { delete this.fileIds[file]; return this.syncDoc(name, doc); } throw e; }
    const merged = remote ? doc.merge(local, remote) : local;
    if (stable(merged) !== stable(doc.get())) doc.apply(merged);
    if (!remote || stable(merged) !== stable(remote)) await this.upload(file, merged, id);
  }

  /* uma volta de sincronização (se já há uma a correr, faz-se outra a seguir) */
  now() {
    if (!this.cfg.refresh) return Promise.resolve(false);
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      this.set('syncing');
      try {
        for (const [name, doc] of this.docs) await this.syncDoc(name, doc);
        this.set('ok');
        return true;
      } catch (e) {
        this.set('error', String(e.message || e));
        return false;
      } finally {
        this.running = null;
        if (this.again) { this.again = false; setTimeout(() => this.now(), 500); }
      }
    })();
    return this.running;
  }
  /* uma alteração no Mac: sincroniza daqui a pouco (juntando várias seguidas) */
  touch() {
    if (!this.cfg.refresh) return;
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.now(), AFTER_CHANGE);
  }
  start() {
    if (!this.cfg.refresh || this.timer) return;
    this.timer = setInterval(() => this.now(), EVERY);
    setTimeout(() => this.now(), 5000);
  }
}

function emailOf(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString()).email || ''; } catch (e) { return ''; }
}

module.exports = { Sync };

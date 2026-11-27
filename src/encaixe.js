'use strict';
/*
 * Encaixe no Olimpo.
 * O Olimpo (a interface que substitui a secretária do Mac) pode mostrar o Zeus "dentro" de si, como
 * mostra o Apolo: pede ao Zeus, por um socket local, que ponha a janela exatamente por cima do painel
 * (sem os botões de janela). Ao sair do painel, o Olimpo pede para soltar e o Zeus volta ao tamanho e
 * ao sítio de antes. Se o Olimpo fechar (ou a ligação cair), o Zeus solta-se sozinho.
 *
 * Socket: <userData>/olimpo.sock (só o próprio utilizador lhe chega). Uma linha JSON por pedido:
 *   {"cmd":"encaixar","x":..,"y":..,"width":..,"height":..}  → põe a janela ali e traz o Zeus à frente
 *   {"cmd":"mostrar"}                                         → traz o Zeus à frente (se estiver encaixado)
 *   {"cmd":"soltar"}                                          → volta à janela normal
 *   {"cmd":"estado"}                                          → {encaixado, versao}
 * Cada pedido tem uma resposta numa linha JSON ({"ok":true,...}).
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

function setupEncaixe({ app, getWin, versao, log = () => {} }) {
  const isMac = process.platform === 'darwin';
  const sock = process.platform === 'win32' ? '\\\\.\\pipe\\zeus-olimpo' : path.join(app.getPath('userData'), 'olimpo.sock');
  const E = { encaixado: false, antes: null, dono: null };

  const frente = win => {
    if (win.isMinimized()) win.restore();
    win.show();
    if (isMac) { try { app.focus({ steal: true }); } catch (e) { /* ok */ } }
    win.focus();
  };

  function encaixar(r, cliente) {
    const win = getWin(); if (!win) return { ok: false, erro: 'sem janela' };
    const rect = { x: Math.round(+r.x), y: Math.round(+r.y), width: Math.round(+r.width), height: Math.round(+r.height) };
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 200 || rect.height < 200) return { ok: false, erro: 'retângulo inválido' };
    if (!E.encaixado) {
      if (win.isFullScreen()) win.setFullScreen(false);
      E.antes = { bounds: win.getNormalBounds(), max: win.isMaximized(), min: win.getMinimumSize() };
      if (win.isMaximized()) win.unmaximize();
      win.setMinimumSize(200, 200);
      if (isMac && win.setWindowButtonVisibility) win.setWindowButtonVisibility(false);
      E.encaixado = true;
    }
    E.dono = cliente;
    win.setBounds(rect);
    frente(win);
    return { ok: true };
  }

  function soltar() {
    const win = getWin();
    if (!E.encaixado) return { ok: true };
    E.encaixado = false; E.dono = null;
    if (!win) return { ok: true };
    if (isMac && win.setWindowButtonVisibility) win.setWindowButtonVisibility(true);
    const a = E.antes || {};
    if (a.min) win.setMinimumSize(a.min[0], a.min[1]);
    if (a.bounds) win.setBounds(a.bounds);
    if (a.max) win.maximize();
    E.antes = null;
    return { ok: true };
  }

  function tratar(m, cliente) {
    switch (m && m.cmd) {
      case 'encaixar': return encaixar(m, cliente);
      case 'mostrar': { const win = getWin(); if (win && E.encaixado) frente(win); return { ok: true, encaixado: E.encaixado }; }
      case 'soltar': return soltar();
      case 'estado': return { ok: true, encaixado: E.encaixado, versao };
      default: return { ok: false, erro: 'pedido desconhecido' };
    }
  }

  const server = net.createServer(c => {
    let buf = '';
    c.setEncoding('utf8');
    c.on('data', d => {
      buf += d;
      if (buf.length > 64 * 1024) { c.destroy(); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i); buf = buf.slice(i + 1);
        let r;
        try { r = tratar(JSON.parse(linha), c); } catch (e) { r = { ok: false, erro: e.message }; }
        try { c.write(JSON.stringify(r) + '\n'); } catch (e) { /* ligação fechada */ }
      }
    });
    // o Olimpo fechou: a janela volta ao normal
    c.on('close', () => { if (E.dono === c) soltar(); });
    c.on('error', () => {});
  });
  server.on('error', e => log('encaixe: ' + e.message));
  try { if (process.platform !== 'win32' && fs.existsSync(sock)) fs.unlinkSync(sock); } catch (e) { /* ok */ }
  server.listen(sock, () => { try { if (process.platform !== 'win32') fs.chmodSync(sock, 0o600); } catch (e) { /* ok */ } });
  app.on('will-quit', () => { try { server.close(); if (process.platform !== 'win32') fs.unlinkSync(sock); } catch (e) { /* ok */ } });

  return {
    get encaixado() { return E.encaixado; },
    /* tamanho a guardar no estado do Zeus: o de antes do encaixe, nunca o do painel */
    boundsGuardar() { return E.encaixado && E.antes ? E.antes.bounds : null; },
    soltar
  };
}

module.exports = { setupEncaixe };

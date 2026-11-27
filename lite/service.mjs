import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { attachDesktopCompatible } from '../lib/desktop-connect.mjs';
import { createThreadCatalog } from '../lib/thread-catalog.mjs';
import { ScopedThread } from '../lib/scoped-thread.mjs';
import { GuestUploads, UPLOAD_CHUNK_BYTES } from '../lib/guest-uploads.mjs';
import { createShare, newToken } from './state-store.mjs';
import { allowedHost, clientAddress, isLanClient, isLoopback, lanAddresses } from './network.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8']]);
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws:; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function sameToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || Buffer.byteLength(left) !== Buffer.byteLength(right)) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function safeSend(socket, value) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > 20 * 1024 * 1024) return false;
  socket.send(body);
  return true;
}

async function jsonBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('请求格式无效'), { status: 400 }); }
}

function publicShare(share, state, status, snapshot) {
  const base = `http://${state.hostname}:${state.port}/s/${share.id}`;
  return {
    id: share.id, threadId: share.threadId, title: snapshot?.title || share.title, viewerName: share.viewerName,
    createdAt: share.createdAt, status, url: `${base}#token=${share.token}`,
    fallbackUrls: lanAddresses().map(address => `http://${address}:${state.port}/s/${share.id}#token=${share.token}`),
  };
}

export class LiteService {
  constructor({ root, runtimeDir, store, hostname, port, catalog = createThreadCatalog(), attach = attachDesktopCompatible } = {}) {
    if (![root, runtimeDir].every(path.isAbsolute) || !store) throw new TypeError('LiteService requires absolute project paths and a state store');
    Object.assign(this, { root, runtimeDir, store, hostname, port, catalog, attach });
    this.webRoot = path.join(root, 'lite', 'web');
    this.runtimes = new Map();
    this.clients = new Map();
    this.persistTails = new Map();
    this.desktop = { phase: 'starting', message: '正在连接 Codex Desktop' };
    this.closed = false;
  }

  async start() {
    await fs.mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.runtimeDir, 0o700);
    this.server = http.createServer((req, res) => void this.route(req, res));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    this.server.on('clientError', (_error, socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '0.0.0.0', () => { this.server.off('error', reject); resolve(); });
    });
    this.connectDesktop();
    return this.info();
  }

  info() {
    const state = this.store.snapshot();
    return { ownerUrl: `http://127.0.0.1:${state.port}/admin#owner=${state.ownerToken}`,
      guestBaseUrl: `http://${state.hostname}:${state.port}`, port: state.port, hostname: state.hostname };
  }

  managerAuthorized(req) {
    if (!isLoopback(clientAddress(req))) return false;
    const auth = req.headers.authorization;
    return typeof auth === 'string' && auth.startsWith('Bearer ') && sameToken(auth.slice(7), this.store.state.ownerToken);
  }

  guestAuthorized(req, share) {
    return isLanClient(req) && sameToken(req.headers['x-share-token'], share.token);
  }

  getShare(id) {
    return this.store.state.shares.find(share => share.id === id) ?? null;
  }

  snapshotFor(id) {
    return this.runtimes.get(id)?.snapshot ?? null;
  }

  statusFor(id) {
    const runtime = this.runtimes.get(id);
    if (runtime?.snapshot?.status && runtime.snapshot.status !== 'offline') return runtime.snapshot.status;
    return this.desktop.phase === 'connected' ? 'restoring' : 'offline';
  }

  async route(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (!allowedHost(req, { hostname: this.hostname, port: this.port }) || !isLanClient(req)) return sendJson(res, 403, { error: '拒绝非内网访问' });
      if (url.pathname === '/health') return sendJson(res, 200, { ok: true, desktop: this.desktop.phase });
      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        if (!isLoopback(clientAddress(req))) return sendJson(res, 403, { error: '管理后台仅允许本机访问' });
        return this.staticFile(res, 'admin.html');
      }
      if (url.pathname.startsWith('/assets/')) return this.staticFile(res, url.pathname.slice('/assets/'.length));
      const guestPage = /^\/s\/([0-9a-f-]{36})\/?$/i.exec(url.pathname);
      if (guestPage) {
        if (!this.getShare(guestPage[1])) return this.gone(res);
        return this.staticFile(res, 'guest.html');
      }
      if (url.pathname.startsWith('/api/')) return await this.api(req, res, url);
      res.writeHead(302, { Location: '/admin', ...SECURITY_HEADERS }).end();
    } catch (error) {
      sendJson(res, error.status ?? 500, { error: error.status ? error.message : '服务处理失败' });
    }
  }

  async staticFile(res, name) {
    if (!/^[a-z0-9._-]+$/i.test(name)) return sendJson(res, 404, { error: '未找到资源' });
    const file = path.join(this.webRoot, name);
    const bytes = await fs.readFile(file).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!bytes) return sendJson(res, 404, { error: '未找到资源' });
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME.get(path.extname(file)) ?? 'application/octet-stream', 'Content-Length': bytes.length });
    res.end(bytes);
  }

  gone(res) {
    const body = Buffer.from('<!doctype html><meta charset="utf-8"><title>共享已停止</title><style>body{font:16px system-ui;margin:10vh auto;max-width:560px;padding:24px;color:#202124}h1{font-size:24px}</style><h1>共享已停止</h1><p>这个链接已被分享者撤销，请联系分享者获取新链接。</p>');
    res.writeHead(410, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length }).end(body);
  }

  async api(req, res, url) {
    const image = /^\/api\/shares\/([0-9a-f-]{36})\/images\/([a-f0-9]{64})$/i.exec(url.pathname);
    const file = /^\/api\/shares\/([0-9a-f-]{36})\/files\/([a-f0-9]{64})$/i.exec(url.pathname);
    if (image || file) return this.asset(req, res, image || file, Boolean(image), url);
    if (!this.managerAuthorized(req)) return sendJson(res, 401, { error: '管理凭据无效，请重新运行启动命令' });
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const state = this.store.snapshot();
      return sendJson(res, 200, { desktop: this.desktop, hostname: state.hostname, port: state.port,
        addresses: lanAddresses(), uploadChunkBytes: UPLOAD_CHUNK_BYTES,
        shares: state.shares.map(share => publicShare(share, state, this.statusFor(share.id), this.snapshotFor(share.id))) });
    }
    if (req.method === 'GET' && url.pathname === '/api/threads') {
      const cursor = Number(url.searchParams.get('cursor') || 0);
      const search = url.searchParams.get('search') || '';
      return sendJson(res, 200, await this.catalog.list({ cursor, search }));
    }
    if (req.method === 'POST' && url.pathname === '/api/shares') {
      const body = await jsonBody(req);
      if (!UUID.test(body.threadId ?? '') || typeof body.title !== 'string' || typeof body.viewerName !== 'string') {
        return sendJson(res, 400, { error: '请选择有效会话并填写协作者名称' });
      }
      const existing = this.store.state.shares.find(share => share.threadId === body.threadId);
      if (existing) return sendJson(res, 200, publicShare(existing, this.store.state, this.statusFor(existing.id), this.snapshotFor(existing.id)));
      if (!await this.catalog.contains(body.threadId)) return sendJson(res, 404, { error: '会话已归档或不在当前 Codex 索引中' });
      const share = createShare(body);
      await this.store.update(state => { state.shares.push(share); });
      void this.restoreShare(share);
      return sendJson(res, 201, publicShare(share, this.store.state, this.statusFor(share.id), null));
    }
    const rotate = /^\/api\/shares\/([0-9a-f-]{36})\/rotate$/i.exec(url.pathname);
    if (req.method === 'POST' && rotate) {
      let changed;
      await this.store.update(state => {
        changed = state.shares.find(share => share.id === rotate[1]);
        if (changed) changed.token = newToken();
      });
      if (!changed) return sendJson(res, 404, { error: '共享不存在' });
      for (const socket of this.clients.get(changed.id) ?? []) socket.close(4003, 'link rotated');
      return sendJson(res, 200, publicShare(this.getShare(changed.id), this.store.state, this.statusFor(changed.id), this.snapshotFor(changed.id)));
    }
    const remove = /^\/api\/shares\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (req.method === 'DELETE' && remove) {
      const share = this.getShare(remove[1]);
      if (!share) return sendJson(res, 404, { error: '共享不存在' });
      await this.store.update(state => { state.shares = state.shares.filter(item => item.id !== share.id); });
      await this.stopRuntime(share.id);
      await this.store.removeSnapshot(share.id);
      for (const socket of this.clients.get(share.id) ?? []) socket.close(4004, 'sharing stopped');
      this.clients.delete(share.id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/reconnect') {
      this.connectDesktop(true);
      return sendJson(res, 202, { ok: true });
    }
    return sendJson(res, 404, { error: '接口不存在' });
  }

  async asset(req, res, match, image, url) {
    const share = this.getShare(match[1]);
    if (!share || !this.guestAuthorized(req, share)) return sendJson(res, 401, { error: '链接凭据无效' });
    const runtime = this.runtimes.get(share.id);
    if (!runtime?.thread || runtime.snapshot?.status === 'offline') return sendJson(res, 503, { error: '分享者暂时离线' });
    try {
      const value = image ? await runtime.thread.readImage(match[2])
        : await runtime.thread.readFile(match[2], { representation: url.searchParams.get('original') === '1' ? 'original' : 'preview' });
      const ref = runtime.snapshot.items.flatMap(item => image ? item.images ?? [] : item.files ?? []).find(item => item.id === match[2]);
      const filename = String(ref?.name || (image ? 'image' : 'attachment')).replace(/[\r\n"\\]/g, '_');
      res.writeHead(200, { ...SECURITY_HEADERS, 'Cache-Control': 'private, max-age=60', 'Content-Type': value.mime,
        'Content-Length': value.bytes.length, 'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename="${filename}"` });
      res.end(value.bytes);
    } catch { sendJson(res, 404, { error: '附件不可用' }); }
  }

  upgrade(req, socket, head) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const match = /^\/ws\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (!match || !allowedHost(req, { hostname: this.hostname, port: this.port }) || !isLanClient(req) || !this.getShare(match[1])) return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, ws => this.guestSocket(ws, match[1]));
    } catch { socket.destroy(); }
  }

  guestSocket(socket, shareId) {
    let authenticated = false;
    let shareToken = null;
    const authTimer = setTimeout(() => socket.close(4001, 'authentication required'), 5000);
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(authTimer);
      if (authenticated) this.clients.get(shareId)?.delete(socket);
    });
    socket.on('message', bytes => void (async () => {
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { return socket.close(4002, 'invalid message'); }
      const share = this.getShare(shareId);
      if (!authenticated) {
        if (!share || message?.type !== 'auth' || !sameToken(message.token, share.token)) return socket.close(4001, 'invalid link');
        authenticated = true; shareToken = share.token; clearTimeout(authTimer);
        if (!this.clients.has(shareId)) this.clients.set(shareId, new Set());
        this.clients.get(shareId).add(socket);
        const stored = this.snapshotFor(shareId) ?? await this.store.readSnapshot(shareId);
        return safeSend(socket, { type: 'ready', share: { id: share.id, title: stored?.title || share.title, viewerName: share.viewerName },
          snapshot: stored ? { ...stored, status: this.statusFor(shareId) } : { type: 'snapshot', title: share.title, items: [], status: 'offline', revision: 0 },
          uploads: Boolean(this.runtimes.get(shareId)?.uploadsEnabled), uploadChunkBytes: UPLOAD_CHUNK_BYTES });
      }
      if (!share || share.token !== shareToken) return socket.close(4003, 'link revoked');
      await this.guestMessage(socket, share, message);
    })().catch(error => safeSend(socket, { type: 'error', requestId: error.requestId, message: error.safeMessage || error.message || '操作失败' })));
  }

  async guestMessage(socket, share, message) {
    const runtime = this.runtimes.get(share.id);
    if (message?.type === 'ping') return safeSend(socket, { type: 'pong' });
    if (!runtime || runtime.snapshot?.status === 'offline') throw new Error('分享者暂时离线，请稍后重试');
    if (['upload-start', 'upload-chunk', 'upload-finish', 'upload-cancel'].includes(message?.type)) {
      if (!runtime.uploadsEnabled) throw new Error('当前共享未开放附件');
      const { requestId, ...upload } = message;
      const result = runtime.uploads.receive(share.id, upload, share.id);
      return safeSend(socket, { ...result, requestId });
    }
    if (message?.type !== 'submit' || !UUID.test(message.requestId ?? '') || typeof message.text !== 'string'
      || !Array.isArray(message.uploadIds) || message.uploadIds.length > 8) throw new Error('无效的消息请求');
    let attachments = [];
    try {
      if (message.uploadIds.length) attachments = runtime.uploads.claim(share.id, message.uploadIds);
      const token = share.token;
      const result = await runtime.thread.submitApproved(message.text, message.requestId, {
        attachments,
        canDispatch: () => this.getShare(share.id)?.token === token && this.runtimes.get(share.id) === runtime,
      });
      safeSend(socket, { type: 'submitted', requestId: message.requestId, result });
    } catch (error) {
      error.requestId = message.requestId;
      throw error;
    } finally { runtime.uploads.release(attachments); }
  }

  broadcast(shareId, message) {
    for (const socket of this.clients.get(shareId) ?? []) safeSend(socket, message);
  }

  connectDesktop(force = false) {
    if (this.closed || this.connecting) return;
    clearTimeout(this.reconnectTimer);
    this.connecting = (async () => {
      this.desktop = { phase: 'connecting', message: '正在连接 Codex Desktop' };
      try {
        if (this.attachment) await this.attachment.reconnect();
        else this.attachment = await this.attach({ runtimeDir: this.runtimeDir, resourceRoot: this.root, catalog: this.catalog });
        if (this.closed) return;
        this.desktop = { phase: 'connected', message: 'Codex Desktop 已连接', transport: this.attachment.endpoint };
        this.attachment.removeAllListeners?.('disconnected');
        this.attachment.on?.('disconnected', () => this.desktopDisconnected());
        await this.restoreAll();
      } catch (error) {
        this.desktop = { phase: 'offline', message: error.safeMessage || error.message || 'Codex Desktop 连接失败' };
        this.scheduleReconnect();
      }
    })().finally(() => { this.connecting = null; });
  }

  desktopDisconnected() {
    if (this.closed) return;
    this.desktop = { phase: 'offline', message: 'Codex Desktop 已断开，正在自动重连' };
    for (const [id, runtime] of this.runtimes) {
      if (runtime.snapshot) {
        runtime.snapshot = { ...runtime.snapshot, status: 'offline' };
        this.broadcast(id, { type: 'snapshot', snapshot: runtime.snapshot, uploads: false });
      }
    }
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connectDesktop(); }, 5000);
    this.reconnectTimer.unref?.();
  }

  async restoreAll() {
    for (const share of this.store.snapshot().shares) {
      if (this.closed || this.desktop.phase !== 'connected') break;
      await this.restoreShare(share).catch(() => {});
    }
  }

  async restoreShare(share) {
    if (!this.attachment || this.desktop.phase !== 'connected' || !this.getShare(share.id)) return;
    await this.stopRuntime(share.id);
    await this.attachment.selectThread(share.threadId, { activate: false, canContinue: () => Boolean(this.getShare(share.id)) });
    const rpc = await this.attachment.rpcFactory();
    const thread = new ScopedThread({ rpc, threadId: share.threadId });
    const runtime = { rpc, thread, uploads: new GuestUploads(this.runtimeDir, share.id), snapshot: null, uploadsEnabled: false };
    this.runtimes.set(share.id, runtime);
    thread.on('snapshot', snapshot => {
      if (this.runtimes.get(share.id) !== runtime) return;
      runtime.snapshot = snapshot;
      if (snapshot.status !== 'offline') this.persistSnapshot(share.id, snapshot);
      this.broadcast(share.id, { type: 'snapshot', snapshot, uploads: runtime.uploadsEnabled });
    });
    thread.on('fault', () => { if (this.runtimes.get(share.id) === runtime) this.scheduleReconnect(); });
    try {
      runtime.snapshot = await thread.start();
      if (typeof rpc.setLocalUploadPermission === 'function') {
        rpc.setLocalUploadPermission(true);
        runtime.uploadsEnabled = rpc.canUploadAttachments?.() === true;
      }
      this.persistSnapshot(share.id, runtime.snapshot);
      this.broadcast(share.id, { type: 'snapshot', snapshot: runtime.snapshot, uploads: runtime.uploadsEnabled });
    } catch (error) {
      await this.stopRuntime(share.id);
      throw error;
    }
  }

  persistSnapshot(shareId, snapshot) {
    const previous = this.persistTails.get(shareId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.store.writeSnapshot(shareId, snapshot));
    const tracked = next.finally(() => { if (this.persistTails.get(shareId) === tracked) this.persistTails.delete(shareId); });
    this.persistTails.set(shareId, tracked);
  }

  async stopRuntime(shareId) {
    const runtime = this.runtimes.get(shareId);
    if (!runtime) return;
    this.runtimes.delete(shareId);
    runtime.thread.close();
    runtime.rpc.close?.();
    runtime.uploads.close();
  }

  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.closing = (async () => {
      for (const sockets of this.clients.values()) for (const socket of sockets) socket.close(1001, 'service stopped');
      for (const id of [...this.runtimes.keys()]) await this.stopRuntime(id);
      await Promise.allSettled([...this.persistTails.values()]);
      await this.attachment?.close?.();
      await new Promise(resolve => this.server.close(resolve));
      this.wss.close();
    })();
    return this.closing;
  }
}

export { randomUUID };

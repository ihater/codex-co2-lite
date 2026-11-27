import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { StateStore } from '../state-store.mjs';
import { LiteService } from '../service.mjs';

const thread = { id: '01a1e293-8f21-7af0-9eb6-7f5796bb4918', name: '分析1v1客户端与服务端代码', updatedAt: Date.now(), cwd: '/tmp/work' };
const catalog = { list: async () => ({ threads: [thread], total: 1, nextCursor: null }), contains: async id => id === thread.id };
const offlineAttach = async () => { throw new Error('test desktop offline'); };

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function request(port, pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function connectGuest(port, share) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/${share.id}`);
    const timer = setTimeout(() => reject(new Error('guest timeout')), 3000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: share.token })));
    socket.on('message', bytes => {
      const message = JSON.parse(bytes);
      if (message.type === 'ready') { clearTimeout(timer); resolve({ socket, message }); }
    });
    socket.on('error', reject);
  });
}

test('permanent link survives service restart and stop revokes it', async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'co2-lite-service-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtimeDir = path.join(directory, '.coop');
  const port = await freePort();
  const store = new StateStore(directory, { port, hostname: 'test.local' });
  const state = await store.open();
  const first = new LiteService({ root, runtimeDir, store, hostname: state.hostname, port, catalog, attach: offlineAttach });
  await first.start();
  const created = await request(port, '/api/shares', { token: state.ownerToken, method: 'POST', body: { threadId: thread.id, title: thread.name, viewerName: '同事A' } });
  assert.equal(created.status, 201);
  const share = store.snapshot().shares[0];
  const firstGuest = await connectGuest(port, share);
  assert.equal(firstGuest.message.snapshot.status, 'offline');
  firstGuest.socket.close();
  await first.close();

  const restoredStore = new StateStore(directory, { port: 60000, hostname: 'changed.local' });
  const restoredState = await restoredStore.open();
  const second = new LiteService({ root, runtimeDir, store: restoredStore, hostname: restoredState.hostname, port: restoredState.port, catalog, attach: offlineAttach });
  await second.start();
  const listed = await request(port, '/api/state', { token: restoredState.ownerToken });
  assert.equal(listed.body.shares[0].url, created.body.url);
  const secondGuest = await connectGuest(port, share);
  assert.equal(secondGuest.message.share.viewerName, '同事A');
  secondGuest.socket.close();
  const stopped = await request(port, `/api/shares/${share.id}`, { token: restoredState.ownerToken, method: 'DELETE' });
  assert.equal(stopped.status, 200);
  const gone = await fetch(`http://127.0.0.1:${port}/s/${share.id}`);
  assert.equal(gone.status, 410);
  await second.close();
});

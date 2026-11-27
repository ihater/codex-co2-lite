import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, createShare } from '../state-store.mjs';

test('state and snapshot survive a new store instance', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'co2-lite-state-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = new StateStore(directory, { port: 55661, hostname: 'test.local' });
  const initial = await first.open();
  const share = createShare({ threadId: '01a1e293-8f21-7af0-9eb6-7f5796bb4918', title: '会话', viewerName: '同事' });
  await first.update(state => state.shares.push(share));
  await first.writeSnapshot(share.id, { type: 'snapshot', title: '会话', items: [{ role: 'assistant', text: '结果' }], status: 'idle', revision: 1 });

  const second = new StateStore(directory, { port: 60000, hostname: 'changed.local' });
  const restored = await second.open();
  assert.equal(restored.ownerToken, initial.ownerToken);
  assert.equal(restored.port, 55661);
  assert.equal(restored.hostname, 'test.local');
  assert.deepEqual(restored.shares, [share]);
  assert.equal((await second.readSnapshot(share.id)).items[0].text, '结果');
  assert.equal((await fs.stat(path.join(directory, 'state.json'))).mode & 0o077, 0);
});

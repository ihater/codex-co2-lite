import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newToken() {
  return randomBytes(32).toString('base64url');
}

function validShare(value) {
  return value && UUID.test(value.id) && UUID.test(value.threadId) && TOKEN.test(value.token)
    && typeof value.title === 'string' && value.title.length <= 512
    && typeof value.viewerName === 'string' && value.viewerName.length <= 80
    && Number.isSafeInteger(value.createdAt) && value.createdAt > 0;
}

function validState(value) {
  return value && value.version === 1 && TOKEN.test(value.ownerToken)
    && Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535
    && typeof value.hostname === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/i.test(value.hostname)
    && Array.isArray(value.shares) && value.shares.every(validShare)
    && new Set(value.shares.map(share => share.id)).size === value.shares.length
    && new Set(value.shares.map(share => share.threadId)).size === value.shares.length;
}

export class StateStore {
  constructor(directory, { port = 55661, hostname } = {}) {
    if (!path.isAbsolute(directory) || !hostname) throw new TypeError('StateStore requires an absolute directory and hostname');
    this.directory = directory;
    this.snapshots = path.join(directory, 'snapshots');
    this.file = path.join(directory, 'state.json');
    this.defaults = { port, hostname: hostname.toLowerCase() };
    this.tail = Promise.resolve();
  }

  async open() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.directory, 0o700);
    await fs.mkdir(this.snapshots, { recursive: true, mode: 0o700 });
    await fs.chmod(this.snapshots, 0o700);
    let state;
    try { state = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Co2 Lite 状态文件无法读取或已损坏', { cause: error });
      state = { version: 1, ownerToken: newToken(), port: this.defaults.port,
        hostname: this.defaults.hostname, shares: [] };
      await this.write(state);
    }
    if (!validState(state)) throw new Error('Co2 Lite 状态文件格式不兼容');
    this.state = state;
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  update(change) {
    this.tail = this.tail.then(async () => {
      const next = structuredClone(this.state);
      await change(next);
      if (!validState(next)) throw new Error('拒绝保存无效的 Co2 Lite 状态');
      await this.write(next);
      this.state = next;
      return this.snapshot();
    });
    return this.tail;
  }

  async write(value) {
    const temporary = path.join(this.directory, `.state-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, this.file);
    await fs.chmod(this.file, 0o600);
  }

  snapshotFile(shareId) {
    if (!UUID.test(shareId)) throw new TypeError('Invalid share ID');
    return path.join(this.snapshots, `${shareId}.json`);
  }

  async readSnapshot(shareId) {
    try { return JSON.parse(await fs.readFile(this.snapshotFile(shareId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async writeSnapshot(shareId, snapshot) {
    const file = this.snapshotFile(shareId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(snapshot)); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  }

  async removeSnapshot(shareId) {
    await fs.unlink(this.snapshotFile(shareId)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function createShare({ threadId, title, viewerName }) {
  return { id: randomUUID(), threadId, token: newToken(), title: String(title || '共享会话').slice(0, 512),
    viewerName: String(viewerName || '协作者').slice(0, 80), createdAt: Date.now() };
}

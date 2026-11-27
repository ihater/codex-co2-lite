#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateStore } from './state-store.mjs';
import { localHostname } from './network.mjs';
import { LiteService } from './service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.CO2_LITE_DATA_DIR ? path.resolve(process.env.CO2_LITE_DATA_DIR) : path.join(root, '.lite-data');
const runtimeDir = path.join(dataDir, '.coop');
const hostname = await localHostname();
const store = new StateStore(dataDir, { port: Number(process.env.CO2_LITE_PORT || 55661), hostname });
const state = await store.open();
const service = new LiteService({ root, runtimeDir, store, hostname: state.hostname, port: state.port });

let closing;
async function close(code) {
  if (closing) return closing;
  closing = service.close().finally(() => process.exit(code));
  return closing;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void close(0));
process.once('uncaughtException', error => { console.error(`[fatal] ${error.stack || error.message}`); void close(1); });
process.once('unhandledRejection', error => { console.error(`[fatal] ${error?.stack || error}`); void close(1); });

try {
  const info = await service.start();
  await fs.writeFile(path.join(dataDir, 'service.json'), `${JSON.stringify({ pid: process.pid, ...info }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Co2 Lite 已启动：${info.ownerUrl.split('#')[0]}`);
} catch (error) {
  console.error(`Co2 Lite 启动失败：${error.message}`);
  process.exit(1);
}

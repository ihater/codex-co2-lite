#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateFile = path.join(root, '.lite-data', 'state.json');
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    const base = `http://127.0.0.1:${state.port}`;
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) {
      const url = `${base}/admin#owner=${state.ownerToken}`;
      await run('/usr/bin/open', [url]);
      console.log(url.split('#')[0]);
      process.exit(0);
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}
throw new Error('Co2 Lite 未能在 10 秒内启动，请查看 .lite-data/service-error.log');

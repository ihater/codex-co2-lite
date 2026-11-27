import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { privateIPv4 } from '../lib/lan-network.mjs';

const run = promisify(execFile);

export async function localHostname() {
  try {
    const { stdout } = await run('/usr/sbin/scutil', ['--get', 'LocalHostName'], { timeout: 3000 });
    const label = stdout.trim().toLowerCase();
    if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return `${label}.local`;
  } catch {}
  const label = os.hostname().split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  return `${label || 'codex-co2-lite'}.local`;
}

export function lanAddresses(interfaces = os.networkInterfaces()) {
  const values = [];
  for (const entries of Object.values(interfaces)) for (const entry of entries ?? []) {
    if (entry && entry.internal === false && [4, 'IPv4'].includes(entry.family) && privateIPv4(entry.address)) values.push(entry.address);
  }
  return [...new Set(values)].sort();
}

export function clientAddress(req) {
  const value = req.socket.remoteAddress ?? '';
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

export function isLoopback(value) {
  return value === '127.0.0.1' || value === '::1';
}

export function isLanClient(req) {
  const address = clientAddress(req);
  return isLoopback(address) || privateIPv4(address);
}

export function allowedHost(req, { hostname, port }) {
  const host = String(req.headers.host ?? '').toLowerCase();
  return host === `${hostname}:${port}` || host === `localhost:${port}` || host === `127.0.0.1:${port}`
    || lanAddresses().some(address => host === `${address}:${port}`);
}

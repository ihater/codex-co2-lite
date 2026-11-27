#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.lite-data');
const agents = path.join(os.homedir(), 'Library', 'LaunchAgents');
const file = path.join(agents, 'local.codex-co2-lite.plist');
const domain = `gui/${process.getuid()}`;
const label = 'local.codex-co2-lite';
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
await fs.chmod(dataDir, 0o700);
await fs.mkdir(agents, { recursive: true });
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(path.join(root, 'lite', 'server.mjs'))}</string></array>
  <key>WorkingDirectory</key><string>${escape(root)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${escape(path.join(dataDir, 'service.log'))}</string>
  <key>StandardErrorPath</key><string>${escape(path.join(dataDir, 'service-error.log'))}</string>
</dict></plist>
`;
const temporary = `${file}.tmp`;
await fs.writeFile(temporary, plist, { mode: 0o600 });
await fs.rename(temporary, file);
await run('/bin/launchctl', ['bootout', `${domain}/${label}`]).catch(() => {});
await run('/bin/launchctl', ['bootstrap', domain, file]);
await run('/bin/launchctl', ['kickstart', `${domain}/${label}`]);
console.log(file);

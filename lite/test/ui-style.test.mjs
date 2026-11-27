import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestId } from '../web/request-id.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('guest H5 keeps the official Co2 stylesheet unchanged', async () => {
  const [official, lite] = await Promise.all([
    fs.readFile(path.join(root, 'public', 'style.css')),
    fs.readFile(path.join(root, 'lite', 'web', 'co2-style.css')),
  ]);

  assert.deepEqual(lite, official);
});

test('guest H5 keeps the official conversation and composer structure', async () => {
  const html = await fs.readFile(path.join(root, 'lite', 'web', 'guest.html'), 'utf8');

  for (const className of ['page-shell', 'masthead', 'reading-width', 'conversation-wrap', 'transcript', 'messages', 'composer', 'compose-box']) {
    assert.match(html, new RegExp(`class="[^"]*\\b${className}\\b`), `missing official H5 class: ${className}`);
  }
});

test('guest H5 supports image selection, paste, drop and local preview', async () => {
  const [html, script] = await Promise.all([
    fs.readFile(path.join(root, 'lite', 'web', 'guest.html'), 'utf8'),
    fs.readFile(path.join(root, 'lite', 'web', 'guest.js'), 'utf8'),
  ]);

  assert.match(html, /id="attachment-input"[^>]*type="file"[^>]*multiple/);
  assert.match(script, /addEventListener\('paste'/);
  assert.match(script, /addEventListener\('dragover'/);
  assert.match(script, /addEventListener\('drop'/);
  assert.match(script, /URL\.createObjectURL\(entry\.file\)/);
  assert.match(script, /upload-start/);
  assert.match(script, /upload-finish/);
});

test('guest H5 creates UUIDs on insecure LAN origins without crypto.randomUUID', () => {
  const fallback = requestId({
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index++) bytes[index] = index;
      return bytes;
    },
  });

  assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fallback, '00010203-0405-4607-8809-0a0b0c0d0e0f');
  assert.equal(requestId({ randomUUID: () => 'native-uuid' }), 'native-uuid');
});

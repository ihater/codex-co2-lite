import { requestId } from './request-id.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
Object.assign(ui, { message: ui['proposal-text'], send: ui['send-button'], attach: ui['attach-button'],
  attachments: ui['compose-attachments'], feedback: ui['proposal-feedback'],
  'message-form': ui['proposal-form'], 'file-input': ui['attachment-input'] });
const shareId = location.pathname.split('/').filter(Boolean).at(-1);
const hash = new URLSearchParams(location.hash.slice(1));
const tokenKey = `co2-lite-token:${shareId}`;
const token = hash.get('token') || sessionStorage.getItem(tokenKey) || '';
if (token) sessionStorage.setItem(tokenKey, token);
let socket;
let reconnectTimer;
let attempts = 0;
let uploadsEnabled = false;
let uploadChunkBytes = 30 * 1024;
let pendingFiles = [];
let renderGeneration = 0;
const pending = new Map();
const objectUrls = new Set();
const MAX_ATTACHMENTS = 8;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function updateViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--viewport-height', `${viewport?.height || window.innerHeight}px`);
  document.documentElement.style.setProperty('--viewport-top', `${viewport?.offsetTop || 0}px`);
}
updateViewport();
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport);
window.addEventListener('resize', updateViewport);

function status(label, state = '') {
  ui['connection-label'].textContent = label;
  ui['connection-status'].dataset.state = state === 'online' ? 'connected' : state === 'connecting' ? 'pending' : 'warning';
}

function feedback(message, error = false) {
  ui.feedback.textContent = message;
  if (error) ui.feedback.dataset.kind = 'warning';
  else delete ui.feedback.dataset.kind;
}

function updateControls(online = socket?.readyState === WebSocket.OPEN) {
  ui.message.disabled = !online;
  ui.send.disabled = !online || (!ui.message.value.trim() && !pendingFiles.length);
  ui.attach.disabled = !online || !uploadsEnabled;
  ui['send-mode'].textContent = online ? '直接发送' : '同步中';
}

function socketUrl() {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/${shareId}`;
}

function connect() {
  clearTimeout(reconnectTimer);
  if (!token) { status('链接无效'); feedback('分享链接缺少访问凭据', true); return; }
  status('连接中', 'connecting');
  socket = new WebSocket(socketUrl());
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'ready') {
      attempts = 0; uploadsEnabled = message.uploads === true; uploadChunkBytes = message.uploadChunkBytes || uploadChunkBytes;
      ui['thread-title'].textContent = message.share.title;
      ui['viewer-name'].textContent = message.share.viewerName;
      renderSnapshot(message.snapshot); status(message.snapshot.status === 'offline' ? '分享者离线' : '已连接', message.snapshot.status === 'offline' ? '' : 'online');
      updateControls(message.snapshot.status !== 'offline');
    } else if (message.type === 'snapshot') {
      uploadsEnabled = message.uploads === true;
      renderSnapshot(message.snapshot);
      const online = message.snapshot.status !== 'offline'; status(online ? (message.snapshot.status === 'running' ? '执行中' : '已连接') : '分享者离线', online ? 'online' : '');
      updateControls(online);
    } else if (message.type === 'error') {
      if (message.requestId && pending.has(message.requestId)) { pending.get(message.requestId).reject(new Error(message.message)); pending.delete(message.requestId); }
      else feedback(message.message, true);
    } else if (message.requestId && pending.has(message.requestId)) {
      pending.get(message.requestId).resolve(message); pending.delete(message.requestId);
    }
  });
  socket.addEventListener('close', event => {
    updateControls(false);
    for (const operation of pending.values()) operation.reject(new Error('连接已断开')); pending.clear();
    if ([4003, 4004].includes(event.code)) { status('共享已停止'); feedback('这个分享链接已失效', true); return; }
    if (event.code === 4001) { status('链接无效'); feedback('分享链接凭据无效', true); return; }
    status('正在重连', 'connecting');
    reconnectTimer = setTimeout(connect, Math.min(10000, 1000 * 2 ** Math.min(attempts++, 4)));
  });
  socket.addEventListener('error', () => {});
}

function request(message) {
  const operationId = message.requestId || requestId();
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN) return reject(new Error('当前未连接'));
    const timer = setTimeout(() => { pending.delete(operationId); reject(new Error('请求超时')); }, 30000);
    pending.set(operationId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ ...message, requestId: operationId }));
  });
}

function assetUrl(kind, id, original = false) {
  return `/api/shares/${shareId}/${kind}/${id}${original ? '?original=1' : ''}`;
}

async function loadAsset(kind, ref, element, generation) {
  try {
    const response = await fetch(assetUrl(kind, ref.id, kind === 'files'), { headers: { 'X-Share-Token': token } });
    if (!response.ok || generation !== renderGeneration) return;
    const url = URL.createObjectURL(await response.blob()); objectUrls.add(url);
    if (kind === 'images') element.src = url;
    else { element.dataset.url = url; element.disabled = false; }
  } catch {}
}

function renderSnapshot(snapshot) {
  const nearBottom = ui.conversation.scrollHeight - ui.conversation.scrollTop - ui.conversation.clientHeight < 120;
  const generation = ++renderGeneration;
  for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear();
  const fragment = document.createDocumentFragment();
  for (const item of snapshot?.items || []) {
    if (!item || typeof item.text !== 'string') continue;
    const role = ['user', 'assistant'].includes(item.role) ? item.role : 'activity';
    const article = document.createElement('article'); article.className = `message message-${role}`;
    const label = document.createElement('p'); label.className = 'message-author';
    label.textContent = item.role === 'user' ? '协作者' : item.role === 'assistant' ? 'Codex' : '执行记录';
    const text = document.createElement('div'); text.className = 'message-text';
    const body = document.createElement('div'); body.className = 'message-body'; body.textContent = item.text;
    text.append(body); article.append(label, text);
    for (const image of item.images || []) {
      const figure = document.createElement('figure'); figure.className = 'message-image';
      const img = document.createElement('img'); img.alt = image.name || '图片'; img.loading = 'lazy';
      figure.append(img); article.append(figure); void loadAsset('images', image, img, generation);
    }
    for (const file of item.files || []) {
      const figure = document.createElement('figure'); figure.className = 'message-file';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'file-link'; button.textContent = file.name || '附件'; button.disabled = true;
      button.addEventListener('click', () => { if (button.dataset.url) window.open(button.dataset.url, '_blank', 'noopener'); });
      figure.append(button); article.append(figure); void loadAsset('files', file, button, generation);
    }
    fragment.append(article);
  }
  ui.messages.replaceChildren(fragment);
  ui.empty.hidden = ui.messages.children.length > 0;
  ui['thread-title'].textContent = snapshot?.title || ui['thread-title'].textContent;
  ui['agent-status'].hidden = snapshot?.status === 'offline';
  ui['agent-status'].textContent = snapshot?.status === 'running' ? 'Agent 执行中' : 'Agent 空闲';
  ui['agent-status'].dataset.running = String(snapshot?.status === 'running');
  if (nearBottom) requestAnimationFrame(() => { ui.conversation.scrollTop = ui.conversation.scrollHeight; });
}

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

async function uploadFile(entry) {
  const bytes = new Uint8Array(await entry.file.arrayBuffer());
  await request({ type: 'upload-start', uploadId: entry.id, name: entry.file.name, size: bytes.length });
  let index = 0;
  for (let offset = 0; offset < bytes.length; offset += uploadChunkBytes) {
    await request({ type: 'upload-chunk', uploadId: entry.id, index: index++, data: base64(bytes.subarray(offset, offset + uploadChunkBytes)) });
  }
  await request({ type: 'upload-finish', uploadId: entry.id });
  entry.ready = true; renderPendingFiles();
}

function disposePendingFile(entry) {
  if (!entry.previewUrl) return;
  URL.revokeObjectURL(entry.previewUrl);
  entry.previewUrl = null;
}

function imagePreview(entry) {
  if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(entry.file.type)) return null;
  if (!entry.previewUrl) entry.previewUrl = URL.createObjectURL(entry.file);
  const preview = document.createElement('div'); preview.className = 'compose-attachment-preview'; preview.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img'); image.alt = entry.file.name; image.src = entry.previewUrl;
  preview.append(image);
  return preview;
}

function renderPendingFiles() {
  ui.attachments.replaceChildren(); ui.attachments.hidden = pendingFiles.length === 0;
  for (const entry of pendingFiles) {
    const chip = document.createElement('div'); chip.className = 'compose-attachment'; chip.dataset.status = entry.ready ? 'ready' : 'uploading';
    const preview = imagePreview(entry); chip.dataset.preview = preview ? 'image' : 'none';
    const footer = document.createElement('div'); footer.className = 'compose-attachment-footer';
    const icon = document.createElement('span'); icon.className = 'compose-file-icon'; icon.setAttribute('aria-hidden', 'true');
    const extension = entry.file.name.split('.').pop()?.toUpperCase(); icon.textContent = /^[A-Z0-9]{1,5}$/.test(extension) ? extension : 'FILE';
    const name = document.createElement('span'); name.className = 'compose-attachment-name'; name.textContent = entry.file.name;
    const state = document.createElement('span'); state.className = 'compose-attachment-status'; state.textContent = entry.ready ? '已就绪' : '上传中';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'compose-attachment-remove'; remove.textContent = '×'; remove.title = '移除';
    remove.addEventListener('click', () => {
      request({ type: 'upload-cancel', uploadId: entry.id }).catch(() => {});
      pendingFiles = pendingFiles.filter(value => value !== entry); disposePendingFile(entry); renderPendingFiles(); updateControls();
    });
    footer.append(icon, name); chip.append(...(preview ? [preview] : []), footer, state, remove); ui.attachments.append(chip);
  }
  updateControls();
}

async function addFiles(files) {
  if (!uploadsEnabled) return feedback('当前共享暂时不能上传图片或附件', true);
  const candidates = [...files];
  if (!candidates.length) return;
  const available = Math.max(0, MAX_ATTACHMENTS - pendingFiles.length);
  if (!available) return feedback(`每条消息最多添加 ${MAX_ATTACHMENTS} 个附件`, true);
  const selected = candidates.slice(0, available);
  const existingBytes = pendingFiles.reduce((total, entry) => total + entry.file.size, 0);
  let acceptedBytes = 0;
  const accepted = [];
  for (const file of selected) {
    if (file.size > MAX_FILE_BYTES) { feedback(`${file.name}: 单个文件不能超过 32 MiB`, true); continue; }
    if (existingBytes + acceptedBytes + file.size > MAX_TOTAL_BYTES) { feedback('每条消息的附件合计不能超过 64 MiB', true); break; }
    accepted.push({ id: requestId(), file, ready: false, previewUrl: null });
    acceptedBytes += file.size;
  }
  if (candidates.length > available) feedback(`每条消息最多添加 ${MAX_ATTACHMENTS} 个附件`, true);
  pendingFiles.push(...accepted); renderPendingFiles();
  for (const entry of accepted) {
    try { await uploadFile(entry); }
    catch (error) {
      pendingFiles = pendingFiles.filter(value => value !== entry); disposePendingFile(entry); renderPendingFiles();
      feedback(`${entry.file.name}: ${error.message}`, true);
    }
  }
}

ui.attach.addEventListener('click', () => ui['file-input'].click());
ui['file-input'].addEventListener('change', async () => {
  await addFiles(ui['file-input'].files);
  ui['file-input'].value = '';
});

ui.message.addEventListener('paste', event => {
  if (!event.clipboardData?.files?.length || !uploadsEnabled) return;
  event.preventDefault(); void addFiles(event.clipboardData.files);
});
ui['message-form'].addEventListener('dragover', event => {
  if (uploadsEnabled && Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault();
});
ui['message-form'].addEventListener('drop', event => {
  if (!event.dataTransfer?.files?.length || !uploadsEnabled) return;
  event.preventDefault(); void addFiles(event.dataTransfer.files);
});

ui.message.addEventListener('input', () => {
  ui.message.style.height = 'auto'; ui.message.style.height = `${Math.min(160, ui.message.scrollHeight)}px`; updateControls();
});
ui.message.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); ui['message-form'].requestSubmit(); }
});
ui['message-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const text = ui.message.value;
  if ((!text.trim() && !pendingFiles.length) || pendingFiles.some(file => !file.ready)) return;
  const uploadIds = pendingFiles.map(file => file.id);
  ui.send.disabled = true; feedback('正在提交');
  try {
    await request({ type: 'submit', requestId: requestId(), text, uploadIds });
    ui.message.value = ''; ui.message.style.height = 'auto';
    for (const entry of pendingFiles) disposePendingFile(entry);
    pendingFiles = []; renderPendingFiles(); feedback('已提交');
  } catch (error) { feedback(error.message, true); }
  finally { updateControls(); }
});

connect();

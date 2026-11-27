const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
const hash = new URLSearchParams(location.hash.slice(1));
let ownerToken = hash.get('owner') || sessionStorage.getItem('co2-lite-owner') || '';
if (ownerToken) sessionStorage.setItem('co2-lite-owner', ownerToken);
let selected = null;
let searchTimer;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${ownerToken}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

function feedback(message, error = false) {
  ui['share-feedback'].textContent = message;
  ui['share-feedback'].classList.toggle('error', error);
}

function time(value) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value);
}

function selectThread(thread, button) {
  selected = thread;
  ui['selected-thread'].value = thread.id;
  ui['share-button'].disabled = false;
  for (const row of ui['thread-list'].children) row.classList.toggle('selected', row === button);
}

async function loadThreads() {
  ui['thread-list'].replaceChildren();
  selected = null;
  ui['share-button'].disabled = true;
  try {
    const result = await api(`/api/threads?search=${encodeURIComponent(ui.search.value.trim())}`);
    for (const thread of result.threads) {
      const button = document.createElement('button');
      button.className = 'thread-row'; button.type = 'button'; button.role = 'option';
      const title = document.createElement('span'); title.className = 'thread-title'; title.textContent = thread.name;
      const meta = document.createElement('span'); meta.className = 'thread-meta';
      const updated = document.createElement('span'); updated.textContent = time(thread.updatedAt);
      const cwd = document.createElement('span'); cwd.textContent = thread.cwd;
      meta.append(updated, cwd); button.append(title, meta);
      button.addEventListener('click', () => selectThread(thread, button));
      ui['thread-list'].append(button);
    }
    if (!result.threads.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '没有匹配的会话';
      ui['thread-list'].append(empty);
    }
  } catch (error) { feedback(error.message, true); }
}

function actionButton(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function renderShares(shares) {
  ui['share-list'].replaceChildren();
  ui['share-count'].textContent = String(shares.length);
  ui['shares-empty'].hidden = shares.length > 0;
  for (const share of shares) {
    const entry = document.createElement('article'); entry.className = 'share-entry';
    const head = document.createElement('div'); head.className = 'share-entry-head';
    const text = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = share.title;
    const meta = document.createElement('div'); meta.className = 'share-meta'; meta.textContent = `${share.viewerName} · ${time(share.createdAt)}`;
    text.append(title, meta);
    const status = document.createElement('span'); status.className = `share-status ${share.status}`;
    status.textContent = ({ idle: '在线', running: '执行中', restoring: '恢复中', offline: '离线' })[share.status] || share.status;
    head.append(text, status);
    const urlRow = document.createElement('div'); urlRow.className = 'share-url';
    const input = document.createElement('input'); input.readOnly = true; input.value = share.url; input.setAttribute('aria-label', '分享链接');
    const copy = actionButton('复制', 'secondary', async () => {
      await navigator.clipboard.writeText(share.url); copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制'; }, 1200);
    });
    urlRow.append(input, copy);
    const actions = document.createElement('div'); actions.className = 'share-actions';
    const open = actionButton('打开', 'secondary', () => window.open(share.url, '_blank', 'noopener'));
    const rotate = actionButton('更换链接', 'secondary', async () => {
      if (!confirm('更换后，旧链接会立即失效。继续吗？')) return;
      try { await api(`/api/shares/${share.id}/rotate`, { method: 'POST' }); await loadState(); }
      catch (error) { feedback(error.message, true); }
    });
    const stop = actionButton('停止分享', 'danger', async () => {
      if (!confirm('停止后，这个链接会立即失效。继续吗？')) return;
      try { await api(`/api/shares/${share.id}`, { method: 'DELETE' }); await loadState(); }
      catch (error) { feedback(error.message, true); }
    });
    actions.append(open, rotate, stop); entry.append(head, urlRow, actions); ui['share-list'].append(entry);
  }
}

async function loadState() {
  try {
    const state = await api('/api/state');
    ui['desktop-status'].textContent = state.desktop.message;
    ui['desktop-dot'].className = `dot ${state.desktop.phase === 'connected' ? 'online' : state.desktop.phase === 'connecting' ? 'connecting' : ''}`;
    renderShares(state.shares);
  } catch (error) {
    ui['desktop-status'].textContent = error.message;
    feedback(error.message, true);
  }
}

ui['share-form'].addEventListener('submit', async event => {
  event.preventDefault();
  if (!selected) return;
  ui['share-button'].disabled = true;
  try {
    const share = await api('/api/shares', { method: 'POST', body: JSON.stringify({
      threadId: selected.id, title: selected.name, viewerName: ui['viewer-name'].value.trim() || '协作者',
    }) });
    await navigator.clipboard.writeText(share.url).catch(() => {});
    feedback('永久链接已生成并复制');
    await loadState();
  } catch (error) { feedback(error.message, true); }
  finally { ui['share-button'].disabled = !selected; }
});

ui.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadThreads, 250); });
ui['reload-threads'].addEventListener('click', loadThreads);
ui.reconnect.addEventListener('click', async () => {
  try { await api('/api/reconnect', { method: 'POST' }); await loadState(); }
  catch (error) { feedback(error.message, true); }
});

if (!ownerToken) feedback('管理凭据缺失，请重新运行“启动 Co2 Lite.command”', true);
else { await Promise.all([loadThreads(), loadState()]); setInterval(loadState, 3000); }

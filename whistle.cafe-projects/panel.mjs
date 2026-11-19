const list = document.querySelector('#projects');
const title = document.querySelector('#title');
const meta = document.querySelector('#meta');
const start = document.querySelector('#start');
const open = document.querySelector('#open');
const status = document.querySelector('#status');
const sync = document.querySelector('#sync');
const restart = document.querySelector('#restart');
const rules = document.querySelector('#rules');
const ruleModal = document.querySelector('#rule-modal');
const ruleState = document.querySelector('#rule-state');
const ruleText = document.querySelector('#rule-text');
const workspacePath = document.querySelector('#workspace');
const saveWorkspace = document.querySelector('#save-workspace');
const workspaceStatus = document.querySelector('#workspace-status');
let refreshingAfterSave = false;
let token = document.querySelector('meta[name="cafe-token"]').content;

let snapshot = null;
let selected = new URLSearchParams(location.search).get('project') || '';
let busy = false;
let launchUntil = 0;
let listKey = '';
let refreshTimer;
let refreshing = false;
let restartDeadline = 0;
let restartFrom = null;
let lastInstance = null;

function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '未知';
  if (ms < 10000) return '刚刚';
  if (ms < 60000) return `${Math.round(ms / 1000)} 秒前`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟前`;
  return `${Math.round(ms / 3600000)} 小时前`;
}

function clock(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '未知'
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

async function post(path) {
  const send = () => fetch(path, { method: 'POST', headers: { 'X-Cafe-Token': token } });
  let response = await send();
  if (response.status !== 403) return response;
  // Whistle 重启后插件进程换了，旧页面里的令牌会失效；重新取一次再试。
  try {
    const current = await fetch('./api/token', { cache: 'no-store' });
    if (current.ok) {
      const data = await current.json();
      if (data.token) token = data.token;
    }
  } catch {
    // 取不到就按原错误返回。
  }
  response = await send();
  return response;
}

function setStatus(text, state) {
  status.textContent = text;
  status.dataset.state = state || '';
}

function renderList() {
  if (!snapshot) return;
  const key = selected + '|' + snapshot.projects.map(p => `${p.name}:${p.active}:${p.port}`).join('|');
  if (key === listKey) return;
  listKey = key;
  const fragment = document.createDocumentFragment();
  for (const project of snapshot.projects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(project.name === selected));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `cybercafe-${project.name}`;
    const tag = document.createElement('span');
    tag.className = project.active ? 'tag' : 'tag idle';
    tag.textContent = project.active ? `:${project.port}` : '未接管';
    button.append(name, tag);
    button.addEventListener('click', () => {
      if (selected !== project.name) setStatus('', '');
      selected = project.name;
      render();
    });
    fragment.append(button);
  }
  if (!snapshot.projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '工作区里没有找到可启动的项目。';
    fragment.append(empty);
  }
  list.replaceChildren(fragment);
}

function render() {
  if (!snapshot) return;
  const info = snapshot.projects.find(project => project.name === selected);
  if (!info && snapshot.projects.length) {
    const preferred = snapshot.projects.find(project => project.active) || snapshot.projects[0];
    selected = preferred.name;
    return render();
  }

  renderList();
  title.textContent = info ? `cybercafe-${info.name}` : '选择项目';
  if (info && info.active) {
    meta.textContent = `本地接管中 · 端口 ${info.port} · ${info.engine} · ${clock(info.since)} 开始（终端已在运行，无需重复启动）`;
  } else if (info && info.unmatched) {
    meta.textContent = `检测到 127.0.0.1:${info.unmatched.port} 上的服务，但它没有以 /cybercafe-${info.name}/ 为 base 启动（多半是直接 npm run dev 起的）；请用「启动终端」启动，脚本会自动带上前缀。`;
  } else if (info) {
    meta.textContent = '未接管 · 启动服务后会自动切到本地，测试地址保持不变。';
  } else {
    meta.textContent = '在左侧选择项目后，可以启动本地开发服务。';
  }
  const cooling = Date.now() < launchUntil;
  const active = Boolean(info && info.active);
  start.disabled = !info || busy || active || cooling;
  start.textContent = active ? '已在本地运行' : cooling ? '等待服务就绪…' : '启动终端';
  open.hidden = !info;
  if (info) open.href = info.url;
}

function renderSync(data) {
  const { error, lastSuccessAt } = data.sync || {};
  sync.dataset.state = 'warn';
  if (data.workspace === '') {
    sync.textContent = '等待选择工作区';
  } else if (error) {
    const lastSuccess = lastSuccessAt || data.updatedAt;
    sync.textContent = `同步失败：${error}${lastSuccess ? ` · 上次成功：${ago(lastSuccess)}` : ''}`;
  } else if (data.message) {
    sync.textContent = data.message;
  } else if (data.stale && data.updatedAt) {
    sync.textContent = `同步状态过期 · ${ago(data.updatedAt)}更新`;
  } else if (!lastSuccessAt) {
    sync.textContent = '等待插件首次同步…';
  } else {
    sync.textContent = `自动同步 · ${ago(lastSuccessAt)}更新`;
    sync.dataset.state = 'ok';
  }
}

async function load() {
  if (refreshing) return;
  clearTimeout(refreshTimer);
  refreshing = true;
  try {
    const response = await fetch('./api/projects', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (data.startedAt != null) {
      lastInstance = data.startedAt;
      if (restartDeadline && lastInstance !== restartFrom) {
        location.reload();
        return;
      }
    }
    if (refreshingAfterSave) return;
    if (typeof data.workspace === 'string') {
      workspacePath.textContent = data.workspace || '请选择包含 cybercafe-* 子项目的目录。';
    }
    renderSync(data);
    snapshot = response.ok ? data : { projects: [] };
    render();
  } catch (error) {
    sync.textContent = `无法读取状态：${error.message}`;
    sync.dataset.state = 'warn';
  } finally {
    if (restartDeadline && Date.now() >= restartDeadline) {
      restartDeadline = 0;
      restart.disabled = false;
      setStatus('重启后没有连上，请在终端执行 w2 restart。', 'error');
    }
    refreshing = false;
    refreshTimer = setTimeout(load, refreshingAfterSave ? 0 : restartDeadline ? 1000 : 2000);
    refreshingAfterSave = false;
  }
}

saveWorkspace.addEventListener('click', async () => {
  saveWorkspace.disabled = true;
  workspaceStatus.textContent = '请在系统窗口中选择目录。';
  workspaceStatus.dataset.state = '';
  try {
    const response = await post('./api/workspace');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '选择目录失败。');
    workspaceStatus.textContent = '';
    if (data.cancelled) return;
    workspacePath.textContent = data.workspace;
    snapshot = { projects: [] };
    render();
    if (refreshing) refreshingAfterSave = true;
    else load();
  } catch (error) {
    workspaceStatus.textContent = error.message;
    workspaceStatus.dataset.state = 'error';
  } finally {
    saveWorkspace.disabled = false;
  }
});

start.addEventListener('click', async () => {
  if (!selected || busy) return;
  const project = selected;
  busy = true;
  start.disabled = true;
  setStatus('正在打开终端…', 'busy');
  try {
    const response = await post(`./api/start/${project}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '启动失败。');
    launchUntil = Date.now() + 15000;
    if (selected === project) {
      setStatus('终端已打开，等待本地服务就绪（最多约 10 秒）…', 'busy');
    }
  } catch (error) {
    if (selected === project) setStatus(error.message, 'error');
  } finally {
    busy = false;
    render();
  }
});

restart.addEventListener('click', async () => {
  if (!window.confirm('重启 Whistle 会短暂断开所有代理连接，约 2 秒后恢复。继续？')) return;
  restart.disabled = true;
  restartFrom = lastInstance;
  setStatus('正在重启 Whistle，页面会自动重连…', 'busy');
  try {
    const response = await post('./api/restart');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '重启失败。');
  } catch (error) {
    setStatus(error.message, 'error');
    restart.disabled = false;
    return;
  }
  restartDeadline = Date.now() + 40000;
  load();
});

async function showRule() {
  ruleModal.hidden = false;
  ruleText.textContent = '正在读取…';
  ruleState.textContent = '';
  try {
    const response = await fetch('./api/rule', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '读取失败。');
    if (data.value === null) {
      ruleText.textContent = `Whistle 里暂时没有「${data.name}」规则。`;
      return;
    }
    ruleText.textContent = data.value;
    ruleState.textContent = data.selected ? '已启用' : '未启用';
  } catch (error) {
    ruleText.textContent = error.message;
  }
}

function hideRule() {
  ruleModal.hidden = true;
}

rules.addEventListener('click', showRule);
document.querySelector('#close-rule').addEventListener('click', hideRule);
ruleModal.addEventListener('click', event => {
  if (event.target === ruleModal) hideRule();
});
document.querySelector('#copy-rule').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ruleText.textContent);
    setStatus('规则已复制到剪贴板。', '');
  } catch {
    setStatus('复制失败，请手动选择规则内容。', 'error');
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});

await load();
if (new URLSearchParams(location.search).get('rule') === '1') showRule();

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
let token = document.querySelector('meta[name="cafe-token"]').content;

let snapshot = null;
let selected = new URLSearchParams(location.search).get('project') || '';
let busy = false;
let launchUntil = 0;
let listKey = '';

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
  if (!info && snapshot.projects.length && !selected) {
    const preferred = snapshot.projects.find(project => project.active) || snapshot.projects[0];
    selected = preferred.name;
    return render();
  }

  if (!snapshot.updatedAt) {
    sync.textContent = '尚未同步 · Whistle 刚启动或插件未加载';
    sync.dataset.state = 'warn';
  } else if (snapshot.stale) {
    sync.textContent = `同步未运行 · 状态更新于 ${ago(snapshot.updatedAt)}`;
    sync.dataset.state = 'warn';
  } else {
    sync.textContent = `同步正常 · ${ago(snapshot.updatedAt)}更新`;
    sync.dataset.state = 'ok';
  }

  renderList();
  title.textContent = info ? `cybercafe-${info.name}` : '选择项目';
  if (info && info.active) {
    meta.textContent = info.compat
      ? `本地接管中（兼容模式）· 端口 ${info.port} · ${info.engine} · 资源路径由代理改写，HMR 已一并代理`
      : `本地接管中 · 端口 ${info.port} · ${info.engine} · ${clock(info.since)} 开始（终端已在运行，无需重复启动）`;
  } else if (info && info.unmatched) {
    meta.textContent = `检测到 127.0.0.1:${info.unmatched.port} 上的服务，但它没有以 /cybercafe-${info.name}/ 为 base 启动（多半是直接 npm run dev 起的）。先停掉这个实例，这里会恢复成可启动状态，再点「启动终端」就会带上正确前缀。`;
  } else if (info) {
    meta.textContent = '未接管 · 启动服务后会自动切到本地，测试地址保持不变。';
  } else {
    meta.textContent = '在左侧选择项目后，可以启动本地开发服务。';
  }
  const cooling = Date.now() < launchUntil;
  const active = Boolean(info && info.active);
  const unmatched = Boolean(info && !info.active && info.unmatched);
  start.disabled = !info || busy || active || cooling || unmatched;
  start.textContent = active
    ? info.compat ? '已在本地运行（兼容）' : '已在本地运行'
    : unmatched
      ? '已在运行（未带前缀）'
      : cooling
        ? '等待服务就绪…'
        : '启动终端';
  open.hidden = !info || unmatched;
  if (info) open.href = info.url;
}

async function load() {
  try {
    const response = await fetch('./api/projects', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '读取状态失败。');
    snapshot = data;
    render();
  } catch (error) {
    sync.textContent = `无法读取状态：${error.message}`;
    sync.dataset.state = 'warn';
  }
}

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
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    try {
      const response = await fetch('./api/projects', { cache: 'no-store' });
      if (response.ok) {
        clearInterval(timer);
        location.reload();
        return;
      }
    } catch {
      // 重启过程中连接会被拒绝，继续等待。
    }
    if (tries >= 40) {
      clearInterval(timer);
      restart.disabled = false;
      setStatus('重启后没有连上，请在终端执行 w2 restart。', 'error');
    }
  }, 1000);
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
setInterval(load, 2000);

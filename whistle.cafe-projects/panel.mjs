const list = document.querySelector('#projects');
const title = document.querySelector('#title');
const meta = document.querySelector('#meta');
const start = document.querySelector('#start');
const install = document.querySelector('#install');
const open = document.querySelector('#open');
const logs = document.querySelector('#logs');
const takeover = document.querySelector('#takeover');
const rules = document.querySelector('#rules');
const status = document.querySelector('#status');
const sync = document.querySelector('#sync');
const syncNow = document.querySelector('#sync-now');
const restart = document.querySelector('#restart');
const search = document.querySelector('#search');
const onlyFav = document.querySelector('#only-fav');
const tokenMeta = document.querySelector('meta[name="cafe-token"]');
let token = tokenMeta.content;

const ruleModal = document.querySelector('#rule-modal');
const ruleState = document.querySelector('#rule-state');
const ruleText = document.querySelector('#rule-text');
const doctorModal = document.querySelector('#doctor-modal');
const doctorState = document.querySelector('#doctor-state');
const doctorList = document.querySelector('#doctor-list');
const logModal = document.querySelector('#log-modal');
const logTitle = document.querySelector('#log-title');
const logState = document.querySelector('#log-state');
const logText = document.querySelector('#log-text');
const logDiags = document.querySelector('#log-diags');

let snapshot = null;
let selected = new URLSearchParams(location.search).get('project') || '';
let busy = false;
let launchUntil = 0;
let listKey = '';
let query = '';
let favoritesOnly = false;
let logTimer = null;
let logProject = '';

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

async function currentServerToken() {
  try {
    const response = await fetch('./', { cache: 'no-store' });
    const text = await response.text();
    const match = /name="cafe-token" content="([a-f0-9]+)"/.exec(text);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function setStatus(text, state) {
  status.textContent = text;
  status.dataset.state = state || '';
}

function depLabel(project) {
  if (project.installing) return { text: '安装中', className: 'installing' };
  if (project.deps.status === 'missing') return { text: '缺依赖', className: 'missing' };
  if (project.deps.status === 'stale') return { text: '待更新', className: 'stale' };
  return null;
}

function sortedProjects() {
  const projects = snapshot.projects
    .filter(project => !favoritesOnly || project.favorite)
    .filter(project => !query || project.name.includes(query));
  return projects.sort((a, b) => {
    const weight = project => (project.favorite ? 2 : 0) + (project.recentAt ? 1 : 0);
    return weight(b) - weight(a)
      || (b.recentAt || 0) - (a.recentAt || 0)
      || a.name.localeCompare(b.name);
  });
}

function renderList() {
  if (!snapshot) return;
  const projects = sortedProjects();
  const key = query + '|' + favoritesOnly + '|' + projects.map(project =>
    `${project.name}:${project.active}:${project.port}:${project.deps.status}:${project.installing}:${project.favorite}`,
  ).join('|');
  if (key === listKey) return;
  listKey = key;
  const fragment = document.createDocumentFragment();
  for (const project of projects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(project.name === selected));
    const star = document.createElement('span');
    star.className = project.favorite ? 'star on' : 'star';
    star.textContent = project.favorite ? '★' : '☆';
    star.title = project.favorite ? '取消收藏' : '收藏';
    star.addEventListener('click', event => {
      event.stopPropagation();
      toggleFavorite(project.name);
    });
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `cybercafe-${project.name}`;
    button.append(star, name);
    const dep = depLabel(project);
    if (dep) {
      const badge = document.createElement('span');
      badge.className = 'dep ' + dep.className;
      badge.textContent = dep.text;
      button.append(badge);
    }
    const tag = document.createElement('span');
    tag.className = project.active ? 'tag' : 'tag idle';
    tag.textContent = project.active ? `:${project.port}` : '未接管';
    button.append(tag);
    button.addEventListener('click', () => {
      if (selected !== project.name) setStatus('', '');
      selected = project.name;
      render();
    });
    fragment.append(button);
  }
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = snapshot.projects.length ? '没有匹配的项目。' : '工作区里没有找到可启动的项目。';
    fragment.append(empty);
  }
  list.replaceChildren(fragment);
}

function render() {
  if (!snapshot) return;
  const info = snapshot.projects.find(project => project.name === selected);
  if (!info && snapshot.projects.length && !selected) {
    const preferred = snapshot.projects.find(project => project.active)
      || snapshot.projects.find(project => project.favorite)
      || snapshot.projects[0];
    selected = preferred.name;
    return render();
  }

  if (!snapshot.updatedAt) {
    sync.textContent = '尚未同步 · Whistle 刚启动或插件未加载';
    sync.dataset.state = 'warn';
    syncNow.hidden = false;
  } else if (snapshot.stale) {
    sync.textContent = `同步未运行 · 状态更新于 ${ago(snapshot.updatedAt)}`;
    sync.dataset.state = 'warn';
    syncNow.hidden = false;
  } else {
    sync.textContent = `同步正常 · ${ago(snapshot.updatedAt)}更新`;
    sync.dataset.state = 'ok';
    syncNow.hidden = true;
  }

  renderList();
  title.textContent = info ? `cybercafe-${info.name}` : '选择项目';

  if (info && info.active) {
    meta.textContent = info.compat
      ? `本地接管中（兼容模式）· 端口 ${info.port} · 资源路径由代理改写，HMR 已一并代理`
      : `本地接管中 · 端口 ${info.port} · ${info.engine} · ${clock(info.since)} 开始（终端已在运行，无需重复启动）`;
  } else if (info && info.unmatched) {
    meta.textContent = `检测到 127.0.0.1:${info.unmatched.port} 上的服务，但它没有以 /cybercafe-${info.name}/ 为 base 启动；可以点「接管并重启」结束它并按可接管方式重启。`;
  } else if (info && info.deps.status === 'missing') {
    meta.textContent = '缺少开发依赖，先点「安装依赖」；装完状态会自动刷新。';
  } else if (info && info.deps.status === 'stale') {
    meta.textContent = 'lockfile 比 node_modules 新，依赖可能已过期，建议重新安装。';
  } else if (info) {
    meta.textContent = '未接管 · 启动服务后会自动切到本地，测试地址保持不变。';
  } else {
    meta.textContent = '在左侧选择项目后，可以启动本地开发服务。';
  }

  const cooling = Date.now() < launchUntil;
  const active = Boolean(info && info.active);
  const unmatched = Boolean(info && !info.active && info.unmatched);
  const installing = Boolean(info && info.installing);
  const missing = Boolean(info && info.deps.status === 'missing');
  start.disabled = !info || busy || active || cooling || installing || missing;
  start.textContent = active
    ? info.compat ? '已在本地运行（兼容）' : '已在本地运行'
    : installing
      ? '安装中…'
      : missing
        ? '先安装依赖'
        : cooling
          ? '等待服务就绪…'
          : '启动终端';

  install.hidden = !info || info.deps.status === 'ready' || installing || active;
  install.textContent = info && info.deps.status === 'stale' ? '重新安装依赖' : '安装依赖';
  open.hidden = !info || unmatched;
  if (info) open.href = info.url;
  takeover.hidden = !info || !(unmatched || info.compat);
  logs.hidden = !info || !(info.log || info.active || installing);
}

function load() {
  return fetch('./api/projects', { cache: 'no-store' })
    .then(response => response.json().then(data => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok) throw new Error(data.message || '读取状态失败。');
      snapshot = data;
      render();
    })
    .catch(error => {
      sync.textContent = `无法读取状态：${error.message}`;
      sync.dataset.state = 'warn';
    });
}

async function toggleFavorite(project) {
  try {
    await post(`./api/favorite/${project}`);
    await load();
  } catch {
    // 忽略
  }
}

function renderChecks(data) {
  doctorList.replaceChildren();
  for (const check of data.checks) {
    const item = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge ' + check.status;
    badge.textContent = { ok: '正常', warn: '注意', fail: '异常', unknown: '待确认' }[check.status] || check.status;
    const text = document.createElement('div');
    text.className = 'check-text';
    const name = document.createElement('b');
    name.textContent = check.label;
    const detail = document.createElement('span');
    detail.textContent = check.detail || '';
    text.append(name, detail);
    if (check.action) {
      const action = document.createElement('span');
      action.className = 'check-action';
      action.textContent = check.action;
      text.append(action);
    }
    item.append(badge, text);
    doctorList.append(item);
  }
  doctorState.textContent = data.ok ? '全部正常' : '有需要处理的项';
}

async function showDoctor({ auto = false } = {}) {
  doctorModal.hidden = false;
  doctorState.textContent = '检查中…';
  doctorList.replaceChildren();
  try {
    const response = await fetch('./api/doctor', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '检查失败。');
    renderChecks(data);
    if (auto && data.ok) {
      doctorModal.hidden = true;
      localStorage.setItem('cafe-doctor-seen', '1');
    }
  } catch (error) {
    doctorState.textContent = error.message;
  }
}

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

async function refreshLogs() {
  if (!logProject) return;
  try {
    const response = await fetch(`./api/logs/${logProject}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '读取失败。');
    const atBottom = logText.scrollTop + logText.clientHeight >= logText.scrollHeight - 30;
    logText.textContent = data.lines.join('\n') || '（暂无日志）';
    if (atBottom) logText.scrollTop = logText.scrollHeight;
    logState.textContent = data.job && data.job.status === 'running'
      ? (data.job.type === 'install' ? '安装中…' : '运行中…')
      : '';
    logDiags.replaceChildren();
    for (const item of data.diagnostics) {
      const chip = document.createElement('span');
      chip.className = 'diag';
      chip.textContent = `${item.text}：${item.action}`;
      logDiags.append(chip);
    }
  } catch (error) {
    logText.textContent = error.message;
  }
}

function openLogs(project) {
  logProject = project;
  logTitle.textContent = `cybercafe-${project} 日志`;
  logModal.hidden = false;
  refreshLogs();
  clearInterval(logTimer);
  logTimer = setInterval(refreshLogs, 1500);
}

function closeLogs() {
  logModal.hidden = true;
  clearInterval(logTimer);
  logTimer = null;
  logProject = '';
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
    if (selected === project) setStatus('终端已打开，等待本地服务就绪（最多约 10 秒）…', 'busy');
  } catch (error) {
    if (selected === project) setStatus(error.message, 'error');
  } finally {
    busy = false;
    render();
  }
});

install.addEventListener('click', async () => {
  if (!selected) return;
  const project = selected;
  install.disabled = true;
  setStatus('正在安装依赖，进度可以点「查看日志」…', 'busy');
  try {
    const response = await post(`./api/install/${project}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '安装失败。');
    if (selected === project) {
      setStatus(data.message || '开始安装依赖…', 'busy');
      openLogs(project);
    }
  } catch (error) {
    if (selected === project) setStatus(error.message, 'error');
  } finally {
    install.disabled = false;
    load();
  }
});

takeover.addEventListener('click', async () => {
  if (!selected) return;
  const project = selected;
  if (!window.confirm('会结束当前运行的实例，再用可接管的方式重新启动。继续？')) return;
  setStatus('正在重启实例…', 'busy');
  try {
    const response = await post(`./api/takeover/${project}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '重启失败。');
    launchUntil = Date.now() + 15000;
    if (selected === project) setStatus(data.message, 'busy');
  } catch (error) {
    if (selected === project) setStatus(error.message, 'error');
  } finally {
    load();
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
  let sawDown = false;
  const timer = setInterval(async () => {
    tries += 1;
    try {
      const response = await fetch('./api/projects', { cache: 'no-store' });
      if (response.ok) {
        // 重启后插件进程换了，面板里的令牌会变；用这个判断是否真的重启了。
        const next = await currentServerToken();
        if (!next || next !== token) {
          clearInterval(timer);
          location.reload();
          return;
        }
      }
    } catch {
      sawDown = true;
    }
    if (tries === 10 && !sawDown) {
      clearInterval(timer);
      restart.disabled = false;
      setStatus('重启命令已发送，但服务一直没有断开，可能没有生效；请查看工具目录下的 .cafe-tools/logs/whistle-restart.log，或手动执行 w2 restart。', 'error');
      return;
    }
    if (tries >= 40) {
      clearInterval(timer);
      restart.disabled = false;
      setStatus('重启后没有连上，请在终端执行 w2 restart。', 'error');
    }
  }, 1000);
});

syncNow.addEventListener('click', async () => {
  try {
    await post('./api/sync');
    setStatus('已触发同步，稍后刷新状态。', 'busy');
    setTimeout(load, 1200);
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

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

document.querySelector('#doctor').addEventListener('click', () => showDoctor());
document.querySelector('#rerun-doctor').addEventListener('click', () => showDoctor());
document.querySelector('#close-doctor').addEventListener('click', () => {
  doctorModal.hidden = true;
  localStorage.setItem('cafe-doctor-seen', '1');
});
doctorModal.addEventListener('click', event => {
  if (event.target === doctorModal) {
    doctorModal.hidden = true;
    localStorage.setItem('cafe-doctor-seen', '1');
  }
});

logs.addEventListener('click', () => selected && openLogs(selected));
document.querySelector('#close-log').addEventListener('click', closeLogs);
document.querySelector('#refresh-log').addEventListener('click', refreshLogs);
logModal.addEventListener('click', event => {
  if (event.target === logModal) closeLogs();
});

search.addEventListener('input', () => {
  query = search.value.trim().toLowerCase();
  render();
});
onlyFav.addEventListener('change', () => {
  favoritesOnly = onlyFav.checked;
  render();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});

await load();
if (!localStorage.getItem('cafe-doctor-seen') && new URLSearchParams(location.search).get('doctor') !== '0') showDoctor({ auto: true });
if (new URLSearchParams(location.search).get('rule') === '1') showRule();
if (new URLSearchParams(location.search).get('log') === '1' && selected) openLogs(selected);
setInterval(load, 2000);

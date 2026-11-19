import { post } from './api.mjs';
import { openLogs } from './logs.mjs';

const list = document.querySelector('#projects');
const title = document.querySelector('#title');
const meta = document.querySelector('#meta');
const start = document.querySelector('#start');
const install = document.querySelector('#install');
const open = document.querySelector('#open');
const logs = document.querySelector('#logs');
const takeover = document.querySelector('#takeover');
const stop = document.querySelector('#stop');
const restartService = document.querySelector('#restart-service');
const installPrompt = document.querySelector('#install-prompt');
const status = document.querySelector('#status');
const startupResult = document.querySelector('#startup-result');
const startupStatus = document.querySelector('#startup-status');
const startupLog = document.querySelector('#startup-log');
const sync = document.querySelector('#sync');
const syncNow = document.querySelector('#sync-now');
const search = document.querySelector('#search');
const onlyFav = document.querySelector('#only-fav');

let snapshot = null;
let selected = new URLSearchParams(location.search).get('project') || '';
let busy = false;
let listKey = '';
let query = '';
let favoritesOnly = false;

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

export function setStatus(text, state) {
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
  const key = selected + '|' + query + '|' + favoritesOnly + '|' + projects.map(project =>
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
    meta.textContent = '缺少开发依赖，可以在启动时安装。';
  } else if (info && info.deps.status === 'stale') {
    meta.textContent = 'lockfile 比 node_modules 新，依赖可能已过期，建议重新安装。';
  } else if (info) {
    meta.textContent = '未接管 · 启动服务后会自动切到本地，测试地址保持不变。';
  } else {
    meta.textContent = '在左侧选择项目后，可以启动本地开发服务。';
  }

  const active = Boolean(info && info.active);
  const unmatched = Boolean(info && !info.active && info.unmatched);
  const installing = Boolean(info && info.installing);
  const launching = Boolean(info && info.launching);
  start.disabled = !info || busy || active || unmatched || launching || installing;
  start.textContent = active
    ? info.compat ? '已在本地运行（兼容）' : '已在本地运行'
    : installing
      ? '安装中…'
      : launching
        ? '等待服务就绪…'
        : '启动终端';

  install.hidden = !info || info.deps.status === 'ready' || installing || active || unmatched;
  install.textContent = info && info.deps.status === 'stale' ? '重新安装依赖' : '安装依赖';
  open.hidden = !info || unmatched;
  if (info) open.href = info.url;
  takeover.hidden = !info || !(unmatched || info.compat);
  stop.hidden = !info?.canStop;
  restartService.hidden = !info?.canStop || !active;
  for (const button of [install, takeover, stop, restartService]) button.disabled = busy || installing || launching;
  logs.hidden = !info || !(info.log || info.active || installing);
  const startup = info?.startup;
  startupResult.hidden = !startup || (startup.stage === 'ready' && (!active || snapshot.stale));
  startupResult.dataset.stage = startup?.stage || '';
  const message = startupResult.hidden ? '' : startup.message || '';
  if (startupStatus.textContent !== message) startupStatus.textContent = message;
  startupLog.hidden = !startup?.hasLog || !info.log;
}

export function load() {
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

function confirmInstall() {
  installPrompt.returnValue = '';
  const choice = new Promise(resolve => {
    installPrompt.addEventListener('close', () => resolve(installPrompt.returnValue === 'install'), { once: true });
  });
  installPrompt.showModal();
  return choice;
}

async function projectAction(action, pending) {
  if (!selected || busy) return;
  const project = selected;
  busy = true;
  render();
  setStatus(pending, 'busy');
  try {
    let response = await post('./api/' + action + '/' + project);
    let data = await response.json();
    if (action === 'start' && response.status === 409 && data.action === 'install') {
      if (!(await confirmInstall())) {
        if (selected === project) setStatus('');
        return;
      }
      action = 'install-and-start';
      response = await post('./api/' + action + '/' + project);
      data = await response.json();
    }
    if (!response.ok) throw new Error(data.message || '操作失败。');
    if (selected === project) {
      setStatus(action === 'stop' ? data.message : '');
      if (action === 'install' || action === 'install-and-start') openLogs(project);
    }
  } catch (error) {
    if (selected === project) setStatus(error.message, 'error');
  } finally {
    await load();
    busy = false;
    render();
  }
}

start.addEventListener('click', () => projectAction('start', '正在检查依赖并启动…'));
install.addEventListener('click', () => projectAction('install', '正在安装依赖…'));
stop.addEventListener('click', () => projectAction('stop', '正在停止本地服务…'));
restartService.addEventListener('click', () => projectAction('restart-service', '正在重启本地服务…'));
takeover.addEventListener('click', () => {
  if (!selected || busy) return;
  if (window.confirm('会结束当前运行的实例，再用可接管的方式重新启动。继续？')) {
    projectAction('takeover', '正在重启实例…');
  }
});

logs.addEventListener('click', () => selected && openLogs(selected));
startupLog.addEventListener('click', () => selected && openLogs(selected));

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

export function openSelectedLogs() {
  if (selected) openLogs(selected);
}

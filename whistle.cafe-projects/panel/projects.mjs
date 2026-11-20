import { confirmAction, post } from './api.mjs';
import { openLogs } from './logs.mjs';

const proxySwitch = document.querySelector('#local-proxy');
const proxyNotice = document.querySelector('#proxy-notice');
let changingProxy = false;

const list = document.querySelector('#projects');
const title = document.querySelector('#title');
const meta = document.querySelector('#meta');
const cmsEntryNote = document.querySelector('#cms-entry-note');
const cmsEntryNotes = {
  cms: '使用 CMS 测试账号登录。需要使用 4A 时，请从 4A 的应用资源进入。',
  newcms: '用 CMS 测试账号登录后，在同一标签页从用户菜单选择「新业管」。',
};
const start = document.querySelector('#start');
const install = document.querySelector('#install');
const open = document.querySelector('#open');
const gameChannel = document.querySelector('#game-channel');
const gameChannelField = document.querySelector('#game-channel-field');
const logs = document.querySelector('#logs');
const terminal = document.querySelector('#terminal');
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
let loadError = '';
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
  const key = JSON.stringify([snapshot.workspace, snapshot.proxyEnabled, loadError]) + '|' + selected + '|' + query + '|' + favoritesOnly + '|' + projects.map(project =>
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
    tag.textContent = project.active ? (snapshot.proxyEnabled === false ? '运行中' : `:${project.port}`) : '未接管';
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
    if (loadError) {
      empty.textContent = loadError;
    } else if (!snapshot.workspace) {
      empty.textContent = '尚未配置项目工作区。';
    } else {
      empty.textContent = snapshot.projects.length ? '没有匹配的项目。' : '工作区里没有找到可启动的项目。';
    }
    fragment.append(empty);
    if (!snapshot.projects.length) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '在体检中选择目录';
      button.addEventListener('click', () => document.querySelector('#doctor').click());
      fragment.append(button);
    }
  }
  list.replaceChildren(fragment);
}

function render() {
  if (!snapshot) return;
  if (!changingProxy) {
    proxySwitch.disabled = !snapshot.workspace || typeof snapshot.proxyEnabled !== 'boolean' || Boolean(loadError);
    proxySwitch.checked = snapshot.proxyEnabled === true;
  }
  const info = snapshot.projects.find(project => project.name === selected);
  if (!info && snapshot.projects.length) {
    const preferred = snapshot.projects.find(project => project.active)
      || snapshot.projects.find(project => project.favorite)
      || snapshot.projects[0];
    selected = preferred.name;
    return render();
  }

  if (!snapshot.workspace) {
    sync.textContent = '等待选择工作区';
    sync.dataset.state = '';
    syncNow.hidden = true;
  } else if (snapshot.syncError) {
    sync.textContent = `同步失败：${snapshot.syncError}${snapshot.updatedAt ? ` · 上次成功：${ago(snapshot.updatedAt)}` : ''}`;
    sync.dataset.state = 'warn';
    syncNow.hidden = false;
  } else if (!snapshot.updatedAt) {
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
    meta.textContent = snapshot.proxyEnabled === false
      ? `本地服务运行中 · 端口 ${info.port} · 测试地址当前走测试部署`
      : info.compat
      ? `本地接管中（兼容模式）· 端口 ${info.port} · 资源路径由代理改写，HMR 已一并代理`
      : `本地接管中 · 端口 ${info.port} · ${info.engine} · ${clock(info.since)} 开始（服务已在运行，无需重复启动）`;
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
        : '启动服务';

  install.hidden = !info || info.deps.status === 'ready' || installing || active || unmatched;
  install.textContent = info && info.deps.status === 'stale' ? '重新安装依赖' : '安装依赖';
  const cmsEntryNoteText = Object.hasOwn(cmsEntryNotes, info?.name) ? cmsEntryNotes[info.name] : '';
  cmsEntryNote.hidden = !cmsEntryNoteText;
  cmsEntryNote.textContent = cmsEntryNoteText;
  open.textContent = cmsEntryNoteText ? '打开 CMS 测试登录' : '打开项目页面';
  gameChannelField.hidden = info?.name !== 'game';
  gameChannel.required = !gameChannelField.hidden;
  open.hidden = !info;
  if (info) {
    open.href = info.url;
    open.dataset.project = info.name;
  } else {
    open.removeAttribute('href');
    delete open.dataset.project;
  }
  takeover.hidden = !info || !(unmatched || info.compat);
  stop.hidden = !info?.canStop;
  restartService.hidden = !info?.canStop || !active;
  for (const button of [install, takeover, stop, restartService]) button.disabled = busy || installing || launching;
  logs.hidden = !info || !(info.log || info.active || installing);
  terminal.hidden = !info || !(info.active || info.log);
  terminal.textContent = info && info.terminalSource === 'external' ? '终端（外部）' : '终端';
  const startup = info?.startup;
  startupResult.hidden = !startup || (startup.stage === 'ready' && (!active || snapshot.stale));
  startupResult.dataset.stage = startup?.stage || '';
  const message = startupResult.hidden ? '' : startup.message || '';
  if (startupStatus.textContent !== message) startupStatus.textContent = message;
  startupLog.hidden = !startup?.hasLog || !info.log;
}

const IDLE_REFRESH_INTERVAL = 15000;
const ACTIVE_REFRESH_INTERVAL = 3000;
let refreshInFlight;
let refreshTimer;

function scheduleRefresh() {
  if (document.hidden) return;
  const pending = !loadError && snapshot?.projects.some(project => project.installing || project.launching);
  refreshTimer = setTimeout(load, pending ? ACTIVE_REFRESH_INTERVAL : IDLE_REFRESH_INTERVAL);
}

proxySwitch.addEventListener('change', async () => {
  changingProxy = true;
  proxySwitch.disabled = true;
  proxyNotice.textContent = '正在切换…';
  try {
    const response = await post('./api/proxy/' + (proxySwitch.checked ? 'on' : 'off'));
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '切换本地代理失败。');
    await refreshInFlight;
    await load();
    proxyNotice.textContent = data.message;
  } catch (error) {
    proxyNotice.textContent = error.message;
  } finally {
    changingProxy = false;
    render();
  }
});

export function load() {
  if (refreshInFlight) return refreshInFlight;
  clearTimeout(refreshTimer);
  refreshInFlight = fetch('./api/projects', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    .then(response => response.json().then(data => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok) {
        snapshot = { workspace: data.workspace, projects: [] };
        throw new Error(data.message || '读取状态失败。');
      }
      loadError = '';
      snapshot = data;
      render();
    })
    .catch(error => {
      snapshot ??= { projects: [] };
      loadError = `无法读取项目列表：${error.message}`;
      render();
      sync.textContent = `无法读取状态：${error.message}`;
      sync.dataset.state = 'warn';
    })
    .finally(() => {
      refreshInFlight = null;
      scheduleRefresh();
    });
  return refreshInFlight;
}

async function toggleFavorite(project) {
  try {
    await post(`./api/favorite/${project}`);
    await load();
  } catch {
    // 忽略
  }
}

function openDesktopTerminal(project) {
  if (!window.cafeDesktopTerminal) return false;
  location.href = './terminal.html?project=' + encodeURIComponent(project);
  return true;
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
      const terminalActions = ['start', 'install', 'install-and-start', 'restart-service', 'takeover'];
      const desktopTerminal = terminalActions.includes(action) && openDesktopTerminal(project);
      if (!desktopTerminal && (action === 'install' || action === 'install-and-start')) openLogs(project);
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
takeover.addEventListener('click', async () => {
  if (!selected || busy) return;
  const project = selected;
  if (await confirmAction('会结束当前运行的实例，再用可接管的方式重新启动。继续？') && selected === project) {
    projectAction('takeover', '正在重启实例…');
  }
});

function openTerminalPage(project) {
  const url = './terminal.html?project=' + encodeURIComponent(project);
  if (window.cafeDesktopTerminal) {
    location.href = url;
    return;
  }
  const opened = window.open(url, '_blank');
  if (opened) return;
  // 老桌面端会拦截新窗口，退回到面板内的日志弹层，至少能看到输出。
  if (window.cafeDesktop) {
    openLogs(project);
    return;
  }
  location.href = url;
}

open.addEventListener('click', event => {
  if (open.dataset.project !== 'game') return;
  gameChannel.value = gameChannel.value.trim();
  if (!gameChannel.reportValidity()) {
    event.preventDefault();
    return;
  }
  const url = new URL(open.href);
  url.hash = '/gameList/menu?' + new URLSearchParams({ channelCode: gameChannel.value });
  open.href = url.href;
});

terminal.addEventListener('click', () => selected && openTerminalPage(selected));
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
  if (document.hidden) clearTimeout(refreshTimer);
  else load();
});

export function hasWorkspace() {
  return Boolean(snapshot?.workspace);
}

export function openSelectedLogs() {
  if (selected) openLogs(selected);
}

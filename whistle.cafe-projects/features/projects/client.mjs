import { showTerminal, focusTerminal } from '../terminal/embedded.mjs';
import { showError, showInfo, reportError } from '../../shared/toast/toast.mjs';
import { confirmAction, post } from '../../shared/http/client.mjs';

const proxySwitch = document.querySelector('#local-proxy');
let changingProxy = false;
let proxyShutdown = false;

const list = document.querySelector('#projects');
const title = document.querySelector('#title');
const meta = document.querySelector('#meta');
const projectEntryNote = document.querySelector('#project-entry-note');
const portalEntryNotes = {
  power: '登录统一服务平台后，将自动进入账号可访问的算力管理页面。',
  hub: '首次打开如需登录，登录后将完成会话交换并返回云网吧服务页面。',
  open: '登录后由统一服务平台完成会话交换，并返回算力开放页面。',
  service: '登录后由统一服务平台完成会话交换，并返回运营分析页面。',
};
const cmsEntryNotes = {
  cms: '使用 CMS 测试账号登录。需要使用 4A 时，请从 4A 的应用资源进入。',
  newcms: '用 CMS 测试账号登录后，将在同一标签页返回新业管页面。',
};
const start = document.querySelector('#start');
const install = document.querySelector('#install');
const open = document.querySelector('#open');
const gameChannel = document.querySelector('#game-channel');
const gameChannelField = document.querySelector('#game-channel-field');
const takeover = document.querySelector('#takeover');
const stop = document.querySelector('#stop');
const restartService = document.querySelector('#restart-service');
const installPrompt = document.querySelector('#install-prompt');
const status = document.querySelector('#status');
const startupResult = document.querySelector('#startup-result');
const startupStatus = document.querySelector('#startup-status');
const sync = document.querySelector('#sync');
const syncNow = document.querySelector('#sync-now');
const search = document.querySelector('#search');
const onlyFav = document.querySelector('#only-fav');

let snapshot = null;
const actionErrors = new Map();
let retryAction = 'start';
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

export function setStatus(text, state) {
  if (state === 'error') {
    showError(text);
    text = '';
  }
  status.textContent = text;
  status.dataset.state = state || '';
}

function depLabel(project) {
  if (project.installing) return { text: '安装中', className: 'installing' };
  if (project.deps.status === 'missing') return { text: '缺依赖', className: 'missing' };
  if (project.deps.status === 'stale') return { text: '待更新', className: 'stale', title: 'lockfile 比 node_modules 新，依赖可能已过期，建议重新安装。' };
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
      if (dep.title) badge.title = dep.title;
      button.append(badge);
    }
    const tag = document.createElement('span');
    tag.className = project.active ? 'tag' : 'tag idle';
    tag.textContent = project.active ? (snapshot.proxyEnabled === false ? '运行中' : `:${project.port}`) : '未运行';
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
      button.textContent = snapshot.workspace ? '重新选择项目目录' : '选择项目目录';
      button.addEventListener('click', () => document.querySelector('#save-workspace').click());
      fragment.append(button);
    }
  }
  list.replaceChildren(fragment);
}

function render() {
  if (!snapshot) return;
  if (!changingProxy) {
    proxySwitch.disabled = proxyShutdown || !snapshot.workspace || typeof snapshot.proxyEnabled !== 'boolean' || Boolean(loadError);
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
    sync.textContent = '同步失败';
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
  document.dispatchEvent(new CustomEvent('cafe-projects-updated', { detail: snapshot }));
  renderReadiness(info);
  title.textContent = info ? `cybercafe-${info.name}` : '选择项目';

  if (info && info.active) {
    meta.textContent = '';
  } else if (info && info.unmatched) {
    meta.textContent = `检测到 127.0.0.1:${info.unmatched.port} 上的服务，但它没有以 /cybercafe-${info.name}/ 为 base 启动；可以点「接管并重启」结束它并按可接管方式重启。`;
  } else if (info && info.deps.status === 'missing') {
    meta.textContent = '缺少开发依赖，可以在启动时安装。';
  } else if (info) {
    meta.textContent = '';
  } else {
    meta.textContent = '在左侧选择项目后，可以启动本地开发服务。';
  }

  meta.hidden = !meta.textContent;

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
  const portalEntryNoteText = Object.hasOwn(portalEntryNotes, info?.name) ? portalEntryNotes[info.name] : '';
  const entryNoteText = cmsEntryNoteText || portalEntryNoteText;
  projectEntryNote.hidden = !entryNoteText;
  projectEntryNote.textContent = entryNoteText;
  const openLabel = cmsEntryNoteText ? '打开 CMS 测试登录' : '打开项目页面';
  open.textContent = openLabel;
  const startup = info?.startup;
  const startupPending = startup && startup.stage !== 'ready';
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
  showTerminal(info?.name, Boolean(info && (info.active || info.log || installing || launching)));
  startupResult.hidden = !startupPending;
  startupResult.dataset.stage = startup?.stage || '';
  const message = startupResult.hidden ? '' : startup.message || '';
  if (startupStatus.textContent !== message) startupStatus.textContent = message;
}

const IDLE_REFRESH_INTERVAL = 15000;
const ACTIVE_REFRESH_INTERVAL = 3000;
let refreshInFlight;
let refreshTimer;

export function shouldOpenDirectly() {
  return proxyShutdown || snapshot?.proxyEnabled === false;
}

function scheduleRefresh() {
  if (document.hidden || proxyShutdown) return;
  const pending = !loadError && snapshot?.projects.some(project => project.installing || project.launching);
  refreshTimer = setTimeout(load, pending ? ACTIVE_REFRESH_INTERVAL : IDLE_REFRESH_INTERVAL);
}

proxySwitch.addEventListener('change', async () => {
  changingProxy = true;
  proxySwitch.disabled = true;
  showInfo('正在切换本地代理…');
  try {
    const response = await post('./api/proxy/' + (proxySwitch.checked ? 'on' : 'off'));
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '切换本地代理失败。');
    proxyShutdown = false;
    if (proxyShutdown) clearTimeout(refreshTimer);
    await refreshInFlight;
    snapshot.proxyEnabled = data.proxyEnabled;
    showInfo(data.message);
    if (data.proxyEnabled) await load();
  } catch (error) {
    showError(error.message);
  } finally {
    changingProxy = false;
    render();
  }
});

export function load({ fresh = false } = {}) {
  if (proxyShutdown) return Promise.resolve();
  if (refreshInFlight) return fresh ? refreshInFlight.then(() => load()) : refreshInFlight;
  clearTimeout(refreshTimer);
  refreshInFlight = fetch('./api/projects', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    .then(response => response.json().then(data => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok) {
        snapshot = { workspace: data.workspace, projects: [] };
        throw new Error(data.message || '读取状态失败。');
      }
      loadError = '';
      reportError('projects-load', '');
      reportError('sync', data.syncError || '');
      for (const project of data.projects) {
        reportError('startup-' + project.name, project.startup?.stage === 'failed' ? project.startup.message : '');
      }
      if (snapshot?.workspace !== data.workspace) actionErrors.clear();
      snapshot = data;
      render();
    })
    .catch(error => {
      snapshot ??= { projects: [] };
      reportError('projects-load', error.message);
      loadError = '暂时无法读取项目列表';
      render();
      sync.textContent = '暂时无法读取状态';
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
  const workspace = snapshot?.workspace;
  busy = true;
  actionErrors.delete(project);
  render();
  setStatus(pending, 'busy');
  try {
    let response = await post('./api/' + action + '/' + project, undefined, { workspace });
    let data = await response.json();
    if (action === 'start' && response.status === 409 && data.action === 'install') {
      if (!(await confirmInstall())) {
        if (selected === project && snapshot?.workspace === workspace) setStatus('');
        return;
      }
      if (snapshot?.workspace !== workspace) return;
      action = 'install-and-start';
      response = await post('./api/' + action + '/' + project, undefined, { workspace });
      data = await response.json();
    }
    if (!response.ok) throw new Error(data.message || '操作失败。');
    if (selected === project && snapshot?.workspace === workspace) {
      setStatus(action === 'stop' ? data.message : '');
      const terminalActions = ['start', 'install', 'install-and-start', 'restart-service', 'takeover'];
      if (terminalActions.includes(action)) focusTerminal(project);
    }
  } catch (error) {
    if (snapshot?.workspace === workspace) actionErrors.set(project, { message: error.message, action });
    if (selected === project && snapshot?.workspace === workspace) setStatus(error.message, 'error');
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
  const workspace = snapshot?.workspace;
  if (await confirmAction('会结束当前运行的实例，再用可接管的方式重新启动。继续？') && selected === project && snapshot?.workspace === workspace) {
    projectAction('takeover', '正在重启实例…');
  }
});


open.addEventListener('click', event => {
  if (open.dataset.project !== 'game') return;
  gameChannel.value = gameChannel.value.trim();
  if (!gameChannel.reportValidity()) {
    event.preventDefault();
    return;
  }
  const url = new URL(open.href);
  url.hash = '/gameList/menu?' + new URLSearchParams({ channelCode: gameChannel.value });
  const target = new URL(url);
  target.searchParams.delete('__cafe_return');
  url.searchParams.set('__cafe_return', target.pathname + target.search + target.hash);
  open.href = url.href;
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
  if (document.hidden) clearTimeout(refreshTimer);
  else load();
});

export function hasWorkspace() {
  return Boolean(snapshot?.workspace);
}

function renderReadiness(info) {
  const card = document.querySelector('#readiness');
  card.hidden = !info;
  const service = Boolean(info?.active);
  const rules = service && snapshot.proxyEnabled === true && !snapshot.stale && !snapshot.syncError && Boolean(snapshot.updatedAt) && !loadError;
  const confirmed = rules && Boolean(info?.browser?.confirmed);
  const steps = document.querySelector('#readiness-steps');
  steps.replaceChildren();
  for (const [label, done] of [['服务已启动', service && !loadError], ['代理已经开启', rules], ['测试链接已代理到本地资源', confirmed]]) {
    const item = document.createElement('li');
    item.dataset.complete = String(done);
    item.textContent = (done ? '✓ ' : '○ ') + label;
    steps.append(item);
  }
  const error = actionErrors.get(selected);
  const failed = info?.startup?.stage === 'failed';
  const syncFailure = snapshot.proxyEnabled !== false && (snapshot.syncError || (snapshot.workspace && snapshot.stale && !info?.launching && !info?.installing));
  const detail = loadError ? '无法读取最新状态，请检查 Whistle 是否运行，然后重试。' : error?.message || (failed && info.startup.message) || (info?.installStatus === 'failed' && '依赖安装失败，请查看终端中的具体原因，处理后重新安装。') || syncFailure;
  const issue = document.querySelector('#project-issue');
  issue.hidden = !detail;
  document.querySelector('#issue-title').textContent = loadError ? '连接异常' : error || failed ? '项目操作未完成' : info?.installStatus === 'failed' ? '依赖安装失败' : '代理规则未就绪';
  document.querySelector('#issue-detail').textContent = typeof detail === 'string' ? detail : '同步状态已过期，请在环境体检中检查并同步规则。';
  retryAction = loadError || (!error && !failed && info?.installStatus !== 'failed') ? 'load' : error?.action || (info?.installStatus === 'failed' ? 'install' : 'start');
  const retry = document.querySelector('#issue-retry');
  retry.hidden = retryAction === 'load' && !loadError;
  retry.disabled = busy || Boolean(info?.installing || info?.launching) || (retryAction !== 'load' && !info);
  document.querySelector('#issue-log').hidden = !info?.log && !info?.startup?.hasLog;
}
document.querySelector('#issue-retry').addEventListener('click', () => {
  if (retryAction === 'load') return load();
  // 复用原操作入口，保留确认弹窗、安装提示和按钮的可用性判断。
  const control = { start, install, 'install-and-start': start, stop, 'restart-service': restartService, takeover }[retryAction];
  if (control && !control.disabled && !control.hidden) control.click();
});
document.querySelector('#issue-doctor').addEventListener('click', () => document.querySelector('#doctor').click());
document.querySelector('#issue-log').addEventListener('click', () => focusTerminal(selected));

import { showError, reportError } from '../../shared/toast/toast.mjs';
import { confirmAction, post } from '../../shared/http/client.mjs';

const params = new URLSearchParams(location.search);
const project = params.get('project') || '';
let workspace = params.get('workspace') || '';
let workspaceChanged = false;
const title = document.querySelector('#title');
const status = document.querySelector('#status');
const dot = document.querySelector('#dot');
const output = document.querySelector('#output');
const diags = document.querySelector('#diags');
const back = document.querySelector('#back');
const notice = document.querySelector('#notice');
const noticeText = document.querySelector('#notice-text');
const takeover = document.querySelector('#takeover');

let pending = false;
let refreshing = false;
let refreshTimer;
let diagnosticsKey;

if (!/^[a-z0-9-]+$/.test(project)) {
  title.textContent = '项目参数无效';
  output.textContent = '请从面板重新打开终端。';
  throw new Error('invalid project');
}

title.textContent = `cybercafe-${project}`;
document.title = `终端 · cybercafe-${project}`;

function setStatus(text, state) {
  if (status.textContent !== text) status.textContent = text;
  const className = 'dot' + (state ? ' ' + state : '');
  if (dot.className !== className) dot.className = className;
}

function renderDiagnostics(list) {
  const key = JSON.stringify(list);
  if (diagnosticsKey === key) return;
  diagnosticsKey = key;
  if (!list.length) {
    diags.replaceChildren();
    return;
  }
  diags.replaceChildren(...list.map(item => {
    const chip = document.createElement('span');
    chip.className = 'diag';
    chip.textContent = item.text + '：' + item.action;
    return chip;
  }));
}

async function refresh() {
  if (refreshing || pending || document.hidden || workspaceChanged) return;
  clearTimeout(refreshTimer);
  refreshing = true;
  try {
    const query = workspace ? '?' + new URLSearchParams({ workspace }) : '';
    const response = await fetch(`./api/logs/${encodeURIComponent(project)}${query}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    if (!response.ok) {
      workspaceChanged = response.status === 409;
      throw new Error(data.message || '读取失败。');
    }
    workspaceChanged = false;
    workspace ||= data.workspace || '';
    if (workspace) title.title = workspace;
    reportError('terminal-load', '');
    const text = data.lines.join('\n') || '（暂无日志）';
    if (output.textContent !== text) {
      const atBottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 30;
      output.textContent = text;
      if (atBottom) output.scrollTop = output.scrollHeight;
    }
    renderDiagnostics(data.diagnostics || []);
    if (data.source === 'external') {
      notice.hidden = false;
      noticeText.textContent = '这个服务是在外部终端启动的，工具读不到它的实时输出。可以到原终端查看，或让工具接管并重启（会结束当前进程）。';
      takeover.hidden = false;
    } else if (data.source === 'none') {
      notice.hidden = false;
      noticeText.textContent = '服务未运行，下面显示最近一次运行日志。';
      takeover.hidden = true;
    } else {
      notice.hidden = true;
    }
    if (data.job && data.job.status === 'running') {
      setStatus(data.job.type === 'install' ? '正在安装依赖…' : '正在运行…', 'on');
    } else if (data.source === 'none') {
      setStatus('服务未运行', 'warn');
    } else if (data.source === 'external' || data.pid) {
      setStatus('运行中', 'on');
    } else {
      setStatus('等待启动…', '');
    }
  } catch (error) {
    setStatus(workspaceChanged ? '工作区已切换，请从主面板重新打开终端。' : '等待 Whistle…', 'warn');
    reportError('terminal-load', error.message);
    if (workspaceChanged) {
      clearTimeout(refreshTimer);
      output.textContent = '';
      diags.replaceChildren();
      notice.hidden = false;
      noticeText.textContent = '原目录终端已关闭，运行日志已保留；请从当前工作目录重新打开终端。';
    }
    takeover.hidden = true;
  } finally {
    refreshing = false;
    clearTimeout(refreshTimer);
    if (!document.hidden && !workspaceChanged && !pending) refreshTimer = setTimeout(refresh, 3000);
  }
}

async function serviceAction(button, action, message, pendingText) {
  if (pending || button.disabled || workspaceChanged || !workspace) return;
  pending = true;
  button.disabled = true;
  try {
    if (!await confirmAction(message)) return;
    setStatus(pendingText, 'warn');
    const response = await post(`./api/${action}/${encodeURIComponent(project)}`, undefined, { workspace });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '操作失败。');
  } catch (error) {
    setStatus('操作失败', 'warn');
    showError(error.message);
  } finally {
    pending = false;
    button.disabled = false;
    await refresh();
  }
}

takeover.addEventListener('click', () => serviceAction(
  takeover, 'restart-service', '会结束当前外部启动的进程，再由工具重新启动并接管日志。继续？', '正在接管并重启…',
));

back.hidden = new URLSearchParams(location.search).get('embedded') === '1';

back.addEventListener('click', () => {
  location.href = './?project=' + encodeURIComponent(project);
});

refresh();
document.addEventListener('visibilitychange', () => {
  clearTimeout(refreshTimer);
  if (!document.hidden && !pending && !workspaceChanged) refresh();
});
window.addEventListener('pagehide', () => clearTimeout(refreshTimer));
window.addEventListener('pageshow', event => {
  if (event.persisted && !document.hidden && !workspaceChanged) refresh();
});

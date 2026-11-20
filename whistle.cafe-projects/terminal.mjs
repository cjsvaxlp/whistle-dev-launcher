import { confirmAction, post } from './panel/api.mjs';

const project = new URLSearchParams(location.search).get('project') || '';
const title = document.querySelector('#title');
const status = document.querySelector('#status');
const dot = document.querySelector('#dot');
const output = document.querySelector('#output');
const diags = document.querySelector('#diags');
const stop = document.querySelector('#stop');
const back = document.querySelector('#back');
const notice = document.querySelector('#notice');
const noticeText = document.querySelector('#notice-text');
const takeover = document.querySelector('#takeover');

let pending = false;
let refreshing = false;

if (!/^[a-z0-9-]+$/.test(project)) {
  title.textContent = '项目参数无效';
  output.textContent = '请从面板重新打开终端。';
  throw new Error('invalid project');
}

title.textContent = `cybercafe-${project}`;
document.title = `终端 · cybercafe-${project}`;

function setStatus(text, state) {
  status.textContent = text;
  dot.className = 'dot' + (state ? ' ' + state : '');
}

function renderDiagnostics(list) {
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
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch(`./api/logs/${encodeURIComponent(project)}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '读取失败。');
    const atBottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 30;
    const text = data.lines.join('\n');
    output.textContent = text || '（暂无日志）';
    if (atBottom) output.scrollTop = output.scrollHeight;
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
    stop.disabled = data.source === 'none' || !data.pid || data.job?.status === 'running';
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
    setStatus('等待 Whistle…', 'warn');
    output.textContent = error.message;
    stop.disabled = true;
    takeover.hidden = true;
  } finally {
    refreshing = false;
  }
}

async function serviceAction(button, action, message, pendingText) {
  if (pending || button.disabled) return;
  pending = true;
  try {
    if (!await confirmAction(message)) return;
    button.disabled = true;
    setStatus(pendingText, 'warn');
    const response = await post(`./api/${action}/${encodeURIComponent(project)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '操作失败。');
    await refresh();
  } catch (error) {
    setStatus(error.message, 'warn');
  } finally {
    pending = false;
    if (button === takeover) button.disabled = false;
  }
}

takeover.addEventListener('click', () => serviceAction(
  takeover, 'restart-service', '会结束当前外部启动的进程，再由工具重新启动并接管日志。继续？', '正在接管并重启…',
));
stop.addEventListener('click', () => serviceAction(
  stop, 'stop', '停止 cybercafe-' + project + ' 的本地服务？', '正在停止…',
));

back.addEventListener('click', () => {
  location.href = './?project=' + encodeURIComponent(project);
});

refresh();
setInterval(() => {
  if (!document.hidden && !pending) refresh();
}, 3000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !pending) refresh();
});

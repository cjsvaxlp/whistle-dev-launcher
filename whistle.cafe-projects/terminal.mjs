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

let token = '';
let stopped = false;

if (!/^[a-z0-9-]+$/.test(project)) {
  title.textContent = '项目参数无效';
  output.textContent = '请从面板重新打开终端。';
  throw new Error('invalid project');
}

title.textContent = `cybercafe-${project}`;
document.title = `终端 · cybercafe-${project}`;

async function fetchToken() {
  if (token) return token;
  const response = await fetch('./api/token', { cache: 'no-store' });
  const data = await response.json();
  token = data.token || '';
  return token;
}

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

function hasExit(lines) {
  return lines.some(line => line.includes('[cafe-launch ') && line.includes(' exit '));
}

async function refresh() {
  try {
    const response = await fetch(`./api/logs/${encodeURIComponent(project)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '读取失败。');
    const atBottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 30;
    const text = data.lines.join('\n');
    output.textContent = text || '（暂无日志）';
    if (atBottom) output.scrollTop = output.scrollHeight;
    renderDiagnostics(data.diagnostics || []);
    const exited = hasExit(data.lines);
    stopped = exited;
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
    stop.disabled = data.source === 'none' || exited;
    if (data.job && data.job.status === 'running') {
      setStatus(data.job.type === 'install' ? '正在安装依赖…' : '正在运行…', 'on');
    } else if (exited) {
      setStatus('服务已退出', 'warn');
    } else if (text) {
      setStatus('运行中', 'on');
    } else {
      setStatus('等待启动…', '');
    }
  } catch (error) {
    setStatus('等待 Whistle…', 'warn');
    output.textContent = error.message;
  }
}

takeover.addEventListener('click', async () => {
  if (!window.confirm('会结束当前外部启动的进程，再由工具重新启动并接管日志。继续？')) return;
  takeover.disabled = true;
  setStatus('正在接管并重启…', 'warn');
  try {
    const current = await fetchToken();
    const response = await fetch(`./api/restart-service/${encodeURIComponent(project)}`, {
      method: 'POST',
      headers: { 'X-Cafe-Token': current },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '接管失败。');
    setStatus('已提交，等待新日志…', 'on');
    await refresh();
  } catch (error) {
    setStatus(error.message, 'warn');
  } finally {
    takeover.disabled = false;
  }
});

stop.addEventListener('click', async () => {
  if (stopped) return;
  if (!window.confirm('停止 cybercafe-' + project + ' 的本地服务？')) return;
  stop.disabled = true;
  try {
    const current = await fetchToken();
    const response = await fetch(`./api/stop/${encodeURIComponent(project)}`, {
      method: 'POST',
      headers: { 'X-Cafe-Token': current },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '停止失败。');
    setStatus('正在停止…', 'warn');
    await refresh();
  } catch (error) {
    stop.disabled = false;
    setStatus(error.message, 'warn');
  }
});

back.addEventListener('click', () => {
  location.href = './?project=' + encodeURIComponent(project);
});

refresh();
setInterval(refresh, 1000);

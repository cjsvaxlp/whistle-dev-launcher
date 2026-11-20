const project = new URLSearchParams(location.search).get('project') || '';
const title = document.querySelector('#title');
const status = document.querySelector('#status');
const dot = document.querySelector('#dot');
const output = document.querySelector('#output');
const diags = document.querySelector('#diags');
const stop = document.querySelector('#stop');
const back = document.querySelector('#back');

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
    stop.disabled = exited || !text;
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

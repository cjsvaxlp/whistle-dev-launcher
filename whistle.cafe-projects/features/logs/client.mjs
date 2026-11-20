import { showError, reportError } from '../../shared/toast/toast.mjs';
import { confirmAction, post } from '../../shared/http/client.mjs';

const logModal = document.querySelector('#log-modal');
const logTitle = document.querySelector('#log-title');
const logState = document.querySelector('#log-state');
const logText = document.querySelector('#log-text');
const logDiags = document.querySelector('#log-diags');
const logRun = document.querySelector('#log-run');
const logSearch = document.querySelector('#log-search');
const copyLog = document.querySelector('#copy-log');
const downloadLog = document.querySelector('#download-log');
const clearLog = document.querySelector('#clear-log');
const logNotice = document.querySelector('#log-notice');

let logTimer = null;
let logProject = '';
let logRequest = null;
let displayedLog = '';
let clearing = false;

function logUrl(extra = {}) {
  return './api/logs/' + logProject + '?' + new URLSearchParams({
    run: logRun.value || 'current', ...extra,
  });
}

function renderRuns(runs, selectedRun) {
  if (runs.map(run => run.name).join() === [...logRun.options].map(option => option.value).join()) return;
  logRun.replaceChildren(...runs.map(run => new Option(
    run.name === 'current' ? '当前日志' : new Date(run.at).toLocaleString('zh-CN'), run.name,
  )));
  logRun.value = selectedRun;
}

async function refreshLogs() {
  if (!logProject) return;
  logRequest?.abort();
  const controller = new AbortController();
  logRequest = controller;
  const q = logSearch.value.trim();
  try {
    const response = await fetch(logUrl({ q }), { cache: 'no-store', signal: controller.signal });
    const data = await response.json();
    if (controller.signal.aborted) return;
    if (!response.ok) {
      if (response.status === 404 && logRun.value !== 'current') {
        logRun.value = 'current';
        return refreshLogs();
      }
      throw new Error(data.message || '读取失败。');
    }
    reportError('logs-load', '');
    renderRuns(data.runs, data.run);
    const atBottom = logText.scrollTop + logText.clientHeight >= logText.scrollHeight - 30;
    displayedLog = data.lines.join('\n');
    logText.textContent = displayedLog || (q ? '（没有匹配的日志）' : '（暂无日志）');
    copyLog.disabled = !displayedLog;
    downloadLog.disabled = !data.runs.find(run => run.name === data.run)?.at;
    clearLog.disabled = clearing || !data.runs.some(run => run.at);
    if (atBottom && !q) logText.scrollTop = logText.scrollHeight;
    const job = data.job;
    const jobLabel = data.startup?.message || (job?.status === 'running' ? '安装中…'
      : job?.status === 'failed' ? (job.message || '安装失败') : '');
    const count = q ? (data.count > data.lines.length
      ? '显示最近 ' + data.lines.length + ' 条，共 ' + data.count + ' 条'
      : data.count + ' 条匹配') : '';
    logState.textContent = [jobLabel, count].filter(Boolean).join(' · ');
    logDiags.replaceChildren();
    for (const item of data.diagnostics) {
      const chip = document.createElement('span');
      chip.className = 'diag';
      chip.textContent = item.text + '：' + item.action;
      logDiags.append(chip);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      copyLog.disabled = true;
      downloadLog.disabled = true;
      reportError('logs-load', error.message);
    }
  }
}

export function openLogs(project) {
  logProject = project;
  logTitle.textContent = 'cybercafe-' + project + ' 日志';
  logModal.hidden = false;
  logRun.replaceChildren(new Option('当前日志', 'current'));
  logSearch.value = '';
  logText.textContent = '正在读取…';
  logState.textContent = '';
  logNotice.textContent = '';
  logDiags.replaceChildren();
  copyLog.disabled = true;
  downloadLog.disabled = true;
  clearLog.disabled = true;
  refreshLogs();
  clearInterval(logTimer);
  logTimer = setInterval(() => {
    if (!document.hidden && logRun.value === 'current' && !logSearch.value.trim()) refreshLogs();
  }, 5000);
}

function closeLogs() {
  logModal.hidden = true;
  clearInterval(logTimer);
  logTimer = null;
  logProject = '';
  logRequest?.abort();
}

logRun.addEventListener('change', refreshLogs);
let searchTimer;
logSearch.addEventListener('input', () => {
  logRequest?.abort();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshLogs, 250);
});
copyLog.addEventListener('click', async () => {
  const text = displayedLog;
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      logState.textContent = '已复制当前显示的日志';
      return;
    } catch {
      // Whistle 的内嵌面板可能没有 Clipboard API 权限。
    }
  }
  const selection = window.getSelection();
  try {
    const range = document.createRange();
    range.selectNodeContents(logText);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('copy')) throw new Error('复制失败');
    logState.textContent = '已复制当前显示的日志';
  } catch {
    showError('无法自动复制，可选中日志手动复制');
  } finally {
    selection?.removeAllRanges();
  }
});
downloadLog.addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = logUrl({ download: '1' });
  link.download = '';
  link.click();
});

clearLog.addEventListener('click', async () => {
  if (!logProject || clearing) return;
  const project = logProject;
  if (!await confirmAction(`清理 cybercafe-${project} 的日志？正在使用的当前日志会保留。`) || logProject !== project || clearing) return;
  clearing = true;
  clearLog.disabled = true;
  logNotice.textContent = '正在清理…';
  try {
    const response = await post('./api/logs/' + project + '/clear');
    const data = await response.json();
    if (logProject === project) {
      logRun.value = 'current';
      logSearch.value = '';
      clearing = false;
      await refreshLogs();
      if (logProject === project) logNotice.textContent = data.message || '清理日志失败。';
    }
  } catch (error) {
    if (logProject === project) {
      clearLog.disabled = false;
      showError(error.message);
    }
  } finally {
    clearing = false;
  }
});

document.querySelector('#close-log').addEventListener('click', closeLogs);
document.querySelector('#refresh-log').addEventListener('click', refreshLogs);
logModal.addEventListener('click', event => {
  if (event.target === logModal) closeLogs();
});

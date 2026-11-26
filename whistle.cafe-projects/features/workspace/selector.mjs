import { reportError, showInfo, showError } from '../../shared/toast/toast.mjs';

export function bindWorkspaceSelector({ updateWorkspace }) {
  const select = document.querySelector('#workspace-select');
  const path = document.querySelector('#current-workspace-path');
  const branch = document.querySelector('#current-workspace-branch');
  const add = document.querySelector('#save-workspace');
  let snapshot;
  let overview;
  let busy = false;
  let inFlight;
  let loadedAt = 0;
  let overviewError = '';

  function render() {
    const working = busy || add.dataset.pending === 'true' || Boolean(snapshot?.projects?.some(project => project.launching || project.installing));
    select.disabled = working || (!snapshot?.workspace && !overview?.workspaces?.length);
    add.disabled = working;
    add.textContent = snapshot?.workspace ? '切换项目目录' : '选择项目目录';
    const directory = snapshot?.workspace || '';
    const segments = directory.split(/[\\/]+/).filter(Boolean);
    path.textContent = segments.length > 2
      ? '…/' + segments.slice(-2).join('/')
      : directory || '选择包含 cybercafe-* 子项目的目录';
    path.title = snapshot?.workspace || '';
    select.title = snapshot?.workspace || '选择最近使用的工作目录';
    branch.textContent = overviewError ? '暂时无法读取分支与最近记录' : overview?.current === snapshot?.workspace
      ? overview.branch ? `分支：${overview.branch}` : snapshot?.workspace ? '未检测到 Git 分支' : ''
      : snapshot?.workspace ? '正在读取分支…' : '';
    const entries = overview?.workspaces || [];
    const key = JSON.stringify([snapshot?.workspace, entries]);
    if (select.dataset.entries !== key) {
      const items = [...entries];
      if (snapshot?.workspace && !items.some(item => item.directory === snapshot.workspace)) items.unshift({ directory: snapshot.workspace, label: '当前工作区', available: true });
      select.replaceChildren();
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.directory;
        const label = item.directory.split(/[\\/]+/).filter(Boolean).at(-1) || '项目目录';
        option.textContent = item.directory === snapshot?.workspace
          ? label : `${label}${item.available ? '' : '（目录不存在）'} · ${item.directory}`;
        option.disabled = !item.available && item.directory !== snapshot?.workspace;
        select.append(option);
      }
      if (!items.length) {
        const option = document.createElement('option');
        option.textContent = '请选择工作区';
        select.append(option);
      }
      select.dataset.entries = key;
    }
    select.value = snapshot?.workspace || '';
  }
  function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetch('./api/workspaces', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || '读取工作区记录失败。');
        if (data.current === snapshot?.workspace) {
          overview = data;
          overviewError = '';
          reportError('workspace-overview', '');
          loadedAt = Date.now();
        }
      } catch (error) {
        overviewError = error.message;
        reportError('workspace-overview', error.message);
        loadedAt = Date.now();
      } finally {
        inFlight = null;
        render();
      }
    })();
    return inFlight;
  }
  async function choose(directory) {
    if (busy) return;
    busy = true;
    render();
    try {
      await updateWorkspace(directory);
      await inFlight;
      await refresh();
    } finally {
      busy = false;
      render();
    }
  }
  document.addEventListener('cafe-projects-updated', event => {
    const changed = snapshot?.workspace !== event.detail.workspace;
    snapshot = event.detail;
    if (changed) { overview = null; overviewError = ''; loadedAt = 0; }
    render();
    if (!busy && (!loadedAt || Date.now() - loadedAt > 10000)) refresh();
  });
  document.addEventListener('cafe-workspace-saved', event => {
    if (event.detail.historyWarning) showError(event.detail.historyWarning);
    else if (event.detail.message) showInfo(event.detail.message);
  });
  select.addEventListener('change', () => {
    const directory = select.value;
    select.value = snapshot?.workspace || '';
    if (directory && directory !== snapshot?.workspace) choose(directory);
  });
}

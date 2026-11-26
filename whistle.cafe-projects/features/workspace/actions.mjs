import { confirmAction, post } from '../../shared/http/client.mjs';
import { showError, showInfo } from '../../shared/toast/toast.mjs';

async function readWorkspaceResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error.name !== 'SyntaxError') throw error;
    throw new Error(response.status === 405
      ? '当前页面不支持目录操作，请在 Cybercafe 主面板中操作。'
      : '未收到完整的目录操作结果，请刷新面板确认当前工作目录后再重试。');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('目录操作返回了无效结果，请刷新面板确认当前工作目录。');
  }
  return data;
}

// All directory entry points share the same validation, confirmation, and commit flow.
export function bindWorkspaceActions({ load, showDoctor }) {
  const picker = document.querySelector('#save-workspace');
  let pending = false;

  async function updateWorkspace(directory) {
    if (pending) return;
    pending = true;
    picker.dataset.pending = 'true';
    picker.disabled = true;
    if (!directory) showInfo('正在打开目录选择器…');
    try {
      let body = directory ? new URLSearchParams({ directory }) : undefined;
      let response = await post('./api/workspace', body);
      let data = await readWorkspaceResponse(response);
      if (response.status === 409 && data.action === 'confirm-switch') {
        const confirmed = await confirmAction(
          `从 ${data.previousWorkspace}\n切换到 ${data.workspace}\n\n同时只监听一个工作目录，最近记录仅用于切换。\n切换后将停止原目录中由工具启动的所有服务和终端，运行日志会保留。外部手动启动的服务不会被关闭。\n\n确定要切换吗？`,
          { title: '切换工作目录', label: '停止并切换' },
        );
        if (!confirmed) return;
        showInfo('正在停止原目录服务并切换…');
        body = new URLSearchParams({ directory: data.workspace, confirmed: '1', previousWorkspace: data.previousWorkspace });
        response = await post('./api/workspace', body);
        data = await readWorkspaceResponse(response);
      }
      if (!response.ok) throw new Error(data.message || '选择目录失败。');
      if (data.cancelled) return;
      if (typeof data.workspace !== 'string' || !data.workspace) {
        throw new Error('目录操作结果缺少工作目录，请刷新面板确认当前状态。');
      }
      await load({ fresh: true });
      document.dispatchEvent(new CustomEvent('cafe-workspace-saved', { detail: data }));
      // Refresh visible checks in the background; do not hold the directory controls for a full doctor run.
      if (!document.querySelector('#doctor-modal').hidden) showDoctor();
    } catch (error) {
      showError(error.message);
    } finally {
      pending = false;
      delete picker.dataset.pending;
      picker.disabled = false;
    }
  }
  picker.addEventListener('click', () => updateWorkspace());
  return { updateWorkspace };
}

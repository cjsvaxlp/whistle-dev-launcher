import { showError } from '../shared/toast/toast.mjs';
import { post } from '../shared/http/client.mjs';
import { bindDoctor } from '../features/doctor/client.mjs';
import { bindRules } from '../features/rules/client.mjs';
import { hasWorkspace, load, openSelectedLogs, setStatus, shouldOpenDirectly } from '../features/projects/client.mjs';
import { bindWhistleControls } from '../features/whistle/client.mjs';

const { showDoctor } = bindDoctor({ load });
bindRules();
bindWhistleControls({ load, setStatus, shouldOpenDirectly });

const picker = document.querySelector('#save-workspace');
const workspaceStatus = document.querySelector('#workspace-status');
const workspacePathForm = document.querySelector('#workspace-path-form');
const workspacePath = document.querySelector('#workspace-path');
const applyWorkspacePath = document.querySelector('#apply-workspace-path');

async function updateWorkspace(directory) {
  picker.disabled = true;
  applyWorkspacePath.disabled = true;
  workspaceStatus.dataset.state = '';
  workspaceStatus.textContent = directory ? '正在检查目录…' : '请在系统窗口中选择目录。';
  try {
    const body = directory ? new URLSearchParams({ directory }) : undefined;
    const response = await post('./api/workspace', body);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '选择目录失败。');
    if (data.cancelled) {
      workspaceStatus.textContent = '';
      return;
    }
    workspacePath.value = data.workspace;
    workspaceStatus.textContent = '已保存工作区。';
    await load();
    await load();
    if (!picker.closest('.modal').hidden) await showDoctor();
  } catch (error) {
    workspaceStatus.textContent = '';
    showError(error.message);
  } finally {
    picker.disabled = false;
    applyWorkspacePath.disabled = false;
  }
}

picker.addEventListener('click', () => updateWorkspace());
workspacePathForm.addEventListener('submit', event => {
  event.preventDefault();
  const directory = workspacePath.value.trim();
  if (directory) updateWorkspace(directory);
});

await load();
const params = new URLSearchParams(location.search);
if (hasWorkspace()
  && !localStorage.getItem('cafe-doctor-seen') && params.get('doctor') !== '0') showDoctor({ auto: true });
if (params.get('log') === '1') openSelectedLogs();

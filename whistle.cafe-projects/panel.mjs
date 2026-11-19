import { post } from './panel/api.mjs';
import { bindDialogs } from './panel/dialogs.mjs';
import { hasWorkspace, load, openSelectedLogs, setStatus } from './panel/projects.mjs';
import { bindWhistleControls } from './panel/whistle.mjs';

const { showDoctor, showRule } = bindDialogs({ load, setStatus });
bindWhistleControls({ load, setStatus });

const picker = document.querySelector('#save-workspace');
const workspaceStatus = document.querySelector('#workspace-status');
picker.addEventListener('click', async () => {
  picker.disabled = true;
  workspaceStatus.dataset.state = '';
  workspaceStatus.textContent = '请在系统窗口中选择目录。';
  try {
    const response = await post('./api/workspace');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '选择目录失败。');
    workspaceStatus.textContent = '';
    if (data.cancelled) return;
    await load();
    await load();
    if (!picker.closest('.modal').hidden) await showDoctor();
  } catch (error) {
    workspaceStatus.dataset.state = 'error';
    workspaceStatus.textContent = error.message;
  } finally {
    picker.disabled = false;
  }
});

await load();
const params = new URLSearchParams(location.search);
if (hasWorkspace()
  && !localStorage.getItem('cafe-doctor-seen') && params.get('doctor') !== '0') showDoctor({ auto: true });
if (params.get('rule') === '1') showRule();
if (params.get('log') === '1') openSelectedLogs();

import { confirmAction, post } from '../../shared/http/client.mjs';
import { showError } from '../../shared/toast/toast.mjs';

export function bindCleanup({ load }) {
  const button = document.querySelector('#cleanup');
  const state = document.querySelector('#doctor-state');
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    if (!await confirmAction(
      '将删除工具生成的日志、同步状态、兼容代理文件、PAC 文件和临时文件。工作区路径、收藏设置、项目源码和桌面应用会保留。请先停止所有服务和安装任务。已配置 PAC 的用户需重新生成配置。',
      { title: '清理生成文件', label: '清理' },
    )) return;
    button.disabled = true;
    try {
      const response = await post('./api/cleanup');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '清理失败。');
      state.textContent = data.message;
      await load();
    } catch (error) {
      showError(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

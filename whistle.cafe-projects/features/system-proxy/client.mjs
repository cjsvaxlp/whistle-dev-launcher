import { post } from '../../shared/http/client.mjs';
import { showError } from '../../shared/toast/toast.mjs';

export async function bindProxyMode() {
  const control = document.querySelector('#system-proxy-mode');
  const hint = document.querySelector('#proxy-mode-hint');
  let busy = false;
  let lastError = '';
  let savedMode = 'browser';
  let supported = false;
  async function readMode() {
    const response = await fetch('./api/proxy-mode', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('无法读取代理接入模式。');
    const data = await response.json();
    savedMode = data.mode;
    control.checked = savedMode === 'system';
    supported = Boolean(window.cafeDesktop && data.supported);
    control.disabled = !supported;
    if (data.status?.error && data.status.error !== lastError) showError(data.status.error);
    lastError = data.status?.error || '';
    hint.textContent = data.mode === 'system'
      ? '系统代理：应用自动配置 PAC，退出时恢复原设置。'
      : '浏览器代理：请将开发浏览器指向 127.0.0.1:8899，其他流量沿用系统代理。';
    if (data.status?.error) hint.textContent += ' 切换失败：' + data.status.error;
    else if (data.status && data.status.mode !== data.mode) hint.textContent += ' 等待桌面端应用配置。';
  }
  control.addEventListener('change', async () => {
    if (busy) { control.checked = savedMode === 'system'; return; }
    busy = true;
    const mode = control.checked ? 'system' : 'browser';
    control.disabled = true;
    try {
      const response = await post('./api/proxy-mode/' + mode);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '切换代理模式失败。');
      await readMode();
      hint.textContent += ' 桌面端将在数秒内应用，系统可能要求授权。';
    } catch (error) {
      control.checked = savedMode === 'system';
      showError(error.message);
    } finally { busy = false; control.disabled = !supported; }
  });
  async function refresh() {
    if (!busy && !document.hidden) {
      busy = true;
      try { await readMode(); } catch (error) {
        if (lastError !== error.message) showError(error.message);
        lastError = error.message;
      } finally { busy = false; }
    }
    setTimeout(refresh, 3000);
  }
  await refresh();
}

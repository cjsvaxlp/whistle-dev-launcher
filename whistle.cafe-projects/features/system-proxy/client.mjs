import { post } from '../../shared/http/client.mjs';
import { showError } from '../../shared/toast/toast.mjs';

export async function bindProxyMode() {
  const control = document.querySelector('#proxy-mode-picker');
  const hint = document.querySelector('#proxy-mode-hint');
  let busy = false;
  let lastError = '';
  let savedMode = 'browser';
  let supported = false;
  function selectMode(mode) {
    for (const input of control.querySelectorAll('input[name="proxy-mode"]')) input.checked = input.value === mode;
  }
  async function readMode() {
    const response = await fetch('./api/proxy-mode', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('无法读取代理接入模式。');
    const data = await response.json();
    savedMode = data.mode;
    selectMode(savedMode);
    supported = Boolean(window.cafeDesktop && data.supported);
    control.disabled = !supported;
    if (data.status?.error && data.status.error !== lastError) showError(data.status.error);
    lastError = data.status?.error || '';
    hint.title = data.mode === 'system'
      ? 'Whistle 代理：自动配置系统 PAC，退出恢复原设置。'
      : '浏览器代理：扩展中启用 HTTP 127.0.0.1:8899 的测试域名规则，无需配置 PAC。详细说明见体检。';
    control.title = hint.title;
    const pending = data.status && data.status.mode !== data.mode && !data.status.error;
    hint.hidden = !data.status?.error && !pending;
    hint.textContent = data.status?.error ? '代理切换失败 · 查看体检' : pending ? '正在切换代理…' : '';
    if (data.status?.error) hint.title = data.status.error;
  }
  control.addEventListener('change', async event => {
    if (busy) { selectMode(savedMode); return; }
    busy = true;
    const mode = event.target.value;
    if (!['browser', 'system'].includes(mode) || mode === savedMode) { busy = false; return; }
    control.disabled = true;
    try {
      const response = await post('./api/proxy-mode/' + mode);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '切换代理模式失败。');
      await readMode();

    } catch (error) {
      selectMode(savedMode);
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

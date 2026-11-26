import { post } from '../../shared/http/client.mjs';
import { showError, showInfo } from '../../shared/toast/toast.mjs';

export async function bindProxyMode() {
  const control = document.querySelector('#proxy-mode-picker');
  let busy = false;
  let lastError = '';
  let lastNotice = '';
  let requestedMode = null;
  let refreshTimer;
  function notifyPending(message) {
    const notice = message ? message.replace(/[…。.]+$/u, '') : '';
    if (notice && notice !== lastNotice) showInfo(message);
    lastNotice = notice;
  }
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
    if (!data.status?.pending && data.status?.error && data.status.error !== lastError) showError(data.status.error);
    lastError = data.status?.error || '';
    control.title = data.mode === 'system'
      ? 'Whistle 代理：自动配置系统 PAC，退出恢复原设置。'
      : '浏览器代理：扩展中启用 HTTP 127.0.0.1:8899 的测试域名规则，无需配置 PAC。详细说明见体检。';
    const pending = data.status && (data.status.pending || data.status.mode !== data.mode) && !data.status.error;
    notifyPending(pending ? (data.status.message || '正在切换代理…') : '');
    if (data.status?.error) {
      control.title = data.status.error;
      requestedMode = null;
    } else if (requestedMode && !pending && data.status?.mode === requestedMode) {
      showInfo(requestedMode === 'system' ? 'Whistle 已接管系统代理' : '已切换到浏览器代理');
      requestedMode = null;
    }
  }
  control.addEventListener('change', async event => {
    if (busy) { selectMode(savedMode); return; }
    busy = true;
    const mode = event.target.value;
    if (!['browser', 'system'].includes(mode) || mode === savedMode) { busy = false; return; }
    requestedMode = mode;
    control.disabled = true;
    notifyPending('正在切换代理…');
    try {
      const response = await post('./api/proxy-mode/' + mode);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '切换代理模式失败。');
      await readMode();
    } catch (error) {
      selectMode(savedMode);
      lastNotice = '';
      requestedMode = null;
      showError(error.message);
    } finally { busy = false; control.disabled = !supported; }
  });
  async function refresh() {
    clearTimeout(refreshTimer);
    if (!busy && !document.hidden) {
      busy = true;
      try { await readMode(); } catch (error) {
        if (lastError !== error.message) showError(error.message);
        lastError = error.message;
      } finally { busy = false; }
    }
    clearTimeout(refreshTimer);
    if (!document.hidden) refreshTimer = setTimeout(refresh, 3000);
  }
  document.addEventListener('visibilitychange', () => {
    clearTimeout(refreshTimer);
    if (!document.hidden) refresh();
  });
  window.addEventListener('pagehide', () => clearTimeout(refreshTimer));
  window.addEventListener('pageshow', event => {
    if (event.persisted && !document.hidden) refresh();
  });
  await refresh();
}

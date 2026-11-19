import { post, currentServerToken } from './api.mjs';

export function bindWhistleControls({ load, setStatus }) {
  const syncNow = document.querySelector('#sync-now');
  const restart = document.querySelector('#restart');

  restart.addEventListener('click', async () => {
    if (!window.confirm('重启 Whistle 会短暂断开所有代理连接，约 2 秒后恢复。继续？')) return;
    restart.disabled = true;
    setStatus('正在重启 Whistle，页面会自动重连…', 'busy');
    try {
      const response = await post('./api/restart');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '重启失败。');
    } catch (error) {
      setStatus(error.message, 'error');
      restart.disabled = false;
      return;
    }
    const previousToken = document.querySelector('meta[name="cafe-token"]').content;
    let tries = 0;
    let sawDown = false;
    async function pollRestart() {
      tries += 1;
      const next = await currentServerToken();
      if (next && next !== previousToken) {
        location.reload();
        return;
      }
      if (!next) sawDown = true;
      if ((tries === 10 && !sawDown) || tries >= 40) {
        restart.disabled = false;
        setStatus('未检测到 Whistle 重启，请查看 .cafe-tools/logs/whistle-restart.log 或执行 w2 restart。', 'error');
        return;
      }
      setTimeout(pollRestart, 1000);
    }
    setTimeout(pollRestart, 1000);
  });

  syncNow.addEventListener('click', async () => {
    try {
      await post('./api/sync');
      setStatus('已触发同步，稍后刷新状态。', 'busy');
      setTimeout(load, 1200);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
}

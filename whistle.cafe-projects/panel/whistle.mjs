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
    let tries = 0;
    let sawDown = false;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const response = await fetch('./api/projects', { cache: 'no-store' });
        if (response.ok) {
          // 重启后插件进程换了，面板里的令牌会变；用这个判断是否真的重启了。
          const next = await currentServerToken();
          if (!next || next !== token) {
            clearInterval(timer);
            location.reload();
            return;
          }
        }
      } catch {
        sawDown = true;
      }
      if (tries === 10 && !sawDown) {
        clearInterval(timer);
        restart.disabled = false;
        setStatus('重启命令已发送，但服务一直没有断开，可能没有生效；请查看工具目录下的 .cafe-tools/logs/whistle-restart.log，或手动执行 w2 restart。', 'error');
        return;
      }
      if (tries >= 40) {
        clearInterval(timer);
        restart.disabled = false;
        setStatus('重启后没有连上，请在终端执行 w2 restart。', 'error');
      }
    }, 1000);
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

import { confirmAction, post, currentServerToken } from './api.mjs';

export function bindWhistleControls({ load, setStatus }) {
  const syncNow = document.querySelector('#sync-now');
  const restart = document.querySelector('#restart');

  if (/Mac/.test(navigator.platform)) {
    for (const id of ['entry', 'open']) {
      const link = document.querySelector('#' + id);
      link.title = '在开发 Chrome 中通过 Whistle 打开';
      link.addEventListener('click', async event => {
        event.preventDefault();
        const project = link.dataset.project;
        const path = project ? './api/open-chrome/' + encodeURIComponent(project) : './api/open-chrome';
        try {
          const response = await post(path);
          const data = await response.json();
          if (!response.ok) {
            throw new Error(response.status === 404 && !project
              ? '请重启 Whistle 以加载开发 Chrome 入口。'
              : data.message || '打开开发 Chrome 失败。');
          }
          setStatus('');
        } catch (error) {
          setStatus(error.message, 'error');
        }
      });
    }
  }

  restart.addEventListener('click', async () => {
    if (!await confirmAction('代理连接会短暂断开，通常约 2 秒后恢复。', {
      title: '重启 Whistle',
      label: '重启',
    })) return;
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

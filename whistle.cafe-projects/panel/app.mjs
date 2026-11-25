async function startPanel() {
  let loaded;
  try {
    loaded = await Promise.all([
      import('../features/system-proxy/client.mjs'),
      import('../features/cleanup/client.mjs'),
      import('../shared/toast/toast.mjs'),
      import('../shared/http/client.mjs'),
      import('../features/doctor/client.mjs'),
      import('../features/rules/client.mjs'),
      import('../features/projects/client.mjs'),
      import('../features/whistle/client.mjs'),
    ]);
  } catch (error) {
    showBootFailure(error);
    return;
  }
  const [
    { bindProxyMode },
    { bindCleanup },
    { showError },
    { post },
    { bindDoctor },
    { bindRules },
    { hasWorkspace, load, setStatus, shouldOpenDirectly },
    { bindWhistleControls },
  ] = loaded;

  const { showDoctor } = bindDoctor({ load });
  bindRules();
  await bindProxyMode();
  bindCleanup({ load });
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
  sessionStorage.removeItem('cafe-boot-restart');
}

function showBootFailure(error) {
  if (document.querySelector('#boot-failure')) return;
  const overlay = document.createElement('div');
  overlay.id = 'boot-failure';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:#f5f6f8;font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#1d2939';
  const card = document.createElement('section');
  card.style.cssText = 'width:min(520px,100%);padding:24px;border:1px solid #e4e9ef;border-radius:14px;background:#fff;box-shadow:0 12px 30px rgba(16,24,40,.12)';
  card.innerHTML = [
    '<h2 style="margin:0 0 8px;font-size:18px">面板代码没有加载完成</h2>',
    '<p style="margin:0 0 12px;color:#667085">通常是更新后 Whistle 还在运行旧插件。重启一次 Whistle 即可。</p>',
    '<p id="boot-error" style="margin:0 0 16px;color:#b42318;font-size:12px;overflow-wrap:anywhere"></p>',
    '<button id="boot-restart" type="button" style="margin-right:8px;padding:7px 14px;border:0;border-radius:7px;background:#0066cc;color:#fff;font:inherit;cursor:pointer">重启 Whistle</button>',
    '<button id="boot-close" type="button" style="padding:7px 14px;border:1px solid #d0d7de;border-radius:7px;background:#fff;color:inherit;font:inherit;cursor:pointer">关闭提示</button>',
  ].join('');
  const detail = card.querySelector('#boot-error');
  const button = card.querySelector('#boot-restart');
  const message = error && error.message ? error.message : String(error || '');
  detail.textContent = message;
  const missingUrl = (message.match(/https?:\/\/[^\s"']+/) || [])[0] || '';

  async function restart() {
    button.disabled = true;
    button.textContent = '正在重启…';
    detail.textContent = '正在重启 Whistle，页面会自动重连…';
    try {
      const tokenResponse = await fetch('./api/token', { cache: 'no-store' });
      const token = (await tokenResponse.json()).token;
      const response = await fetch('./api/restart', {
        method: 'POST',
        headers: { 'X-Cafe-Token': token },
      });
      if (!response.ok) {
        throw new Error(response.status === 404
          ? '当前插件没有重启接口，请在终端执行 w2 restart。'
          : '重启失败，请在终端执行 w2 restart。');
      }
      let tries = 0;
      async function pollRestart() {
        if (!overlay.isConnected) return;
        tries += 1;
        try {
          const probe = missingUrl || './api/token';
          if ((await fetch(probe, { cache: 'no-store', signal: AbortSignal.timeout(3000) })).ok && overlay.isConnected) {
            sessionStorage.removeItem('cafe-boot-restart');
            location.reload();
            return;
          }
        } catch {
          // Whistle 重启过程中连接会断开。
        }
        if (tries >= 30) {
          button.disabled = false;
          button.textContent = '重启 Whistle';
          detail.textContent = '重启后仍未连上，请在终端执行 w2 restart。';
          return;
        }
        setTimeout(pollRestart, 1000);
      }
      setTimeout(pollRestart, 1000);
    } catch (restartError) {
      button.disabled = false;
      button.textContent = '重启 Whistle';
      detail.textContent = restartError.message;
    }
  }

  button.addEventListener('click', restart);
  card.querySelector('#boot-close').addEventListener('click', () => overlay.remove());
  overlay.append(card);
  document.body.append(overlay);

  // 只自动尝试一次；若重启后仍失败，保留手动按钮，避免反复重启。
  if (!sessionStorage.getItem('cafe-boot-restart')) {
    sessionStorage.setItem('cafe-boot-restart', '1');
    detail.textContent = '检测到插件更新，正在自动重启 Whistle…';
    setTimeout(restart, 250);
  }
}
startPanel();

import { showError } from '../../shared/toast/toast.mjs';

export function bindWindowControls() {
  const controls = document.querySelector('.window-controls');
  const nativeWindow = window.__TAURI__?.window?.getCurrentWindow();
  if (!controls || !nativeWindow) return;

  // Bind explicitly so blank toolbar space and its brand drag consistently.
  const toolbar = document.querySelector('.toolbar');
  toolbar?.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || event.target.closest('button, a, input, label, fieldset, .proxy-control, .window-controls')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = event.detail === 2 ? nativeWindow.toggleMaximize() : nativeWindow.startDragging();
    action.catch((error) => showError(`窗口操作失败：${error.message || error}`));
  });

  let busy = false;
  let readingSize = false;
  const maximize = controls.querySelector('[data-window-action="maximize"]');
  async function updateMaximized() {
    if (readingSize || controls.hidden) return;
    readingSize = true;
    try {
      const maximized = await nativeWindow.isMaximized();
      maximize.title = maximize.ariaLabel = maximized ? '还原' : '最大化';
      maximize.querySelector('path').setAttribute('d', maximized
        ? 'M5.5 3.5v-1h8v8h-1M2.5 5.5h8v8h-8z' : 'M3.5 3.5h9v9h-9z');
    } catch (error) {
      showError(`读取窗口状态失败：${error.message || error}`);
    } finally {
      readingSize = false;
    }
  }
  function initialize() {
    if (document.documentElement.dataset.desktopPlatform !== 'windows') return;
    controls.hidden = false;
    updateMaximized();
    window.addEventListener('resize', updateMaximized);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else initialize();

  controls.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-window-action]');
    if (!button || busy) return;
    busy = true;
    try {
      switch (button.dataset.windowAction) {
        case 'minimize': await nativeWindow.minimize(); break;
        case 'maximize': await nativeWindow.toggleMaximize(); await updateMaximized(); break;
        case 'close': await nativeWindow.close(); break;
      }
    } catch (error) {
      showError(`窗口操作失败：${error.message || error}`);
    } finally {
      busy = false;
    }
  });
}

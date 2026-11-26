// Local visual preview: serve repository assets and proxy only allowlisted read-only panel APIs.
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { resolve, sep } = require('node:path');
const root = resolve(__dirname, '../whistle.cafe-projects');
const port = Number(process.env.CAFE_PREVIEW_PORT || 18997);
const readonlyMessage = '这是只读预览，不能切换目录或控制服务。请在 Cybercafe 应用或 8899 主面板中操作。';
const readonlyScript = `(() => {
  const ids = ['save-workspace','workspace-select','start','install','stop','restart-service','takeover','restart','sync-now','cleanup','local-proxy','proxy-mode-picker','edit-rule'];
  function lock() {
    for (const id of ids) {
      const control = document.getElementById(id);
      if (control && !control.disabled) control.disabled = true;
      if (control) {
        control.title = '只读预览，请在 Cybercafe 应用中操作';
        control.style.opacity = '.45';
        control.style.cursor = 'not-allowed';
      }
    }
    for (const star of document.querySelectorAll('.star')) star.style.pointerEvents = 'none';
    for (const link of document.querySelectorAll('#entry, #open')) {
      link.setAttribute('aria-disabled', 'true');
      link.tabIndex = -1;
      link.style.pointerEvents = 'none';
      link.style.opacity = '.45';
    }
    for (const button of document.querySelectorAll('.checks button')) if (!button.disabled) button.disabled = true;
  }
  document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
  new MutationObserver(lock).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  document.addEventListener('DOMContentLoaded', lock, { once: true });
  lock();
})();`;

function json(response, code, data) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method !== 'GET') return json(response, 405, { message: readonlyMessage });
  if (url.pathname === '/__preview/readonly.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return response.end(readonlyScript);
  }
  if (url.pathname.startsWith('/api/')) {
    const allowed = ['/api/projects', '/api/workspaces', '/api/proxy-mode', '/api/rule', '/api/doctor'];
    const logs = /^\/api\/logs\/[a-z0-9-]+(?:\/runs)?$/.test(url.pathname);
    if (!allowed.includes(url.pathname) && !logs) return json(response, 403, { message: readonlyMessage });
    const upstream = http.get({ hostname: '127.0.0.1', port: 8899, path: '/plugin.cafe-projects' + url.pathname + url.search }, incoming => {
      response.writeHead(incoming.statusCode, { 'Content-Type': incoming.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store' });
      incoming.on('error', () => response.destroy());
      incoming.pipe(response);
    });
    upstream.setTimeout(5000, () => upstream.destroy());
    upstream.on('error', () => {
      if (response.headersSent) response.destroy();
      else json(response, 503, { message: '无法读取本机面板状态，请确认 Whistle 已启动。' });
    });
    return;
  }
  const relative = url.pathname === '/' ? 'panel/index.html' : url.pathname === '/terminal.html' ? 'features/terminal/terminal.html' : url.pathname.slice(1);
  const file = resolve(root, relative);
  if (!file.startsWith(root + sep)) return json(response, 403, { message: '路径无效。' });
  try {
    const type = /\.(?:mjs|js)$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    let text = readFileSync(file, 'utf8');
    if (type === 'text/html') {
      text = text.replace(/<header\b/, '<script src="/__preview/readonly.js" defer></script><header');
      if (relative === 'panel/index.html') text = text.replace('<header class="toolbar">', '<aside style="flex:none;padding:8px 20px;background:var(--warning-bg);color:var(--warning);font:12px/1.5 -apple-system,sans-serif">只读预览 · 目录和服务操作请使用 Cybercafe 应用。 <a href="http://127.0.0.1:8899/plugin.cafe-projects/">打开正式主面板</a></aside><header class="toolbar">');
    }
    response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(text);
  } catch { json(response, 404, { message: '预览资源不存在。' }); }
}).listen(port, '127.0.0.1', () => console.log(`Read-only preview: http://127.0.0.1:${port}/?doctor=0`));

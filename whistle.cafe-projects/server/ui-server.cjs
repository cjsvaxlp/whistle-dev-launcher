const { modeSnapshot, setMode, setBrowserOption } = require('../features/system-proxy/mode.cjs');
const { cleanGeneratedFiles } = require('../features/cleanup/server.cjs');
const { pacRoute, servePac } = require('../features/system-proxy/pac.cjs');
const { selectWorkspace } = require('../features/workspace/server.cjs');
const { workspaceOverview } = require('../features/workspace/history.cjs');
const { openBrowser } = require('../features/browser/server.cjs');
const { readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { origin, pluginDir, readWorkspace } = require('../shared/config/config.cjs');
const { authorized, json, token } = require('../shared/http/http.cjs');
const { listProjects } = require('../features/projects/store.cjs');
const { projectAction, stopAllServices, runSync, snapshot, changeProxy, isChangingWorkspace, beginLogCleanup } = require('../features/projects/server.cjs');
const { doctor, fix } = require('../features/doctor/server.cjs');
const { getLog, clearProjectLogs } = require('../features/logs/routes.cjs');
const { listLogRuns } = require('../features/logs/store.cjs');
const { getRule, restartWhistle } = require('../features/whistle/server.cjs');

const panelAssets = new Map([
  ["/features/window-controls/client.mjs", ["features/window-controls/client.mjs", "text/javascript; charset=utf-8"]],
  ["/features/system-proxy/client.mjs", ["features/system-proxy/client.mjs", "text/javascript; charset=utf-8"]],
  ["/features/cleanup/client.mjs", ["features/cleanup/client.mjs", "text/javascript; charset=utf-8"]],
  ["/features/rules/dialog.css", ["features/rules/dialog.css", "text/css; charset=utf-8"]],
  ["/features/terminal/embedded.mjs", ["features/terminal/embedded.mjs", "text/javascript; charset=utf-8"]],
  ["/features/terminal/embedded.css", ["features/terminal/embedded.css", "text/css; charset=utf-8"]],
  ["/features/doctor/client.mjs", ["features/doctor/client.mjs", "text/javascript; charset=utf-8"]],
  ["/features/rules/client.mjs", ["features/rules/client.mjs", "text/javascript; charset=utf-8"]],
  ["/", ["panel/index.html", "text/html; charset=utf-8"]],
  ["/features/terminal/terminal.css", ["features/terminal/terminal.css", "text/css; charset=utf-8"]],
  ["/features/badge/badge.html", ["features/badge/badge.html", "text/html; charset=utf-8"]],
  ["/panel/app.mjs", ["panel/app.mjs", "text/javascript; charset=utf-8"]],
  ["/terminal.html", ["features/terminal/terminal.html", "text/html; charset=utf-8"]],
  ["/features/terminal/terminal.html", ["features/terminal/terminal.html", "text/html; charset=utf-8"]],
  ["/features/badge/badge.css", ["features/badge/badge.css", "text/css; charset=utf-8"]],
  ["/panel/index.html", ["panel/index.html", "text/html; charset=utf-8"]],
  ["/features/terminal/client.mjs", ["features/terminal/client.mjs", "text/javascript; charset=utf-8"]],
  ["/shared/http/client.mjs", ["shared/http/client.mjs", "text/javascript; charset=utf-8"]],
  ["/shared/toast/toast.mjs", ["shared/toast/toast.mjs", "text/javascript; charset=utf-8"]],
  ["/features/workspace/actions.mjs", ["features/workspace/actions.mjs", "text/javascript; charset=utf-8"]],
  ["/features/workspace/selector.mjs", ["features/workspace/selector.mjs", "text/javascript; charset=utf-8"]],
  ["/features/projects/client.mjs", ["features/projects/client.mjs", "text/javascript; charset=utf-8"]],
  ["/shared/toast/toast.css", ["shared/toast/toast.css", "text/css; charset=utf-8"]],
  ["/features/whistle/client.mjs", ["features/whistle/client.mjs", "text/javascript; charset=utf-8"]],
  ["/panel/panel.css", ["panel/panel.css", "text/css; charset=utf-8"]],
]);
const panelCache = new Map();

function readPanel(name) {
  const file = join(pluginDir, name);
  const { mtimeMs, size, ino } = statSync(file);
  const cached = panelCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size && cached.ino === ino) return cached.data;
  const data = readFileSync(file, 'utf8');
  panelCache.set(file, { mtimeMs, size, ino, data });
  return data;
}

function servePanel(response, path) {
  const [file, type] = panelAssets.get(path);
  try {
    const data = readPanel(file);
    response.setHeader('Content-Type', type);
    if (path === '/' || path === '/terminal.html') {
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ipc: http://ipc.localhost; frame-src 'self'; frame-ancestors 'self'");
    }
    response.end((path === '/' || path === '/terminal.html') ? data.replace('CAFE_CSRF', token) : data);
  } catch {
    json(response, 503, { message: '暂时无法读取面板文件，请刷新重试。' });
  }
}

async function handle(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(request.url, origin);
  const path = url.pathname;
  if (path === pacRoute && ['GET', 'HEAD'].includes(request.method)) return servePac(response, request.method);
  if (request.method === 'GET') {
    if (panelAssets.has(path)) return servePanel(response, path);
    if (path === '/api/proxy-mode') return json(response, 200, modeSnapshot());
    if (path === '/api/token') return json(response, 200, { token });
    if (path === '/api/workspaces') return json(response, 200, await workspaceOverview());
    if (path === '/api/projects') {
      try {
        return json(response, 200, snapshot());
      } catch (error) {
        const workspace = readWorkspace();
        return json(response, 503, { workspace, code: error.code, message: error.code === 'ENOENT' || error.code === 'ENOTDIR'
          ? `无法读取项目工作区「${workspace}」（${error.code}）。请重新选择本机项目目录。` : error.message });
      }
    }
    if (path === '/api/doctor') {
      try {
        const workspace = readWorkspace();
        const data = await doctor();
        if (workspace !== readWorkspace()) return json(response, 409, { message: '工作区已切换，请重新检查当前环境。' });
        return json(response, 200, data);
      } catch (error) {
        return json(response, 503, { message: error.message });
      }
    }
    if (path === '/api/rule') return getRule(response);
  }

  const logMatch = /^\/api\/logs\/([a-z0-9-]+)(?:\/(runs|clear))?$/.exec(path);
  if (logMatch) {
    const [, project, action] = logMatch;
    if (url.searchParams.has('workspace') && url.searchParams.get('workspace') !== readWorkspace()) return json(response, 409, { message: '工作区已切换，请从主面板重新打开终端。' });
    if (action === 'clear' && (request.method !== 'POST' || !authorized(request))) {
      return json(response, 403, { message: '请从本机 Whistle 面板操作。' });
    }
    if (!listProjects().includes(project)) return json(response, 404, { message: '项目不存在。' });
    if (action === 'clear') {
      let release;
      try {
        release = beginLogCleanup();
        return await clearProjectLogs(response, project);
      } catch (error) {
        if (error.code !== 'WORKSPACE_BUSY') throw error;
        return json(response, 409, { message: error.message });
      } finally { release?.(); }
    }
    if (request.method === 'GET') {
      if (action === 'runs') return json(response, 200, { runs: listLogRuns(project) });
      return getLog(response, url, project);
    }
  }

  if (request.method === 'POST') {
    if (path === '/api/stop-all') return stopAllServices(request, response);
    if (path === '/api/cleanup') return cleanGeneratedFiles(request, response);
    if (path === '/api/workspace') return selectWorkspace(request, response);
    if (path === '/api/proxy/on' || path === '/api/proxy/off') {
      return changeProxy(request, response, path.endsWith('/on'));
    }
    if (path === '/api/sync') {
      if (!authorized(request)) return json(response, 403, { message: '请从本机 Whistle 面板操作。' });
      if (!readWorkspace()) return json(response, 409, { message: '请先选择项目工作区。' });
      const ok = await runSync();
      return json(response, ok ? 200 : 503, { message: ok ? '已同步。' : '同步失败，稍后会自动重试。' });
    }
    const browser = /^\/api\/open-chrome(?:\/([a-z0-9-]+))?$/.exec(path);
    if (browser) return openBrowser(request, response, url, browser);
    if (path === '/api/restart') return restartWhistle(request, response);
    const fixMatch = /^\/api\/fix\/([a-z-]+)$/.exec(path);
    if (fixMatch) return fix(request, response, fixMatch[1]);
  }

  const browserOption = /^\/api\/browser-proxy-option\/(on|off)$/.exec(path);
  if (browserOption && request.method === 'POST') {
    if (isChangingWorkspace()) return json(response, 409, { message: '正在切换工作区，请稍后操作。' });
    return setBrowserOption(request, response, browserOption[1] === 'on');
  }
  const modeMatch = /^\/api\/proxy-mode\/(system|browser)$/.exec(path);
  if (modeMatch && request.method === 'POST') {
    if (isChangingWorkspace()) return json(response, 409, { message: '正在切换工作区，请稍后切换代理模式。' });
    return setMode(request, response, modeMatch[1]);
  }

  const actionMatch = /^\/api\/(install|install-and-start|start|stop|restart-service|takeover|favorite|touch)\/([a-z0-9-]+)$/.exec(path);
  if (actionMatch) return projectAction(request, response, actionMatch[1], actionMatch[2]);
  json(response, 404, { message: '接口不存在。' });
}

exports.uiServer = server => {
  server.on('request', (request, response) => {
    handle(request, response).catch(error => {
      if (response.headersSent) return response.destroy();
      json(response, 503, { message: error.code === 'ENOENT'
        ? '无法读取项目工作区，请在面板重新选择目录。'
        : error.message });
    });
  });
};

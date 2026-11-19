const { readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { origin, pluginDir } = require('./config.cjs');
const { authorized, json, token } = require('./http.cjs');
const { listProjects } = require('./project-store.cjs');
const { projectAction, runSync, snapshot } = require('./projects.cjs');
const { doctor, fix } = require('./doctor.cjs');
const { getLog, clearProjectLogs } = require('./log-routes.cjs');
const { listLogRuns } = require('./logs.cjs');
const { getRule, restartWhistle } = require('./whistle.cjs');

const scriptType = 'text/javascript; charset=utf-8';
const panelAssets = new Map([
  ['/', ['panel.html', 'text/html; charset=utf-8']],
  ['/panel.mjs', ['panel.mjs', scriptType]],
  ['/panel/panel.css', ['panel/panel.css', 'text/css; charset=utf-8']],
  ...['api', 'dialogs', 'logs', 'projects', 'whistle'].map(name => {
    const file = 'panel/' + name + '.mjs';
    return ['/' + file, [file, scriptType]];
  }),
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
    if (path === '/') {
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'");
    }
    response.end(path === '/' ? data.replace('CAFE_CSRF', token) : data);
  } catch {
    json(response, 503, { message: '暂时无法读取面板文件，请刷新重试。' });
  }
}

async function handle(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(request.url, origin);
  const path = url.pathname;
  if (request.method === 'GET') {
    if (panelAssets.has(path)) return servePanel(response, path);
    if (path === '/api/token') return json(response, 200, { token });
    if (path === '/api/projects') return json(response, 200, snapshot());
    if (path === '/api/doctor') {
      try {
        return json(response, 200, await doctor());
      } catch (error) {
        return json(response, 503, { message: error.message });
      }
    }
    if (path === '/api/rule') return getRule(response);
  }

  const logMatch = /^\/api\/logs\/([a-z0-9-]+)(?:\/(runs|clear))?$/.exec(path);
  if (logMatch) {
    const [, project, action] = logMatch;
    if (action === 'clear' && (request.method !== 'POST' || !authorized(request))) {
      return json(response, 403, { message: '请从本机 Whistle 面板操作。' });
    }
    if (!listProjects().includes(project)) return json(response, 404, { message: '项目不存在。' });
    if (action === 'clear') return clearProjectLogs(response, project);
    if (request.method === 'GET') {
      if (action === 'runs') return json(response, 200, { runs: listLogRuns(project) });
      return getLog(response, url, project);
    }
  }

  if (request.method === 'POST') {
    if (path === '/api/sync') {
      if (!authorized(request)) return json(response, 403, { message: '请从本机 Whistle 面板操作。' });
      const ok = await runSync();
      return json(response, ok ? 200 : 503, { message: ok ? '已同步。' : '同步失败，稍后会自动重试。' });
    }
    if (path === '/api/restart') return restartWhistle(request, response);
    const fixMatch = /^\/api\/fix\/([a-z-]+)$/.exec(path);
    if (fixMatch) return fix(request, response, fixMatch[1]);
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
        ? '无法读取项目工作区，请检查 CAFE_WORKSPACE。'
        : error.message });
    });
  });
};

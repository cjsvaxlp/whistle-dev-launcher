const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, rename, rm, writeFile } = require('node:fs/promises');
const { workspaceFile } = require('../workspace.cjs');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { isAbsolute, join, resolve } = require('node:path');
const { origin, pluginDir, stateDir, isWindows, POWERSHELL, readWorkspace, tools, entryUrl, projectPageUrl } = require('./config.cjs');
const { authorized, json, token } = require('./http.cjs');
const { listProjects } = require('./project-store.cjs');
const { projectAction, runSync, refreshWorkspace, snapshot, changeProxy } = require('./projects.cjs');
const { doctor, fix } = require('./doctor.cjs');
const { getLog, clearProjectLogs } = require('./log-routes.cjs');
const { listLogRuns } = require('./logs.cjs');
const { getRule, restartWhistle } = require('./whistle.cjs');

const scriptType = 'text/javascript; charset=utf-8';
const panelAssets = new Map([
  ['/', ['panel.html', 'text/html; charset=utf-8']],
  ['/panel.mjs', ['panel.mjs', scriptType]],
  ['/panel/panel.css', ['panel/panel.css', 'text/css; charset=utf-8']],
  ['/terminal.html', ['terminal.html', 'text/html; charset=utf-8']],
  ['/terminal.mjs', ['terminal.mjs', scriptType]],
  ['/terminal.css', ['terminal.css', 'text/css; charset=utf-8']],
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
    if (path === '/' || path === '/terminal.html') {
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'");
    }
    response.end((path === '/' || path === '/terminal.html') ? data.replace('CAFE_CSRF', token) : data);
  } catch {
    json(response, 503, { message: '暂时无法读取面板文件，请刷新重试。' });
  }
}

const run = promisify(execFile);
async function openWindowsChrome(url) {
  const chrome = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean)
    .map(directory => join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find(existsSync);
  if (!chrome) throw new Error('找不到 Google Chrome，请先安装 Chrome。');
  await mkdir(stateDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--user-data-dir=' + join(stateDir, 'Chrome开发配置'),
      '--proxy-server=http://127.0.0.1:8899',
      url,
    ], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

let savingWorkspace = false;

async function chooseWorkspace() {
  const options = { timeout: 300000, windowsHide: true };
  if (isWindows) {
    const code = [
      '$ErrorActionPreference = "Stop"',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = '请选择包含 cybercafe-* 子项目的目录'",
      '$dialog.ShowNewFolderButton = $false',
      'try { if ($dialog.ShowDialog() -eq "OK") { $dialog.SelectedPath } } finally { $dialog.Dispose() }',
    ].join('\n');
    const { stdout } = await run(POWERSHELL, [
      '-NoProfile', '-STA', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64'),
    ], options);
    return stdout.trim();
  }

  const { stdout } = await run('/usr/bin/osascript', [
    '-e', 'try',
    '-e', 'activate',
    '-e', 'return POSIX path of (choose folder with prompt "请选择包含 cybercafe-* 子项目的目录")',
    '-e', 'on error number -128',
    '-e', 'return ""',
    '-e', 'end try',
  ], options);
  return stdout.trim();
}

async function handle(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(request.url, origin);
  const path = url.pathname;
  if (request.method === 'GET') {
    if (panelAssets.has(path)) return servePanel(response, path);
    if (path === '/api/token') return json(response, 200, { token });
    if (path === '/api/projects') {
      try {
        return json(response, 200, snapshot());
      } catch (error) {
        return json(response, 503, { workspace: readWorkspace(), message: error.code === 'ENOENT'
          ? '找不到项目工作区，请重新选择目录。' : error.message });
      }
    }
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
    if (path === '/api/workspace') {
      if (!authorized(request)) {
        json(response, 403, { message: '请从本机 Whistle 面板保存。' });
        return;
      }
      if (savingWorkspace) {
        json(response, 409, { message: '正在保存，请稍后重试。' });
        return;
      }
      savingWorkspace = true;
      const temporary = `${workspaceFile}.${process.pid}.tmp`;
      try {
        const selected = await chooseWorkspace();
        if (!selected) {
          json(response, 200, { cancelled: true });
          return;
        }
        if (!isAbsolute(selected) || /[\x00-\x1f]/.test(selected)) {
          json(response, 400, { message: '所选目录的路径无效。' });
          return;
        }
        const directory = resolve(selected);
        if (!listProjects(directory).length) {
          json(response, 400, { message: '请选择包含 cybercafe-* 子项目的目录。' });
          return;
        }
        await mkdir(stateDir, { recursive: true });
        await writeFile(temporary, directory + '\n', { mode: 0o600 });
        await rename(temporary, workspaceFile);
        refreshWorkspace();
        json(response, 200, { workspace: readWorkspace() });
      } catch (error) {
        json(response, 500, { message: `无法选择或保存工作区：${error.message}` });
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
        savingWorkspace = false;
      }
      return;
    }
    if (path === '/api/proxy/on' || path === '/api/proxy/off') {
      return changeProxy(request, response, path.endsWith('/on'));
    }
    if (path === '/api/sync') {
      if (!authorized(request)) return json(response, 403, { message: '请从本机 Whistle 面板操作。' });
      const ok = await runSync();
      return json(response, ok ? 200 : 503, { message: ok ? '已同步。' : '同步失败，稍后会自动重试。' });
    }
    const chrome = /^\/api\/open-chrome(?:\/([a-z0-9-]+))?$/.exec(path);
    if (chrome) {
      if (!authorized(request)) return json(response, 403, { message: '请从本机 Whistle 面板操作。' });
      if (!isWindows && process.platform !== 'darwin') {
        return json(response, 501, { message: '开发 Chrome 支持 macOS 和 Windows。' });
      }
      const project = chrome[1];
      if (project && !listProjects().includes(project)) {
        return json(response, 404, { message: '项目不存在。' });
      }
      let launchUrl = project ? projectPageUrl(project) : entryUrl;
      if (project === 'game') {
        const channelCode = url.searchParams.get('channelCode') || '';
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(channelCode)) {
          return json(response, 400, { message: '请输入有效的游戏渠道编码。' });
        }
        launchUrl += '?' + new URLSearchParams({ channelCode });
      }
      try {
        if (isWindows) await openWindowsChrome(launchUrl);
        else await run('/bin/zsh', [join(tools, '打开测试环境.command'), launchUrl], { timeout: 8000 });
        return json(response, 200, { ok: true });
      } catch (error) {
        return json(response, 500, { message: error.stderr?.trim() || error.message || '打开开发 Chrome 失败。' });
      }
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
        ? '无法读取项目工作区，请在面板重新选择目录。'
        : error.message });
    });
  });
};

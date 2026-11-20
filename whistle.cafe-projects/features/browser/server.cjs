const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { stateDir, isWindows, tools, entryUrl, projectPageUrl } = require('../../shared/config/config.cjs');
const { authorized, json } = require('../../shared/http/http.cjs');
const { listProjects } = require('../projects/store.cjs');
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

async function openBrowser(request, response, url, chrome) {
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

module.exports = { openBrowser };

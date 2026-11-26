const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');
const { isWindows, POWERSHELL, tools, entryUrl, projectPageUrl } = require('../../shared/config/config.cjs');
const { authorized, json } = require('../../shared/http/http.cjs');
const { listProjects } = require('../projects/store.cjs');
const { windowsCommand } = require('../terminal/launcher.cjs');
const run = promisify(execFile);

async function openBrowser(request, response, url, chrome) {
  if (!authorized(request)) return json(response, 403, { message: '请从本机 Whistle 面板操作。' });
  if (!isWindows && process.platform !== 'darwin') {
    return json(response, 501, { message: '打开默认浏览器支持 macOS 和 Windows。' });
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
    if (isWindows) {
      await run(POWERSHELL, windowsCommand('Start-Process', [launchUrl]), { windowsHide: true, timeout: 8000 });
    } else await run('/bin/zsh', [join(tools, 'scripts/commands/打开测试环境.command'), launchUrl], { timeout: 8000 });
    return json(response, 200, { ok: true });
  } catch (error) {
    return json(response, 500, { message: error.stderr?.trim() || error.message || '打开默认浏览器失败。' });
  }
}

module.exports = { openBrowser };

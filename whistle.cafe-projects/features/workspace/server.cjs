const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, realpath, rename, rm, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { isAbsolute, join, resolve } = require('node:path');
const { workspaceFile, readWorkspace, stateDir } = require('./store.cjs');
const { isWindows, POWERSHELL } = require('../../shared/config/config.cjs');
const { authorized, json } = require('../../shared/http/http.cjs');
const { listProjects, readState } = require('../projects/store.cjs');
const { refreshWorkspace, beginWorkspaceChange, endWorkspaceChange, stopWorkspaceServices } = require('../projects/server.cjs');
const { rememberWorkspace } = require('./history.cjs');
const run = promisify(execFile);

let savingWorkspace = false;
let workspaceRevision = 0;

async function chooseWorkspace() {
  const options = { timeout: 300000, windowsHide: true };
  if (isWindows) {
    const code = [
      '$ErrorActionPreference = "Stop"',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.TopMost = $true',
      '$owner.ShowInTaskbar = $false',
      '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
      '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
      '$owner.Size = New-Object System.Drawing.Size(1, 1)',
      '$owner.Opacity = 0',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = '请选择包含 cybercafe-* 子项目的目录'",
      '$dialog.ShowNewFolderButton = $false',
      // windowsHide can hide the process's first ShowWindow call. Consume that
      // on an invisible owner, then show it again before opening its modal dialog.
      // A real topmost owner also keeps the picker above the desktop panel.
      'try {',
      '  $owner.Show(); $owner.Hide(); $owner.Show(); $owner.Activate()',
      '  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }',
      '}',
      'finally { $dialog.Dispose(); $owner.Dispose() }',
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

async function readWorkspacePath(request) {
  if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
    return null;
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16384) return { directory: '' };
  }
  const params = new URLSearchParams(body);
  const value = params.get('directory')?.trim() || '';
  return { directory: value.replace(/^"(.*)"$/, '$1').trim(), confirmed: params.get('confirmed') === '1', previousWorkspace: params.get('previousWorkspace') || '' };
}

async function resolveWorkspacePath(selected) {
  const directory = await realpath(resolve(selected));
  const candidates = [
    join(directory, 'cloudgame-cybercafe', 'cybercafe-front'),
    join(directory, 'cybercafe-front'),
    directory,
  ];
  const candidate = candidates.find(candidate => existsSync(candidate) && listProjects(candidate).length);
  return candidate ? realpath(candidate) : undefined;
}

async function selectWorkspace(request, response) {
  if (!authorized(request)) {
    json(response, 403, { message: '请从本机 Whistle 面板保存。' });
    return;
  }
  if (savingWorkspace) {
    json(response, 409, { message: '正在保存，请稍后重试。' });
    return;
  }

  // Neither platform holds the save lock while its native picker is open.
  // A later explicit path must take precedence over an older picker result.
  const revision = workspaceRevision;
  let locked = false;
  let switching = false;

  const temporary = `${workspaceFile}.${process.pid}.tmp`;
  try {
    const entered = await readWorkspacePath(request);
    const selected = entered?.directory ?? await chooseWorkspace();
    if (!selected && entered === null) {
      json(response, 200, { cancelled: true });
      return;
    }
    if (!isAbsolute(selected) || /[\x00-\x1f]/.test(selected)) {
      json(response, 400, { message: '所选目录的路径无效。' });
      return;
    }
    const directory = await resolveWorkspacePath(selected);
    if (!directory) {
      json(response, 400, { message: '请选择包含 cybercafe-* 子项目的目录。' });
      return;
    }
    // 等待系统选择框期间，用户可能已经通过路径输入保存了工作区；
    // 这种情况下不要再用旧的选择框结果覆盖。
    if (revision !== workspaceRevision) {
      json(response, 200, { workspace: readWorkspace(), superseded: true });
      return;
    }
    if (savingWorkspace) {
      json(response, 409, { message: '正在保存，请稍后重试。' });
      return;
    }
    const previous = readWorkspace();
    const changed = previous !== directory;
    if (changed && previous && (!entered?.confirmed || entered.previousWorkspace !== previous)) {
      return json(response, 409, {
        action: 'confirm-switch', workspace: directory, previousWorkspace: previous,
        message: '切换将停止原目录中由本工具启动的所有服务并关闭对应终端，原目录将不再被监听或代理。',
      });
    }
    let previousProjects = [];
    let running = [];
    let stoppedServices = [];
    if (changed) {
      beginWorkspaceChange();
      switching = true;
      try {
        previousProjects = listProjects();
        const state = readState();
        running = [...new Set([...Object.keys(state?.projects || {}), ...Object.keys(state?.unmatched || {})])];
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
    savingWorkspace = true;
    locked = true;
    await mkdir(stateDir, { recursive: true });
    await writeFile(temporary, directory + '\n', { mode: 0o600 });
    if (changed && previous) stoppedServices = await stopWorkspaceServices(previous);
    await rename(temporary, workspaceFile);
    workspaceRevision += 1;
    let historyWarning = '';
    try {
      if (changed && previous) rememberWorkspace(previous);
      rememberWorkspace(directory);
    } catch { historyWarning = '最近使用记录未能保存。'; }
    const synced = await refreshWorkspace(changed ? previousProjects : null);
    json(response, 200, {
      workspace: directory, previousWorkspace: previous, previousRunning: running.filter(project => !stoppedServices.includes(project)).map(project => `cybercafe-${project}`), stoppedServices,
      message: changed
        ? `已切换工作目录。原目录由工具管理的服务和终端已停止，运行日志已保留；外部手动启动的服务请自行管理。${synced ? '代理仅接管当前工作区，未启动的项目访问测试部署。请刷新测试页面。' : '代理规则尚未更新，可能仍指向原工作区；请在体检中检查并同步。'}`
        : synced ? '已保存当前工作目录并同步规则。' : '已保存当前工作目录，但代理规则未同步成功，请在体检中检查。',
      historyWarning,
    });
  } catch (error) {
    const message = error.code === 'ENOENT' || error.code === 'ENOTDIR'
      ? '目录不存在，或所选路径不是文件夹。'
      : `无法选择或保存工作区：${error.message}`;
    json(response, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 400 : error.code === 'WORKSPACE_BUSY' ? 409 : 500, { message });
  } finally {
    if (switching) endWorkspaceChange();
    if (locked) {
      await rm(temporary, { force: true }).catch(() => {});
      savingWorkspace = false;
    }
  }
  return;
}
module.exports = { selectWorkspace };

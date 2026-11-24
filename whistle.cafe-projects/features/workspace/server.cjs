const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, realpath, rename, rm, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { isAbsolute, join, resolve } = require('node:path');
const { workspaceFile, readWorkspace, stateDir } = require('./store.cjs');
const { isWindows, POWERSHELL } = require('../../shared/config/config.cjs');
const { authorized, json } = require('../../shared/http/http.cjs');
const { listProjects } = require('../projects/store.cjs');
const { refreshWorkspace } = require('../projects/server.cjs');
const run = promisify(execFile);

let savingWorkspace = false;
let workspaceRevision = 0;

async function chooseWorkspace() {
  const options = { timeout: 300000, windowsHide: true };
  if (isWindows) {
    const code = [
      '$ErrorActionPreference = "Stop"',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '$shell = New-Object -ComObject Shell.Application',
      "$folder = $shell.BrowseForFolder(0, '请选择包含 cybercafe-* 子项目的目录', 1)",
      'if ($folder) { $folder.Self.Path }',
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
    if (body.length > 16384) return '';
  }
  const value = new URLSearchParams(body).get('directory')?.trim() || '';
  return value.replace(/^"(.*)"$/, '$1').trim();
}

async function resolveWorkspacePath(selected) {
  const directory = await realpath(resolve(selected));
  const candidates = [
    join(directory, 'cloudgame-cybercafe', 'cybercafe-front'),
    join(directory, 'cybercafe-front'),
    directory,
  ];
  return candidates.find(candidate => existsSync(candidate) && listProjects(candidate).length);
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

  // Windows 上系统选择框是独立进程，不能让它长时间占着保存锁，
  // 否则用户在面板里输入路径也会被 409 挡住。macOS 保持原来的锁行为。
  const deferLock = isWindows;
  const revision = workspaceRevision;
  let locked = false;
  if (!deferLock) {
    savingWorkspace = true;
    locked = true;
  }

  const temporary = `${workspaceFile}.${process.pid}.tmp`;
  try {
    const entered = await readWorkspacePath(request);
    const selected = entered ?? await chooseWorkspace();
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
    if (deferLock) {
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
      savingWorkspace = true;
      locked = true;
    }
    await mkdir(stateDir, { recursive: true });
    await writeFile(temporary, directory + '\n', { mode: 0o600 });
    await rename(temporary, workspaceFile);
    workspaceRevision += 1;
    refreshWorkspace();
    json(response, 200, { workspace: readWorkspace() });
  } catch (error) {
    const message = error.code === 'ENOENT' || error.code === 'ENOTDIR'
      ? '目录不存在，或所选路径不是文件夹。'
      : `无法选择或保存工作区：${error.message}`;
    json(response, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 400 : 500, { message });
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    if (locked) savingWorkspace = false;
  }
  return;
}
module.exports = { selectWorkspace };

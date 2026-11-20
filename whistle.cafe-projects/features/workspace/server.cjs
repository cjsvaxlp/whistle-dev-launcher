const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, rename, rm, writeFile } = require('node:fs/promises');
const { isAbsolute, resolve } = require('node:path');
const { workspaceFile, readWorkspace, stateDir } = require('./store.cjs');
const { isWindows, POWERSHELL } = require('../../shared/config/config.cjs');
const { authorized, json } = require('../../shared/http/http.cjs');
const { listProjects } = require('../projects/store.cjs');
const { refreshWorkspace } = require('../projects/server.cjs');
const run = promisify(execFile);

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

async function selectWorkspace(request, response) {
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
}

module.exports = { selectWorkspace };

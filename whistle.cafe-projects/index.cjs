const { execFile, execFileSync, spawn } = require('node:child_process');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { mkdir, mkdtemp, writeFile, rename, rm } = require('node:fs/promises');
const { homedir, tmpdir } = require('node:os');
const { dirname, isAbsolute, join, resolve } = require('node:path');
const { promisify } = require('node:util');

const { stateDir, workspaceFile, readWorkspace, workspaceId } = require('./workspace.cjs');

const run = promisify(execFile);
const isWindows = process.platform === 'win32';
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe');
let workspace = readWorkspace();
const tools = process.env.CAFE_TOOLS_DIR || join(__dirname, '..');
const stateFile = join(stateDir, 'state.json');
const origin = 'http://127.0.0.1:8899';
const entryUrl = 'https://cloudgametest2.migufun.com:18443/cybercafe-power/#/amsportal';
const ruleName = 'Cafe 自动代理';
const STALE_AFTER = 15000;
const startedAt = Date.now();
const syncStatus = { lastSuccessAt: null, error: null };
const token = randomBytes(32).toString('hex');
const html = readFileSync(join(__dirname, 'panel.html'), 'utf8');
const script = readFileSync(join(__dirname, 'panel.mjs'), 'utf8');

function listProjects(directory = workspace) {
  if (!directory) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^cybercafe-[a-z0-9-]+$/.test(entry.name)
      && existsSync(join(directory, entry.name, 'package.json')))
    .map(entry => entry.name.slice('cybercafe-'.length))
    .sort();
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function snapshot() {
  const savedState = readState();
  const state = workspace && savedState && (savedState.workspaceId === workspaceId(workspace)
    || (!savedState.workspaceId && !existsSync(workspaceFile))) ? savedState : null;
  const updatedAt = state && state.updatedAt;
  const age = updatedAt ? Date.now() - Date.parse(updatedAt) : Infinity;
  const projects = listProjects().map(name => {
    const local = state && state.projects && state.projects[name];
    const unmatched = state && state.unmatched && state.unmatched[name];
    return {
      name,
      url: 'https://cloudgametest2.migufun.com:18443/cybercafe-' + name + '/',
      active: Boolean(local),
      port: local ? local.port : null,
      engine: local ? local.engine : null,
      since: local ? local.since : null,
      unmatched: !local && unmatched ? { port: unmatched.port } : null,
    };
  });
  return {
    workspace,
    startedAt,
    sync: syncStatus,
    updatedAt: updatedAt || null,
    stale: !(age <= STALE_AFTER),
    rule: ruleName,
    entryUrl,
    projects,
  };
}

function psLiteral(value) {
  return '\'' + value.replaceAll('\'', '\'\'') + '\'';
}

function cliFor(directory, vite) {
  const name = vite ? 'vite' : 'webpack';
  const bin = vite ? 'vite.js' : 'webpack.js';
  try {
    const pkg = require.resolve(name + '/package.json', { paths: [directory] });
    return join(dirname(pkg), 'bin', bin);
  } catch {
    return join(directory, 'node_modules', name, 'bin', bin);
  }
}

function powershellEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

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
      '-NoProfile', '-STA', '-EncodedCommand', powershellEncoded(code),
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

async function openWindowsTerminal(project) {
  const directory = join(workspace, 'cybercafe-' + project);
  const vite = ['vite.config.js', 'vite.config.ts'].some(file => existsSync(join(directory, file)));
  const cli = cliFor(directory, vite);
  if (!existsSync(cli)) {
    throw new Error('项目缺少开发依赖。请先在该项目目录安装依赖。');
  }
  const mode = ['.env.test', 'env/.env.test'].some(file => existsSync(join(directory, file)))
    ? 'test'
    : 'development';
  const prefix = '/cybercafe-' + project + '/';
  const host = 'cloudgametest2.migufun.com';
  const args = vite
    ? ['--mode', mode, '--host', '127.0.0.1', '--base', prefix]
    : [
        'serve', '--config', 'build/webpack.dev.conf.js', '--host', '127.0.0.1', '--no-open',
        '--allowed-hosts', host,
        '--client-web-socket-url', 'wss://' + host + ':18443' + prefix + '__hmr',
      ];
  const script = [
    '$ErrorActionPreference = \'Stop\'',
    'Set-Location -LiteralPath ' + psLiteral(directory),
    '$env:NODE_ENV = \'development\'',
    '$env:HOST = \'127.0.0.1\'',
    '$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = ' + psLiteral(host),
    '& ' + [process.execPath, cli, ...args].map(psLiteral).join(' '),
  ].join('\n');
  const open = '$ErrorActionPreference = \'Stop\'; Start-Process -FilePath ' + psLiteral(POWERSHELL)
    + ' -ArgumentList \'-NoProfile\',\'-NoExit\',\'-EncodedCommand\',\'' + powershellEncoded(script) + '\'';
  await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(open)], {
    windowsHide: true,
    timeout: 10000,
  });
}

async function openTerminal(project) {
  if (isWindows) return openWindowsTerminal(project);
  const projectDir = join(workspace, 'cybercafe-' + project);
  const vite = ['vite.config.js', 'vite.config.ts'].some(file => existsSync(join(projectDir, file)));
  if (!existsSync(join(projectDir, 'node_modules/.bin', vite ? 'vite' : 'webpack'))) {
    throw new Error('项目缺少开发依赖。请先在该项目目录安装依赖。');
  }
  const folder = await mkdtemp(join(tmpdir(), 'cafe-terminal-'));
  const launcher = join(folder, '启动 ' + project + '.command');
  const quote = value => '\'' + value.replaceAll('\'', '\'\\\'\'') + '\'';
  const args = [join(tools, '启动任意项目.command'), project].map(quote).join(' ');
  try {
    await writeFile(launcher, '#!/bin/zsh\nrm -f -- "$0"\nrmdir -- "${0:h}"\nexec /usr/bin/env ' + quote('CAFE_STATE_DIR=' + stateDir) + ' ' + quote('CAFE_WORKSPACE=' + workspace) + ' /bin/zsh ' + args + '\n', { mode: 0o700 });
    await run('/usr/bin/open', ['-a', 'Terminal', launcher], { timeout: 10000 });
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

function json(response, code, value) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function sameMachine(originValue) {
  if (!originValue) return true;
  try {
    const host = new URL(originValue).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
      || host === '[::1]' || host === 'local.whistlejs.com';
  } catch {
    return false;
  }
}

function authorized(request) {
  const presented = request.headers['x-cafe-token'];
  return typeof presented === 'string'
    && presented.length === token.length
    && timingSafeEqual(Buffer.from(token), Buffer.from(presented, 'latin1'))
    && sameMachine(request.headers.origin);
}

const syncScript = join(__dirname, 'sync.mjs');

let syncTimer;
let syncing = false;
let savingWorkspace = false;

async function synchronize() {
  syncing = true;
  const currentWorkspace = workspace;
  try {
    await run(process.execPath, [syncScript], { windowsHide: true, timeout: 60000 });
    if (workspace !== currentWorkspace) return;
    syncStatus.lastSuccessAt = new Date().toISOString();
    syncStatus.error = null;
  } catch (error) {
    if (workspace !== currentWorkspace) return;
    syncStatus.error = error.killed
      ? '同步超过 60 秒。'
      : (error.stderr?.trim() || error.message).slice(0, 500);
  } finally {
    syncing = false;
    syncTimer = setTimeout(synchronize, workspace === currentWorkspace ? 5000 : 0).unref();
  }
}

if (workspace) syncTimer = setTimeout(synchronize, 2000).unref();

exports.uiServer = server => {
  server.on('request', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const path = new URL(request.url, origin).pathname;
    if (request.method === 'GET' && path === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': 'default-src \'none\'; script-src \'self\'; style-src \'unsafe-inline\'; connect-src \'self\'; frame-ancestors \'self\'',
      });
      response.end(html.replace('CAFE_CSRF', token));
      return;
    }
    if (request.method === 'GET' && path === '/panel.mjs') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end(script);
      return;
    }
    if (request.method === 'POST' && path === '/api/restart') {
      if (!authorized(request)) {
        json(response, 403, { message: '请从本机 Whistle 面板操作。' });
        return;
      }
      let cli = '';
      try {
        const finder = isWindows ? 'where' : 'which';
        cli = execFileSync(finder, ['w2'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
      } catch {
        cli = '';
      }
      if (!cli) {
        json(response, 503, { message: '找不到 w2 命令，请手动重启 Whistle。' });
        return;
      }
      json(response, 200, { message: '正在重启 Whistle…' });
      setTimeout(() => {
        try {
          const child = isWindows
            ? spawn('w2', ['restart'], {
                detached: true, stdio: 'ignore', shell: true, windowsHide: true,
                cwd: homedir(), env: process.env,
              })
            : spawn(cli, ['restart'], {
                detached: true, stdio: 'ignore', cwd: homedir(), env: process.env,
              });
          child.unref();
        } catch {
          // 失败了页面会提示手动重启。
        }
      }, 400);
      return;
    }
    if (request.method === 'GET' && path === '/api/token') {
      // 同源读取，用于 Whistle 重启后旧页面自动换用新令牌。
      json(response, 200, { token });
      return;
    }
    if (request.method === 'GET' && path === '/api/rule') {
      try {
        const upstream = await fetch(
          `${origin}/cgi-bin/rules/value?name=${encodeURIComponent(ruleName)}`,
          { signal: AbortSignal.timeout(3000) },
        );
        const data = await upstream.json();
        json(response, 200, {
          name: ruleName,
          value: data && data.value ? data.value.value : null,
          selected: Boolean(data && data.value && data.value.selected),
        });
      } catch {
        json(response, 503, { message: '无法读取 Whistle 规则。' });
      }
      return;
    }
    if (request.method === 'POST' && path === '/api/workspace') {
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
        workspace = directory;
        syncStatus.lastSuccessAt = null;
        syncStatus.error = null;
        if (!syncing) {
          clearTimeout(syncTimer);
          syncTimer = setTimeout(synchronize, 0).unref();
        }
        json(response, 200, { workspace });
      } catch (error) {
        json(response, 500, { message: `无法选择或保存工作区：${error.message}` });
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
        savingWorkspace = false;
      }
      return;
    }
    if (request.method === 'GET' && path === '/api/projects') {
      try {
        json(response, 200, snapshot());
      } catch {
        json(response, 503, { workspace, startedAt, sync: syncStatus, message: '无法读取项目工作区，请在面板重新选择目录。' });
      }
      return;
    }
    const match = /^\/api\/start\/([a-z0-9-]+)$/.exec(path);
    if (!match) {
      json(response, 404, { message: '接口不存在。' });
      return;
    }
    if (request.method !== 'POST' || !authorized(request)) {
      json(response, 403, { message: '请从本机 Whistle 面板启动。' });
      return;
    }
    try {
      if (!listProjects().includes(match[1])) {
        json(response, 404, { message: '项目不存在。' });
        return;
      }
      await openTerminal(match[1]);
      json(response, 200, { message: '终端已打开；服务就绪后会自动接管，状态将在几秒内更新。' });
    } catch (error) {
      json(response, 503, { message: error.code === 'ENOENT'
        ? '无法读取项目工作区，请在面板重新选择目录。'
        : error.message });
    }
  });
};

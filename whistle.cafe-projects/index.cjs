const { execFile, execFileSync, spawn } = require('node:child_process');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const {
  appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync,
} = require('node:fs');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { homedir, tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);
const isWindows = process.platform === 'win32';
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe');
const workspace = process.env.CAFE_WORKSPACE || join(homedir(), 'Desktop/work/cloudgame-cybercafe/cybercafe-front');
const tools = process.env.CAFE_TOOLS_DIR || join(__dirname, '..');
const stateDir = process.env.CAFE_STATE_DIR
  ? join(process.env.CAFE_STATE_DIR)
  : join(homedir(), '.cache/cafe-tools');
const stateFile = join(stateDir, 'state.json');
const logsDir = join(stateDir, 'logs');
const prefsFile = join(stateDir, 'preferences.json');
const origin = 'http://127.0.0.1:8899';
const entryUrl = 'https://cloudgametest2.migufun.com:18443/cybercafe-power/#/amsportal';
const ruleName = 'Cafe 自动代理';
const STALE_AFTER = 15000;
const token = randomBytes(32).toString('hex');
const html = readFileSync(join(__dirname, 'panel.html'), 'utf8');
const script = readFileSync(join(__dirname, 'panel.mjs'), 'utf8');
const jobs = new Map();

function listProjects() {
  return readdirSync(workspace, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^cybercafe-[a-z0-9-]+$/.test(entry.name)
      && existsSync(join(workspace, entry.name, 'package.json')))
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

function readPrefs() {
  try {
    const data = JSON.parse(readFileSync(prefsFile, 'utf8'));
    return {
      favorites: Array.isArray(data.favorites) ? data.favorites : [],
      recent: data.recent && typeof data.recent === 'object' ? data.recent : {},
    };
  } catch {
    return { favorites: [], recent: {} };
  }
}

function writePrefs(prefs) {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(prefsFile, JSON.stringify(prefs, null, 2) + '\n');
  } catch {
    // 偏好写不进去不影响主流程。
  }
}

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

function depInfo(name) {
  const directory = join(workspace, 'cybercafe-' + name);
  const vite = ['vite.config.js', 'vite.config.ts'].some(file => existsSync(join(directory, file)));
  const lockfile = LOCKFILES.find(file => existsSync(join(directory, file))) || null;
  const manager = lockfile === 'pnpm-lock.yaml' ? 'pnpm' : lockfile === 'yarn.lock' ? 'yarn' : 'npm';
  const packageName = vite ? 'vite' : 'webpack';
  let installed = false;
  try {
    require.resolve(packageName + '/package.json', { paths: [directory] });
    installed = true;
  } catch {
    const bin = join(directory, 'node_modules/.bin', packageName);
    installed = existsSync(bin) || existsSync(bin + '.cmd');
  }
  let lockAt = 0;
  let installedAt = 0;
  try {
    lockAt = lockfile ? statSync(join(directory, lockfile)).mtimeMs : 0;
  } catch {
    lockAt = 0;
  }
  for (const file of ['node_modules/.package-lock.json', 'node_modules/.modules.yaml', 'node_modules']) {
    try {
      installedAt = Math.max(installedAt, statSync(join(directory, file)).mtimeMs);
    } catch {
      // 忽略
    }
  }
  let status = installed ? 'ready' : 'missing';
  if (installed && lockAt && installedAt && lockAt > installedAt + 5000) status = 'stale';
  return {
    status,
    manager,
    lockfile,
    lockAt: lockAt || null,
    installedAt: installedAt || null,
  };
}

function snapshot() {
  const state = readState();
  const prefs = readPrefs();
  const updatedAt = state && state.updatedAt;
  const age = updatedAt ? Date.now() - Date.parse(updatedAt) : Infinity;
  const projects = listProjects().map(name => {
    const local = state && state.projects && state.projects[name];
    const unmatched = state && state.unmatched && state.unmatched[name];
    const job = jobs.get(name);
    return {
      name,
      url: 'https://cloudgametest2.migufun.com:18443/cybercafe-' + name + '/',
      active: Boolean(local),
      port: local ? local.port : null,
      engine: local ? local.engine : null,
      since: local ? local.since : null,
      compat: Boolean(local && local.compat),
      unmatched: !local && unmatched ? { port: unmatched.port } : null,
      deps: depInfo(name),
      installing: Boolean(job && job.status === 'running'),
      favorite: prefs.favorites.includes(name),
      recentAt: prefs.recent[name] || null,
      log: existsSync(join(logsDir, name + '.log')),
    };
  });
  return {
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

function powershellEncoded(value) {
  return Buffer.from(value, 'utf16le').toString('base64');
}

function logPath(project) {
  return join(logsDir, project + '.log');
}

function prepareLog(project) {
  mkdirSync(logsDir, { recursive: true });
  const file = logPath(project);
  try {
    writeFileSync(file, '');
  } catch {
    // 忽略
  }
  return file;
}

async function openWindowsTerminal(project) {
  const directory = join(workspace, 'cybercafe-' + project);
  const vite = ['vite.config.js', 'vite.config.ts'].some(file => existsSync(join(directory, file)));
  const cli = cliFor(directory, vite);
  if (!existsSync(cli)) {
    throw new Error('项目缺少开发依赖。请先安装依赖。');
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
  const file = prepareLog(project);
  const value = [
    '$ErrorActionPreference = \'Stop\'',
    'Set-Location -LiteralPath ' + psLiteral(directory),
    '$env:NODE_ENV = \'development\'',
    '$env:HOST = \'127.0.0.1\'',
    '$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = ' + psLiteral(host),
    'Start-Transcript -Path ' + psLiteral(file) + ' -Force -ErrorAction SilentlyContinue | Out-Null',
    '& ' + [process.execPath, cli, ...args].map(psLiteral).join(' '),
  ].join('\n');
  const open = '$ErrorActionPreference = \'Stop\'; Start-Process -FilePath ' + psLiteral(POWERSHELL)
    + ' -ArgumentList \'-NoProfile\',\'-NoExit\',\'-EncodedCommand\',\'' + powershellEncoded(value) + '\'';
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
    throw new Error('项目缺少开发依赖。请先安装依赖。');
  }
  const file = prepareLog(project);
  const folder = await mkdtemp(join(tmpdir(), 'cafe-terminal-'));
  const launcher = join(folder, '启动 ' + project + '.command');
  const quote = value => '\'' + value.replaceAll('\'', '\'\\\'\'') + '\'';
  const args = [join(tools, '启动任意项目.command'), project].map(quote).join(' ');
  try {
    await writeFile(launcher, [
      '#!/bin/zsh',
      'rm -f -- "$0"',
      'rmdir -- "${0:h}"',
      'export CAFE_LOG_FILE=' + quote(file),
      '/bin/zsh ' + args + ' 2>&1 | tee -a "$CAFE_LOG_FILE"',
      '',
    ].join('\n'), { mode: 0o700 });
    await run('/usr/bin/open', ['-a', 'Terminal', launcher], { timeout: 10000 });
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

function tailLog(file, max = 240) {
  try {
    const text = readFileSync(file, 'utf8');
    return text.length > 400000 ? text.slice(-400000).split('\n').slice(-max) : text.split('\n').slice(-max);
  } catch {
    return [];
  }
}

const DIAGNOSTICS = [
  { re: /EADDRINUSE|address already in use/i, text: '端口被占用', action: '换端口，或先停掉占用该端口的进程' },
  { re: /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve import|Cannot resolve dependency/i, text: '缺少依赖', action: '点「安装依赖」' },
  { re: /Unsupported engine|requires Node|Node\.js .*version|EBADENGINE/i, text: 'Node 版本不匹配', action: '升级或切换 Node 版本' },
  { re: /command not found|ENOENT[^\n]*node|不是内部或外部命令/i, text: '找不到 node/npm', action: '检查 PATH，在终端确认 node -v' },
  { re: /SyntaxError|Transform failed|Pre-transform error|failed to load config/i, text: '代码或配置有语法错误', action: '看日志定位文件' },
];

function diagnose(text) {
  return DIAGNOSTICS.filter(item => item.re.test(text)).map(item => ({ text: item.text, action: item.action }));
}

function startInstall(project) {
  const existing = jobs.get(project);
  if (existing && existing.status === 'running') {
    return { error: '这个项目正在安装依赖。' };
  }
  const directory = join(workspace, 'cybercafe-' + project);
  const info = depInfo(project);
  const args = info.manager === 'npm'
    ? [info.lockfile === 'package-lock.json' ? 'ci' : 'install', '--prefer-offline', '--no-audit', '--no-fund']
    : ['install', '--prefer-offline'];
  const file = prepareLog(project);
  appendFileSync(file, `$ ${info.manager} ${args.join(' ')}\n`);
  // Whistle 可能是从 GUI/launcher 启动的，PATH 里不一定有 node/npm；优先用 node 所在目录。
  const binDir = dirname(process.execPath);
  const command = join(binDir, isWindows ? info.manager + '.cmd' : info.manager);
  const executable = existsSync(command) ? command : info.manager;
  const env = {
    ...process.env,
    PATH: [binDir, process.env.PATH].filter(Boolean).join(isWindows ? ';' : ':'),
  };
  const child = spawn(executable, args, {
    cwd: directory,
    env,
    windowsHide: true,
    shell: isWindows,
  });
  const job = { child, status: 'running', type: 'install', startedAt: Date.now() };
  const append = data => {
    try {
      appendFileSync(file, data);
    } catch {
      // 忽略写日志失败
    }
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', error => {
    job.status = 'failed';
    append(`\n${error.message}\n`);
  });
  child.on('exit', code => {
    job.status = code === 0 ? 'done' : 'failed';
    append(`\n[install exit ${code}]\n`);
    const timer = setTimeout(() => jobs.delete(project), 60000);
    if (timer.unref) timer.unref();
  });
  jobs.set(project, job);
  return { message: `开始安装依赖（${info.manager}）…` };
}

async function doctor() {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    id: 'node', label: 'Node 版本', status: major >= 20 ? 'ok' : 'fail',
    detail: process.versions.node, action: major >= 20 ? '' : '升级到 Node 20+',
  });
  checks.push({
    id: 'workspace', label: '项目工作区', status: existsSync(workspace) ? 'ok' : 'fail',
    detail: workspace, action: existsSync(workspace) ? '' : '设置 CAFE_WORKSPACE',
  });
  checks.push({ id: 'plugin', label: '插件加载', status: 'ok', detail: 'whistle.cafe-projects' });

  const certDir = join(homedir(), '.WhistleAppData', '.whistle', 'certs');
  const certs = existsSync(certDir) ? readdirSync(certDir).filter(name => !name.startsWith('.')) : [];
  checks.push({
    id: 'ca', label: 'Whistle CA', status: certs.length ? 'ok' : 'unknown',
    detail: certs.length ? '证书文件存在，需确认系统/浏览器已信任' : certDir,
    action: certs.length ? '' : '打开 Whistle 的 HTTPS 页面安装并信任 CA',
  });

  let proxy = { status: 'unknown', detail: '当前系统未做检测', action: '' };
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run('scutil', ['--proxy'], { timeout: 2000 });
      const enabled = /HTTPEnable\s*:\s*1/.test(stdout) || /HTTPSEnable\s*:\s*1/.test(stdout);
      const host = (stdout.match(/HTTPProxy\s*:\s*(\S+)/) || [])[1] || '';
      const port = (stdout.match(/HTTPPort\s*:\s*(\d+)/) || [])[1] || '';
      proxy = enabled && port === '8899'
        ? { status: 'ok', detail: `${host || '127.0.0.1'}:${port}`, action: '' }
        : {
            status: enabled ? 'warn' : 'warn',
            detail: enabled ? `HTTP 代理已开：${host}:${port}` : '未检测到系统代理',
            action: '把测试域名代理到 127.0.0.1:8899',
          };
    } catch {
      proxy = { status: 'unknown', detail: '无法读取系统代理设置', action: '' };
    }
  }
  checks.push({ id: 'proxy', label: '系统代理', ...proxy });

  try {
    const response = await fetch(
      `${origin}/cgi-bin/rules/value?name=${encodeURIComponent(ruleName)}`,
      { signal: AbortSignal.timeout(2500) },
    );
    const data = await response.json();
    const selected = Boolean(data && data.value && data.value.selected);
    checks.push({
      id: 'rule', label: 'Whistle 规则', status: selected ? 'ok' : 'warn',
      detail: ruleName + (selected ? '（已启用）' : '（未启用）'),
      action: selected ? '' : '重启 Whistle，或等一次自动同步',
    });
  } catch {
    checks.push({
      id: 'rule', label: 'Whistle 规则', status: 'fail', detail: '读取失败',
      action: '确认 Whistle 在 127.0.0.1:8899 运行',
    });
  }

  const notReady = listProjects().filter(name => depInfo(name).status !== 'ready');
  checks.push({
    id: 'deps', label: '项目依赖', status: notReady.length ? 'warn' : 'ok',
    detail: notReady.length ? `${notReady.length} 个项目未就绪：${notReady.join('、')}` : '全部就绪',
    action: notReady.length ? '用面板里的「安装依赖」处理' : '',
  });

  return { checks, ok: checks.every(check => check.status === 'ok' || check.status === 'unknown') };
}

async function restartInstance(project) {
  const state = readState();
  const entry = (state && state.projects && state.projects[project])
    || (state && state.unmatched && state.unmatched[project]);
  if (!entry || !entry.pid) throw new Error('没有找到这个项目正在运行的进程。');
  try {
    process.kill(entry.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw new Error('结束旧进程失败：' + error.message);
  }
  await new Promise(resolve => setTimeout(resolve, 900));
  await openTerminal(project);
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

function whistleCli() {
  const candidates = [];
  try {
    if (require.main && require.main.filename) {
      candidates.push(join(dirname(require.main.filename), '..', '..', 'bin', 'whistle.js'));
    }
  } catch {
    // 忽略
  }
  candidates.push(join(dirname(process.execPath), '..', 'lib', 'node_modules', 'whistle', 'bin', 'whistle.js'));
  candidates.push(join(dirname(process.execPath), '..', 'lib', 'node_modules', 'w2', 'bin', 'whistle.js'));
  if (isWindows) {
    candidates.push(join(dirname(process.execPath), 'node_modules', 'whistle', 'bin', 'whistle.js'));
  }
  return candidates.find(candidate => existsSync(candidate)) || '';
}

function authorized(request) {
  const presented = request.headers['x-cafe-token'];
  return typeof presented === 'string'
    && presented.length === token.length
    && timingSafeEqual(Buffer.from(token), Buffer.from(presented, 'latin1'))
    && sameMachine(request.headers.origin);
}

// 插件自己按节奏同步规则和状态，用户不需要额外开监听窗口；监听脚本退化为可选的日志窗口。
{
  const syncScript = join(__dirname, 'sync.mjs');
  let syncing = false;
  const kick = () => {
    if (syncing) return;
    syncing = true;
    const child = spawn(process.execPath, [syncScript], {
      windowsHide: true,
      stdio: 'ignore',
      env: process.env,
    });
    const done = () => {
      syncing = false;
    };
    child.on('exit', done);
    child.on('error', done);
    child.unref();
  };
  setTimeout(kick, 2000).unref();
  setInterval(kick, 5000).unref();
}

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
    if (request.method === 'GET' && path === '/api/token') {
      json(response, 200, { token });
      return;
    }
    if (request.method === 'GET' && path === '/api/projects') {
      try {
        json(response, 200, snapshot());
      } catch {
        json(response, 503, { message: '无法读取项目工作区，请检查 CAFE_WORKSPACE。' });
      }
      return;
    }
    if (request.method === 'GET' && path === '/api/doctor') {
      try {
        json(response, 200, await doctor());
      } catch (error) {
        json(response, 503, { message: error.message });
      }
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

    const logMatch = /^\/api\/logs\/([a-z0-9-]+)$/.exec(path);
    if (request.method === 'GET' && logMatch) {
      const project = logMatch[1];
      if (!listProjects().includes(project)) {
        json(response, 404, { message: '项目不存在。' });
        return;
      }
      const lines = tailLog(logPath(project));
      const job = jobs.get(project);
      json(response, 200, {
        project,
        lines,
        diagnostics: diagnose(lines.join('\n')),
        job: job ? { status: job.status, type: job.type, startedAt: job.startedAt } : null,
      });
      return;
    }

    if (request.method === 'POST' && path === '/api/sync') {
      if (!authorized(request)) {
        json(response, 403, { message: '请从本机 Whistle 面板操作。' });
        return;
      }
      const child = spawn(process.execPath, [join(__dirname, 'sync.mjs')], {
        windowsHide: true, stdio: 'ignore', env: process.env,
      });
      child.unref();
      json(response, 200, { message: '已触发一次同步。' });
      return;
    }

    if (request.method === 'POST' && path === '/api/restart') {
      if (!authorized(request)) {
        json(response, 403, { message: '请从本机 Whistle 面板操作。' });
        return;
      }
      const cliPath = whistleCli();
      if (!cliPath) {
        json(response, 503, { message: '找不到 Whistle CLI，请手动执行 w2 restart。' });
        return;
      }
      json(response, 200, { message: '正在重启 Whistle…' });
      setTimeout(() => {
        try {
          mkdirSync(logsDir, { recursive: true });
          const fd = openSync(join(logsDir, 'whistle-restart.log'), 'a');
          const binDir = dirname(process.execPath);
          const child = spawn(process.execPath, [cliPath, 'restart'], {
            detached: true,
            stdio: ['ignore', fd, fd],
            cwd: homedir(),
            env: {
              ...process.env,
              PATH: [binDir, process.env.PATH].filter(Boolean).join(isWindows ? ';' : ':'),
            },
            windowsHide: true,
          });
          child.on('error', () => {});
          child.unref();
        } catch {
          // 失败了页面会提示手动重启。
        }
      }, 400);
      return;
    }

    const actionMatch = /^\/api\/(install|start|takeover|favorite|touch)\/([a-z0-9-]+)$/.exec(path);
    if (actionMatch) {
      if (request.method !== 'POST' || !authorized(request)) {
        json(response, 403, { message: '请从本机 Whistle 面板操作。' });
        return;
      }
      const [, action, project] = actionMatch;
      if (!listProjects().includes(project)) {
        json(response, 404, { message: '项目不存在。' });
        return;
      }
      try {
        if (action === 'install') {
          const state = readState();
          if (state && state.projects && state.projects[project]) {
            json(response, 409, { message: '项目正在运行，先停止本地服务再安装依赖。' });
            return;
          }
          const result = startInstall(project);
          json(response, result.error ? 409 : 200, result.error ? { message: result.error } : result);
          return;
        }
        if (action === 'favorite') {
          const prefs = readPrefs();
          prefs.favorites = prefs.favorites.includes(project)
            ? prefs.favorites.filter(name => name !== project)
            : [...prefs.favorites, project];
          writePrefs(prefs);
          json(response, 200, { favorite: prefs.favorites.includes(project) });
          return;
        }
        if (action === 'touch') {
          const prefs = readPrefs();
          prefs.recent[project] = Date.now();
          writePrefs(prefs);
          json(response, 200, { ok: true });
          return;
        }
        if (action === 'takeover') {
          await restartInstance(project);
          json(response, 200, { message: '已结束旧实例并重新启动。' });
          return;
        }
        // start
        const deps = depInfo(project);
        if (deps.status === 'missing') {
          json(response, 409, { message: '项目缺少开发依赖，请先点「安装依赖」。', action: 'install' });
          return;
        }
        await openTerminal(project);
        const prefs = readPrefs();
        prefs.recent[project] = Date.now();
        writePrefs(prefs);
        json(response, 200, { message: '终端已打开；服务就绪后会自动接管，状态将在几秒内更新。' });
      } catch (error) {
        json(response, 503, { message: error.code === 'ENOENT'
          ? '无法读取项目工作区，请检查 CAFE_WORKSPACE。'
          : error.message });
      }
      return;
    }

    json(response, 404, { message: '接口不存在。' });
  });
};

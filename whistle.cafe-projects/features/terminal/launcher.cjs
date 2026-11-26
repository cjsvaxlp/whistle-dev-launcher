const { execFile, spawn } = require('node:child_process');
const { accessSync, constants, existsSync, statSync } = require('node:fs');
const { once } = require('node:events');
const { dirname, join } = require('node:path');
const { promisify } = require('node:util');
const { pluginDir, readWorkspace, tools, stateDir, isWindows, POWERSHELL } = require('../../shared/config/config.cjs');
const { installPolicy, runtimePath } = require('../runtime/runtime.cjs');
const run = promisify(execFile);
const launched = new Map();

function hasDevDependency(directory, vite) {
  if (isWindows) return existsSync(cliFor(directory, vite));
  try {
    accessSync(join(directory, 'node_modules/.bin', vite ? 'vite' : 'webpack'), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function depInfo(name) {
  const directory = join(readWorkspace(), 'cybercafe-' + name);
  const vite = ['vite.config.js', 'vite.config.ts'].some(file => existsSync(join(directory, file)));
  let policy;
  try {
    policy = installPolicy(directory);
  } catch {
    // Install requests report manifest errors for the selected project.
  }
  const { lockfile = null, manager = 'npm' } = policy || {};
  const installed = hasDevDependency(directory, vite);
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

function windowsCommand(command, args) {
  const script = "$ErrorActionPreference = 'Stop'\n& "
    + [command, ...args].map(psLiteral).join(' ') + '\nexit $LASTEXITCODE';
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(script)];
}

async function openWindowsTerminal(project, file, launchId, runtime) {
  const directory = join(readWorkspace(), 'cybercafe-' + project);
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
  await launchLogged(file, runtime.node, [cli, ...args], {
    cwd: directory,
    env: {
      ...process.env,
      PATH: runtimePath(runtime),
      NODE_ENV: 'development',
      CAFE_WORKSPACE: readWorkspace(),
      CAFE_STATE_DIR: stateDir,
      CAFE_LAUNCH_ID: launchId,
      HOST: '127.0.0.1',
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: host,
    },
  });
}

async function openTerminal(project, file, launchId, runtime) {
  if (isWindows) return openWindowsTerminal(project, file, launchId, runtime);
  const workspace = readWorkspace();
  const projectDir = join(workspace, 'cybercafe-' + project);
  const vite = ['vite.config.js', 'vite.config.ts'].some(name => existsSync(join(projectDir, name)));
  if (!hasDevDependency(projectDir, vite)) {
    throw new Error('项目缺少开发依赖。请先安装依赖。');
  }

  await launchLogged(file, '/bin/zsh', [join(tools, 'scripts/commands/启动任意项目.command'), project], {
    cwd: projectDir,
    env: {
      ...process.env,
      PATH: runtimePath(runtime),
      CAFE_WORKSPACE: workspace,
      CAFE_STATE_DIR: stateDir,
      CAFE_LAUNCH_ID: launchId,
      CAFE_NODE_BIN: runtime.node,
    },
  });
}

async function launchLogged(file, command, args, options) {
  const child = spawn(process.execPath, [
    join(pluginDir, 'features/logs/run-log.cjs'), file, command, ...args,
  ], {
    ...options,
    detached: !isWindows,
    windowsHide: true,
    stdio: 'ignore',
  });
  await once(child, 'spawn');
  launched.set(child.pid, child);
  child.once('close', () => launched.delete(child.pid));
  child.unref();
}

async function stopLaunchedServices() {
  for (const pid of launched.keys()) {
    try {
      if (isWindows) {
        await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
      } else {
        process.kill(-pid, 'SIGTERM');
      }
    } catch (error) {
      if (error.code !== 'ESRCH' && launched.has(pid)) throw error;
    }
  }
}

module.exports = { depInfo, cliFor, windowsCommand, openTerminal, stopLaunchedServices };

const { execFile } = require('node:child_process');
const { accessSync, constants, existsSync, statSync } = require('node:fs');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { promisify } = require('node:util');
const { pluginDir, workspace, tools, stateDir, isWindows, POWERSHELL } = require('./config.cjs');
const { installPolicy, runtimePath } = require('./runtime.cjs');
const run = promisify(execFile);

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
  const directory = join(workspace, 'cybercafe-' + name);
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
  const value = [
    '$ErrorActionPreference = \'Stop\'',
    'Set-Location -LiteralPath ' + psLiteral(directory),
    '$env:NODE_ENV = \'development\'',
    '$env:CAFE_LAUNCH_ID = ' + psLiteral(launchId),
    '$env:PATH = ' + psLiteral(runtimePath(runtime)),
    '$env:HOST = \'127.0.0.1\'',
    '$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = ' + psLiteral(host),
    '& ' + [process.execPath, join(pluginDir, 'run-log.cjs'), file, runtime.node, cli, ...args]
      .map(psLiteral).join(' '),
  ].join('\n');
  const open = '$ErrorActionPreference = \'Stop\'; Start-Process -FilePath ' + psLiteral(POWERSHELL)
    + ' -ArgumentList \'-NoProfile\',\'-NoExit\',\'-EncodedCommand\',\'' + powershellEncoded(value) + '\'';
  await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(open)], {
    windowsHide: true,
    timeout: 10000,
  });
}

async function openTerminal(project, file, launchId, runtime) {
  if (isWindows) return openWindowsTerminal(project, file, launchId, runtime);
  const projectDir = join(workspace, 'cybercafe-' + project);
  const vite = ['vite.config.js', 'vite.config.ts'].some(file => existsSync(join(projectDir, file)));
  if (!hasDevDependency(projectDir, vite)) {
    throw new Error('项目缺少开发依赖。请先安装依赖。');
  }
  const folder = await mkdtemp(join(tmpdir(), 'cafe-terminal-'));
  const launcher = join(folder, '启动 ' + project + '.command');
  const quote = value => '\'' + value.replaceAll('\'', '\'\\\'\'') + '\'';
  const command = [process.execPath, join(pluginDir, 'run-log.cjs'), file,
    '/bin/zsh', join(tools, '启动任意项目.command'), project].map(quote).join(' ');
  try {
    await writeFile(launcher, [
      '#!/bin/zsh',
      'rm -f -- "$0"',
      'rmdir -- "${0:h}"',
      'export CAFE_WORKSPACE=' + quote(workspace),
      'export CAFE_STATE_DIR=' + quote(stateDir),
      'export CAFE_LAUNCH_ID=' + quote(launchId),
      'export CAFE_NODE_BIN=' + quote(runtime.node),
      command,
      '',
    ].join('\n'), { mode: 0o700 });
    await run('/usr/bin/open', ['-a', 'Terminal', launcher], { timeout: 10000 });
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { depInfo, cliFor, windowsCommand, openTerminal };

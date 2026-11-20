const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync, realpathSync } = require('node:fs');
const { createRequire } = require('node:module');
const { homedir } = require('node:os');
const { delimiter, dirname, join } = require('node:path');
const { isWindows, readWorkspace } = require('../../shared/config/config.cjs');

const LOCKFILES = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' };
const nodeName = isWindows ? 'node.exe' : 'node';

function readOptional(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return '';
  }
}

function projectManifest(directory) {
  return JSON.parse(readOptional(join(directory, 'package.json')) || '{}');
}

function pinAt(directory, manifest) {
  return readOptional(join(directory, '.nvmrc')).trim()
    || readOptional(join(directory, '.node-version')).trim()
    || manifest.volta?.node
    || '';
}

function loadSemver() {
  try {
    return require('semver');
  } catch {
    // Standard Node installations bundle semver with npm.
    const bin = dirname(process.execPath);
    const npm = isWindows ? join(bin, 'node_modules', 'npm', 'package.json') : realpathSync(join(bin, 'npm'));
    return createRequire(npm)('semver');
  }
}

function versionDirectories() {
  const nvm = isWindows
    ? process.env.NVM_HOME
    : join(process.env.NVM_DIR || join(homedir(), '.nvm'), 'versions', 'node');
  if (!nvm) return [];
  try {
    return readdirSync(nvm, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name))
      .map(entry => isWindows ? join(nvm, entry.name) : join(nvm, entry.name, 'bin'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
}

function nodeRuntime(directory) {
  const manifest = projectManifest(directory);
  const workspace = readWorkspace();
  const pin = pinAt(directory, manifest) || (workspace && pinAt(workspace, projectManifest(workspace)));
  const engine = manifest.engines?.node;
  const ranges = [pin, engine].filter(Boolean);
  const semver = ranges.length ? loadSemver() : null;
  for (const range of ranges) {
    if (!semver.validRange(range)) throw new Error('无法识别项目的 Node 版本声明：' + range);
  }
  const matches = version => ranges.every(range => semver.satisfies(version, range));
  const current = { node: process.execPath, version: process.version };
  if (matches(current.version)) return current;

  const bins = [...(process.env.PATH || '').split(delimiter).filter(Boolean), ...versionDirectories()];
  const candidates = new Set(bins.map(bin => join(bin, nodeName)));
  const compatible = [];
  for (const node of candidates) {
    if (node === current.node || !existsSync(node)) continue;
    try {
      const version = execFileSync(node, ['--version'], { encoding: 'utf8', timeout: 1500, windowsHide: true }).trim();
      if (matches(version)) compatible.push({ node, version });
    } catch {
      // Another Node installation may still be usable.
    }
  }
  compatible.sort((a, b) => semver.rcompare(a.version, b.version));
  if (compatible.length) return compatible[0];
  throw new Error('找不到满足 ' + ranges.join(' 且 ') + ' 的本机 Node，当前为 ' + current.version + '。');
}

function runtimePath(runtime) {
  return [dirname(runtime.node), process.env.PATH].filter(Boolean).join(delimiter);
}

function installPolicy(directory) {
  const managerField = projectManifest(directory).packageManager;
  const declared = typeof managerField === 'string' && /^(npm|pnpm|yarn)@(\d+)\./.exec(managerField);
  if (managerField && !declared) throw new Error('暂不支持项目声明的包管理器：' + managerField);
  const existing = Object.keys(LOCKFILES).filter(manager => existsSync(join(directory, LOCKFILES[manager])));
  const manager = declared && (!existing.length || existing.includes(declared[1])) ? declared[1] : existing[0] || 'npm';
  const lockfile = existing.includes(manager) ? LOCKFILES[manager] : null;
  const mismatch = declared && declared[1] !== manager;
  return {
    manager,
    lockfile,
    pin: declared && !mismatch ? managerField : '',
    major: declared && !mismatch ? Number(declared[2]) : null,
    notice: mismatch ? '项目声明 ' + managerField.split('+')[0] + '，缺少对应锁文件，按现有 ' + lockfile + ' 安装。' : '',
  };
}

function installInvocation(runtime, policy) {
  const { manager, lockfile, pin, major } = policy;
  const bin = dirname(runtime.node);
  const commandPath = name => join(bin, isWindows ? name + '.cmd' : name);
  let command = commandPath(manager);
  let args;
  if (manager === 'npm') {
    args = [lockfile ? 'ci' : 'install', '--prefer-offline', '--no-audit', '--no-fund'];
  } else if (manager === 'pnpm') {
    args = ['install', '--prefer-offline', ...(lockfile ? ['--frozen-lockfile'] : [])];
  } else {
    args = ['install', ...(lockfile && major === 1 ? ['--frozen-lockfile'] : lockfile && major ? ['--immutable'] : [])];
  }
  const corepack = commandPath('corepack');
  if (pin || (!existsSync(command) && manager !== 'npm')) {
    if (!existsSync(corepack)) throw new Error('所选 Node ' + runtime.version + ' 缺少 Corepack，无法运行 ' + (pin || manager) + '。');
    command = corepack;
    args.unshift(manager);
  }
  if (!existsSync(command)) throw new Error('所选 Node ' + runtime.version + ' 缺少 ' + manager + '。');
  return { command, args };
}

module.exports = { nodeRuntime, runtimePath, installPolicy, installInvocation };

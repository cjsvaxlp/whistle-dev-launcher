const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, resolve } = require('node:path');
const { findWorkspace } = require('./discover.cjs');

const tools = process.env.CAFE_TOOLS_DIR || join(__dirname, '../../..');
const defaultStateDir = existsSync(join(tools, '.installed'))
  ? process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Cybercafe', 'data')
    : join(homedir(), 'Library', 'Application Support', 'Cybercafe')
  : join(tools, '.cafe-tools');
const stateDir = resolve(process.env.CAFE_STATE_DIR || defaultStateDir);
const workspaceFile = join(stateDir, 'workspace');
const proxyDisabledFile = join(stateDir, 'proxy-disabled');
let discoveryTried = false;
let discoveredWorkspace = '';

function isLocalProxyEnabled() {
  return !existsSync(proxyDisabledFile);
}

function readWorkspace() {
  const files = [workspaceFile];
  if (!process.env.CAFE_STATE_DIR) files.push(join(homedir(), '.cache/cafe-tools/workspace'));
  for (const file of files) {
    try {
      const saved = readFileSync(file, 'utf8').trim();
      if (saved) return saved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const configured = process.env.CAFE_WORKSPACE ? resolve(process.env.CAFE_WORKSPACE) : '';
  if (configured) return configured;
  // Windows 首次启动没有保存过工作区时，按常见仓库位置自动找一次；
  // macOS 保持原来的读取逻辑不变。
  if (process.platform === 'win32') {
    if (!discoveryTried) {
      discoveryTried = true;
      try {
        const found = findWorkspace();
        if (found) {
          discoveredWorkspace = found;
          mkdirSync(stateDir, { recursive: true });
          writeFileSync(workspaceFile, found + '\n', { mode: 0o600 });
        }
      } catch {
        // 自动发现失败不阻塞手动选择。
      }
    }
    if (discoveredWorkspace) return discoveredWorkspace;
  }
  return '';
}

function workspaceId(directory) {
  return createHash('sha256').update(directory).digest('hex');
}

module.exports = { stateDir, workspaceFile, readWorkspace, workspaceId, proxyDisabledFile, isLocalProxyEnabled };

const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, resolve } = require('node:path');

const tools = process.env.CAFE_TOOLS_DIR || join(__dirname, '..');
const defaultStateDir = existsSync(join(tools, '.installed'))
  ? process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Cybercafe', 'data')
    : join(homedir(), 'Library', 'Application Support', 'Cybercafe')
  : join(tools, '.cafe-tools');
const stateDir = resolve(process.env.CAFE_STATE_DIR || defaultStateDir);
const workspaceFile = join(stateDir, 'workspace');

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
  return process.env.CAFE_WORKSPACE ? resolve(process.env.CAFE_WORKSPACE) : '';
}

function workspaceId(directory) {
  return createHash('sha256').update(directory).digest('hex');
}

module.exports = { stateDir, workspaceFile, readWorkspace, workspaceId };

const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { stateDir, readWorkspace } = require('./store.cjs');
const run = promisify(execFile);
const file = join(stateDir, 'workspaces.json');

function readHistory() {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data.filter(item => item && typeof item.directory === 'string')
      .slice(0, 20).map(item => ({ directory: item.directory, lastUsedAt: item.lastUsedAt || null })) : [];
  } catch { return []; }
}
function rememberWorkspace(directory) {
  const history = readHistory();
  const item = { directory, lastUsedAt: new Date().toISOString() };
  mkdirSync(stateDir, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify([item, ...history.filter(row => row.directory !== directory)].slice(0, 20), null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}

// Only inspect the explicitly selected checkout. Missing Git is a display limitation, not a startup failure.
let branchCache;
let branchRequest;
async function currentBranch(directory) {
  if (!directory) return null;
  if (branchCache?.directory === directory && Date.now() - branchCache.at < 5000) return branchCache.branch;
  if (branchRequest?.directory === directory) return branchRequest.promise;
  const promise = (async () => {
    let branch = null;
    try {
      try {
        const { stdout } = await run('git', ['-C', directory, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 2000, windowsHide: true });
        branch = stdout.trim();
      } catch {
        const { stdout } = await run('git', ['-C', directory, 'rev-parse', '--short', 'HEAD'], { timeout: 2000, windowsHide: true });
        branch = `分离 HEAD · ${stdout.trim()}`;
      }
    } catch { /* Non-Git directories remain usable. */ }
    branchCache = { directory, branch, at: Date.now() };
    return branch;
  })();
  const pending = { directory, promise };
  branchRequest = pending;
  try { return await promise; } finally { if (branchRequest === pending) branchRequest = null; }
}
async function workspaceOverview() {
  const current = readWorkspace();
  const history = readHistory();
  if (current && !history.some(item => item.directory === current)) history.unshift({ directory: current, lastUsedAt: null });
  return {
    current,
    branch: await currentBranch(current),
    workspaces: history.map(item => ({ ...item, label: basename(item.directory), available: existsSync(item.directory) })),
  };
}
module.exports = { readHistory, rememberWorkspace, workspaceOverview };

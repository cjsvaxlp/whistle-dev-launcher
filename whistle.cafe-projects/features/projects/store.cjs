const { workspaceFile, workspaceId } = require('../workspace/store.cjs');
const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { readWorkspace, stateDir, stateFile, prefsFile } = require('../../shared/config/config.cjs');

function listProjects(directory = readWorkspace()) {
  if (!directory) return [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch (error) {
    // Only a failure to read the workspace itself means the saved path is gone.
    // Missing dependencies/logs and permission errors must keep their own cause.
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') error.workspaceUnavailable = true;
    throw error;
  }
  return entries
    .filter(entry => entry.isDirectory() && /^cybercafe-[a-z0-9-]+$/.test(entry.name)
      && existsSync(join(directory, entry.name, 'package.json')))
    .map(entry => entry.name.slice('cybercafe-'.length))
    .sort();
}

function readState() {
  try {
    const workspace = readWorkspace();
    if (!workspace) return null;
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    return state && (state.workspaceId === workspaceId(workspace)
      || (!state.workspaceId && !existsSync(workspaceFile))) ? state : null;
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

function stateEntry(project) {
  const state = readState();
  return (state && state.projects && state.projects[project])
    || (state && state.unmatched && state.unmatched[project])
    || null;
}

module.exports = { listProjects, readState, readPrefs, writePrefs, stateEntry };

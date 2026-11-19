const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { workspace, stateDir, stateFile, prefsFile } = require('./config.cjs');

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

function stateEntry(project) {
  const state = readState();
  return (state && state.projects && state.projects[project])
    || (state && state.unmatched && state.unmatched[project])
    || null;
}

module.exports = { listProjects, readState, readPrefs, writePrefs, stateEntry };

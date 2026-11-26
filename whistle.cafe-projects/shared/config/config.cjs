const { readWorkspace, stateDir } = require('../../features/workspace/store.cjs');
const { join } = require('node:path');
const loginTargets = require('./login-targets.js');
const pluginDir = join(__dirname, '../..');

const isWindows = process.platform === 'win32';
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe');
const tools = process.env.CAFE_TOOLS_DIR || join(pluginDir, '..');
const stateFile = join(stateDir, 'state.json');
const logsDir = join(stateDir, 'logs');
const prefsFile = join(stateDir, 'preferences.json');
const origin = 'http://127.0.0.1:8899';
const entryUrl = 'https://cloudgametest2.migufun.com:18443/cybercafe-power/#/amsportal';
const projectEntryRoutes = new Map([
  ['power', '/freeLogin'],
  ['service', '/noPower'],
  ['open', '/noPower'],
  ['newcms', '/noPower'],
  ['client', '/Home'],
  ['web-client', '/Home'],
  ['h5', '/download'],
  ['game', '/gameList/menu'],
  ['cms', '/testLogin'],
  ['cloud', '/login'],
  ['external', '/amsportal'],
  ['hub', '/enterprise/manage'],
  ['store', '/merchant/store/list'],
  ['inter', '/noPower'],
  ['monitor', '/noPower'],
]);

function loginTarget(project) {
  const value = loginTargets[project];
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, entryUrl);
    if (url.origin !== new URL(entryUrl).origin) return null;
    return url;
  } catch { return null; }
}

function projectPageUrl(project, { channelCode } = {}) {
  const target = new URL('/cybercafe-' + project + '/', entryUrl);
  const route = projectEntryRoutes.get(project);
  if (route) target.hash = route;
  if (project === 'game' && channelCode) target.hash += '?' + new URLSearchParams({ channelCode });
  // Preserve the existing login/session-exchange entry, carrying the intended module separately.
  const launch = ['power', 'service', 'open'].includes(project) ? new URL(entryUrl)
    : project === 'newcms' ? new URL('/cybercafe-cms/#/testLogin', entryUrl) : new URL(target);
  const returnTarget = loginTarget(project) || target;
  launch.searchParams.set('__cafe_return', returnTarget.pathname + returnTarget.search + returnTarget.hash);
  // The launch URL can be the shared power portal. Keep the intended project
  // so the browser opener does not reuse an unrelated power tab.
  launch.searchParams.set('__cafe_project', project);
  // Make every open a fresh URL so a reused tab navigates instead of showing a
  // stale page whose old remote chunk may already be gone.
  launch.searchParams.set('__cafe_open', Date.now().toString(36));
  return launch.href;
}

const ruleName = 'Cafe 自动代理';

const testHost = 'cloudgametest2.migufun.com';
const pacFile = join(stateDir, 'cafe.pac');

module.exports = { pluginDir, isWindows, POWERSHELL, readWorkspace, tools, stateDir, stateFile, logsDir, prefsFile, origin, entryUrl, projectPageUrl, loginTargets, loginTarget, ruleName, testHost, pacFile };

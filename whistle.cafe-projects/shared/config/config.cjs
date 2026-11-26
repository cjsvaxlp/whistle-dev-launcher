const { readWorkspace, stateDir } = require('../../features/workspace/store.cjs');
const { join } = require('node:path');
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
  ['store', '/noPower'],
  ['inter', '/noPower'],
  ['monitor', '/noPower'],
]);

function projectPageUrl(project, { channelCode } = {}) {
  const target = new URL('/cybercafe-' + project + '/', entryUrl);
  const route = projectEntryRoutes.get(project);
  if (route) target.hash = route;
  if (project === 'game' && channelCode) target.hash += '?' + new URLSearchParams({ channelCode });
  // Preserve the existing login/session-exchange entry, carrying the intended module separately.
  const launch = ['power', 'service', 'open'].includes(project) ? new URL(entryUrl)
    : project === 'newcms' ? new URL('/cybercafe-cms/#/testLogin', entryUrl) : new URL(target);
  // New CMS is entered from the CMS user menu after login; auto-returning to
  // cybercafe-newcms makes its login page bounce back to the CMS login page.
  if (project !== 'newcms') {
    launch.searchParams.set('__cafe_return', target.pathname + target.search + target.hash);
  }
  return launch.href;
}

const ruleName = 'Cafe 自动代理';

const testHost = 'cloudgametest2.migufun.com';
const pacFile = join(stateDir, 'cafe.pac');

module.exports = { pluginDir, isWindows, POWERSHELL, readWorkspace, tools, stateDir, stateFile, logsDir, prefsFile, origin, entryUrl, projectPageUrl, ruleName, testHost, pacFile };

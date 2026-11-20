const { readWorkspace, stateDir } = require('../workspace.cjs');
const { join } = require('node:path');
const pluginDir = join(__dirname, '..');

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
  ['client', '/Home'],
  ['web-client', '/Home'],
  ['h5', '/download'],
  ['game', '/gameList/menu'],
  ['cms', '/testLogin'],
]);

function projectPageUrl(project) {
  if (project === 'power') return entryUrl;
  // New CMS reads the session established by CMS in the same browser tab.
  const entryProject = project === 'newcms' ? 'cms' : project;
  const url = new URL('/cybercafe-' + entryProject + '/', entryUrl);
  const route = projectEntryRoutes.get(entryProject);
  if (route) url.hash = route;
  return url.href;
}

const ruleName = 'Cafe 自动代理';

const testHost = 'cloudgametest2.migufun.com';
const pacFile = join(stateDir, 'cafe.pac');

module.exports = { pluginDir, isWindows, POWERSHELL, readWorkspace, tools, stateDir, stateFile, logsDir, prefsFile, origin, entryUrl, projectPageUrl, ruleName, testHost, pacFile };

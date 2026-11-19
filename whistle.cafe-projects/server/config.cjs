const { homedir } = require('node:os');
const { join, resolve } = require('node:path');
const pluginDir = join(__dirname, '..');

const isWindows = process.platform === 'win32';
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe');
const workspace = resolve(process.env.CAFE_WORKSPACE || join(homedir(), 'Desktop/work/cloudgame-cybercafe/cybercafe-front'));
const tools = process.env.CAFE_TOOLS_DIR || join(pluginDir, '..');
const stateDir = process.env.CAFE_STATE_DIR
  ? resolve(process.env.CAFE_STATE_DIR)
  : join(tools, '.cafe-tools');
const stateFile = join(stateDir, 'state.json');
const logsDir = join(stateDir, 'logs');
const prefsFile = join(stateDir, 'preferences.json');
const origin = 'http://127.0.0.1:8899';
const entryUrl = 'https://cloudgametest2.migufun.com:18443/cybercafe-power/#/amsportal';
const ruleName = 'Cafe 自动代理';

const testHost = 'cloudgametest2.migufun.com';
const pacFile = join(stateDir, 'cafe.pac');

module.exports = { pluginDir, isWindows, POWERSHELL, workspace, tools, stateDir, stateFile, logsDir, prefsFile, origin, entryUrl, ruleName, testHost, pacFile };

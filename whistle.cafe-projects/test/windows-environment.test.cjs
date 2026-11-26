const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, delimiter } = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise Windows PowerShell itself on the Windows Actions runner, including
// paths with spaces. Only npm/Whistle are fixtures; Node is the runner's Node.
test('Windows discovers local tools, starts with app plugin, and explains missing Whistle/npm errors', {
  skip: process.platform !== 'win32', timeout: 30000,
}, t => {
  const dir = mkdtempSync(join(tmpdir(), 'cafe local environment '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'global modules');
  const tools = join(dir, 'app tools');
  const cli = join(root, 'whistle', 'bin', 'whistle.js');
  mkdirSync(join(root, 'whistle', 'bin'), { recursive: true });
  mkdirSync(join(tools, 'whistle.cafe-projects'), { recursive: true });
  writeFileSync(join(tools, 'whistle.cafe-projects', 'package.json'), '{}');
  writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)));');
  writeFileSync(join(dir, 'npm.cmd'), '@echo off\r\n"%CAFE_TEST_NODE%" "%~dp0npm-stub.cjs" %*\r\nexit /b %errorlevel%\r\n');
  writeFileSync(join(dir, 'npm-stub.cjs'), 'if(process.env.CAFE_TEST_NPM_FAIL)process.exit(1); console.log(process.env.CAFE_TEST_NPM_ROOT);');
  const source = readFileSync(join(__dirname, '../../desktop/src/services/windows-environment.ps1'), 'utf8');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const invoke = (checkOnly, extraEnv = {}) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`& { ${source} } -ToolsRoot ${quote(tools)} ${checkOnly ? '-CheckOnly' : ''}`, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, PATH: dir + delimiter + process.env.PATH,
      CAFE_TEST_NODE: process.execPath, CAFE_TEST_NPM_ROOT: root, ...extraEnv },
  });
  let result = invoke(true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).whistle, cli);
  result = invoke(false);
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(result.stdout.trim());
  assert.deepEqual(args, ['start', '-H', '127.0.0.1', '-p', '8899', '--addon', tools]);
  rmSync(cli);
  result = invoke(true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm install -g whistle/);
  result = invoke(true, { CAFE_TEST_NPM_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm root -g/);
});

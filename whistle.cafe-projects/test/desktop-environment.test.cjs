const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, delimiter } = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise Windows PowerShell itself on the Windows Actions runner, including
// paths with spaces. Only npm/Whistle are fixtures; Node is the runner's Node.
test('Windows reuses Whistle or installs it silently when missing, and reports npm errors', {
  skip: process.platform !== 'win32', timeout: 60000,
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
  writeFileSync(join(dir, 'npm-stub.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
if (process.env.CAFE_TEST_NPM_FAIL) process.exit(1);
if (process.argv[2] === 'install') {
  fs.appendFileSync(process.env.CAFE_TEST_INSTALL_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
  if (process.env.CAFE_TEST_INSTALL_FAIL) { console.error('registry unavailable'); process.exit(1); }
  const cli = path.join(process.env.CAFE_TEST_NPM_ROOT, 'whistle/bin/whistle.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)));');
} else console.log(process.env.CAFE_TEST_NPM_ROOT);
`);
  const source = readFileSync(join(__dirname, '../../desktop/src/services/windows-environment.ps1'), 'utf8');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const invoke = (checkOnly, extraEnv = {}) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`& { ${source} } -ToolsRoot ${quote(tools)} ${checkOnly ? '-CheckOnly' : ''}`, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, PATH: dir + delimiter + process.env.PATH,
      CAFE_TEST_NODE: process.execPath, CAFE_TEST_NPM_ROOT: root, CAFE_TEST_INSTALL_LOG: join(dir, 'install.log'), ...extraEnv },
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
  result = invoke(false);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), args);
  let installs = readFileSync(join(dir, 'install.log'), 'utf8').trim().split('\n');
  assert.equal(installs.length, 1);
  assert.deepEqual(JSON.parse(installs[0]).slice(0, 3), ['install', '-g', 'whistle']);
  result = invoke(false);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(dir, 'install.log'), 'utf8').trim().split('\n').length, 1);
  rmSync(cli);
  result = invoke(false, { CAFE_TEST_INSTALL_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /自动安装 Whistle 失败/);
  assert.match(result.stderr, /registry unavailable/);
  result = invoke(true, { CAFE_TEST_NPM_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm root -g/);
});

test('macOS installs missing Whistle, reuses it on restart and reports installation errors', {
  skip: process.platform !== 'darwin',
}, t => {
  const dir = mkdtempSync(join(tmpdir(), 'cafe mac environment '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, 'w2');
  writeFileSync(join(dir, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(dir, 'npm'), `#!/bin/sh
printf '%s\\n' "$*" >> "$CAFE_TEST_BIN/install.log"
if [ "$CAFE_TEST_INSTALL_FAIL" = 1 ]; then echo 'registry unavailable' >&2; exit 1; fi
printf '#!/bin/sh\\nexit 0\\n' > "$CAFE_TEST_BIN/w2"
/bin/chmod +x "$CAFE_TEST_BIN/w2"
`, { mode: 0o755 });
  const script = readFileSync(join(__dirname, '../../desktop/src/services/macos-environment.sh'), 'utf8');
  const invoke = (extra = {}) => spawnSync('/bin/zsh', ['-c', script], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: dir, CAFE_TEST_BIN: dir, ...extra },
  });
  let result = invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), cli);
  const installed = readFileSync(join(dir, 'install.log'), 'utf8');
  assert.match(installed, /^install -g whistle /);
  result = invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(dir, 'install.log'), 'utf8'), installed);
  rmSync(cli);
  result = invoke({ CAFE_TEST_INSTALL_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /自动安装 Whistle 失败/);
  assert.match(result.stderr, /registry unavailable/);
});

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  beginStartup, waitForService, failStartup, observeStartup, startupSnapshot, hasPendingStartup, clearStartup,
} = require('../features/startup/startup.cjs');

test('a successful scan must have started after the terminal launch', () => {
  const attempt = beginStartup('fresh', 'starting');
  waitForService(attempt);
  const state = { projects: { fresh: { port: 3000 } } };
  observeStartup(state, attempt.waitingSince - 1);
  assert.equal(startupSnapshot('fresh').stage, 'waiting');
  observeStartup(state, attempt.waitingSince);
  assert.equal(startupSnapshot('fresh').stage, 'ready');
  assert.equal(hasPendingStartup('fresh'), false);
  clearStartup('fresh');
  assert.equal(startupSnapshot('fresh'), null);
});

test('a failed install ends the attempt without waiting for a service', () => {
  const attempt = beginStartup('install-failure', 'installing');
  failStartup(attempt, '安装失败');
  observeStartup({ projects: { 'install-failure': { port: 3000 } } }, Date.now());
  assert.equal(startupSnapshot('install-failure').stage, 'failed');
  assert.equal(hasPendingStartup('install-failure'), false);
  clearStartup('install-failure');
});

test('a terminal process exit uses diagnostics from the current attempt', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cafe-launch-test-'));
  t.after(() => {
    clearStartup('early-exit');
    rmSync(dir, { recursive: true, force: true });
  });
  const attempt = beginStartup('early-exit', 'starting');
  attempt.logFile = join(dir, 'current.log');
  writeFileSync(attempt.logFile, '[cafe-launch another-attempt exit 1]\n');
  waitForService(attempt);
  assert.equal(startupSnapshot('early-exit').stage, 'waiting');
  const child = spawnSync(process.execPath, [
    join(__dirname, '..', 'features/logs/run-log.cjs'), attempt.logFile,
    process.execPath, '-e', 'console.error("Error: EADDRINUSE"); process.exitCode = 12',
  ], { env: { ...process.env, CAFE_LAUNCH_ID: attempt.id }, encoding: 'utf8' });
  assert.equal(child.status, 12);
  assert.equal(startupSnapshot('early-exit').stage, 'failed');
  assert.match(startupSnapshot('early-exit').message, /端口被占用/);
});

test('sync timeout releases the launch guard and a late success is reflected', () => {
  const attempt = beginStartup('timeout', 'waiting');
  waitForService(attempt);
  attempt.waitingSince -= 46000;
  observeStartup(null, Date.now());
  assert.match(startupSnapshot('timeout').message, /同步超时/);
  assert.equal(hasPendingStartup('timeout'), false);
  observeStartup({ projects: { timeout: { port: 3000 } } }, Date.now());
  assert.equal(startupSnapshot('timeout').stage, 'ready');
  clearStartup('timeout');
});

test('an unmatched service is reported without claiming it was taken over', () => {
  const attempt = beginStartup('unmatched', 'starting');
  waitForService(attempt);
  observeStartup({ projects: {}, unmatched: { unmatched: { port: 3000 } } }, Date.now());
  assert.equal(startupSnapshot('unmatched').stage, 'failed');
  assert.match(startupSnapshot('unmatched').message, /无法接管/);
  clearStartup('unmatched');
});

test('ready messages describe the selected mode without claiming browser traffic is verified', () => {
  const { readyMessage } = require('../features/startup/startup.cjs');
  assert.match(readyMessage('browser'), /浏览器代理模式.*浏览器代理扩展/);
  assert.match(readyMessage('system'), /Whistle 代理模式.*系统代理配置成功/);
  for (const mode of ['browser', 'system']) {
    assert.match(readyMessage(mode), /尚未验证浏览器请求/);
    assert.doesNotMatch(readyMessage(mode), /已接管本地服务/);
  }
});

test('confirmed page reports are reflected in startup text', () => {
  const { readyMessage } = require('../features/startup/startup.cjs');
  assert.match(readyMessage('browser', true), /浏览器代理模式.*已确认测试标签页/);
  assert.doesNotMatch(readyMessage('browser', true), /尚未验证/);
});

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

test('共享日志会话隔离项目日志、清空请求和服务进程组，面板断开后继续记录', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const { spawn } = require('node:child_process');
  const { once } = require('node:events');
  const { existsSync, readFileSync } = require('node:fs');
  const { setTimeout: delay } = require('node:timers/promises');
  const directory = mkdtempSync(join(tmpdir(), 'cafe-shared-log-'));
  const session = spawn(process.execPath, [join(__dirname, '../features/logs/session.cjs')], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const services = [];
  t.after(() => {
    for (const pid of services) { try { process.kill(-pid, 'SIGTERM'); } catch {} }
    session.kill();
    rmSync(directory, { recursive: true, force: true });
  });
  await once(session, 'spawn');
  async function message(type, id, action) {
    const result = new Promise((resolve, reject) => {
      const handler = value => {
        if (value.id !== id) return;
        if (value.type === type || value.type === 'error') {
          session.off('message', handler);
          if (value.type === 'error') reject(new Error(value.message)); else resolve(value);
        }
      };
      session.on('message', handler);
    });
    action();
    return result;
  }
  for (const id of [1, 2]) {
    const file = join(directory, id + '.log');
    const value = await message('started', id, () => session.send({ type: 'start', id, file, command: process.execPath,
      args: ['-e', `console.log('project-${id}');console.error('error-${id}');setInterval(()=>console.log('tick-${id}'),100)`],
      options: { cwd: directory, env: { ...process.env, CAFE_LAUNCH_ID: String(id) } } }));
    services.push(value.pid);
    assert.equal(readFileSync(file + '.pid', 'utf8'), String(session.pid));
  }
  const a = join(directory, '1.log');
  const b = join(directory, '2.log');
  for (let i = 0; i < 100 && !readFileSync(b, 'utf8').includes('error-2'); i++) await delay(10);
  assert.match(readFileSync(a, 'utf8'), /project-1/);
  assert.doesNotMatch(readFileSync(a, 'utf8'), /project-2/);
  const request = a + '.clear-' + session.pid;
  writeFileSync(request, '1');
  for (let i = 0; i < 100 && existsSync(request); i++) await delay(10);
  assert.equal(existsSync(request), false);
  assert.doesNotMatch(readFileSync(a, 'utf8'), /project-1/);
  assert.match(readFileSync(b, 'utf8'), /project-2/);
  await message('closed', 1, () => process.kill(-services[0], 'SIGTERM'));
  assert.equal(existsSync(a + '.pid'), false);
  assert.equal(process.kill(services[1], 0), true);
  session.disconnect();
  const before = readFileSync(b, 'utf8').length;
  for (let i = 0; i < 100 && readFileSync(b, 'utf8').length === before; i++) await delay(10);
  assert.ok(readFileSync(b, 'utf8').length > before);
  const ended = once(session, 'exit');
  process.kill(-services[1], 'SIGTERM');
  await ended;
});

test('日志纯文本视图过滤颜色控制码，保留警告、搜索和原始文件', t => {
  const { readLog, diagnose } = require('../features/logs/store.cjs');
  const { readFileSync } = require('node:fs');
  const directory = mkdtempSync(join(tmpdir(), 'cafe-ansi-log-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'current.log');
  const text = '\x1b[1m\x1b[33m[@vue/compiler-sfc]\x1b[0m :deep usage is deprecated.\n'
    + '\x1b]0;terminal title\x07Error: EADDR\x1b[31mINUSE\x1b[0m\n';
  for (const encoding of ['utf8', 'utf16le']) {
    writeFileSync(file, encoding === 'utf16le' ? '\uFEFF' + text : text, encoding);
    const before = readFileSync(file);
    const result = readLog(file, '');
    assert.equal(result.lines[0], '[@vue/compiler-sfc] :deep usage is deprecated.');
    assert.equal(result.lines[1], 'Error: EADDRINUSE');
    assert.equal(readLog(file, 'eaddrinuse').count, 1);
    assert.equal(diagnose(result.lines.join('\n'))[0].text, '端口被占用');
    assert.deepEqual(readFileSync(file), before);
  }
});

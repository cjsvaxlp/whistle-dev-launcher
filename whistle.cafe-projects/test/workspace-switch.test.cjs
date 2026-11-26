const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const vm = require('node:vm');

test('同名 clone 切换需确认，停止原目录全部托管进程并保留外部服务及日志', {
  skip: process.platform === 'win32' || Boolean(spawnSync('lsof', ['-v']).error), timeout: 25000,
}, async t => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'cafe-workspaces-')));
  const keys = ['CAFE_STATE_DIR', 'CAFE_TOOLS_DIR', 'CAFE_WORKSPACE', 'CAFE_WHISTLE_ORIGIN'];
  const previousEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const a = join(fixture, 'feature-a', 'cybercafe-front');
  const b = join(fixture, 'feature-b', 'cybercafe-front');
  const children = [];
  let managedLauncher;
  let rule = null;
  let failSync = false;
  const whistle = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (failSync) { response.writeHead(503); response.end('{}'); return; }
    if (request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      rule = { value: new URLSearchParams(body).get('value'), selected: true };
      response.end('{"ec":0}');
    } else response.end(JSON.stringify({ value: rule }));
  });
  const panel = createServer();
  t.after(async () => {
    if (managedLauncher) await managedLauncher.stopLaunchedServices().catch(() => {});
    for (const child of children) child.kill();
    panel.close(); whistle.close();
    for (const key of keys) if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    rmSync(fixture, { recursive: true, force: true });
  });
  whistle.listen(0, '127.0.0.1'); await once(whistle, 'listening');
  Object.assign(process.env, { CAFE_STATE_DIR: join(fixture, 'state'), CAFE_TOOLS_DIR: fixture,
    CAFE_WORKSPACE: a, CAFE_WHISTLE_ORIGIN: `http://127.0.0.1:${whistle.address().port}` });
  const ports = [];
  for (const [workspace, branch] of [[a, 'feature-a'], [b, 'feature-b']]) {
    const directory = join(workspace, 'cybercafe-demo');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), '{}');
    writeFileSync(join(directory, 'vite.config.js'), '');
    execFileSync('git', ['init', '--quiet', '-b', branch, workspace]);
    // An unborn branch is valid and needs no commit or configured Git identity.
    const child = spawn(process.execPath, ['-e', `const s=require('node:http').createServer((q,r)=>r.end('<script src="/cybercafe-demo/@vite/client"></script>'));s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    ports.push(Number((await once(child.stdout, 'data'))[0].toString().trim()));
  }
  const projects = require('../features/projects/server.cjs');
  const startup = require('../features/startup/startup.cjs');
  const logs = require('../features/logs/store.cjs');
  require('../index.cjs').uiServer(panel);
  panel.listen(0, '127.0.0.1'); await once(panel, 'listening');
  const base = `http://127.0.0.1:${panel.address().port}`;
  const { token } = await (await fetch(base + '/api/token')).json();
  const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST',
    headers: { 'X-Cafe-Token': token, ...headers }, body: data && new URLSearchParams(data) });
  const switchTo = directory => post('/api/workspace', { directory, confirmed: '1', previousWorkspace: projects.snapshot().workspace });
  assert.equal(await projects.runSync(), true);
  assert.equal(projects.snapshot().projects[0].port, ports[0]);
  const launcher = require('../features/terminal/launcher.cjs');
  managedLauncher = launcher;
  const managed = [];
  const commands = join(fixture, 'scripts', 'commands');
  mkdirSync(commands, { recursive: true });
  writeFileSync(join(commands, '启动任意项目.command'), '#!/bin/zsh\nexec "$CAFE_NODE_BIN" service.cjs\n');
  for (const name of ['managed-one', 'managed-two']) {
    const directory = join(a, 'cybercafe-' + name);
    mkdirSync(join(directory, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(directory, 'node_modules', '.bin', 'vite'), '', { mode: 0o755 });
    writeFileSync(join(directory, 'package.json'), '{}');
    writeFileSync(join(directory, 'vite.config.js'), '');
    writeFileSync(join(directory, 'service.cjs'), `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);const s=require('node:http').createServer((q,r)=>r.end('<script src="/cybercafe-${name}/@vite/client"></script>'));s.listen(0,'127.0.0.1',()=>require('node:fs').writeFileSync('service.json',JSON.stringify({pid:process.pid,child:child.pid,port:s.address().port})));`);
    await launcher.openTerminal(name, logs.prepareLog(name), 'fixture-' + name, { node: process.execPath });
    for (let attempt = 0; !existsSync(join(directory, 'service.json')) && attempt < 100; attempt++) await delay(20);
    managed.push(JSON.parse(readFileSync(join(directory, 'service.json'), 'utf8')));
  }
  const preview = await post('/api/workspace', { directory: b });
  assert.equal(preview.status, 409);
  assert.equal((await preview.json()).action, 'confirm-switch');
  const staleConfirmation = await post('/api/workspace', { directory: b, confirmed: '1', previousWorkspace: '/different-directory' });
  assert.equal(staleConfirmation.status, 409);
  assert.equal((await staleConfirmation.json()).action, 'confirm-switch');
  assert.equal(projects.snapshot().workspace, a);
  for (const service of managed) assert.equal((await fetch(`http://127.0.0.1:${service.port}`)).status, 200);

  const oldLog = logs.prepareLog('demo');
  writeFileSync(oldLog, 'clone A log');
  const releaseLogCleanup = projects.beginLogCleanup();
  assert.equal((await switchTo(b)).status, 409);
  assert.equal(projects.snapshot().workspace, a);
  releaseLogCleanup();
  const attempt = startup.beginStartup('demo', 'starting');
  const sameDirectory = await switchTo(a);
  assert.equal(sameDirectory.status, 200);
  assert.equal(projects.snapshot().projects[0].startup.stage, 'starting');
  assert.equal((await switchTo(b)).status, 409);
  assert.equal(projects.snapshot().workspace, a);
  startup.failStartup(attempt, 'old failure');
  const switched = await switchTo(b);
  assert.equal(switched.status, 200);
  const result = await switched.json();
  assert.deepEqual(result.previousRunning, ['cybercafe-demo']);
  assert.match(result.message, /服务和终端已停止/);
  assert.deepEqual([...result.stoppedServices].sort(), ['managed-one', 'managed-two']);
  for (const service of managed) {
    assert.throws(() => process.kill(service.pid, 0), { code: 'ESRCH' });
    assert.throws(() => process.kill(service.child, 0), { code: 'ESRCH' });
  }
  assert.equal(launcher.hasLaunchedServices(), false);
  assert.equal(projects.snapshot().projects[0].port, ports[1]);
  assert.equal(projects.snapshot().projects[0].startup, null);
  assert.match(rule.value, new RegExp('127\\.0\\.0\\.1:' + ports[1]));
  assert.doesNotMatch(rule.value, new RegExp('127\\.0\\.0\\.1:' + ports[0]));
  assert.equal((await fetch(`http://127.0.0.1:${ports[0]}`)).status, 200);
  assert.notEqual(logs.logPath('demo'), oldLog);
  assert.deepEqual(logs.readLog(logs.logPath('demo'), '').lines, []);
  const bLog = logs.prepareLog('demo'); writeFileSync(bLog, 'clone B log');
  assert.equal((await post('/api/workspace/name', { directory: b, name: 'old-name' })).status, 404);
  writeFileSync(join(fixture, 'state', 'workspaces.json'), JSON.stringify([{ directory: b, name: 'old-alias' }, { directory: a, name: 'another-alias' }]));
  const overview = await (await fetch(base + '/api/workspaces')).json();
  assert.equal(overview.current, b);
  assert.equal(overview.branch, 'feature-b');
  assert.equal(overview.workspaces.find(item => item.directory === b).label, 'cybercafe-front');
  assert.equal(overview.workspaces.find(item => item.directory === b).name, undefined);
  assert.equal(overview.workspaces.length, 2);
  assert.equal((await switchTo(a)).status, 200);
  assert.equal(logs.logPath('demo'), oldLog);
  assert.equal(readFileSync(oldLog, 'utf8'), 'clone A log');
  assert.equal(readFileSync(bLog, 'utf8'), 'clone B log');
  assert.equal((await post('/api/stop/demo', undefined, { 'X-Cafe-Workspace': encodeURIComponent(b) })).status, 409);
  assert.equal((await fetch(base + '/api/logs/demo?' + new URLSearchParams({ workspace: b }))).status, 409);
  assert.equal((await fetch(`http://127.0.0.1:${ports[1]}`)).status, 200);
  projects.beginWorkspaceChange();
  assert.equal((await post('/api/start/demo')).status, 409);
  assert.equal((await post('/api/proxy/off')).status, 409);
  assert.equal((await post('/api/proxy-mode/browser')).status, 409);
  assert.equal((await post('/api/cleanup')).status, 409);
  assert.equal((await post('/api/logs/demo/clear')).status, 409);
  projects.endWorkspaceChange();
  const invalid = await switchTo(join(fixture, 'missing'));
  assert.equal(invalid.status, 400);
  assert.equal(projects.snapshot().workspace, a);
  failSync = true;
  const failed = await switchTo(b);
  assert.equal(failed.status, 200);
  assert.match((await failed.json()).message, /代理规则尚未更新/);
  assert.ok(projects.snapshot().syncError);
  failSync = false;
  assert.equal(await projects.runSync(), true);
  // Re-selecting the same path must still synchronize, while retaining its existing task state.
  startup.beginStartup('demo', 'failed').message = 'keep current attempt';
  projects.jobs.set('demo', { status: 'done' });
  failSync = true;
  const sameFailed = await switchTo(b);
  assert.equal(sameFailed.status, 200);
  assert.match((await sameFailed.json()).message, /未同步成功/);
  assert.ok(projects.snapshot().syncError);
  assert.equal(projects.snapshot().projects[0].startup.message, 'keep current attempt');
  assert.equal(projects.jobs.get('demo').status, 'done');
  failSync = false;
  assert.equal(await projects.runSync(), true);
});

test('原目录服务停止失败时不保存新目录、不改代理，并释放切换锁', async () => {
  const calls = [];
  const isWindows = process.platform === 'win32';
  const a = isWindows ? 'C:\\a' : '/a';
  const b = isWindows ? 'C:\\b' : '/b';
  const source = readFileSync(require.resolve('../features/workspace/server.cjs'), 'utf8');
  const context = vm.createContext({ process, URLSearchParams, module: { exports: {} }, require: name => {
    if (name === 'node:fs/promises') return {
      realpath: async value => value,
      mkdir: async () => {},
      writeFile: async () => calls.push('prepare'),
      rename: async () => calls.push('save'),
      rm: async () => calls.push('remove-temp'),
    };
    if (name === 'node:fs') return { existsSync: value => value === b };
    if (name.startsWith('node:')) return require(name);
    if (name === './store.cjs') return { workspaceFile: '/state/workspace', stateDir: '/state', readWorkspace: () => a };
    if (name.endsWith('/config.cjs')) return {};
    if (name.endsWith('/http.cjs')) return { authorized: () => true, json: (response, status, data) => Object.assign(response, { status, data }) };
    if (name.endsWith('/projects/store.cjs')) return { listProjects: () => ['demo'], readState: () => ({ projects: {} }) };
    if (name.endsWith('/projects/server.cjs')) return {
      beginWorkspaceChange: () => calls.push('lock'), endWorkspaceChange: () => calls.push('unlock'),
      stopWorkspaceServices: async workspace => { assert.equal(workspace, a); calls.push('stop'); throw new Error('进程未退出'); },
      refreshWorkspace: async () => calls.push('sync'),
    };
    if (name === './history.cjs') return { rememberWorkspace: () => calls.push('history') };
    throw new Error(name);
  } });
  vm.runInContext(source, context);
  const body = new URLSearchParams({ directory: b, confirmed: '1', previousWorkspace: a }).toString();
  const request = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, async *[Symbol.asyncIterator]() { yield body; } };
  const response = {};
  await context.module.exports.selectWorkspace(request, response);
  assert.equal(response.status, 500);
  assert.match(response.data.message, /进程未退出/);
  assert.deepEqual(calls, ['lock', 'prepare', 'stop', 'unlock', 'remove-temp']);
});

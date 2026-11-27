const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { spawn, spawnSync } = childProcess;
const { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');

test('panel lifecycle, install guard, and project log cleanup', {
  skip: process.platform === 'win32' || Boolean(spawnSync('lsof', ['-v']).error),
  timeout: 15000,
}, async t => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'cafe-lifecycle-')));
  const stateDir = join(fixture, 'state');
  const workspace = join(fixture, 'workspace');
  const serviceDir = join(workspace, 'cybercafe-demo');
  const alternateProject = join(workspace, 'cybercafe-alternate');
  const alternateBin = join(fixture, 'alternate-bin');
  const children = [];
  const originalEnv = { ...process.env };
  const server = createServer();
  t.after(() => {
    for (const child of children) child.kill();
    server.close();
    for (const key of ['CAFE_WORKSPACE', 'CAFE_STATE_DIR', 'CAFE_TOOLS_DIR', 'CAFE_WHISTLE_ORIGIN', 'PATH']) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    rmSync(fixture, { recursive: true, force: true });
  });

  function write(file, value, mode) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, value, { mode });
  }

  Object.assign(process.env, {
    CAFE_WORKSPACE: workspace,
    CAFE_STATE_DIR: stateDir,
    CAFE_TOOLS_DIR: fixture,
    CAFE_WHISTLE_ORIGIN: 'http://127.0.0.1:1',
  });
  for (const project of ['demo', 'missing']) {
    const directory = join(workspace, 'cybercafe-' + project);
    write(join(directory, 'package.json'), '{}');
    write(join(directory, 'vite.config.js'), '');
  }
  write(join(serviceDir, 'node_modules', '.bin', 'vite'), '', 0o755);
  write(join(alternateProject, 'package.json'), '{"engines":{"node":"99.20.2"}}');
  write(join(alternateProject, 'vite.config.js'), '');
  write(join(alternateBin, 'node'), '#!/bin/sh\nprintf "v99.20.2\\n"\n', 0o755);
  write(join(alternateBin, 'npm'), '', 0o755);
  process.env.PATH = alternateBin + ':' + process.env.PATH;

  const terminalLaunches = [];
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    if (args[0]?.endsWith('/session.cjs')) {
      assert.equal(command, process.execPath);
      assert.equal(options.detached, true);
      assert.equal(options.stdio[3], 'ipc');
      const session = originalSpawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options);
      children.push(session);
      session.send = (message, callback) => {
        assert.ok(message.options.env.CAFE_LAUNCH_ID);
        terminalLaunches.push(message.options.env);
        const child = originalSpawn(process.execPath, ['-e', ''], { ...message.options, detached: true, stdio: 'ignore' });
        children.push(child);
        child.once('spawn', () => session.emit('message', { type: 'started', id: message.id, pid: child.pid }));
        child.once('close', () => session.emit('message', { type: 'closed', id: message.id }));
        callback?.();
      };
      return session;
    }
    if (options.cwd === alternateProject) {
      assert.equal(command, join(alternateBin, 'npm'));
      assert.equal(options.env.PATH.split(':')[0], alternateBin);
      write(join(alternateProject, 'node_modules', '.bin', 'vite'), '', 0o755);
      const child = originalSpawn(process.execPath, ['-e', 'console.log("fixture installed")'], options);
      children.push(child);
      return child;
    }
    if (options.cwd === join(workspace, 'cybercafe-missing')) {
      const child = originalSpawn(process.execPath, ['-e', 'console.error("fixture install failure"); process.exitCode = 9'], options);
      children.push(child);
      return child;
    }
    return originalSpawn(command, args, options);
  };
  t.after(() => { childProcess.spawn = originalSpawn; });
  require('../index.cjs').uiServer(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const base = 'http://127.0.0.1:' + server.address().port;
  const get = path => fetch(base + path);
  const { token } = await (await get('/api/token')).json();
  const post = (path, key = token) => fetch(base + path, { method: 'POST', headers: { 'X-Cafe-Token': key } });
  const project = async name => (await (await get('/api/projects')).json()).projects.find(item => item.name === name);

  const launch = await post('/api/start/demo');
  assert.equal(launch.status, 200, await launch.text());
  assert.equal((await project('demo')).startup.stage, 'waiting');
  assert.equal((await post('/api/start/demo')).status, 409);
  assert.equal(terminalLaunches.length, 1);

  const log = join(stateDir, 'logs', 'demo.log');
  const archived = join(stateDir, 'logs', 'archive', 'demo-2026-01-01T10-00-00-000Z.log');
  const other = join(dirname(archived), 'demo-more-2026-01-01T10-00-00-000Z.log');
  write(archived, 'archive');
  write(other, 'another project');
  assert.equal((await post('/api/logs/demo/clear', 'bad')).status, 403);
  const cleared = await (await post('/api/logs/demo/clear')).json();
  assert.equal(cleared.removed, 1);
  assert.equal(cleared.keptCurrent, true);
  assert(existsSync(log));
  assert(existsSync(other));
  assert(!existsSync(archived));

  const worker = spawn(process.execPath, [
    '-e', 'const s=require("node:http").createServer((_q,r)=>r.end("ok")); s.listen(0, "127.0.0.1", ()=>console.log(s.address().port));',
  ], { cwd: serviceDir });
  children.push(worker);
  const port = Number((await once(worker.stdout, 'data'))[0]);
  write(join(stateDir, 'state.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    projects: { missing: { port, engine: 'vite', pid: worker.pid } },
  }));
  assert.equal((await post('/api/stop/missing')).status, 503);
  assert.doesNotThrow(() => process.kill(worker.pid, 0));
  const workerExit = once(worker, 'exit');
  worker.kill();
  await workerExit;
  assert.equal((await post('/api/stop/missing')).status, 503);
  write(join(stateDir, 'state.json'), JSON.stringify({ projects: {} }));

  assert.equal((await post('/api/start/missing')).status, 409);
  assert.equal((await post('/api/install-and-start/missing')).status, 200);
  for (let checks = 0; checks < 40 && (await project('missing')).startup.stage !== 'failed'; checks++) {
    await delay(50);
  }
  assert.equal((await project('missing')).startup.stage, 'failed');
  assert.match((await (await get('/api/logs/missing')).json()).lines.join('\n'), /fixture install failure/);
  assert.equal(terminalLaunches.length, 1);

  assert.equal((await post('/api/install-and-start/alternate')).status, 200);
  for (let checks = 0; checks < 40 && terminalLaunches.length < 2; checks++) await delay(50);
  assert.equal(terminalLaunches.length, 2);
  assert.equal(terminalLaunches[1].CAFE_NODE_BIN, join(alternateBin, 'node'));
  assert.match((await project('alternate')).startup.message, /Node v99\.20\.2/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

test('plugin protocol responds without redirect and shares confirmation with panel', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cafe-report-server-'));
  const workspace = join(directory, 'repositories');
  mkdirSync(join(workspace, 'cybercafe-demo'), { recursive: true });
  writeFileSync(join(workspace, 'cybercafe-demo/package.json'), '{"name":"demo","scripts":{}}');
  const previous = process.env.CAFE_STATE_DIR;
  process.env.CAFE_STATE_DIR = directory;
  writeFileSync(join(directory, 'workspace'), workspace);
  const since = new Date().toISOString();
  const workspaceId = createHash('sha256').update(workspace).digest('hex');
  writeFileSync(join(directory, 'state.json'), JSON.stringify({ workspaceId, updatedAt: since, proxyEnabled: true,
    projects: { demo: { port: 5173, pid: '456', engine: 'vite', since } } }));
  const plugin = require('../index.cjs');
  assert.equal(typeof plugin.server, 'function');
  const server = createServer(request => {
    request.originalReq = { url: 'https://cloudgametest2.migufun.com:18443' + request.url };
  });
  plugin.server(server);
  const panel = createServer();
  plugin.uiServer(panel);
  t.after(() => {
    server.close(); panel.close();
    if (previous === undefined) delete process.env.CAFE_STATE_DIR; else process.env.CAFE_STATE_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1'); panel.listen(0, '127.0.0.1');
  await Promise.all([once(server, 'listening'), once(panel, 'listening')]);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const query = new URLSearchParams({ project: 'demo', proof: 'demo-5173-456', since, workspace: workspaceId });
  const response = await fetch(origin + '/__cafe/confirm?' + query, {
    redirect: 'manual', headers: { referer: 'https://cloudgametest2.migufun.com:18443/cybercafe-demo/' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(await response.json(), { accepted: true });
  // A damaged/unwritable logs location must not turn a readable checkout into
  // a failed project-list request (including Windows ENOTDIR/EACCES failures).
  writeFileSync(join(directory, 'logs'), 'blocked log directory');
  const listResponse = await fetch('http://127.0.0.1:' + panel.address().port + '/api/projects');
  assert.equal(listResponse.status, 200);
  const state = await listResponse.json();
  assert.match(state.projects[0].logError, /无法读取项目日志/);
  assert.equal(state.projects[0].log, false);
  rmSync(join(directory, 'logs'));
  const recovered = await (await fetch('http://127.0.0.1:' + panel.address().port + '/api/projects')).json();
  assert.equal(recovered.projects[0].logError, '');
  assert.equal(state.projects.find(project => project.name === 'demo').browser.confirmed, true);
  const rejected = await fetch(origin + '/__cafe/confirm?' + query, { headers: { referer: 'https://unrelated.example/' } });
  assert.equal(rejected.status, 409);
  const unknown = await fetch(origin + '/other');
  assert.equal(unknown.status, 404);
});

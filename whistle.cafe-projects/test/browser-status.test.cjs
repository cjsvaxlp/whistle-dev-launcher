const test = require('node:test');
const assert = require('node:assert/strict');
const { browserStatus, recordBrowserReport } = require('../features/proxy/browser-status.cjs');
const now = Date.now();
const local = { port: 5173, pid: '456', since: new Date(now - 5000).toISOString() };
const state = { proxyEnabled: true, workspaceId: 'workspace-a', updatedAt: new Date(now).toISOString(), projects: { demo: local } };
const query = () => new URLSearchParams({ project: 'demo', proof: 'demo-5173-456', since: local.since, workspace: state.workspaceId });
const referer = 'https://cloudgametest2.migufun.com:18443/cybercafe-demo/';

test('local readiness alone is not browser confirmation; reports expire and cannot carry over to a new instance', () => {
  assert.equal(browserStatus(state, 'demo', now).confirmed, false);
  assert.equal(recordBrowserReport(state, query(), referer, now), true);
  assert.equal(browserStatus(state, 'demo', now + 1000).confirmed, true);
  assert.equal(browserStatus(state, 'demo', now + 21000).confirmed, false);
  assert.equal(browserStatus({ ...state, workspaceId: 'different' }, 'demo', now).confirmed, false);
  assert.equal(browserStatus({ ...state, proxyEnabled: false }, 'demo', now).confirmed, false);
  assert.equal(browserStatus({ ...state, projects: { demo: { ...local, pid: '789' } } }, 'demo', now).confirmed, false);
  assert.equal(browserStatus({ ...state, projects: { demo: { ...local, since: 'new-start' } } }, 'demo', now).confirmed, false);
});

test('reports must match the test-page origin, project, local marker and fresh state', () => {
  assert.equal(recordBrowserReport(state, query(), 'https://example.com/cybercafe-demo/', now), false);
  assert.equal(recordBrowserReport(state, query(), referer.replace('demo', 'other'), now), false);
  assert.equal(recordBrowserReport(state, query(), undefined, now), false);
  const wrong = query(); wrong.set('proof', 'demo-5173-999');
  assert.equal(recordBrowserReport(state, wrong, referer, now), false);
  assert.equal(recordBrowserReport(state, query(), referer, now + 31000), false);
  assert.equal(recordBrowserReport({ ...state, proxyEnabled: false }, query(), referer, now), false);
});

test('generated rules expose local markers and the same-origin report route', async () => {
  const { buildRule } = await import('../features/proxy/sync.mjs');
  const rules = buildRule(['demo', 'compat'], { demo: { port: 5173, pid: '456', engine: 'vite' } }, { compat: { port: 5174, pid: '789' } });
  assert.match(rules, /__cafe\/confirm cafe-projects:\/\/browser-report/);
  assert.doesNotMatch(rules, /__cafe\/confirm http:\/\/127\.0\.0\.1:8899/);
  assert.match(rules, /resHeaders:\/\/x-cafe-local=demo-5173-456/);
  assert.match(rules, /resHeaders:\/\/x-cafe-local=compat-5174-789/);
});

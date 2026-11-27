const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

// Run the actual route with Windows configuration. A disappeared checkout must
// not prevent registry-based cleanup or cause any external process discovery.
for (const failed of [false, true]) {
  test(`Windows stop-all with missing workspace, cleanup ${failed ? 'fails' : 'succeeds'}`, async () => {
    const source = readFileSync(require.resolve('../features/projects/server.cjs'), 'utf8');
    const handler = source.slice(source.indexOf('async function stopAllServices('), source.indexOf('\nmodule.exports'));
    let stops = 0;
    const context = vm.createContext({
      authorized: () => true,
      json: (response, status, data) => Object.assign(response, { status, data }),
      stoppingServices: false, changingWorkspace: false, isWindows: true,
      cancelInstalls() {}, operations: new Set(),
      listProjects() { throw Object.assign(new Error('checkout deleted'), { code: 'ENOENT' }); },
      runSync() { throw new Error('must not scan or sync before cleanup'); },
      stopLaunchedServices: async () => { stops++; if (failed) throw new Error('taskkill failed'); },
    });
    vm.runInContext(handler, context);
    const response = {};
    await context.stopAllServices({}, response);
    assert.equal(stops, 1);
    assert.equal(response.status, failed ? 503 : 200);
    assert.equal(context.stoppingServices, false);
    if (failed) assert.match(response.data.message, /taskkill failed/);
  });
}

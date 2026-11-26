const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

test('原目录服务停止失败时不保存新目录、不改代理，并释放切换锁', async () => {
  const calls = [];
  const source = readFileSync(require.resolve('../features/workspace/server.cjs'), 'utf8');
  const context = vm.createContext({ process, URLSearchParams, module: { exports: {} }, require: name => {
    if (name === 'node:fs/promises') return {
      realpath: async value => value,
      mkdir: async () => {},
      writeFile: async () => calls.push('prepare'),
      rename: async () => calls.push('save'),
      rm: async () => calls.push('remove-temp'),
    };
    if (name === 'node:fs') return { existsSync: value => value === '/b' };
    if (name.startsWith('node:')) return require(name);
    if (name === './store.cjs') return { workspaceFile: '/state/workspace', stateDir: '/state', readWorkspace: () => '/a' };
    if (name.endsWith('/config.cjs')) return {};
    if (name.endsWith('/http.cjs')) return { authorized: () => true, json: (response, status, data) => Object.assign(response, { status, data }) };
    if (name.endsWith('/projects/store.cjs')) return { listProjects: () => ['demo'], readState: () => ({ projects: {} }) };
    if (name.endsWith('/projects/server.cjs')) return {
      beginWorkspaceChange: () => calls.push('lock'), endWorkspaceChange: () => calls.push('unlock'),
      stopWorkspaceServices: async workspace => { assert.equal(workspace, '/a'); calls.push('stop'); throw new Error('进程未退出'); },
      refreshWorkspace: async () => calls.push('sync'),
    };
    if (name === './history.cjs') return { rememberWorkspace: () => calls.push('history') };
    throw new Error(name);
  } });
  vm.runInContext(source, context);
  const request = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, async *[Symbol.asyncIterator]() { yield 'directory=%2Fb&confirmed=1&previousWorkspace=%2Fa'; } };
  const response = {};
  await context.module.exports.selectWorkspace(request, response);
  assert.equal(response.status, 500);
  assert.match(response.data.message, /进程未退出/);
  assert.deepEqual(calls, ['lock', 'prepare', 'stop', 'unlock', 'remove-temp']);
});

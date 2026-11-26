const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { join } = require('node:path');

for (const isWindows of [false, true]) {
  test(`${isWindows ? 'Windows' : 'macOS'} 体检等待 npm 时不阻塞目录请求`, async () => {
    let npmCallback;
    const source = readFileSync(require.resolve('../features/doctor/server.cjs'), 'utf8');
    const context = vm.createContext({ process, Buffer, module: { exports: {} }, require: name => {
      if (name === 'node:child_process') return {
        execFile(command, args, options, callback) { npmCallback = callback; },
        execFileSync() { throw new Error('同步子进程会阻塞目录选择'); },
      };
      if (name.startsWith('node:')) return require(name);
      if (name.endsWith('/config.cjs')) return { isWindows, POWERSHELL: 'powershell.exe' };
      if (name.endsWith('/launcher.cjs')) return { windowsCommand: (command, args) => [command, ...args] };
      return {};
    } });
    vm.runInContext(source, context);
    let finished = false;
    const result = context.globalPluginTarget().then(value => { finished = true; return value; });
    assert.equal(typeof npmCallback, 'function');
    let otherRequestProcessed = false;
    await new Promise(resolve => setImmediate(() => { otherRequestProcessed = true; resolve(); }));
    assert.equal(otherRequestProcessed, true);
    assert.equal(finished, false);
    npmCallback(null, { stdout: '/global/node_modules\n' });
    assert.equal(await result, join('/global/node_modules', 'whistle.cafe-projects'));
  });
}

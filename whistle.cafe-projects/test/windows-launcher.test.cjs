const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { join, posix, win32 } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../features/terminal/launcher.cjs'), 'utf8');

function fixture(vite, paths) {
  const workspace = paths === win32 ? 'C:\\workspace with spaces' : '/workspace with spaces';
  const calls = [], child = new EventEmitter();
  child.pid = 12345;
  child.unref = () => {};
  const config = { pluginDir: paths.join(workspace, 'tools', 'plugin'), tools: paths.join(workspace, 'tools'), stateDir: paths.join(workspace, 'state'), isWindows: true,
    POWERSHELL: 'powershell.exe', readWorkspace: () => workspace };
  const mockRequire = name => {
    if (name === 'node:path') return paths;
    if (name === 'node:child_process') return {
      spawn(command, args, options) {
        calls.push({ command, args, options });
        process.nextTick(() => child.emit('spawn'));
        return child;
      },
      execFile(command, args, options, callback) {
        calls.push({ command, args, options });
        child.emit('close');
        callback(null, '', '');
      },
    };
    if (name === 'node:fs') return { existsSync: file => vite ? !file.endsWith('webpack.dev.conf.js') : !/vite\.config|\.env\.test/.test(file) };
    if (name.endsWith('/config.cjs')) return config;
    if (name.endsWith('/runtime.cjs')) return { runtimePath: () => '/selected-node/bin', installPolicy: () => ({}) };
    return require(name);
  };
  mockRequire.resolve = name => paths.join(workspace, 'node_modules', name);
  const context = { require: mockRequire, module: { exports: {} }, process, Buffer };
  vm.runInNewContext(source, context);
  return { api: context.module.exports, calls, workspace };
}

for (const paths of [posix, win32]) {
  for (const vite of [true, false]) {
    test(`Windows ${vite ? 'Vite' : 'webpack'} with ${paths === win32 ? 'Windows' : 'POSIX'} paths starts in background and cleans up its process tree`, async () => {
      const { api, calls, workspace } = fixture(vite, paths);
      const log = paths.join(workspace, 'logs', 'demo.log');
      const node = paths.join(workspace, 'selected node', 'node.exe');
      await api.openTerminal('demo', log, 'launch-1', { node });
      assert.equal(calls.length, 1);
      const launch = calls[0];
      assert.equal(launch.command, process.execPath);
      assert.match(launch.args[0], /run-log\.cjs$/);
      assert.equal(launch.args[1], log);
      assert.equal(launch.args[2], node);
      assert.equal(launch.options.cwd, paths.join(workspace, 'cybercafe-demo'));
      assert.equal(launch.options.windowsHide, true);
      assert.equal(launch.options.detached, false);
      assert.equal(launch.options.stdio, 'ignore');
      assert.equal(launch.options.env.CAFE_LAUNCH_ID, 'launch-1');
      assert.ok(launch.args.includes('--host'));
      await api.stopLaunchedServices();
      assert.equal(calls[1].command, 'taskkill.exe');
      assert.equal(calls[1].args.join(' '), '/PID 12345 /T /F');
      assert.equal(calls[1].options.windowsHide, true);
      await api.stopLaunchedServices();
      assert.equal(calls.length, 2);
    });
  }
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const vm = require('node:vm');

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: workspace is explicitly selected, persisted and restored`, t => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'cafe-workspace-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const context = { module: { exports: {} }, __dirname: dir,
      process: { platform, env: { CAFE_STATE_DIR: dir } },
      require: name => name === 'node:os' ? { homedir: () => dir } : require(name) };
    vm.runInNewContext(fs.readFileSync(join(__dirname, '../features/workspace/store.cjs'), 'utf8'), context);
    const { readWorkspace } = context.module.exports;
    assert.equal(readWorkspace(), '');
    fs.writeFileSync(join(dir, 'workspace'), join(dir, 'chosen-project') + '\n');
    assert.equal(readWorkspace(), join(dir, 'chosen-project'));
  });

  test(`${platform}: project links use the default browser without a separate profile or global proxy`, async () => {
    const calls = [];
    const context = { module: { exports: {} }, process: { platform }, require: name => {
      if (name === 'node:child_process') return { execFile(command, args, options, callback) {
        calls.push({ command, args, options }); callback(null, '', '');
      } };
      if (name.endsWith('/config.cjs')) return { isWindows: platform === 'win32', POWERSHELL: 'powershell.exe', tools: '/tools',
        entryUrl: 'https://cloudgametest2.migufun.com:18443/cybercafe-power/',
        projectPageUrl: project => `https://cloudgametest2.migufun.com:18443/cybercafe-${project}/` };
      if (name.endsWith('/http.cjs')) return { authorized: () => true, json: (response, status, data) => Object.assign(response, { status, data }) };
      if (name.endsWith('/store.cjs')) return { listProjects: () => ['demo'] };
      if (name.endsWith('/launcher.cjs')) return require('../features/terminal/launcher.cjs');
      return require(name);
    } };
    vm.runInNewContext(fs.readFileSync(join(__dirname, '../features/browser/server.cjs'), 'utf8'), context);
    const response = {};
    await context.module.exports.openBrowser({}, response, new URL('http://localhost/'), ['', 'demo']);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    const launch = calls[0];
    const script = platform === 'win32' ? Buffer.from(launch.args.at(-1), 'base64').toString('utf16le') : launch.args.join(' ');
    assert.ok(script.includes('https://cloudgametest2.migufun.com:18443/cybercafe-demo/'));
    assert.doesNotMatch(script, /--proxy-server|--user-data-dir|chrome\.exe/);
    if (platform === 'win32') {
      assert.equal(launch.options.windowsHide, true);
      assert.match(script, /Start-Process/);
    }
  });
}

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { X509Certificate } = require('node:crypto');
const { rootCertificates } = require('node:tls');
const { macCaTrusted } = require('../features/doctor/mac-ca.cjs');
const { proxyChecks } = require('../features/doctor/proxy-checks.cjs');

const cert = new X509Certificate(rootCertificates[0]);

test('a standalone CA validation cannot hide a missing keychain certificate', async () => {
  let verified = false;
  const result = await macCaTrusted('ca.cer', cert, async (_, args) => {
    if (args[0] === 'verify-cert') verified = true;
    return { stdout: '' };
  });
  assert.equal(result, false);
  assert.equal(verified, false);
});

test('another installed CA with a different fingerprint does not count', async () => {
  const result = await macCaTrusted('ca.cer', cert, async () => ({ stdout: rootCertificates[1] }));
  assert.equal(result, false);
});

test('the matching installed CA also needs successful SSL trust evaluation', async () => {
  for (const trusted of [false, true]) {
    const result = await macCaTrusted('ca.cer', cert, async (_, args) => {
      if (args[0] === 'verify-cert') {
        assert.ok(args.includes('ssl'));
        if (!trusted) throw new Error('not trusted');
      }
      return { stdout: rootCertificates[0] };
    });
    assert.equal(result, trusted);
  }
});

test('browser mode omits PAC and system checks while keeping browser verification pending', () => {
  const checks = proxyChecks('browser');
  assert.deepEqual(checks.map(check => check.id), ['proxy']);
  assert.equal(checks[0].label, '浏览器代理');
  assert.equal(checks[0].status, 'unknown');
  assert.equal(checks.some(check => check.fix === 'write-pac'), false);
  const confirmed = proxyChecks('browser', { confirmed: ['inter'] });
  assert.equal(confirmed[0].status, 'ok');
  assert.match(confirmed[0].detail, /inter/);
});

test('Whistle mode retains PAC and actual system proxy findings', () => {
  const checks = proxyChecks('system', { systemProxy: { status: 'warn', detail: '未启用' } });
  assert.deepEqual(checks.map(check => check.id), ['pac', 'proxy']);
  assert.equal(checks[1].label, 'Whistle 代理');
  assert.equal(checks[1].status, 'warn');
  assert.equal(checks[1].detail, '未启用');
});

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

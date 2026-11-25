const test = require('node:test');
const assert = require('node:assert/strict');
const { proxyChecks } = require('../features/doctor/proxy-checks.cjs');

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

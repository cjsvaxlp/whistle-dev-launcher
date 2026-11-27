const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { planRestore } = require('../../desktop/src/system_proxy/restore.js');

test('proxy mode uses platform defaults, authenticates changes and persists independently of project preferences', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cafe-proxy-mode-'));
  process.env.CAFE_STATE_DIR = directory;
  t.after(() => { delete process.env.CAFE_STATE_DIR; rmSync(directory, { recursive: true, force: true }); });
  const { token } = require('../shared/http/http.cjs');
  const { modeSnapshot, setMode, setBrowserOption } = require('../features/system-proxy/mode.cjs');
  const response = { writeHead(code) { this.code = code; }, end(body) { this.body = JSON.parse(body); } };
  assert.equal(modeSnapshot().mode, process.platform === 'darwin' ? 'system' : 'browser');
  assert.equal(modeSnapshot().browserEnabled, false);
  setMode({ headers: {} }, response, 'system');
  assert.equal(response.code, 403);
  const request = { headers: { 'x-cafe-token': token } };
  setMode(request, response, 'invalid');
  assert.equal(response.code, 400);
  setMode(request, response, 'system');
  assert.equal(response.code, process.platform === 'darwin' ? 200 : 409);
  if (process.platform === 'darwin') assert.equal(modeSnapshot().mode, 'system');
  setMode(request, response, 'browser');
  assert.equal(response.code, 200);
  assert.equal(modeSnapshot().mode, 'browser');
  assert.equal(modeSnapshot().status.error, null);
  assert.equal(modeSnapshot().status.pending, true);
  assert.equal(modeSnapshot().browserEnabled, false);
  setBrowserOption({ headers: {} }, response, false);
  assert.equal(response.code, 403);
  setBrowserOption(request, response, false);
  assert.equal(response.code, 200);
  assert.equal(modeSnapshot().browserEnabled, false);
  if (process.platform === 'darwin') {
    assert.equal(modeSnapshot().mode, 'system');
    assert.equal(modeSnapshot().browserEnabled, false);
    setBrowserOption(request, response, true);
    assert.equal(modeSnapshot().browserEnabled, true);
    assert.equal(modeSnapshot().mode, 'system');
  }
});

const pac = 'http://127.0.0.1:8899/plugin.cafe-projects/cybercafe.pac';
const saved = { service: 'Wi-Fi', url: '', pac: false, web: true, secureweb: true, discovery: false };

test('empty original PAC URL is removed while VPN and other proxy values are preserved', () => {
  const service = { UserDefinedName: 'Wi-Fi', VPN: { remote: 'unchanged' }, Proxies: {
    ProxyAutoConfigURLString: pac, ProxyAutoConfigEnable: 1,
    HTTPEnable: 0, HTTPSEnable: 0, HTTPProxy: 'existing-proxy', HTTPPort: 1234,
    SOCKSEnable: 1, SOCKSProxy: 'existing-socks', ExceptionsList: ['*.local'],
  } };
  const before = JSON.stringify(service);
  const changes = planRestore([saved], { wifi: service }, pac);
  assert.equal(changes.length, 1);
  const proxy = changes[0].proxy;
  assert.equal(Object.hasOwn(proxy, 'ProxyAutoConfigURLString'), false);
  assert.equal(proxy.ProxyAutoConfigEnable, 0);
  assert.equal(proxy.HTTPEnable, 1);
  assert.equal(proxy.HTTPSEnable, 1);
  assert.equal(proxy.HTTPProxy, 'existing-proxy');
  assert.equal(proxy.SOCKSEnable, 1);
  assert.deepEqual(proxy.ExceptionsList, ['*.local']);
  assert.equal(JSON.stringify(service), before);
});

test('a later PAC choice is not overwritten, and the original nonempty URL can be restored', () => {
  assert.deepEqual(planRestore([saved], { wifi: { UserDefinedName: 'Wi-Fi', Proxies: { ProxyAutoConfigURLString: 'https://other/pac' } } }, pac), []);
  const result = planRestore([{ ...saved, url: 'https://original/pac', pac: true }], {
    wifi: { UserDefinedName: 'Wi-Fi', Proxies: { ProxyAutoConfigURLString: pac } },
  }, pac);
  assert.equal(result[0].proxy.ProxyAutoConfigURLString, 'https://original/pac');
  assert.equal(result[0].proxy.ProxyAutoConfigEnable, 1);
});

test('interface display names are supported, ambiguous or corrupt snapshots are rejected safely', () => {
  const services = { usb: { UserDefinedName: 'iPhone', Interface: { UserDefinedName: 'iPhone USB' }, Proxies: { ProxyAutoConfigURLString: pac } } };
  assert.equal(planRestore([{ ...saved, service: 'iPhone USB' }], services, pac).length, 1);
  assert.equal(planRestore([saved], { a: { UserDefinedName: 'Wi-Fi' }, b: { UserDefinedName: 'Wi-Fi' } }, pac).length, 0);
  assert.throws(() => planRestore([{ service: 'Wi-Fi' }], services, pac), /备份字段无效/);
});

test('macOS 和 Windows 默认隐藏，advanced 的勾选与取消在重启后保留，模式切换不覆盖它', t => {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  const source = readFileSync(require.resolve('../features/system-proxy/mode.cjs'), 'utf8');
  for (const platform of ['darwin', 'win32']) {
    const directory = mkdtempSync(join(tmpdir(), 'cafe-option-restart-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    function restart() {
      const context = { process: { platform }, module: { exports: {} }, require(name) {
        if (name === '../workspace/store.cjs') return { stateDir: directory };
        if (name === '../../shared/http/http.cjs') return {
          authorized: () => true, json: (response, code, data) => Object.assign(response, { code, data }),
        };
        return require(name);
      } };
      vm.runInNewContext(source, context);
      return context.module.exports;
    }
    const response = {};
    let api = restart();
    assert.equal(api.modeSnapshot().browserEnabled, false, platform);
    api.setMode({}, response, 'browser');
    api = restart();
    assert.equal(api.modeSnapshot().browserEnabled, false, platform);
    api.setBrowserOption({}, response, true);
    api = restart();
    assert.equal(api.modeSnapshot().browserEnabled, true, platform);
    assert.equal(api.modeSnapshot().mode, 'browser');
    api.setBrowserOption({}, response, false);
    api = restart();
    assert.equal(api.modeSnapshot().browserEnabled, false, platform);
    assert.equal(api.modeSnapshot().mode, platform === 'darwin' ? 'system' : 'browser');
  }
});

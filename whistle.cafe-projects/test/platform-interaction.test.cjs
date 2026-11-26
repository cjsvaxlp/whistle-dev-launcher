const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const vm = require('node:vm');
const { projectPageUrl } = require('../shared/config/config.cjs');

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

// Exercise the injected adapter without touching a business checkout or issuing login requests.
function portalAdapterFixture({ forceChangePassword = 0, returnCode = '000000', enabled = true, dialog = false, hash = '#/freeLogin' } = {}) {
  const timers = new Map();
  let nextTimer = 0;
  let clicked = 0;
  let attempted = false;
  let cancelled = false;
  class XHR {
    open(...args) { this.args = args; return 'original'; }
    addEventListener(name, callback) { this[name] = callback; }
  }
  const originalOpen = XHR.prototype.open;
  const button = {
    textContent: '门店运营模块', disabled: !enabled, hidden: false,
    getClientRects: () => [1], getAttribute: () => null,
    click() { clicked++; },
  };
  const window = {
    __cafeReturn: {
      read: () => cancelled ? null : ({ project: 'store' }),
      cancel() { cancelled = true; },
      beginExchange() { if (attempted) return false; attempted = true; return true; },
    },
    addEventListener() {}, removeEventListener() {},
  };
  const document = {
    addEventListener() {}, removeEventListener() {},
    querySelectorAll(selector) {
      return selector.includes('service-entry') ? [button] : dialog ? [{ hidden: false, getClientRects: () => [1] }] : [];
    },
  };
  const context = {
    window, document, XMLHttpRequest: XHR, URL,
    location: { origin: 'https://cloudgametest2.migufun.com:18443', pathname: '/cybercafe-power/', href: 'https://cloudgametest2.migufun.com:18443/cybercafe-power/' + hash, hash },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(fs.readFileSync(join(__dirname, '../features/navigation/portal.js'), 'utf8'), context);
  const xhr = new XHR();
  assert.equal(xhr.open('POST', '/cybercafe-ruiyun-api/cmsapi/v2/street/account/profile'), 'original');
  xhr.status = 200;
  xhr.responseType = 'json';
  xhr.response = { returnCode, resultData: { forceChangePassword } };
  xhr.loadend();
  for (const [id, timer] of [...timers]) if (timer.delay === 0) { timers.delete(id); timer.callback(); }
  return { clicked, attempted, restored: XHR.prototype.open === originalOpen };
}

test('门户运行时适配仅在已有校验成功后触发原模块入口，并恢复观察包装', () => {
  const result = portalAdapterFixture();
  assert.equal(result.clicked, 1);
  assert.equal(result.attempted, true);
  assert.equal(result.restored, true);
});

test('登录后停在门户 amsportal 时也会自动进入目标模块', () => {
  const result = portalAdapterFixture({ hash: '#/amsportal' });
  assert.equal(result.clicked, 1);
  assert.equal(result.attempted, true);
  assert.equal(result.restored, true);
});

test('store 入口落到门店商品列表，登录后返回该页', () => {
  const url = new URL(projectPageUrl('store'));
  assert.equal(url.pathname, '/cybercafe-store/');
  assert.equal(url.hash, '#/merchant/store/list');
  assert.equal(url.searchParams.get('__cafe_return'), '/cybercafe-store/#/merchant/store/list');

  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-store/#/merchant/store/list';
  const page = returnPage(origin + '/cybercafe-store/?__cafe_return=' + encodeURIComponent(target) + '#/login');
  page.location.hash = '/home';
  page.events.get('hashchange')();
  assert.deepEqual(page.redirects, [origin + target]);
});

test('门户校验失败、强制改密、弹窗及禁用入口不触发自动进入', () => {
  for (const options of [{ returnCode: '070008' }, { forceChangePassword: 1 }, { dialog: true }, { enabled: false }]) {
    const result = portalAdapterFixture(options);
    assert.equal(result.clicked, 0);
    assert.equal(result.attempted, false);
  }
});

function returnPage(href, values = new Map(), name = '', referrer = '', targets = {}) {
  const events = new Map();
  const redirects = [];
  class Storage {
    getItem(key) { return values.get(key) ?? null; }
    setItem(key, value) { values.set(key, String(value)); }
    removeItem(key) { values.delete(key); }
    clear() { values.clear(); }
  }
  const sessionStorage = new Storage();
  const location = new URL(href);
  location.replace = value => redirects.push(value);
  const history = {
    state: null,
    pushState(state, title, url) { location.href = new URL(url, location).href; },
    replaceState(state, title, url) { location.href = new URL(url, location).href; },
  };
  const window = { name, Storage, sessionStorage, __cafeLoginTargets: targets, setTimeout: () => 1, clearTimeout() {},
    addEventListener(type, callback) { events.set(type, callback); }, removeEventListener(type) { events.delete(type); } };
  window.top = window.self = window;
  const document = { addEventListener() {}, referrer };
  const originalClear = Storage.prototype.clear;
  vm.runInNewContext(fs.readFileSync(join(__dirname, '../features/navigation/return.js'), 'utf8'), { window, location, history, document, URL, Date });
  return { window, location, redirects, events, sessionStorage, originalClear };
}

test('登录跨页面后 window.name 丢失、会话被清理，仍返回原深链接，取消跟踪后清除临时记录', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-hub/#/enterprise/detail?id=42';
  const values = new Map([['business-token', 'old']]);
  const first = returnPage(origin + '/cybercafe-hub/?__cafe_return=' + encodeURIComponent(target) + '#/login', values);
  first.sessionStorage.clear();
  assert.equal(values.has('business-token'), false);
  assert.equal(values.has('__cafe_return_state'), true);
  const next = returnPage(origin + '/cybercafe-hub/#/login', values, '');
  assert.equal(next.window.__cafeReturn.read().url, origin + target);
  next.location.hash = '/enterprise/manage';
  next.events.get('hashchange')();
  assert.deepEqual(next.redirects, [origin + target]);
  next.window.__cafeReturn.cancel();
  assert.equal(values.has('__cafe_return_state'), false);
  assert.equal(next.window.Storage.prototype.clear, next.originalClear);
});

test('普通页面不注入回跳，过期记录不能触发跳转', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const plain = returnPage(origin + '/cybercafe-hub/#/login');
  assert.equal(plain.window.__cafeReturn, undefined);
  assert.equal(plain.window.Storage.prototype.clear, plain.originalClear);
  const values = new Map([['__cafe_return_state', JSON.stringify({ url: origin + '/cybercafe-hub/#/enterprise/detail', expiresAt: Date.now() - 1 })]]);
  const expired = returnPage(origin + '/cybercafe-hub/#/enterprise/manage', values);
  assert.equal(expired.window.__cafeReturn, undefined);
  assert.equal(values.size, 0);
  assert.deepEqual(expired.redirects, []);
});

for (const project of ['store', 'hub']) {
  test(`${project}: 工具入口后的实际业务路径随导航更新，登录后恢复最新路径及参数`, () => {
    const origin = 'https://cloudgametest2.migufun.com:18443';
    const base = `/cybercafe-${project}/`;
    const page = returnPage(origin + base + '?__cafe_return=' + encodeURIComponent(base + '#/noPower') + '#/noPower');
    page.location.hash = '/home';
    page.events.get('hashchange')();
    const expected = origin + base + '?view=compact#/merchant/store/list?page=3';
    page.location.href = expected;
    page.events.get('hashchange')();
    assert.equal(page.window.__cafeReturn.read().url, expected);
    page.location.hash = '/login';
    page.events.get('hashchange')();
    page.sessionStorage.clear();
    page.location.hash = '/home';
    page.events.get('hashchange')();
    assert.deepEqual(page.redirects, [expected]);
  });
}


test('newcms 走 CMS 登录，登录后进入 newcms 商品列表', () => {
  const url = new URL(projectPageUrl('newcms'));
  assert.equal(url.pathname, '/cybercafe-cms/');
  assert.equal(url.hash, '#/testLogin');
  assert.equal(url.searchParams.get('__cafe_return'),
    '/cybercafe-newcms/#/bercafe/product/productlist');
});

test('cms 走 CMS 登录，登录后进入 CMS 商品列表', () => {
  const url = new URL(projectPageUrl('cms'));
  assert.equal(url.pathname, '/cybercafe-cms/');
  assert.equal(url.hash, '#/testLogin');
  assert.equal(url.searchParams.get('__cafe_return'),
    '/cybercafe-cms/#/businessManagement/product/productList');
});

test('CMS 登录完成后从 cms 交接到 newcms 商品列表', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-newcms/#/bercafe/product/productlist';
  const page = returnPage(origin + '/cybercafe-cms/?__cafe_return=' + encodeURIComponent(target) + '#/testLogin');
  page.location.href = origin + '/cybercafe-cms/#/home';
  page.events.get('hashchange')();
  assert.deepEqual(page.redirects, [origin + target]);
});

test('CMS 登录后被统一门户重定向到 power/amsportal 时回到 CMS 商品列表', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-cms/#/businessManagement/product/productList';
  const page = returnPage(origin + '/cybercafe-cms/?__cafe_return=' + encodeURIComponent(target) + '#/testLogin');
  page.location.href = origin + '/cybercafe-power/#/amsportal';
  page.events.get('hashchange')();
  assert.deepEqual(page.redirects, [origin + target]);
});

test('CMS 登录后被统一门户重定向到 power/amsportal 时进入 newcms 商品列表', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-newcms/#/bercafe/product/productlist';
  const page = returnPage(origin + '/cybercafe-cms/?__cafe_return=' + encodeURIComponent(target) + '#/testLogin');
  page.location.href = origin + '/cybercafe-power/#/amsportal';
  page.events.get('hashchange')();
  assert.deepEqual(page.redirects, [origin + target]);
});


test('store 登录页丢失链接参数时按项目配置恢复', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-store/#/merchant/store/list';
  const page = returnPage(origin + '/cybercafe-power/#/amsportal', new Map(), '',
    origin + '/cybercafe-store/', { store: target });
  assert.equal(page.window.__cafeReturn.read().url, origin + target);
});

test('hub 登录页丢失链接参数时按项目配置恢复', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-hub/#/enterprise/manage';
  const page = returnPage(origin + '/cybercafe-power/#/amsportal', new Map(), '',
    origin + '/cybercafe-hub/#/enterprise/manage', { hub: target });
  assert.equal(page.window.__cafeReturn.read().url, origin + target);
});

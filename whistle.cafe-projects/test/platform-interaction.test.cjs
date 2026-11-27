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
function portalAdapterFixture({ forceChangePassword = 0, returnCode = '000000', enabled = true, dialog = false, hash = '#/freeLogin', project = 'store', targetUrl = '', buttonLabel = '门店运营模块', profile = true, polling = false, portalRoot = null, origin = 'https://cloudgametest2.migufun.com:18443' } = {}) {
  const timers = new Map();
  const listeners = new Map();
  const observed = [];
  let requests = 0;
  let nextTimer = 0;
  let clicked = 0;
  let attempted = false;
  const redirects = [];
  let cancelled = false;
  class XHR {
    open(...args) { this.args = args; return 'original'; }
    addEventListener(name, callback) { this[name] = callback; }
  }
  const originalOpen = XHR.prototype.open;
  const button = {
    textContent: buttonLabel, disabled: !enabled, hidden: false,
    getClientRects: () => [1], getAttribute: () => null,
    click() { clicked++; },
  };
  const window = {
    __cafeReturn: {
      read: () => cancelled ? null : ({ project, url: targetUrl || ('https://cloudgametest2.migufun.com:18443/cybercafe-' + project + '/#/merchant/store/list') }),
      cancel() { cancelled = true; },
      beginExchange() { if (attempted) return false; attempted = true; return true; },
    },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    ...(polling ? { fetch: async () => { requests++; return { status: 401, clone: () => ({ json: async () => ({ returnCode: '070008' }) }) }; } } : {}),
  };
  const document = {
    addEventListener() {}, removeEventListener() {},
    querySelector(selector) { return selector === '.business-portal' ? portalRoot : null; },
    querySelectorAll(selector) {
      return selector.includes('service-entry') ? [button] : dialog ? [{ hidden: false, getClientRects: () => [1] }] : [];
    },
  };
  const context = {
    window, document, XMLHttpRequest: XHR, URL,
    AbortController,
    location: { origin, pathname: '/cybercafe-power/', href: 'https://cloudgametest2.migufun.com:18443/cybercafe-power/' + hash, hash, replace: value => redirects.push(value) },
    MutationObserver: class { observe(target, options) { observed.push({ target, options }); } disconnect() {} },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearInterval(id) { timers.delete(id); },
  };
  vm.runInNewContext(fs.readFileSync(join(__dirname, '../features/navigation/portal.js'), 'utf8'), context);
  const xhr = new XHR();
  assert.equal(xhr.open('POST', '/cybercafe-ruiyun-api/cmsapi/v2/street/account/profile'), 'original');
  xhr.status = 200;
  xhr.responseType = 'json';
  xhr.response = { returnCode, resultData: { forceChangePassword } };
  if (profile) xhr.loadend?.();
  for (const [id, timer] of [...timers]) if (timer.delay === 0) { timers.delete(id); timer.callback(); }
  return { clicked, attempted, restored: XHR.prototype.open === originalOpen, redirects, timers, context, listeners, observed, requests: () => requests };
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

function returnPage(href, values = new Map(), name = '', referrer = '', targets = {}, cookie = '') {
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
  let cookieValue = cookie;
  const document = {
    addEventListener() {}, referrer,
    get cookie() { return cookieValue; },
    set cookie(value) {
      const pair = String(value).split(';')[0];
      const index = pair.indexOf('=');
      const name = index < 0 ? pair : pair.slice(0, index);
      if (name === 'cafe_project') cookieValue = pair;
    },
  };
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


test('普通 store referrer 不激活工具回跳', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-store/#/merchant/store/list';
  const page = returnPage(origin + '/cybercafe-power/#/amsportal', new Map(), '',
    origin + '/cybercafe-store/', { store: target });
  assert.equal(page.window.__cafeReturn, undefined);
});

test('普通 hub referrer 不激活工具回跳', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-hub/#/enterprise/manage';
  const page = returnPage(origin + '/cybercafe-power/#/amsportal', new Map(), '',
    origin + '/cybercafe-hub/#/enterprise/manage', { hub: target });
  assert.equal(page.window.__cafeReturn, undefined);
});


test('仅有项目 cookie 不激活工具回跳', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-store/#/merchant/store/list';
  const page = returnPage(origin + '/cybercafe-power/#/amsportal', new Map(), '', '',
    { store: target }, 'cafe_project=cybercafe-store');
  assert.equal(page.window.__cafeReturn, undefined);
});


test('open 入口登录后返回 open 实例管理页', () => {
  const url = new URL(projectPageUrl('open'));
  assert.equal(url.pathname, '/cybercafe-power/');
  assert.equal(url.hash, '#/amsportal');
  assert.equal(url.searchParams.get('__cafe_return'), '/cybercafe-open/#/resource/instance');
});

test('power 入口登录后返回 power 资源页', () => {
  const url = new URL(projectPageUrl('power'));
  assert.equal(url.pathname, '/cybercafe-power/');
  assert.equal(url.hash, '#/amsportal');
  assert.equal(url.searchParams.get('__cafe_return'), '/cybercafe-power/#/resource/system/server');
});

test('hub 未登录进入 hub/freeLogin 时转到 power/amsportal', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-hub/#/enterprise/manage';
  const page = returnPage(origin + '/cybercafe-hub/?__cafe_return=' + encodeURIComponent(target) + '#/freeLogin');
  assert.deepEqual(page.redirects, [origin + '/cybercafe-power/#/amsportal']);
});


test('power 登录后通过算力管理模块完成会话交换', () => {
  const target = 'https://cloudgametest2.migufun.com:18443/cybercafe-power/#/resource/system/server';
  const result = portalAdapterFixture({ project: 'power', targetUrl: target, hash: '#/amsportal', buttonLabel: '算力管理模块v2.0' });
  assert.equal(result.clicked, 1);
  assert.equal(result.redirects.length, 0);
});


test('service 从 power 门户启动时带项目标记，避免复用 power 标签页', () => {
  const url = new URL(projectPageUrl('service'));
  assert.equal(url.pathname, '/cybercafe-power/');
  assert.equal(url.searchParams.get('__cafe_project'), 'service');
  assert.equal(url.searchParams.get('__cafe_return'), '/cybercafe-service/#/project/view/list');
});

test('power 登录页优先按 __cafe_project 标记恢复项目配置', () => {
  const origin = 'https://cloudgametest2.migufun.com:18443';
  const target = '/cybercafe-service/#/project/view/list';
  const page = returnPage(origin + '/cybercafe-power/?__cafe_project=service#/amsportal', new Map(), '', '', {
    service: target,
  });
  assert.equal(page.window.__cafeReturn.read().url, origin + target);
});


test('profile 补查只在 power 登录入口执行，最多 40 次且不残留定时器', async () => {
  const page = portalAdapterFixture({ profile: false, polling: true });
  for (let i = 0; i < 45; i++) {
    const entry = [...page.timers].find(([, timer]) => timer.delay === 1200);
    if (!entry) break;
    page.timers.delete(entry[0]);
    await entry[1].callback();
  }
  assert.equal(page.requests(), 40);
  assert.equal([...page.timers.values()].some(timer => timer.delay === 1200 || timer.delay === 5000), false);
  page.context.location.hash = '#/resource/system/server';
  page.listeners.get('hashchange')();
  assert.equal(page.timers.size, 0);
  for (const options of [{ hash: '#/resource/system/server' }, { origin: 'https://example.com' }]) {
    const ordinary = portalAdapterFixture({ profile: false, polling: true, ...options });
    assert.equal(ordinary.requests(), 0);
    assert.equal(ordinary.timers.size, 0);
    assert.equal(ordinary.restored, true);
  }
});

test('profile 成功后立即清除补查定时器', () => {
  const page = portalAdapterFixture({ polling: true });
  assert.equal([...page.timers.values()].some(timer => timer.delay === 1200), false);
});


test('门户属性监听只覆盖门户节点，父节点仅监听直接增删', () => {
  const parent = {};
  const portal = { parentNode: parent };
  const page = portalAdapterFixture({ profile: false, portalRoot: portal });
  assert.equal(page.observed.length, 2);
  assert.equal(page.observed[0].target, portal);
  assert.equal(page.observed[0].options.attributes, true);
  assert.equal(page.observed[1].target, parent);
  assert.equal(page.observed[1].options.subtree, undefined);
  assert.equal(page.observed[1].options.attributes, undefined);
});

test('登录脚本入口仅在测试域名、顶层工具标签页载入资源', () => {
  for (const file of ['return.html', 'portal.html']) {
    const source = fs.readFileSync(join(__dirname, '../features/navigation/', file), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '');
    for (const active of [false, true]) {
      const writes = [];
      const window = { name: '' }; window.top = window.self = window;
      const location = { origin: 'https://cloudgametest2.migufun.com:18443', search: active ? '?__cafe_return=x' : '' };
      const context = { window, location, document: { write: value => writes.push(value) }, sessionStorage: { getItem: () => null } };
      vm.runInNewContext(source, context);
      assert.equal(writes.length, active ? 1 : 0);
      writes.length = 0;
      location.origin = 'https://example.com';
      vm.runInNewContext(source, context);
      assert.equal(writes.length, 0);
    }
  }
});


test('power 普通页面不轮询，之后同页跳到登录入口才启动有限补查', () => {
  const page = portalAdapterFixture({ profile: false, polling: true, hash: '#/resource/system/server' });
  assert.equal(page.timers.size, 0);
  page.context.location.hash = '#/amsportal';
  page.listeners.get('hashchange')();
  assert.equal([...page.timers.values()].filter(timer => timer.delay === 1200).length, 1);
  assert.equal(page.requests(), 0);
});

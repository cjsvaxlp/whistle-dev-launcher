const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function harness(file, extra = {}) {
  const nodes = new Map();
  function element() {
    return {
      hidden: false, disabled: false, dataset: {}, children: [], listeners: {}, classList: { toggle() {} },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      click() { if (!this.disabled) return this.listeners.click?.({ target: this }); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      querySelectorAll() { return []; },
      setAttribute() {}, removeAttribute() {}, focus() {},
    };
  }
  const document = {
    hidden: false, listeners: {},
    querySelector(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, createDocumentFragment: element,
    addEventListener(name, handler) { this.listeners[name] = handler; },
    dispatchEvent(event) { this.listeners[event.type]?.(event); },
  };
  const values = new Map();
  const context = vm.createContext({
    document, URLSearchParams, location: { search: '' },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    showTerminal() {}, focusTerminal() {}, showError() {}, showInfo() {}, reportError() {},
    setTimeout() {}, clearTimeout() {}, AbortSignal,
    ...extra,
  });
  const source = readFileSync(require.resolve(file), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
  return { context, nodes, document, values };
}

test('接管失败后的重试保留原确认弹窗，取消不会请求后台', async () => {
  let confirmations = 0;
  let requests = 0;
  const { context, nodes } = harness('../features/projects/client.mjs', {
    confirmAction: async () => { confirmations++; return false; },
    post: async () => { requests++; },
  });
  vm.runInContext("selected = 'hub'; retryAction = 'takeover';", context);
  await nodes.get('#issue-retry').click();
  assert.equal(confirmations, 1);
  assert.equal(requests, 0);
  nodes.get('#takeover').disabled = true;
  await nodes.get('#issue-retry').click();
  assert.equal(confirmations, 1);
  nodes.get('#takeover').disabled = false;
  nodes.get('#takeover').hidden = true;
  await nodes.get('#issue-retry').click();
  assert.equal(confirmations, 1);
});

test('停止失败后的重试沿用直接停止，不增加确认；安装后启动重试沿用启动入口', async () => {
  const { context, nodes } = harness('../features/projects/client.mjs');
  const actions = [];
  context.record = action => actions.push(action);
  vm.runInContext("projectAction = action => record(action); retryAction = 'stop';", context);
  await nodes.get('#issue-retry').click();
  vm.runInContext("retryAction = 'install-and-start';", context);
  await nodes.get('#issue-retry').click();
  assert.deepEqual(actions, ['stop', 'start']);
});

test('并发体检复用请求，手动打开的体检不被自动关闭', async () => {
  let resolve;
  let reads = 0;
  const { context, nodes } = harness('../features/doctor/client.mjs', {
    fetch: () => { reads++; return new Promise(done => { resolve = done; }); },
  });
  vm.runInContext('globalThis.doctor = bindDoctor({ load: async () => {} });', context);
  const concurrentRequest = context.readDoctor();
  const automatic = context.doctor.showDoctor({ auto: true });
  const manual = context.doctor.showDoctor();
  assert.equal(reads, 1);
  resolve({ ok: true, json: async () => ({ ok: true, checks: [], proxyMode: 'browser' }) });
  await Promise.all([concurrentRequest, automatic, manual]);
  assert.equal(nodes.get('#doctor-modal').hidden, false);
});

test('工作区选择器缩短路径并保留完整提示，切换沿用明确目录', async () => {
  const a = '/work/a/cybercafe-front';
  const b = '/work/b/cybercafe-front';
  let current = a;
  const calls = [];
  const directories = [a, b];
  const { context, nodes, document } = harness('../features/workspace/selector.mjs', {
    fetch: async () => ({ ok: true, json: async () => ({ current, branch: current === a ? 'feature/a' : 'hotfix/b', workspaces: directories.map(directory => ({ directory, label: 'cybercafe-front', available: true })) }) }),
  });
  context.update = async directory => {
    calls.push(['switch', directory]);
    current = directory;
    document.dispatchEvent({ type: 'cafe-projects-updated', detail: { workspace: current, projects: [] } });
    document.dispatchEvent({ type: 'cafe-workspace-saved', detail: { message: '原服务继续运行' } });
  };
  vm.runInContext('bindWorkspaceSelector({ updateWorkspace: update, showDoctor: async () => {} });', context);
  document.dispatchEvent({ type: 'cafe-projects-updated', detail: { workspace: a, projects: [] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get('#current-workspace-path').textContent, '…/a/cybercafe-front');
  assert.equal(nodes.get('#current-workspace-path').title, a);
  assert.equal(nodes.get('#current-workspace-branch').textContent, '分支：feature/a');
  assert.match(nodes.get('#workspace-select').children[1].textContent, /cybercafe-front.*\/work\/b\/cybercafe-front/);
  nodes.get('#workspace-select').value = b;
  nodes.get('#workspace-select').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get('#current-workspace-path').textContent, '…/b/cybercafe-front');
  assert.equal(nodes.get('#current-workspace-path').title, b);
  assert.equal(nodes.get('#workspace-change-note').textContent, '原服务继续运行');
  assert.equal(nodes.get('#current-workspace-branch').textContent, '分支：hotfix/b');
  assert.deepEqual(calls, [['switch', b]]);
  document.dispatchEvent({ type: 'cafe-projects-updated', detail: { workspace: b, projects: [{ installing: true }] } });
  assert.equal(nodes.get('#workspace-select').disabled, true);
  assert.equal(nodes.get('#save-workspace').disabled, true);
});

test('切换目录后的刷新等待旧请求完成，再读取新目录，普通轮询仍合并', async () => {
  const requests = [];
  const rendered = [];
  const { context } = harness('../features/projects/client.mjs', {
    fetch: () => new Promise(resolve => requests.push(resolve)),
    capture: directory => rendered.push(directory),
  });
  vm.runInContext('render = () => capture(snapshot.workspace);', context);
  const first = context.load();
  assert.equal(context.load(), first);
  const switched = context.load({ fresh: true });
  assert.equal(requests.length, 1);
  requests[0]({ ok: true, json: async () => ({ workspace: '/old', projects: [] }) });
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  requests[1]({ ok: true, json: async () => ({ workspace: '/new', projects: [] }) });
  await switched;
  assert.deepEqual(rendered, ['/old', '/new']);
});

for (const directory of [undefined, '/work/b', '/manually-entered/b']) {
  test(`目录切换取消时不保存或停止，入口：${directory || '系统选择器'}`, async () => {
    const calls = [];
    let loads = 0;
    const { context, nodes } = harness('../features/workspace/actions.mjs', {
      post: async (path, body) => { calls.push({ path, body }); return { status: 409, ok: false, json: async () => ({ action: 'confirm-switch', previousWorkspace: '/work/a', workspace: '/work/b' }) }; },
      confirmAction: async (message, options) => {
        assert.match(message, /停止.*所有服务/);
        assert.match(message, /日志会保留/);
        assert.equal(options.label, '停止并切换');
        return false;
      },
      load: async () => { loads++; },
    });
    vm.runInContext('globalThis.actions = bindWorkspaceActions({ load, showDoctor: async () => {} });', context);
    await context.actions.updateWorkspace(directory);
    assert.equal(calls.length, 1);
    assert.equal(loads, 0);
    assert.equal(nodes.get('#save-workspace').disabled, false);
    assert.equal(nodes.has('#workspace-status'), false);
  });
}

test('确认后提交明确的新旧目录；保存后不等待完整体检才释放按钮', async () => {
  const calls = [];
  const loads = [];
  let checks = 0;
  const { context, nodes } = harness('../features/workspace/actions.mjs', {
    post: async (path, body) => {
      calls.push(body && Object.fromEntries(body));
      return calls.length === 1
        ? { status: 409, ok: false, json: async () => ({ action: 'confirm-switch', previousWorkspace: '/work/a', workspace: '/work/b' }) }
        : { status: 200, ok: true, json: async () => ({ workspace: '/work/b', message: '已切换' }) };
    },
    confirmAction: async () => true,
    load: async options => { loads.push(options.fresh); },
    doctor: () => { checks++; return new Promise(() => {}); },
  });
  vm.runInContext('globalThis.actions = bindWorkspaceActions({ load, showDoctor: doctor });', context);
  context.document.querySelector('#doctor-modal').hidden = false;
  await context.actions.updateWorkspace('/work/b');
  assert.deepEqual(calls[1], { directory: '/work/b', confirmed: '1', previousWorkspace: '/work/a' });
  assert.deepEqual(loads, [true]);
  assert.equal(checks, 1);
  assert.equal(nodes.get('#save-workspace').disabled, false);
});

test('只读预览返回空响应时显示明确提示，不重复提交目录操作', async () => {
  const errors = [];
  let requests = 0;
  const { context, nodes } = harness('../features/workspace/actions.mjs', {
    post: async () => { requests++; return { status: 405, ok: false, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }; },
    showError: message => errors.push(message),
  });
  vm.runInContext('globalThis.actions = bindWorkspaceActions({ load: async () => {}, showDoctor: async () => {} });', context);
  await context.actions.updateWorkspace();
  assert.equal(requests, 1);
  assert.match(errors[0], /当前页面不支持目录操作/);
  assert.doesNotMatch(errors[0], /Unexpected end/);
  assert.equal(nodes.get('#save-workspace').disabled, false);
});

test('确认切换后响应不完整时提示先确认状态，不误报成功或自动重试', async () => {
  const errors = [];
  let requests = 0;
  let loads = 0;
  const { context } = harness('../features/workspace/actions.mjs', {
    post: async () => {
      requests++;
      return requests === 1
        ? { status: 409, ok: false, json: async () => ({ action: 'confirm-switch', workspace: '/b', previousWorkspace: '/a' }) }
        : { status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
    },
    confirmAction: async () => true,
    showError: message => errors.push(message),
    load: async () => { loads++; },
  });
  vm.runInContext('globalThis.actions = bindWorkspaceActions({ load, showDoctor: async () => {} });', context);
  await context.actions.updateWorkspace('/b');
  assert.equal(requests, 2);
  assert.equal(loads, 0);
  assert.match(errors[0], /刷新面板确认当前工作目录后再重试/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function render(overrides = {}, projectOverrides = {}, error) {
  const nodes = new Map();
  function element() { return { dataset: {}, children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } }; }
  const document = { querySelector(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element };
  const info = { active: true, browser: { confirmed: true }, ...projectOverrides };
  const context = { document, snapshot: { proxyEnabled: true, updatedAt: 'now', workspace: '/work', ...overrides }, selected: 'hub', actionErrors: new Map(error ? [['hub', error]] : []), loadError: '', busy: false, info };
  vm.createContext(context);
  const source = readFileSync(require.resolve('../features/projects/client.mjs'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function renderReadiness(info)'), source.indexOf("document.querySelector('#issue-retry').addEventListener")) + '\nrenderReadiness(info);', context);
  return nodes;
}

test('只有服务、规则和浏览器均确认时才标记测试链接已代理', () => {
  assert.equal(render().get('#readiness-steps').children[2].dataset.complete, 'true');
  for (const override of [{ stale: true }, { syncError: '同步失败' }, { proxyEnabled: false }]) {
    const nodes = render(override);
    assert.equal(nodes.get('#readiness-steps').children[2].dataset.complete, 'false');
  }
  assert.equal(render({}, { active: false }).get('#readiness-steps').children[2].dataset.complete, 'false');
});
test('启动失败保留实际原因，操作重试保留原动作', () => {
  const nodes = render({}, { active: false, startup: { stage: 'failed', message: '端口被占用，请停止占用进程' } });
  assert.equal(nodes.get('#project-issue').hidden, false);
  assert.match(nodes.get('#issue-detail').textContent, /端口被占用/);
  assert.equal(nodes.get('#issue-retry').disabled, false);
  const action = render({}, {}, { message: '停止失败', action: 'stop' });
  assert.equal(action.get('#issue-detail').textContent, '停止失败');
});
test('等待浏览器确认时保持未完成，同步错误可进入体检', () => {
  assert.equal(render({}, { browser: {} }).get('#readiness-steps').children[2].dataset.complete, 'false');
  const nodes = render({ syncError: '规则写入失败' });
  assert.equal(nodes.get('#issue-detail').textContent, '规则写入失败');
  assert.equal(nodes.get('#issue-retry').hidden, true);
});

test('主动关闭代理时不把旧同步状态显示为同步故障', () => {
  const nodes = render({ proxyEnabled: false, stale: true, syncError: '旧错误' });
  assert.equal(nodes.get('#project-issue').hidden, true);
  assert.equal(nodes.get('#readiness-steps').children[1].dataset.complete, 'false');
});

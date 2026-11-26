const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, '../shared/http/client.mjs'), 'utf8').replace(/^export /gm, '');
function setup(dialog) {
  const context = vm.createContext({
    document: { querySelector: selector => selector.startsWith('meta') ? { content: 'test' } : dialog },
    window: { confirm: () => { throw new Error('WebView native confirmation must not be called'); } },
  });
  vm.runInContext(source, context);
  return context;
}
function createDialog() {
  return {
    open: false, returnValue: '', fields: {}, listeners: {},
    querySelector(selector) { return this.fields[selector] ||= {}; },
    addEventListener(event, listener) { this.listeners[event] = listener; },
    showModal() { this.open = true; },
    close(value) { this.returnValue = value; this.open = false; this.listeners.close(); },
  };
}
test('embedded terminal confirms through its dialog without a desktop flag', async () => {
  const dialog = createDialog(), context = setup(dialog);
  const choice = context.confirmAction('停止服务？', { title: '停止服务', label: '停止' });
  assert.equal(dialog.open, true);
  assert.equal(dialog.fields['#confirm-message'].textContent, '停止服务？');
  assert.equal(context.confirmAction('重复操作'), false);
  dialog.close('confirm');
  assert.equal(await choice, true);
});
test('cancelling the page dialog does not confirm the service action', async () => {
  const dialog = createDialog(), context = setup(dialog);
  const choice = context.confirmAction('停止服务？');
  dialog.close('cancel');
  assert.equal(await choice, false);
});

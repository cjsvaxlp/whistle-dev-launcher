const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('proxy mode defaults to browser, authenticates changes and persists independently of project preferences', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cafe-proxy-mode-'));
  process.env.CAFE_STATE_DIR = directory;
  t.after(() => { delete process.env.CAFE_STATE_DIR; rmSync(directory, { recursive: true, force: true }); });
  const { token } = require('../shared/http/http.cjs');
  const { modeSnapshot, setMode } = require('../features/system-proxy/mode.cjs');
  const response = { writeHead(code) { this.code = code; }, end(body) { this.body = JSON.parse(body); } };
  assert.equal(modeSnapshot().mode, 'browser');
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
});

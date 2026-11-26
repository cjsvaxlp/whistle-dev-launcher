const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const capability = JSON.parse(readFileSync(
  join(__dirname, '../../desktop/capabilities/panel-drag.json'), 'utf8'));

test('window controls accept the IPC Origin without a page path and reject other origins', () => {
  // IPC sends an Origin header, not the full panel URL. Keep this fixture
  // origin-only so both native IPC transports can match it.
  const allows = origin => capability.remote.urls.includes(origin);
  assert.equal(allows(new URL('http://127.0.0.1:8899/plugin.cafe-projects/').origin), true);
  for (const origin of [
    'http://127.0.0.1:8898', 'http://localhost:8899',
    'https://127.0.0.1:8899', 'https://cloudgametest2.migufun.com:18443',
  ]) assert.equal(allows(origin), false, origin);
  assert.deepEqual(capability.windows, ['panel']);
  assert.equal(capability.local, false);
  assert.ok(capability.permissions.includes('core:window:allow-start-dragging'));
});

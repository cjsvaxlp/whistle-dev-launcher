const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { findWorkspace, isWorkspace } = require('../features/workspace/discover.cjs');

test('finds a cybercafe-front workspace under the common Desktop work path', () => {
  const home = mkdtempSync(join(tmpdir(), 'cafe-workspace-'));
  try {
    const workspace = join(home, 'Desktop', 'work', 'cloudgame-cybercafe', 'cybercafe-front');
    mkdirSync(join(workspace, 'cybercafe-hub'), { recursive: true });
    writeFileSync(join(workspace, 'cybercafe-hub', 'package.json'), '{}');
    assert.equal(isWorkspace(workspace), true);
    assert.equal(findWorkspace({ home }), workspace);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('does not report a directory without cybercafe child projects', () => {
  const home = mkdtempSync(join(tmpdir(), 'cafe-workspace-empty-'));
  try {
    const empty = join(home, 'Desktop', 'work', 'cloudgame-cybercafe', 'cybercafe-front');
    mkdirSync(join(empty, 'not-a-project'), { recursive: true });
    assert.equal(isWorkspace(empty), false);
    assert.equal(findWorkspace({ home }), '');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

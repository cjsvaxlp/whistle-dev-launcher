const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { delimiter, join } = require('node:path');
const test = require('node:test');
const { nodeRuntime, runtimePath, installPolicy, installInvocation } = require('../features/runtime/runtime.cjs');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cafe-runtime-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('uses the current Node only when both the pin and engines match', t => {
  const directory = fixture(t);
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ engines: { node: process.version } }));
  assert.deepEqual(nodeRuntime(directory), { node: process.execPath, version: process.version });
  writeFileSync(join(directory, '.node-version'), '0.0.1\n');
  assert.throws(() => nodeRuntime(directory), /找不到满足/);
});

test('finds an installed compatible Node on PATH', { skip: process.platform === 'win32' }, t => {
  const directory = fixture(t);
  const previousPath = process.env.PATH;
  t.after(() => { process.env.PATH = previousPath; });
  process.env.PATH = directory + delimiter + previousPath;
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ engines: { node: '^99.19.0 || >=100.12.0' } }));
  writeFileSync(join(directory, 'node'), '#!/bin/sh\nprint_version() { printf "v99.20.2\\n"; }\nprint_version\n', { mode: 0o755 });
  const runtime = nodeRuntime(directory);
  assert.deepEqual(runtime, { node: join(directory, 'node'), version: 'v99.20.2' });
  assert.equal(runtimePath(runtime).split(delimiter)[0], directory);
});

test('honors a declared pnpm and explains the fallback for a mismatched lockfile', t => {
  const directory = fixture(t);
  writeFileSync(join(directory, 'package.json'), '{"packageManager":"pnpm@10.12.4"}');
  writeFileSync(join(directory, 'package-lock.json'), '{}');
  const fallback = installPolicy(directory);
  assert.equal(fallback.manager, 'npm');
  assert.match(fallback.notice, /pnpm@10.12.4.*package-lock.json/);
  writeFileSync(join(directory, 'pnpm-lock.yaml'), '');
  const policy = installPolicy(directory);
  assert.equal(policy.manager, 'pnpm');
  assert.equal(policy.notice, '');
  const win = process.platform === 'win32';
  const corepack = join(directory, win ? 'corepack.cmd' : 'corepack');
  writeFileSync(corepack, '');
  const invocation = installInvocation({ node: join(directory, win ? 'node.exe' : 'node'), version: 'v20.20.2' }, policy);
  assert.deepEqual(invocation, { command: corepack, args: ['pnpm', 'install', '--prefer-offline', '--frozen-lockfile'] });
});

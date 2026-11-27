const { readFileSync, writeFileSync, mkdirSync, renameSync } = require('node:fs');
const { join } = require('node:path');
const { stateDir } = require('../workspace/store.cjs');
const { authorized, json } = require('../../shared/http/http.cjs');
const modeFile = join(stateDir, 'proxy-mode');
const browserOptionFile = join(stateDir, 'browser-proxy-enabled');
function modeSnapshot() {
  let mode = process.platform === 'darwin' ? 'system' : 'browser';
  let browserEnabled = false;
  try { const saved = readFileSync(modeFile, 'utf8').trim(); if (['system', 'browser'].includes(saved)) mode = saved; } catch {}
  try { browserEnabled = readFileSync(browserOptionFile, 'utf8').trim() === '1'; } catch {}
  let status = null;
  try { status = JSON.parse(readFileSync(join(stateDir, 'proxy-mode-status.json'), 'utf8')); } catch {}
  return { mode, browserEnabled, status, supported: process.platform === 'darwin' };
}
function setMode(request, response, mode) {
  if (!authorized(request)) return json(response, 403, { message: '请从本机面板操作。' });
  if (!['system', 'browser'].includes(mode)) return json(response, 400, { message: '代理模式无效。' });
  if (mode === 'system' && process.platform !== 'darwin') return json(response, 409, { message: '自动系统代理模式目前仅支持 macOS 桌面端。' });
  saveMode(mode);
  json(response, 200, modeSnapshot());
}
function saveMode(mode) {
  mkdirSync(stateDir, { recursive: true });
  const temporary = modeFile + '.tmp';
  writeFileSync(temporary, mode + '\n', { mode: 0o600 });
  renameSync(temporary, modeFile);
  const statusFile = join(stateDir, 'proxy-mode-status.json');
  const pending = statusFile + '.tmp';
  writeFileSync(pending, JSON.stringify({ mode: null, error: null, pending: true, message: '正在切换代理' }));
  renameSync(pending, statusFile);
}
function saveBrowserOption(enabled) {
  const temporary = browserOptionFile + '.tmp';
  writeFileSync(temporary, enabled ? '1\n' : '0\n', { mode: 0o600 });
  renameSync(temporary, browserOptionFile);
}
function setBrowserOption(request, response, enabled) {
  if (!authorized(request)) return json(response, 403, { message: '请从本机面板操作。' });
  mkdirSync(stateDir, { recursive: true });
  if (!enabled) {
    // Write the mode intent before hiding its control; the desktop restores/applies PAC.
    if (process.platform === 'darwin') saveMode('system');
    saveBrowserOption(false);
    return json(response, 200, modeSnapshot());
  }
  saveBrowserOption(true);
  json(response, 200, modeSnapshot());
}
module.exports = { modeSnapshot, setMode, setBrowserOption };

const { readFileSync, writeFileSync, mkdirSync, renameSync } = require('node:fs');
const { join } = require('node:path');
const { stateDir } = require('../workspace/store.cjs');
const { authorized, json } = require('../../shared/http/http.cjs');
const modeFile = join(stateDir, 'proxy-mode');
function modeSnapshot() {
  let mode = 'browser';
  try { if (readFileSync(modeFile, 'utf8').trim() === 'system') mode = 'system'; } catch {}
  let status = null;
  try { status = JSON.parse(readFileSync(join(stateDir, 'proxy-mode-status.json'), 'utf8')); } catch {}
  return { mode, status, supported: process.platform === 'darwin' };
}
function setMode(request, response, mode) {
  if (!authorized(request)) return json(response, 403, { message: '请从本机面板操作。' });
  if (!['system', 'browser'].includes(mode)) return json(response, 400, { message: '代理模式无效。' });
  if (mode === 'system' && process.platform !== 'darwin') return json(response, 409, { message: '自动系统代理模式目前仅支持 macOS 桌面端。' });
  mkdirSync(stateDir, { recursive: true });
  const temporary = modeFile + '.tmp';
  writeFileSync(temporary, mode + '\n', { mode: 0o600 });
  renameSync(temporary, modeFile);
  const statusFile = join(stateDir, 'proxy-mode-status.json');
  const pending = statusFile + '.tmp';
  writeFileSync(pending, JSON.stringify({ mode: null, error: null, pending: true, message: '正在切换代理' }));
  renameSync(pending, statusFile);
  json(response, 200, modeSnapshot());
}
module.exports = { modeSnapshot, setMode };

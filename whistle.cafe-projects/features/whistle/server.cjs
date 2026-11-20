const { prepareSystemProxyShutdown } = require('../system-proxy/shutdown.cjs');
const { spawn } = require('node:child_process');
const { closeSync, existsSync, mkdirSync, openSync } = require('node:fs');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');
const { origin, ruleName, logsDir, isWindows } = require('../../shared/config/config.cjs');
const { json, authorized } = require('../../shared/http/http.cjs');


function whistleCli() {
  const candidates = [];
  try {
    if (require.main && require.main.filename) {
      candidates.push(join(dirname(require.main.filename), '..', '..', 'bin', 'whistle.js'));
    }
  } catch {
    // 忽略
  }
  candidates.push(join(dirname(process.execPath), '..', 'lib', 'node_modules', 'whistle', 'bin', 'whistle.js'));
  candidates.push(join(dirname(process.execPath), '..', 'lib', 'node_modules', 'w2', 'bin', 'whistle.js'));
  if (isWindows) {
    candidates.push(join(dirname(process.execPath), 'node_modules', 'whistle', 'bin', 'whistle.js'));
  }
  return candidates.find(candidate => existsSync(candidate)) || '';
}

async function prepareProxyShutdown() {
  const cli = whistleCli();
  if (!cli) throw new Error('找不到 Whistle CLI，无法自动停止代理。');
  await prepareSystemProxyShutdown();
  const log = join(logsDir, 'whistle-stop.log');
  mkdirSync(logsDir, { recursive: true });
  return () => {
    const fd = openSync(log, 'a');
    try {
      const child = spawn(process.execPath, [cli, 'stop'], {
        detached: true, stdio: ['ignore', fd, fd], cwd: homedir(), windowsHide: true,
      });
      child.on('error', error => console.error(error));
      child.unref();
    } finally {
      closeSync(fd);
    }
  };
}

async function getRule(response) {
  try {
    const upstream = await fetch(
      `${origin}/cgi-bin/rules/value?name=${encodeURIComponent(ruleName)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    const data = await upstream.json();
    json(response, 200, {
      name: ruleName,
      value: data && data.value ? data.value.value : null,
      selected: Boolean(data && data.value && data.value.selected),
    });
  } catch {
    json(response, 503, { message: '无法读取 Whistle 规则。' });
  }
}

async function restartWhistle(request, response) {
  if (!authorized(request)) {
    json(response, 403, { message: '请从本机 Whistle 面板操作。' });
    return;
  }
  const cliPath = whistleCli();
  if (!cliPath) {
    json(response, 503, { message: '找不到 Whistle CLI，请手动执行 w2 restart。' });
    return;
  }
  json(response, 200, { message: '正在重启 Whistle…' });
  setTimeout(() => {
    let fd;
    try {
      mkdirSync(logsDir, { recursive: true });
      fd = openSync(join(logsDir, 'whistle-restart.log'), 'a');
      const binDir = dirname(process.execPath);
      const child = spawn(process.execPath, [cliPath, 'restart'], {
        detached: true,
        stdio: ['ignore', fd, fd],
        cwd: homedir(),
        env: {
          ...process.env,
          PATH: [binDir, process.env.PATH].filter(Boolean).join(isWindows ? ';' : ':'),
        },
        windowsHide: true,
      });
      child.on('error', () => {});
      child.unref();
    } catch {
      // 失败了页面会提示手动重启。
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }, 400);
}

module.exports = { getRule, restartWhistle, prepareProxyShutdown };

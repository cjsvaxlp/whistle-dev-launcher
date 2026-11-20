const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { execFile, spawn } = require('node:child_process');
const { closeSync, existsSync, mkdirSync, openSync } = require('node:fs');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');
const { origin, ruleName, logsDir, isWindows, POWERSHELL, tools, stateDir, pacFile } = require('../../shared/config/config.cjs');
const { json, authorized } = require('../../shared/http/http.cjs');

const run = promisify(execFile);

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

const managedPAC = new Set([
  'http://127.0.0.1:18899/cybercafe.pac',
  pathToFileURL(pacFile).href,
]);

async function disableMacSystemProxy() {
  const networksetup = '/usr/sbin/networksetup';
  const call = async (...args) => (await run(networksetup, args, { timeout: 5000 })).stdout;
  const result = await call('-listallnetworkservices');
  const services = result.trim().split(/\r?\n/).slice(1).map(line => line.replace(/^\*/, ''));
  for (const service of services) {
    const pac = await call('-getautoproxyurl', service);
    const pacUrl = pac.match(/^URL:\s*(.+)$/m)?.[1].trim();
    if (/^Enabled: Yes$/m.test(pac) && managedPAC.has(pacUrl)) {
      await call('-setautoproxystate', service, 'off');
    }
    for (const kind of ['web', 'secureweb', 'socksfirewall']) {
      const settings = await call('-get' + kind + 'proxy', service);
      if (/^Enabled: Yes$/m.test(settings)
        && /^Server: (?:127\.0\.0\.1|localhost)$/m.test(settings)
        && /^Port: 8899$/m.test(settings)) {
        await call('-set' + kind + 'proxystate', service, 'off');
      }
    }
  }
}

async function closeMacDeveloperChrome() {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const profiles = [join(tools, 'Chrome开发配置'), join(stateDir, 'Chrome开发配置')];
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,command='], { timeout: 3000, env: { ...process.env, LC_ALL: 'en_US.UTF-8' } });
  const processes = stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(.*)$/));
  for (const match of processes) {
    if (!match || !match[2].startsWith(chrome + ' ')) continue;
    const args = match[2] + ' ';
    if (!args.includes(' --proxy-server=http://127.0.0.1:8899 ')
      || !profiles.some(profile => args.includes(' --user-data-dir=' + profile + ' '))) continue;
    try {
      process.kill(Number(match[1]), 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

async function disableWindowsProxy() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'",
    '$settings = Get-ItemProperty -LiteralPath $key',
    "if ($env:CAFE_MANAGED_PAC -split '\\|' -contains $settings.AutoConfigURL) { Remove-ItemProperty -LiteralPath $key -Name AutoConfigURL }",
    "if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer -match '^(127\\.0\\.0\\.1|localhost):8899$') { Set-ItemProperty -LiteralPath $key -Name ProxyEnable -Value 0 }",
    "$profileArg = [regex]::Escape('--user-data-dir=' + $env:CAFE_CHROME_PROFILE)",
    "$processes = Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\"",
    "$processes | Where-Object { $_.CommandLine -match ('(?:^|[\\s\"] )'.Replace(' ', '') + $profileArg + '(?:[\\s\"]|$)') -and $_.CommandLine -match '--proxy-server=http://127\\.0\\.0\\.1:8899(?:[\\s\"]|$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }",
  ].join('\n');
  await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    timeout: 10000,
    windowsHide: true,
    env: {
      ...process.env,
      CAFE_MANAGED_PAC: [...managedPAC].join('|'),
      CAFE_CHROME_PROFILE: join(stateDir, 'Chrome开发配置'),
    },
  });
}

async function prepareProxyShutdown() {
  const cli = whistleCli();
  if (!cli) throw new Error('找不到 Whistle CLI，无法自动停止代理。');
  if (isWindows) {
    await disableWindowsProxy();
  } else if (process.platform === 'darwin') {
    await disableMacSystemProxy();
    await closeMacDeveloperChrome();
  }
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

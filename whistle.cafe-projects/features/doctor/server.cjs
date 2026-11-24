const { proxyChecks } = require('./proxy-checks.cjs');
const { modeSnapshot } = require('../system-proxy/mode.cjs');
const { browserStatus } = require('../proxy/browser-status.cjs');
const { pacBody, pacUrl } = require('../system-proxy/pac.cjs');
const { execFile, execFileSync } = require('node:child_process');
const { randomBytes, X509Certificate } = require('node:crypto');
const { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } = require('node:fs');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { pluginDir, isWindows, POWERSHELL, readWorkspace, stateDir, origin, ruleName, pacFile } = require('../../shared/config/config.cjs');
const { listProjects, readState } = require('../projects/store.cjs');
const { depInfo, windowsCommand } = require('../terminal/launcher.cjs');
const { runSync } = require('../projects/server.cjs');
const { json, authorized } = require('../../shared/http/http.cjs');
const run = promisify(execFile);

function npmCliPath() {
  const candidate = join(dirname(process.execPath), isWindows ? 'npm.cmd' : 'npm');
  return existsSync(candidate) ? candidate : 'npm';
}

function globalPluginTarget() {
  try {
    const npm = npmCliPath();
    const args = ['root', '-g'];
    const root = execFileSync(isWindows ? POWERSHELL : npm, isWindows ? windowsCommand(npm, args) : args, {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
    }).trim();
    return root ? join(root, 'whistle.cafe-projects') : '';
  } catch {
    return '';
  }
}

function pluginLinkCheck() {
  if (existsSync(join(dirname(pluginDir), '.installed'))) {
    return { status: 'ok', detail: '已加载安装包内置的插件' };
  }
  const target = globalPluginTarget();
  if (!target) {
    return { status: 'unknown', detail: '无法定位全局 node_modules', action: '' };
  }
  try {
    if (realpathSync(target) === realpathSync(pluginDir)) {
      return { status: 'ok', detail: target, action: '' };
    }
    return {
      status: 'warn', detail: '链接指向 ' + realpathSync(target),
      action: '重新链接到当前工具目录', fix: 'link-plugin',
    };
  } catch {
    return existsSync(target)
      ? { status: 'warn', detail: '全局位置已有同名目录', action: '检查并重新链接', fix: 'link-plugin' }
      : { status: 'warn', detail: '未链接到全局 node_modules', action: '自动创建链接', fix: 'link-plugin' };
  }
}

async function legacyRuleNames() {
  try {
    const response = await fetch(`${origin}/cgi-bin/rules/list2`, { signal: AbortSignal.timeout(2500) });
    const list = await response.json();
    return Object.keys(list).filter(name => name && name !== 'Default' && name !== ruleName
      && (/→ 本地$/.test(name) || name.startsWith('Cafe 自动代理：')));
  } catch {
    return [];
  }
}

async function withWhistleCA(use) {
  const response = await fetch(origin + '/cgi-bin/rootca', {
    redirect: 'error', signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('无法读取当前 Whistle 的 CA。');
  const cert = new X509Certificate(Buffer.from(await response.arrayBuffer()));
  if (!cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey)) {
    throw new Error('Whistle 返回的证书不是自签名根 CA。');
  }
  const directory = await mkdtemp(join(tmpdir(), 'cafe-ca-'));
  try {
    const file = join(directory, 'whistle.cer');
    await writeFile(file, cert.raw);
    return await use(file, cert);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function caTrusted(file, cert) {
  try {
    if (isWindows) {
      const fingerprint = cert.fingerprint.replaceAll(':', '');
      const { stdout } = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
        `Test-Path Cert:\\CurrentUser\\Root\\${fingerprint}; Test-Path Cert:\\LocalMachine\\Root\\${fingerprint}`,
      ], { timeout: 5000, windowsHide: true });
      return /^True$/im.test(stdout.trim());
    }
    await run('/usr/bin/security', ['verify-cert', '-l', '-L', '-p', 'ssl', '-c', file], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function doctor() {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    id: 'node', label: 'Node 版本', status: major >= 20 ? 'ok' : 'fail',
    detail: process.versions.node, action: major >= 20 ? '' : '升级到 Node 20+',
  });
  const workspace = readWorkspace();
  checks.push({
    id: 'workspace', label: '项目工作区', status: existsSync(workspace) ? 'ok' : 'fail',
    detail: workspace || '尚未选择目录', action: existsSync(workspace) ? '' : '在面板选择目录',
  });
  const link = pluginLinkCheck();
  checks.push({ id: 'plugin', label: '插件链接', ...link });

  const ca = { id: 'ca', label: 'Whistle CA' };
  try {
    if (!isWindows && process.platform !== 'darwin') throw new Error('请在 Whistle 的 HTTPS 页面查看信任状态。');
    const trusted = await withWhistleCA(caTrusted);
    checks.push({ ...ca, status: trusted ? 'ok' : 'warn',
      detail: trusted ? '当前 Whistle CA 已受系统信任' : '当前 Whistle CA 尚未受系统信任',
      fix: trusted ? '' : 'install-ca' });
  } catch (error) {
    checks.push({ ...ca, status: 'warn', detail: error.message, fix: 'open-ca' });
  }

  const modeConfig = modeSnapshot();
  const mode = modeConfig.mode;
  if (!modeConfig.status?.pending && modeConfig.status?.error) checks.push({ id: 'proxy-mode', label: '代理模式切换', status: 'warn', detail: modeConfig.status.error });
  if (mode === 'browser') {
    const state = readState();
    const confirmed = Object.keys(state?.projects || {}).filter(project => browserStatus(state, project).confirmed);
    checks.push(...proxyChecks(mode, { confirmed }));
  } else {
    let proxy = { status: 'unknown', detail: '当前系统未做检测', fix: 'write-pac' };
    if (process.platform === 'darwin') {
      try {
        const { stdout } = await run('scutil', ['--proxy'], { timeout: 2000 });
        const setting = name => stdout.match(new RegExp('^\\s*' + name + '\\s*:\\s*(.+)$', 'm'))?.[1].trim();
        const localProxy = setting('HTTPSEnable') === '1'
          && ['127.0.0.1', 'localhost'].includes(setting('HTTPSProxy')) && setting('HTTPSPort') === '8899';
        const usingPAC = setting('ProxyAutoConfigEnable') === '1'
          && (setting('ProxyAutoConfigURLString') === pacUrl
            || (setting('ProxyAutoConfigURLString') === pathToFileURL(pacFile).href && existsSync(pacFile)));
        proxy = localProxy || usingPAC
          ? { status: 'ok', detail: usingPAC ? '已启用本工具生成的 PAC' : 'HTTPS 代理为本机 Whistle' }
          : {
              status: 'warn',
              detail: 'Whistle 代理尚未生效',
              action: '把测试域名代理到 127.0.0.1:8899',
              fix: 'write-pac',
            };
      } catch {
        proxy = { status: 'unknown', detail: '无法读取系统代理设置', fix: 'write-pac' };
      }
    }
    delete proxy.fix;
    if (proxy.status !== 'ok') {
      proxy.action = '选择 Whistle 代理并允许 macOS 网络设置授权。';
    }
    checks.push(...proxyChecks(mode, { systemProxy: proxy }));
  }

  try {
    const response = await fetch(
      `${origin}/cgi-bin/rules/value?name=${encodeURIComponent(ruleName)}`,
      { signal: AbortSignal.timeout(2500) },
    );
    const data = await response.json();
    const selected = Boolean(data && data.value && data.value.selected);
    checks.push({
      id: 'rule', label: 'Whistle 规则', status: selected ? 'ok' : 'warn',
      detail: ruleName + (selected ? '（已启用）' : '（未启用）'),
      action: selected ? '' : '立即同步一次',
      fix: selected ? '' : 'sync',
    });
  } catch {
    checks.push({
      id: 'rule', label: 'Whistle 规则', status: 'fail', detail: '读取失败',
      action: '确认 Whistle 在 127.0.0.1:8899 运行',
    });
  }

  const legacy = await legacyRuleNames();
  if (legacy.length) {
    checks.push({
      id: 'legacy', label: '旧规则', status: 'warn',
      detail: `存在 ${legacy.length} 条旧规则：${legacy.join('、')}`,
      action: '删除后只保留「Cafe 自动代理」', fix: 'clean-legacy',
    });
  }

  const notReady = listProjects().filter(name => depInfo(name).status !== 'ready');
  checks.push({
    id: 'deps', label: '项目依赖', status: notReady.length ? 'warn' : 'ok',
    detail: notReady.length ? `${notReady.length} 个项目未就绪：${notReady.join('、')}` : '全部就绪',
    action: notReady.length ? '用面板里的「安装依赖」处理' : '',
  });

  return { proxyMode: mode, checks, ok: checks.every(check => check.status === 'ok' || check.status === 'unknown') };
}

async function fix(request, response, action) {
  if (!authorized(request)) {
    json(response, 403, { message: '请从本机 Whistle 面板操作。' });
    return;
  }
  try {
    if (action === 'sync') {
      if (!readWorkspace()) {
        json(response, 409, { message: '请先选择项目工作区。' });
        return;
      }
      const ok = await runSync();
      json(response, ok ? 200 : 503, { message: ok ? '已同步。' : '同步失败，稍后会自动重试。' });
      return;
    }
    if (action === 'open-ca') {
      const target = origin + '/#https';
      if (isWindows) await run('cmd', ['/c', 'start', '', target]);
      else await run(process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', [target]);
      json(response, 200, { message: '已打开 Whistle 的 HTTPS 页面，请按页面提示安装并信任证书。' });
      return;
    }
    if (action === 'install-ca' && (isWindows || process.platform === 'darwin')) {
      await withWhistleCA(async (file, cert) => {
        if (await caTrusted(file, cert)) return;
        if (isWindows) {
          await run('certutil.exe', ['-user', '-addstore', 'Root', file], { timeout: 60000, windowsHide: true });
        } else {
          await run('/usr/bin/security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', file], { timeout: 60000 });
        }
        if (!(await caTrusted(file, cert))) throw new Error('证书已提交给系统，请在系统证书设置中确认信任。');
      });
      json(response, 200, { message: '当前 Whistle CA 已受系统信任。' });
      return;
    }
    if (action === 'write-pac') {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(pacFile, pacBody);
      json(response, 200, {
        message: `PAC 已生成。请将 ${pacUrl} 填入系统或浏览器的自动代理配置，保存后重新体检。`,
        path: pacFile,
      });
      return;
    }
    if (action === 'link-plugin') {
      const target = globalPluginTarget();
      if (!target) throw new Error('无法定位全局 node_modules（npm root -g 失败）。');
      const existing = lstatSync(target, { throwIfNoEntry: false });
      if (existing) {
        try {
          if (realpathSync(target) === realpathSync(pluginDir)) {
            json(response, 200, { message: '当前已经是这个工具目录的链接。' });
            return;
          }
        } catch {
          // 继续报冲突
        }
        if (!existing.isSymbolicLink()) throw new Error('全局位置已有同名目录，请手动处理：' + target);
        const temporary = target + '.' + randomBytes(4).toString('hex');
        symlinkSync(pluginDir, temporary, isWindows ? 'junction' : 'dir');
        try {
          renameSync(temporary, target);
        } finally {
          if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
        }
      } else {
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(pluginDir, target, isWindows ? 'junction' : 'dir');
      }
      json(response, 200, { message: '已创建插件链接，重启 Whistle 后生效。' });
      return;
    }
    if (action === 'clean-legacy') {
      const names = await legacyRuleNames();
      let removed = 0;
      for (const name of names) {
        const res = await fetch(origin + '/cgi-bin/rules/remove', {
          method: 'POST',
          body: new URLSearchParams({ name }),
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        if (data && data.ec === 0) removed += 1;
      }
      json(response, removed === names.length ? 200 : 502, {
        message: `已删除 ${removed}/${names.length} 条旧规则。`, removed,
      });
      return;
    }
    json(response, 404, { message: '不支持的修复动作。' });
  } catch (error) {
    json(response, 500, { message: error.message });
  }
}

module.exports = { doctor, fix };

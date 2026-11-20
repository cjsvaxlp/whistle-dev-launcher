#!/usr/bin/env node
// 把本地开发服务同步到 Whistle：生成一条托管规则，并写出面板/徽标共用的状态文件。
// 由插件定期调用，错误显示在面板上。
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import workspaceConfig from '../workspace/store.cjs';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const isWindows = process.platform === 'win32';
const here = dirname(fileURLToPath(import.meta.url));
const { stateDir, readWorkspace, workspaceId, isLocalProxyEnabled } = workspaceConfig;
const whistleOrigin = process.env.CAFE_WHISTLE_ORIGIN || 'http://127.0.0.1:8899';
const stateFile = join(stateDir, 'state.json');

const HOST = 'cloudgametest2.migufun.com:18443';
const RULE_NAME = 'Cafe 自动代理';
const MARKER = '# cafe-tools managed: cafe-auto-proxy';
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe');
const BADGE_HTML = join(here, '../badge/badge.html');
const BADGE_JS = join(here, '../badge/badge.js');
const BADGE_CSS = join(here, '../badge/badge.css');
const PROJECT_RE = /^cybercafe-[a-z0-9-]+$/;
const prefixOf = project => `/cybercafe-${project}/`;

// Whistle 的 file/htmlAppend 会把 `协议://` 之后的部分当作路径：
// macOS 绝对路径以 / 开头，正好拼成 file:///Users/...；Windows 需要 file://C:/...。
export function ruleUrl(protocol, file, platform = process.platform) {
  const path = platform === 'win32' ? file.replaceAll('\\', '/') : file;
  return `${protocol}://${encodeURI(path)}`;
}

export function listProjects(dir = readWorkspace()) {
  if (!dir) throw new Error('请先在面板选择项目工作区。');
  if (!existsSync(dir)) {
    throw new Error(`找不到项目工作区：${dir}，请在面板选择目录。`);
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && PROJECT_RE.test(entry.name)
      && existsSync(join(dir, entry.name, 'package.json')))
    .map(entry => entry.name.slice('cybercafe-'.length))
    .sort();
}

export function parseListeners(stdout) {
  const listeners = [];
  let pid = null;
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (line[0] === 'p') {
      pid = line.slice(1);
    } else if (pid && line[0] === 'n') {
      const match = /^(.*):(\d+)$/.exec(line.slice(1));
      if (!match || !/^(?:127\.0\.0\.1|\[::1\]|\*)$/.test(match[1])) continue;
      const port = Number(match[2]);
      if (port > 0 && port <= 65535) listeners.push({ pid, port });
    }
  }
  return listeners;
}

export function engineOf(directory) {
  if (!existsSync(directory)) return null;
  if (existsSync(join(directory, 'vite.config.js')) || existsSync(join(directory, 'vite.config.ts'))) {
    return 'vite';
  }
  if (existsSync(join(directory, 'build/webpack.dev.conf.js'))) return 'webpack';
  return null;
}

function windowsScript(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export async function windowsListeners() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ports = @(Get-NetTCPConnection -State Listen | Where-Object {
  $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::')
})
$result = @()
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
  $proc = $_
  if (-not $proc.CommandLine) { return }
  foreach ($item in $ports) {
    if ($item.OwningProcess -eq $proc.ProcessId) {
      $result += [pscustomobject]@{
        pid = $proc.ProcessId
        port = $item.LocalPort
        commandLine = $proc.CommandLine
      }
    }
  }
}
ConvertTo-Json -InputObject @($result) -Compress
`;
  const { stdout } = await run(POWERSHELL, [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', windowsScript(script),
  ], { windowsHide: true, timeout: 12000 });
  const rows = JSON.parse(stdout.trim() || '[]');
  return Array.isArray(rows) ? rows : [rows];
}

function windowsCli(project, engine, workspace) {
  const directory = join(workspace, `cybercafe-${project}`);
  const name = engine === 'vite' ? 'vite' : 'webpack';
  const bin = engine === 'vite' ? 'vite.js' : 'webpack.js';
  try {
    const pkg = require.resolve(name + '/package.json', { paths: [directory] });
    return join(dirname(pkg), 'bin', bin);
  } catch {
    return join(directory, 'node_modules', name, 'bin', bin);
  }
}

export async function detectWindows(projects, workspace = readWorkspace()) {
  const locals = {};
  const compat = {};
  const unmatched = {};
  const candidates = [];
  for (const project of projects) {
    const engine = engineOf(join(workspace, `cybercafe-${project}`));
    if (!engine) continue;
    const cli = windowsCli(project, engine, workspace).replaceAll('\\', '/').toLowerCase();
    candidates.push({ project, engine, cli });
  }
  const rows = await windowsListeners();
  for (const row of rows) {
    const commandLine = String(row.commandLine || '').replaceAll('\\', '/').toLowerCase();
    const port = Number(row.port);
    if (!port) continue;
    for (const candidate of candidates) {
      if (!commandLine.includes(candidate.cli)) continue;
      if (locals[candidate.project]) continue;
      const served = await servesProject(port, candidate.project, candidate.engine);
      if (served === null) continue;
      if (served) {
        locals[candidate.project] = { port, engine: candidate.engine, pid: row.pid };
        delete compat[candidate.project];
        delete unmatched[candidate.project];
      } else if (candidate.engine === 'vite' && await rootServesVite(port)) {
        if (!compat[candidate.project]) compat[candidate.project] = { port, engine: candidate.engine, pid: row.pid };
      } else if (!unmatched[candidate.project]) {
        unmatched[candidate.project] = { port, engine: candidate.engine, pid: row.pid };
      }
    }
  }
  return { locals, compat, unmatched };
}

export async function listeningPorts() {
  try {
    const { stdout } = await run(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof', ['-nP', '-a', '-c', 'node', '-iTCP', '-sTCP:LISTEN', '-Fpn'], {
      timeout: 5000,
    });
    return parseListeners(stdout);
  } catch (error) {
    if (error.code === 1 && !error.stderr?.trim() && !error.stdout?.trim()) return [];
    throw new Error(`扫描本地监听端口失败：${error.stderr?.trim() || error.message}`);
  }
}

async function cwdOf(pid) {
  try {
    const { stdout } = await run(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { timeout: 3000 });
    for (const line of stdout.split('\n')) {
      if (line[0] === 'n' && line.length > 1) return resolve(line.slice(1));
    }
  } catch {
    // 进程在两次扫描之间退出。
  }
  return null;
}

async function rootServesVite(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes('@vite/client');
  } catch {
    return false;
  }
}

async function servesProject(port, project, engine) {
  const prefix = prefixOf(project);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${prefix}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const html = await response.text();
    if (engine === 'vite') return html.includes(`${prefix}@vite/client`);
    return html.includes('<script') && html.includes(prefix);
  } catch {
    return null;
  }
}

// 返回 { locals, compat, unmatched }：
// locals 是带前缀的实例；compat 是 base=/ 的 Vite 实例（用代理改写接管）；
// unmatched 是目录对、端口在、但既不是可识别 Vite 也无法接管的候选。
export async function detectLocals(projects, workspace = readWorkspace()) {
  if (isWindows) return detectWindows(projects, workspace);
  const listeners = await listeningPorts();
  if (!listeners.length) return { locals: {}, compat: {}, unmatched: {} };
  const cwds = new Map();
  const locals = {};
  const compat = {};
  const unmatched = {};
  for (const project of projects) {
    const directory = resolve(workspace, `cybercafe-${project}`);
    const engine = engineOf(directory);
    if (!engine) continue;
    let local = null;
    let compatCandidate = null;
    let mismatch = null;
    for (const listener of listeners) {
      if (!cwds.has(listener.pid)) cwds.set(listener.pid, await cwdOf(listener.pid));
      if (cwds.get(listener.pid) !== directory) continue;
      const served = await servesProject(listener.port, project, engine);
      if (served === null) continue;
      if (served) {
        local = { port: listener.port, engine, pid: listener.pid };
        break;
      }
      if (!mismatch) mismatch = { port: listener.port, engine, pid: listener.pid };
      if (engine === 'vite' && !compatCandidate && await rootServesVite(listener.port)) {
        compatCandidate = { port: listener.port, engine, pid: listener.pid };
      }
    }
    if (local) locals[project] = local;
    else if (compatCandidate) compat[project] = compatCandidate;
    else if (mismatch) unmatched[project] = mismatch;
  }
  return { locals, compat, unmatched };
}

// 注意：Whistle 会把 /.../ 形式的 key 当成正则，所以这里都带上引号或括号做字面量替换。
const COMPAT_REPLACEMENTS = {
  '"/@vite/': '"/cybercafe-项目/@vite/',
  "'/@vite/": "'/cybercafe-项目/@vite/",
  '(/@vite/': '(/cybercafe-项目/@vite/',
  '"/src/': '"/cybercafe-项目/src/',
  "'/src/": "'/cybercafe-项目/src/",
  '(/src/': '(/cybercafe-项目/src/',
  '"/node_modules/': '"/cybercafe-项目/node_modules/',
  "'/node_modules/": "'/cybercafe-项目/node_modules/",
  '(/node_modules/': '(/cybercafe-项目/node_modules/',
  '"/@fs/': '"/cybercafe-项目/@fs/',
  "'/@fs/": "'/cybercafe-项目/@fs/",
  '"/@id/': '"/cybercafe-项目/@id/',
  "'/@id/": "'/cybercafe-项目/@id/",
  'const base = "/"': 'const base = "/cybercafe-项目/"',
};

export function compatReplacements(project) {
  return Object.fromEntries(Object.entries(COMPAT_REPLACEMENTS).map(
    ([from, to]) => [from, to.replaceAll('cybercafe-项目', `cybercafe-${project}`)],
  ));
}

export function buildRule(projects, locals, compat = {}) {
  const lines = [
    MARKER,
    '# 由 cafe-tools 自动同步，请勿手动编辑。',
    `${HOST} enable://capture`,
    `${HOST}/__cafe/badge.js ${ruleUrl('file', BADGE_JS)}`,
    `${HOST}/__cafe/badge.css ${ruleUrl('file', BADGE_CSS)}`,
    `${HOST}/__cafe/state.json ${ruleUrl('file', stateFile)}`,
  ];
  for (const project of projects) {
    lines.push(`${HOST}${prefixOf(project)} ${ruleUrl('htmlAppend', BADGE_HTML)}`);
  }
  for (const project of Object.keys(locals)) {
    const { port, engine } = locals[project];
    lines.push(`# local: cybercafe-${project} → 127.0.0.1:${port} (${engine})`);
    lines.push(`${HOST}${prefixOf(project)} http://127.0.0.1:${port}${prefixOf(project)} reqHeaders://host=127.0.0.1:${port}`);
    if (engine === 'webpack') {
      lines.push(`wss://${HOST}${prefixOf(project)}__hmr ws://127.0.0.1:${port}/ws`);
    }
  }
  for (const project of Object.keys(compat)) {
    const { port } = compat[project];
    lines.push(`# compat: cybercafe-${project} → 127.0.0.1:${port} (base /)`);
    lines.push(`${HOST}${prefixOf(project)} http://127.0.0.1:${port}/ reqHeaders://host=127.0.0.1:${port}`);
    lines.push(`${HOST}${prefixOf(project)} ${ruleUrl('resReplace', compatFile(project))}`);
    lines.push(`wss://${HOST}${prefixOf(project)} ws://127.0.0.1:${port}/`);
  }
  return lines.join('\n');
}

const compatFile = project => join(stateDir, `compat-${project}.json`);

async function writeCompatFiles(compat) {
  if (!Object.keys(compat).length) return;
  await mkdir(stateDir, { recursive: true });
  for (const project of Object.keys(compat)) {
    await writeFile(compatFile(project), JSON.stringify(compatReplacements(project), null, 2) + '\n');
  }
}

function unreachable() {
  return new Error(`无法连接 Whistle（${whistleOrigin}），请确认代理已启动。`);
}

async function readRule() {
  let response;
  try {
    response = await fetch(
      `${whistleOrigin}/cgi-bin/rules/value?name=${encodeURIComponent(RULE_NAME)}`,
      { signal: AbortSignal.timeout(3000) },
    );
  } catch {
    throw unreachable();
  }
  if (!response.ok) throw new Error(`Whistle 未响应（HTTP ${response.status}），请确认代理已启动。`);
  const data = await response.json();
  return data && data.value ? data.value : null;
}

async function writeRule(value, enabled) {
  const action = enabled ? 'select' : 'unselect';
  let response;
  try {
    response = await fetch(`${whistleOrigin}/cgi-bin/rules/${action}`, {
      method: 'POST',
      body: new URLSearchParams({ name: RULE_NAME, value }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw unreachable();
  }
  if (!response.ok) throw new Error(`写入 Whistle 规则失败（HTTP ${response.status}）。`);
  const data = await response.json();
  if (data.ec !== 0) throw new Error('写入 Whistle 规则失败，请打开规则页面查看。');
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

async function writeState(workspace, locals, compat, unmatched, proxyEnabled) {
  const prior = await readState();
  const now = new Date().toISOString();
  const projects = {};
  const merged = { ...locals, ...compat };
  for (const project of Object.keys(merged).sort()) {
    const { port, engine } = merged[project];
    const previous = prior && prior.projects && prior.projects[project];
    const keepSince = previous && previous.port === port && previous.engine === engine && previous.since;
    projects[project] = {
      port,
      engine,
      prefix: prefixOf(project),
      since: keepSince ? previous.since : now,
    };
    if (merged[project].pid) projects[project].pid = merged[project].pid;
    if (compat[project]) projects[project].compat = true;
  }
  const state = { workspaceId: workspaceId(workspace), updatedAt: now, rule: RULE_NAME, ruleSelected: proxyEnabled, proxyEnabled, projects };
  if (Object.keys(unmatched).length) state.unmatched = unmatched;
  await mkdir(stateDir, { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n');
  await rename(temporary, stateFile);
  return state;
}

export async function sync(workspace = readWorkspace()) {
  const projects = listProjects(workspace);
  const { locals, compat, unmatched } = await detectLocals(projects, workspace);
  const proxyEnabled = isLocalProxyEnabled();
  if (proxyEnabled) await writeCompatFiles(compat);
  const body = buildRule(projects, locals, compat);
  const current = await readRule();
  if (current && typeof current.value === 'string' && !current.value.startsWith(MARKER)) {
    throw new Error(`Whistle 里已有同名规则「${RULE_NAME}」，但不是本工具生成的；请改名或删除后重试。`);
  }
  if (proxyEnabled && (!current || current.value !== body || !current.selected)) {
    await writeRule(body, true);
  } else if (!proxyEnabled && current?.selected) {
    await writeRule(current.value, false);
  }
  return writeState(workspace, locals, compat, unmatched, proxyEnabled);
}

async function main() {
  try {
    await sync();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}

const { execFile, spawn } = require('node:child_process');
const { existsSync, realpathSync } = require('node:fs');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { openLog } = require('../run-log.cjs');
const { pluginDir, readWorkspace, ruleName, entryUrl, isWindows, POWERSHELL } = require('./config.cjs');
const { listProjects, readState, readPrefs, writePrefs, stateEntry } = require('./project-store.cjs');
const { archiveNames, logPath, prepareLog } = require('./logs.cjs');
const { depInfo, cliFor, windowsCommand, openTerminal } = require('./terminal.cjs');
const { authorized, json } = require('./http.cjs');
const { nodeRuntime, runtimePath, installPolicy, installInvocation } = require('./runtime.cjs');
const {
  beginStartup, waitForService, failStartup, observeStartup, startupSnapshot,
  hasPendingStartup, hasWaitingStartup, clearStartup,
} = require('./startup.cjs');
const run = promisify(execFile);

const SYNC_INTERVAL = 10000;
const STALE_AFTER = 30000;
const jobs = new Map();
const operations = new Set();

function snapshot() {
  const state = readState();
  const prefs = readPrefs();
  const updatedAt = state && state.updatedAt;
  const age = updatedAt ? Date.now() - Date.parse(updatedAt) : Infinity;
  const projects = listProjects().map(name => {
    const local = state && state.projects && state.projects[name];
    const unmatched = state && state.unmatched && state.unmatched[name];
    const job = jobs.get(name);
    const startup = startupSnapshot(name);
    return {
      name,
      url: 'https://cloudgametest2.migufun.com:18443/cybercafe-' + name + '/',
      active: Boolean(local),
      port: local ? local.port : null,
      engine: local ? local.engine : null,
      since: local ? local.since : null,
      compat: Boolean(local && local.compat),
      canStop: Boolean((local || unmatched)?.pid),
      launching: startup?.stage === 'starting' || startup?.stage === 'waiting',
      startup,
      unmatched: !local && unmatched ? { port: unmatched.port } : null,
      deps: depInfo(name),
      installing: Boolean(job && job.status === 'running'),
      installStatus: job ? job.status : null,
      favorite: prefs.favorites.includes(name),
      recentAt: prefs.recent[name] || null,
      log: existsSync(logPath(name)) || archiveNames(name).length > 0,
    };
  });
  return {
    workspace: readWorkspace(),
    syncError,
    updatedAt: updatedAt || null,
    stale: !(age <= STALE_AFTER),
    rule: ruleName,
    entryUrl,
    projects,
  };
}

function startInstall(project, launchAfter, attempt, runtime) {
  const existing = jobs.get(project);
  if (existing && existing.status === 'running') {
    return { error: '这个项目正在安装依赖。' };
  }
  const directory = join(readWorkspace(), 'cybercafe-' + project);
  const policy = installPolicy(directory);
  const { command, args } = installInvocation(runtime, policy);
  attempt.notice = policy.notice;
  const file = prepareLog(project);
  attempt.logFile = file;
  const log = openLog(file);
  log.append(`[Node ${runtime.version}] ${runtime.node}\n`);
  if (policy.notice) log.append(policy.notice + '\n');
  log.append(`$ ${command} ${args.join(' ')}\n`);
  const env = {
    ...process.env,
    PATH: runtimePath(runtime),
    COREPACK_ENABLE_AUTO_PIN: '0',
  };
  const child = spawn(isWindows ? POWERSHELL : command, isWindows ? windowsCommand(command, args) : args, {
    cwd: directory,
    env,
    windowsHide: true,
  });
  const job = { status: 'running', type: 'install', startedAt: Date.now() };
  const append = data => {
    try {
      log.append(data);
    } catch {
      // 忽略写日志失败
    }
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', error => {
    job.message = error.message;
    append(`\n${error.message}\n`);
  });
  child.on('close', async code => {
    append('\n[install exit ' + code + ']\n');
    if (code === 0 && launchAfter) {
      try {
        await launchAfterInstall(project, attempt, runtime);
      } catch (error) {
        job.message = error.message;
        append('\n[启动失败] ' + error.message + '\n');
      }
    }
    if (code !== 0 || job.message) {
      job.message ||= '依赖安装失败（退出状态 ' + (code ?? '已中止') + '）。';
      failStartup(attempt, job.message);
    } else if (!launchAfter) {
      attempt.stage = 'installed';
      attempt.message = '依赖安装完成，可以启动服务。';
    }
    log.close();
    job.status = code === 0 && !job.message ? 'done' : 'failed';
    const timer = setTimeout(() => {
      if (jobs.get(project) === job) jobs.delete(project);
    }, 60000);
    timer.unref();
  });
  jobs.set(project, job);
  return { message: policy.notice || `开始安装依赖（${policy.manager}，Node ${runtime.version}）…` };
}

async function pidMatches(entry, project) {
  const pid = Number(entry.pid);
  if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid) return false;
  const directory = realpathSync(join(readWorkspace(), 'cybercafe-' + project));
  if (isWindows) {
    const { windowsListeners } = await import(pathToFileURL(syncScript).href);
    const cli = cliFor(directory, entry.engine === 'vite').replaceAll('\\', '/').toLowerCase();
    return (await windowsListeners()).some(row => Number(row.pid) === pid && Number(row.port) === entry.port
      && (String(row.commandLine).replaceAll('\\', '/').toLowerCase().match(/"[^"]*"|[^\s"]+/g) || [])
        .some(arg => arg.replace(/^"|"$/g, '') === cli));
  }
  try {
    const { stdout } = await run('lsof', ['-nP', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000 });
    if (!stdout.split('\n').includes('n' + directory)) return false;
    const port = Number(entry.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    await run('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP:' + port, '-sTCP:LISTEN'], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function stopProject(project) {
  const entry = stateEntry(project);
  if (!entry || !entry.pid) throw new Error('没有找到这个项目正在运行的进程。');
  if (!(await pidMatches(entry, project))) {
    throw new Error('进程归属校验失败（可能已经退出），已取消停止。');
  }
  try {
    process.kill(entry.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw new Error('停止失败：' + error.message);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      process.kill(entry.pid, 0);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('服务在 5 秒内未退出，请查看项目日志。');
}

function isProjectBusy(project) {
  return operations.has(project) || jobs.get(project)?.status === 'running' || hasPendingStartup(project);
}

async function launchProject(project, attempt, runtime) {
  attempt.stage = 'starting';
  attempt.logFile = prepareLog(project);
  const log = openLog(attempt.logFile);
  try {
    log.append(`[Node ${runtime.version}] ${runtime.node}\n`);
    await openTerminal(project, attempt.logFile, attempt.id, runtime);
  } catch (error) {
    log.append('[启动失败] ' + error.message + '\n');
    throw error;
  } finally {
    log.close();
  }
  waitForService(attempt);
  const prefs = readPrefs();
  prefs.recent[project] = Date.now();
  writePrefs(prefs);
  scheduleSync(1000);
}

async function launchAfterInstall(project, attempt, runtime) {
  if (depInfo(project).status === 'missing') throw new Error('安装完成后仍未找到开发依赖。');
  await runSync();
  const entry = stateEntry(project);
  if (entry && await pidMatches(entry, project)) throw new Error('项目已有运行中的服务。');
  await launchProject(project, attempt, runtime);
}

// 插件自己按节奏同步规则和状态；在进程内调用，避免每 5 秒起一个 node 子进程。
const syncScript = join(pluginDir, 'sync.mjs');
let syncInFlight;
let syncTimer;
let syncError = null;

function runSync() {
  if (syncInFlight) return syncInFlight;
  const workspace = readWorkspace();
  if (!workspace) return Promise.resolve(false);
  const scanStartedAt = Date.now();
  syncInFlight = import(pathToFileURL(syncScript).href)
    .then(module => module.sync(workspace))
    .then(state => {
      if (readWorkspace() !== workspace) return false;
      syncError = null;
      observeStartup(state, scanStartedAt);
      return true;
    })
    .catch(error => {
      if (readWorkspace() !== workspace) return false;
      syncError = error.message;
      observeStartup(null, scanStartedAt);
      return false;
    })
    .finally(() => { syncInFlight = null; });
  return syncInFlight;
}

function scheduleSync(delay) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    await runSync();
    scheduleSync(hasWaitingStartup() ? 2000 : SYNC_INTERVAL);
  }, delay);
  syncTimer.unref();
}

scheduleSync(1500);

async function projectAction(request, response, action, project) {
  if (request.method !== 'POST' || !authorized(request)) {
    json(response, 403, { message: '请从本机 Whistle 面板操作。' });
    return;
  }
  if (!listProjects().includes(project)) {
    json(response, 404, { message: '项目不存在。' });
    return;
  }
  const lifecycle = action !== 'favorite' && action !== 'touch';
  if (lifecycle) {
    if (isProjectBusy(project)) {
      json(response, 409, { message: '项目正在处理启动、停止或安装操作，请稍候。' });
      return;
    }
    operations.add(project);
  }
  let attempt;
  try {
    if (action === 'favorite') {
      const prefs = readPrefs();
      prefs.favorites = prefs.favorites.includes(project)
        ? prefs.favorites.filter(name => name !== project)
        : [...prefs.favorites, project];
      writePrefs(prefs);
      json(response, 200, { favorite: prefs.favorites.includes(project) });
      return;
    }
    if (action === 'touch') {
      const prefs = readPrefs();
      prefs.recent[project] = Date.now();
      writePrefs(prefs);
      json(response, 200, { ok: true });
      return;
    }
    if (action === 'stop') {
      await runSync();
      await stopProject(project);
      await runSync();
      clearStartup(project);
      json(response, 200, { message: '已停止本地服务。' });
      return;
    }
    if (action === 'start' && depInfo(project).status === 'missing') {
      json(response, 409, { message: '项目缺少开发依赖。', action: 'install' });
      return;
    }
    await runSync();
    const entry = stateEntry(project);
    const restarting = action === 'restart-service' || action === 'takeover';
    if (!restarting && entry && await pidMatches(entry, project)) {
      json(response, 409, { message: '项目正在运行，请先停止本地服务。' });
      return;
    }
    if (action === 'install' || action === 'install-and-start') {
      const runtime = nodeRuntime(join(readWorkspace(), 'cybercafe-' + project));
      if (action === 'install-and-start' && depInfo(project).status !== 'missing') {
        attempt = beginStartup(project, 'starting');
        attempt.nodeVersion = runtime.version;
        await launchProject(project, attempt, runtime);
        json(response, 200, { message: '依赖已就绪，启动命令已提交。' });
        return;
      }
      attempt = beginStartup(project, 'installing');
      attempt.nodeVersion = runtime.version;
      const result = startInstall(project, action === 'install-and-start', attempt, runtime);
      json(response, result.error ? 409 : 200, result.error ? { message: result.error } : result);
      return;
    }
    const deps = depInfo(project);
    if (deps.status === 'missing') {
      json(response, 409, { message: '项目缺少开发依赖。', action: 'install' });
      return;
    }
    const runtime = nodeRuntime(join(readWorkspace(), 'cybercafe-' + project));
    if (restarting) {
      await stopProject(project);
      await runSync();
    }
    attempt = beginStartup(project, 'starting');
    attempt.nodeVersion = runtime.version;
    await launchProject(project, attempt, runtime);
    json(response, 200, { message: '启动命令已提交，服务就绪后会自动接管。' });
  } catch (error) {
    if (attempt) failStartup(attempt, error.message);
    json(response, 503, { message: error.code === 'ENOENT'
      ? '无法读取项目工作区，请检查 CAFE_WORKSPACE。'
      : error.message });
  } finally {
    if (lifecycle) operations.delete(project);
  }
}

async function refreshWorkspace() {
  syncError = null;
  await syncInFlight;
  scheduleSync(0);
}

module.exports = { refreshWorkspace, snapshot, projectAction, runSync, jobs, isProjectBusy };

const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { readWorkspace, isWindows, POWERSHELL } = require('../../shared/config/config.cjs');
const { openLog } = require('../logs/run-log.cjs');
const { prepareLog } = require('../logs/store.cjs');
const { windowsCommand } = require('../terminal/launcher.cjs');
const { runtimePath, installPolicy, installInvocation } = require('../runtime/runtime.cjs');
const { failStartup } = require('../startup/startup.cjs');

const jobs = new Map();

function startInstall(project, launchAfter, attempt, runtime, launchAfterInstall) {
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

module.exports = { jobs, startInstall };

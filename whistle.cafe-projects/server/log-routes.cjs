const { execFileSync } = require('node:child_process');
const { createReadStream } = require('node:fs');
const { join } = require('node:path');
const { json } = require('./http.cjs');
const { archiveDir, archiveNames, logPath, listLogRuns, clearLogs, logWriterPid, readLog, diagnose } = require('./logs.cjs');
const { jobs, isProjectBusy } = require('./projects.cjs');
const { isWindows } = require('./config.cjs');
const { startupSnapshot } = require('./startup.cjs');

async function getLog(response, url, project) {
  let file = logPath(project);
  const run = url.searchParams.get('run');
  if (run && run !== 'current') {
    if (!archiveNames(project).includes(run)) {
      json(response, 404, { message: '日志不存在。' });
      return;
    }
    file = join(archiveDir, run);
  }
  if (url.searchParams.get('download') === '1') {
    const stream = createReadStream(file);
    stream.once('open', () => {
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + (run && run !== 'current' ? run : project + '.log') + '"',
      });
      stream.pipe(response);
    });
    stream.on('error', () => {
      if (response.headersSent) response.destroy();
      else json(response, 404, { message: '日志不可下载。' });
    });
    response.once('close', () => stream.destroy());
    return;
  }
  const search = (url.searchParams.get('q') || '').slice(0, 200).toLowerCase();
  const { lines, count } = readLog(file, search);
  const job = !run || run === 'current' ? jobs.get(project) : null;
  json(response, 200, {
    project,
    run: run && run !== 'current' ? run : 'current',
    runs: listLogRuns(project),
    lines,
    count,
    diagnostics: search ? [] : diagnose(lines.join('\n')),
    startup: !run || run === 'current' ? startupSnapshot(project) : null,
    job: job ? { status: job.status, type: job.type, startedAt: job.startedAt, message: job.message } : null,
  });
}

function isRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function liveLogWriter(project) {
  const pid = logWriterPid(project);
  if (!isRunning(pid)) return { pid: null, verified: false };
  if (isWindows) return { pid, verified: false };
  const expected = logPath(project);
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8', timeout: 2000, windowsHide: true,
    });
    const ours = command.includes('run-log.cjs') && command.includes(expected);
    return ours ? { pid, verified: true } : { pid: null, verified: false };
  } catch {
    // 某些环境里 ps 不可用，用 pgrep 再确认一次是不是日志进程。
  }
  try {
    const list = execFileSync('pgrep', ['-fl', 'run-log.cjs'], {
      encoding: 'utf8', timeout: 2000, windowsHide: true,
    });
    const matched = list.split('\n').some(line => line.startsWith(pid + ' ') && line.includes(expected));
    return matched ? { pid, verified: true } : { pid: null, verified: false };
  } catch {
    // 看不到进程信息时保守处理：保留当前日志。
    return { pid, verified: false };
  }
}

async function clearProjectLogs(response, project) {
  const writer = liveLogWriter(project);
  let keptCurrent = isProjectBusy(project);
  let cleared = false;
  if (writer.pid) {
    keptCurrent = true;
    if (writer.verified) {
      try {
        process.kill(writer.pid, 'SIGUSR1');
        cleared = true;
        // 给日志进程一点时间把文件截断，避免面板紧接着刷新时还看到旧内容。
        await new Promise(resolve => setTimeout(resolve, 80));
      } catch {
        // 发不了信号就保留当前日志。
      }
    }
  }
  const { removed, failed } = clearLogs(project, keptCurrent);
  if (!keptCurrent && !failed) jobs.delete(project);
  const notes = [];
  if (removed) notes.push(`已清理 ${removed} 份日志`);
  if (failed) notes.push(`${failed} 份清理失败`);
  if (cleared) notes.push('当前日志已清空');
  else if (keptCurrent) notes.push('当前日志使用中，已保留');
  if (!notes.length) notes.push('没有可清理的日志');
  json(response, failed ? 503 : 200, { removed, keptCurrent, cleared, message: notes.join('，') + '。' });
}

module.exports = { getLog, clearProjectLogs };

const { createReadStream, existsSync, unlinkSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { isWindows } = require('./config.cjs');
const { setTimeout: delay } = require('node:timers/promises');
const { json } = require('./http.cjs');
const { archiveDir, archiveNames, logPath, listLogRuns, clearLogs, readLog, diagnose, isRunning, liveLogWriter } = require('./logs.cjs');
const { jobs, isProjectBusy } = require('./projects.cjs');
const { stateEntry } = require('./project-store.cjs');
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
  const writer = liveLogWriter(project);
  const entry = stateEntry(project);
  const source = writer.pid ? 'panel'
    : isRunning(Number(entry?.pid)) ? 'external' : 'none';
  json(response, 200, {
    project,
    run: run && run !== 'current' ? run : 'current',
    source,
    pid: entry?.pid || null,
    runs: listLogRuns(project),
    lines,
    count,
    diagnostics: search ? [] : diagnose(lines.join('\n')),
    startup: !run || run === 'current' ? startupSnapshot(project) : null,
    job: job ? { status: job.status, type: job.type, startedAt: job.startedAt, message: job.message } : null,
  });
}

async function clearWindowsLog(project, pid) {
  const request = logPath(project) + '.clear-' + pid;
  if (!existsSync(request + '.ready')) return false;
  try {
    writeFileSync(request, '1', { flag: 'wx' });
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(100);
    if (!existsSync(request)) return true;
  }
  try {
    unlinkSync(request);
  } catch {
    return !existsSync(request);
  }
  return false;
}

async function clearProjectLogs(response, project) {
  const writer = liveLogWriter(project);
  let keptCurrent = isProjectBusy(project);
  let cleared = false;
  if (writer.pid) {
    keptCurrent = true;
    if (isWindows) {
      cleared = await clearWindowsLog(project, writer.pid);
    } else if (writer.canSignal) {
      try {
        process.kill(writer.pid, 'SIGUSR1');
        cleared = true;
        // 给日志进程一点时间把文件截断，避免面板紧接着刷新时还看到旧内容。
        await delay(80);
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

const { createReadStream } = require('node:fs');
const { join } = require('node:path');
const { json } = require('./http.cjs');
const { archiveDir, archiveNames, logPath, listLogRuns, clearLogs, logWriterPid, readLog, diagnose } = require('./logs.cjs');
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

function clearProjectLogs(response, project) {
  const keptCurrent = isProjectBusy(project)
    || isRunning(Number(stateEntry(project)?.pid))
    || isRunning(logWriterPid(project));
  const { removed, failed } = clearLogs(project, keptCurrent);
  if (!keptCurrent && !failed) jobs.delete(project);
  const notes = [
    removed ? `已清理 ${removed} 份日志` : '没有可清理的日志',
    failed ? `${failed} 份清理失败` : '',
    keptCurrent ? '当前日志使用中，已保留' : '',
  ].filter(Boolean);
  json(response, failed ? 503 : 200, { removed, keptCurrent, message: notes.join('，') + '。' });
}

module.exports = { getLog, clearProjectLogs };

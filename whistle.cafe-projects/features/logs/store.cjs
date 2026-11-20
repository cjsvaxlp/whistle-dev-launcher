const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const {
  closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { MAX_SIZE } = require('./run-log.cjs');
const { logsDir, isWindows } = require('../../shared/config/config.cjs');
const archiveDir = join(logsDir, 'archive');

function logPath(project) {
  const file = project === 'whistle-restart' ? 'whistle-restart.project.log' : project + '.log';
  return join(logsDir, file);
}

function archiveNames(project, strict = false) {
  const pattern = new RegExp('^' + project + '-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9-]+Z(?:-[a-f0-9]+)?\\.log$');
  try {
    return readdirSync(archiveDir).filter(name => pattern.test(name)).sort().reverse();
  } catch (error) {
    if (strict && error.code !== 'ENOENT') throw error;
    return [];
  }
}

function prepareLog(project) {
  mkdirSync(logsDir, { recursive: true });
  const file = logPath(project);
  if (existsSync(file) && statSync(file).size > 0) {
    mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    renameSync(file, join(archiveDir, `${project}-${stamp}-${randomBytes(4).toString('hex')}.log`));
    for (const name of archiveNames(project).slice(5)) unlinkSync(join(archiveDir, name));
  }
  writeFileSync(file, '');
  return file;
}

function listLogRuns(project) {
  const runs = [{ name: 'current', at: null, size: 0 }];
  try {
    runs[0].at = statSync(logPath(project)).mtimeMs;
    runs[0].size = statSync(logPath(project)).size;
  } catch {
    // 没有当前日志
  }
  try {
    for (const name of archiveNames(project)) {
      const info = statSync(join(archiveDir, name));
      runs.push({ name, at: info.mtimeMs, size: info.size });
    }
  } catch {
    // 没有归档
  }
  return runs;
}

function clearLogs(project, keepCurrent) {
  const files = archiveNames(project, true).map(name => join(archiveDir, name));
  const current = logPath(project);
  if (!keepCurrent) files.push(current);
  let removed = 0;
  let failed = 0;
  for (const file of files) {
    try {
      unlinkSync(file);
      removed++;
    } catch (error) {
      if (error.code !== 'ENOENT') failed++;
    }
  }
  if (!keepCurrent && !existsSync(current)) {
    try {
      unlinkSync(current + '.pid');
    } catch {
      // The writer marker may already be absent.
    }
  }
  return { removed, failed };
}

function logWriterPid(project) {
  try {
    return Number(readFileSync(logPath(project) + '.pid', 'utf8'));
  } catch {
    return null;
  }
}

function readLog(file, search, tailBytes = 400000) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const { size } = fstatSync(fd);
    const bom = Buffer.alloc(2);
    readSync(fd, bom, 0, bom.length, 0);
    const utf16 = bom[0] === 0xff && bom[1] === 0xfe;
    const data = Buffer.alloc(Math.min(size, search ? MAX_SIZE : tailBytes));
    const length = readSync(fd, data, 0, data.length, size - data.length);
    const lines = data.toString(utf16 ? 'utf16le' : 'utf8', 0, length).replace(/^\uFEFF/, '').split(/\r?\n/);
    if (size > data.length) lines.shift();
    const matches = search ? lines.filter(line => line.toLowerCase().includes(search)) : lines;
    return { lines: matches.slice(-240), count: matches.length };
  } catch {
    return { lines: [], count: 0 };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const DIAGNOSTICS = [
  { re: /EADDRINUSE|address already in use/i, text: '端口被占用', action: '换端口，或先停掉占用该端口的进程' },
  { re: /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve import|Cannot resolve dependency/i, text: '缺少依赖', action: '点「安装依赖」' },
  { re: /Unsupported engine|requires Node|Node\.js .*version|EBADENGINE/i, text: 'Node 版本不匹配', action: '升级或切换 Node 版本' },
  { re: /command not found|ENOENT[^\n]*node|不是内部或外部命令/i, text: '找不到 node/npm', action: '检查 PATH，在终端确认 node -v' },
  { re: /SyntaxError|Transform failed|Pre-transform error|failed to load config/i, text: '代码或配置有语法错误', action: '看日志定位文件' },
];

function diagnose(text) {
  return DIAGNOSTICS.filter(item => item.re.test(text)).map(item => ({ text: item.text, action: item.action }));
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
  if (!isRunning(pid)) return { pid: null, canSignal: false };
  if (isWindows) return { pid, canSignal: false };
  const expected = logPath(project);
  if (!existsSync(expected + '.signal')) {
    return { pid, canSignal: false };
  }
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8', timeout: 2000, windowsHide: true,
    });
    const ours = command.includes('run-log.cjs') && command.includes(expected);
    return { pid, canSignal: ours };
  } catch {
    // 某些环境里 ps 不可用，用 pgrep 再确认一次是不是日志进程。
  }
  try {
    const list = execFileSync('pgrep', ['-fl', 'run-log.cjs'], {
      encoding: 'utf8', timeout: 2000, windowsHide: true,
    });
    const matched = list.split('\n').some(line => line.startsWith(pid + ' ') && line.includes(expected));
    return { pid, canSignal: matched };
  } catch {
    // 看不到进程信息时保守处理。
    return { pid, canSignal: false };
  }
}

module.exports = {
  archiveDir, logPath, archiveNames, prepareLog, listLogRuns, clearLogs, logWriterPid,
  readLog, diagnose, isRunning, liveLogWriter,
};

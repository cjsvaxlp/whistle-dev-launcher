const { randomUUID } = require('node:crypto');
const { readLog, diagnose } = require('./logs.cjs');

const STARTUP_TIMEOUT = 45000;
const attempts = new Map();
const PROGRESS = {
  installing: '正在安装依赖…',
  starting: '正在打开终端…',
  waiting: '终端已打开，正在等待本地服务和 Whistle 接管…',
};

function beginStartup(project, stage) {
  const attempt = { id: randomUUID(), stage, logFile: null };
  attempts.set(project, attempt);
  return attempt;
}

function waitForService(attempt) {
  attempt.stage = 'waiting';
  attempt.waitingSince = Date.now();
}

function failStartup(attempt, message) {
  attempt.stage = 'failed';
  attempt.message = message;
}

function checkStartup(attempt, now) {
  if (attempt.stage !== 'waiting') return;
  const { lines } = readLog(attempt.logFile, '', 8192);
  const exit = lines.find(line => line.startsWith('[cafe-launch ' + attempt.id + ' exit '));
  if (exit) {
    const detail = diagnose(lines.join('\n'))[0];
    failStartup(attempt, detail
      ? detail.text + '。' + detail.action + '。'
      : '本地服务在接管前已退出（' + exit.split(' ').at(-1).slice(0, -1) + '）。');
  } else if (now - attempt.waitingSince >= STARTUP_TIMEOUT) {
    failStartup(attempt, attempt.syncFailed
      ? '等待 Whistle 同步超时。请检查代理状态，或点击「立即同步」。'
      : '45 秒内未检测到可接管的本地服务。请查看本次日志。');
    attempt.timedOut = true;
  }
}

function observeStartup(state, scanStartedAt) {
  for (const [project, attempt] of attempts) {
    if (attempt.stage !== 'waiting' && !attempt.timedOut) continue;
    if (attempt.waitingSince > scanStartedAt) continue;
    attempt.syncFailed = !state;
    if (!state) continue;
    if (state.projects[project]) {
      attempt.stage = 'ready';
      attempt.message = 'Whistle 已接管本地服务。';
      attempt.timedOut = false;
    } else if (state.unmatched?.[project]) {
      failStartup(attempt, '本地服务已监听，但 Whistle 无法接管。请检查启动路径或使用「接管并重启」。');
      attempt.timedOut = false;
    }
  }
}

function startupSnapshot(project) {
  const attempt = attempts.get(project);
  if (!attempt) return null;
  checkStartup(attempt, Date.now());
  const message = [attempt.message ?? PROGRESS[attempt.stage],
    attempt.stage === 'installing' ? attempt.notice : ''].filter(Boolean).join(' ');
  return {
    stage: attempt.stage,
    message: attempt.nodeVersion ? `Node ${attempt.nodeVersion} · ${message}` : message,
    hasLog: Boolean(attempt.logFile),
  };
}

function hasPendingStartup(project) {
  return ['installing', 'starting', 'waiting'].includes(startupSnapshot(project)?.stage);
}

function hasWaitingStartup() {
  for (const [project, attempt] of attempts) {
    if (attempt.stage === 'waiting' && startupSnapshot(project).stage === 'waiting') return true;
  }
  return false;
}

function clearStartup(project) {
  attempts.delete(project);
}

module.exports = {
  beginStartup, waitForService, failStartup, observeStartup, startupSnapshot,
  hasPendingStartup, hasWaitingStartup, clearStartup,
};

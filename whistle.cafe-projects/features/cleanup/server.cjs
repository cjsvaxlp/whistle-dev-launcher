const { readdir, lstat, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { stateDir, logsDir, stateFile, pacFile } = require('../../shared/config/config.cjs');
const { authorized, json } = require('../../shared/http/http.cjs');
const { snapshot, jobs, isProjectBusy, runSync } = require('../projects/server.cjs');

let cleaning = false;

async function cleanGeneratedFiles(request, response) {
  if (!authorized(request)) return json(response, 403, { message: '请从本机面板操作。' });
  if (cleaning) return json(response, 409, { message: '正在清理，请稍候。' });
  cleaning = true;
  try {
    await runSync();
    const state = snapshot();
    if (state.syncError || state.projects.some(project => project.active || project.unmatched
      || isProjectBusy(project.name)) || [...jobs.values()].some(job => job.status === 'running')) {
      return json(response, 409, { message: '请先停止所有项目服务和安装任务，确认同步正常后再清理。' });
    }

    const files = [logsDir, stateFile, pacFile];
    let entries = [];
    try {
      entries = await readdir(stateDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const name of entries) {
      if (/^compat-[a-z0-9-]+\.json$/.test(name)
        || /^state\.json\.\d+\.tmp$/.test(name)
        || /^workspace\.\d+\.tmp$/.test(name)) {
        files.push(join(stateDir, name));
      }
    }
    let removed = 0;
    const errors = [];
    for (const file of files) {
      try {
        const info = await lstat(file);
        if (info.isSymbolicLink()) continue;
        await rm(file, { recursive: info.isDirectory(), force: true });
        removed++;
      } catch (error) {
        if (error.code !== 'ENOENT') errors.push(error.message);
      }
    }
    return json(response, errors.length ? 503 : 200, {
      removed,
      message: errors.length ? '部分文件清理失败：' + errors.join('；')
        : removed ? '已清理日志、临时文件和生成的代理文件。同步状态会在后续同步时重新生成。'
          : '没有可清理的文件。',
    });
  } catch (error) {
    return json(response, 500, { message: error.message });
  } finally {
    cleaning = false;
  }
}

module.exports = { cleanGeneratedFiles, isCleaning: () => cleaning };

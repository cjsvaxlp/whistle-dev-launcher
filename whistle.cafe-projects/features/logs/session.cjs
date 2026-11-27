// One detached logging session for all services started by this plugin instance.
// Service process groups stay independent; disconnecting the panel does not stop them.
const { spawn } = require('node:child_process');
const { writeFileSync, unlinkSync, watchFile, unwatchFile } = require('node:fs');
const { openLog } = require('./run-log.cjs');
const writers = new Map();
let connected = true;
const send = message => { if (connected && process.connected) process.send(message, () => {}); };
function remove(file) { try { unlinkSync(file); } catch {} }
function start({ id, file, command, args, options }) {
  let log;
  let child;
  const request = file + '.clear-' + process.pid;
  const ready = request + '.ready';
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    unwatchFile(request);
    remove(ready);
    remove(request);
    remove(file + '.pid');
    log?.close();
    writers.delete(id);
    if (!connected && !writers.size) process.exit();
  };
  try {
    log = openLog(file);
    writeFileSync(file + '.pid', String(process.pid));
    watchFile(request, { persistent: false, interval: 200 }, current => {
      if (!current.nlink || !log) return;
      try { log.truncate(); unlinkSync(request); } catch { /* Leave the request unacknowledged on failure. */ }
    });
    writeFileSync(ready, '1');
    child = spawn(command, args, { ...options, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    writers.set(id, child);
    const append = chunk => {
      if (!log) return;
      try { log.append(chunk); } catch (error) {
        try { log.close(); } catch {}
        log = null;
        send({ type: 'log-error', id, message: error.message });
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('spawn', () => send({ type: 'started', id, pid: child.pid }));
    child.once('error', error => { append(error.message + '\n'); send({ type: 'error', id, message: error.message }); });
    child.once('close', (code, signal) => {
      const launchId = options.env.CAFE_LAUNCH_ID;
      if (launchId) append('\n[cafe-launch ' + launchId + ' exit ' + (code ?? signal ?? 'unknown') + ']\n');
      close();
      send({ type: 'closed', id });
    });
  } catch (error) {
    close();
    send({ type: 'error', id, message: error.message });
  }
}
process.on('message', message => { if (message.type === 'start') start(message); });
process.on('disconnect', () => { connected = false; if (!writers.size) process.exit(); });

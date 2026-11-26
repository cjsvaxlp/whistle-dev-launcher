const { closeSync, fstatSync, ftruncateSync, openSync, readSync, unlinkSync, unwatchFile, watchFile, writeFileSync, writeSync } = require('node:fs');
const { spawn } = require('node:child_process');

const MAX_SIZE = 4 * 1024 * 1024;

function openLog(file) {
  // Keep the descriptor so archiving the current log cannot redirect a running writer.
  const fd = openSync(file, 'a+');
  let size = fstatSync(fd).size;
  return {
    append(data) {
      const chunk = Buffer.from(data);
      if (size + chunk.length > MAX_SIZE) {
        const tail = Buffer.alloc(Math.min(size, MAX_SIZE / 2));
        readSync(fd, tail, 0, tail.length, size - tail.length);
        const nextLine = tail.indexOf(10);
        const retained = nextLine < 0 ? Buffer.alloc(0) : tail.subarray(nextLine + 1);
        ftruncateSync(fd, 0);
        size = writeSync(fd, retained);
      }
      size += writeSync(fd, chunk.subarray(Math.max(0, chunk.length - (MAX_SIZE - size))));
    },
    truncate() {
      ftruncateSync(fd, 0);
      size = 0;
    },
    close() {
      closeSync(fd);
    },
  };
}

module.exports = { MAX_SIZE, openLog };

if (require.main === module) {
  const [file, command, ...args] = process.argv.slice(2);
  let log;
  try {
    log = openLog(file);
    writeFileSync(file + '.pid', String(process.pid));
    const windows = process.platform === 'win32';
    const clearRequest = file + '.clear-' + process.pid;
    const marker = windows ? clearRequest + '.ready' : file + '.signal';
    if (windows) {
      watchFile(clearRequest, { persistent: false, interval: 200 }, current => {
        if (!current.nlink || !log) return;
        try {
          log.truncate();
          unlinkSync(clearRequest);
        } catch {
          // The panel keeps the active log if the writer cannot confirm the clear.
        }
      });
    }
    writeFileSync(marker, '1');
    process.on('exit', () => {
      if (windows) unwatchFile(clearRequest);
      try {
        unlinkSync(marker);
      } catch {
        // 忽略
      }
    });
  } catch (error) {
    console.error(error.message);
  }
  process.on('SIGUSR1', () => {
    try {
      log?.truncate();
    } catch {
      // 日志截断失败时保持原文件。
    }
  });
  const append = chunk => {
    if (!log) return;
    try {
      log.append(chunk);
    } catch (error) {
      console.error(error.message);
      log.close();
      log = null;
    }
  };
  if (command) {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', error => {
      console.error(error.message);
      append(error.message + '\n');
    });
    child.on('close', (code, signal) => {
      const launchId = process.env.CAFE_LAUNCH_ID;
      if (launchId) append('\n[cafe-launch ' + launchId + ' exit ' + (code ?? signal ?? 'unknown') + ']\n');
      log?.close();
      process.exitCode = code ?? 1;
    });
  } else {
    process.stdin.pipe(process.stdout, { end: false });
    process.stdin.on('data', append);
    process.stdin.on('end', () => log?.close());
  }
}

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const vm = require('node:vm');

function picker(run, isWindows = true) {
  const source = readFileSync(require.resolve('../features/workspace/server.cjs'), 'utf8');
  const start = source.indexOf('async function chooseWorkspace()');
  const end = source.indexOf('async function readWorkspacePath');
  const context = vm.createContext({ run, isWindows, POWERSHELL: 'powershell.exe', Buffer });
  vm.runInContext(source.slice(start, end), context);
  return context.chooseWorkspace;
}

for (const selected of ['', 'D:\\开发目录\\cybercafe-front']) {
  test(`Windows picker preserves ${selected ? 'Unicode path' : 'cancellation'}`, async () => {
    const choose = picker(async (command, args, options) => {
      assert.equal(command, 'powershell.exe');
      assert.ok(args.includes('-STA'));
      assert.equal(options.windowsHide, true);
      return { stdout: selected ? selected + '\r\n' : '' };
    });
    assert.equal(await choose(), selected);
  });
}

test('picker launch failure propagates to the existing route error handler', async () => {
  const choose = picker(async () => { throw new Error('picker failed'); });
  await assert.rejects(choose(), /picker failed/);
});

test('macOS retains its osascript picker', async () => {
  const choose = picker(async (command, args) => {
    assert.equal(command, '/usr/bin/osascript');
    assert.ok(args.includes('return POSIX path of (choose folder with prompt "请选择包含 cybercafe-* 子项目的目录")'));
    return { stdout: '/Users/test/project/\n' };
  }, false);
  assert.equal(await choose(), '/Users/test/project/');
});

// Run the real hidden PowerShell launch on Windows and inspect the native
// dialog while its modal message loop is running. Close it automatically, so
// CI verifies actual visibility rather than merely matching script text.
test('Windows hidden launch displays a visible folder dialog and cancellation closes it', {
  skip: process.platform !== 'win32', timeout: 25000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cafe picker '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const observed = join(directory, 'visible.txt');
  const choose = picker(async (command, args, options) => {
    let script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const probe = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CafePickerProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr owner, uint command);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
}
'@
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$script:ticks = 0
$timer.Add_Tick({
  $script:ticks++
  $popup = [CafePickerProbe]::GetWindow($owner.Handle, 6)
  if ($popup -ne [IntPtr]::Zero -and $popup -ne $owner.Handle) {
    if ([CafePickerProbe]::IsWindowVisible($popup)) {
      [System.IO.File]::WriteAllText($env:CAFE_PICKER_OBSERVED, 'visible')
      $timer.Stop()
      [void][CafePickerProbe]::PostMessage($popup, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    } elseif ($script:ticks -ge 25) {
      $timer.Stop()
      [void][CafePickerProbe]::PostMessage($popup, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    }
  }
})
$timer.Start()
`;
    script = script.replace('try {\n', probe + '\ntry {\n');
    const result = await promisify(execFile)(command,
      [...args.slice(0, -1), Buffer.from(script, 'utf16le').toString('base64')],
      { ...options, timeout: 15000, env: { ...process.env, CAFE_PICKER_OBSERVED: observed } });
    assert.equal(readFileSync(observed, 'utf8'), 'visible');
    return result;
  });
  assert.equal(await choose(), '');
});

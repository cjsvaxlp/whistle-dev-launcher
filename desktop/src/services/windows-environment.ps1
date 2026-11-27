param(
    [Parameter(Mandatory = $true)][string]$ToolsRoot,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Install-CafeWhistle([string]$NpmPath) {
    # npm.cmd needs cmd.exe; explicitly suppress its console as well as npm's.
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $info.Arguments = '/d /s /c ""' + $NpmPath + '" install -g whistle --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $detail = ($stderr.Result + "`n" + $stdout.Result).Trim()
        if ($process.ExitCode -ne 0) {
            if ($detail.Length -gt 1500) { $detail = $detail.Substring($detail.Length - 1500) }
            throw "自动安装 Whistle 失败，请检查网络或 npm 全局目录权限后重试，也可手动执行 npm install -g whistle。`n$detail"
        }
    } finally { $process.Dispose() }
}

function Find-CafeEnvironment {
    # Explorer can retain an old PATH after Node/npm was installed. Read the
    # current user/machine paths as well as common Node/version-manager locations.
    $paths = @($env:PATH,
        [Environment]::GetEnvironmentVariable('Path', 'User'),
        [Environment]::GetEnvironmentVariable('Path', 'Machine'),
        $env:NVM_SYMLINK, $env:FNM_MULTISHELL_PATH)
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($base) { $paths += (Join-Path $base 'nodejs') }
    }
    if ($env:LOCALAPPDATA) { $paths += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs') }
    if ($env:APPDATA) { $paths += (Join-Path $env:APPDATA 'npm') }
    if ($env:VOLTA_HOME) { $paths += (Join-Path $env:VOLTA_HOME 'bin') }
    $env:PATH = [Environment]::ExpandEnvironmentVariables(($paths | Where-Object { $_ }) -join ';')

    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$node) { throw '缺少 Node.js。请先安装 Node.js LTS（包含 npm），再点击“开启代理 / 启动 Whistle”重试。' }
    $version = (& $node.Source --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 20) {
        throw 'Node.js 无法运行或版本低于 20。请安装 Node.js LTS 后重试。'
    }
    $npm = Get-Command npm.cmd,npm.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$npm) {
        $adjacent = Join-Path (Split-Path $node.Source) 'npm.cmd'
        if (Test-Path -LiteralPath $adjacent -PathType Leaf) { $npm = Get-Item -LiteralPath $adjacent }
    }
    if (!$npm) { throw '缺少 npm。请使用包含 npm 的完整 Node.js LTS 安装程序修复安装后重试。' }
    $npmPath = if ($npm.Source) { $npm.Source } else { $npm.FullName }
    $root = (& $npmPath root -g | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or !$root) { throw '无法读取 npm 全局目录。请先在终端确认 npm root -g 可以正常运行。' }
    $cli = Join-Path $root 'whistle\bin\whistle.js'
    $env:PATH = (Split-Path $node.Source) + ';' + (Split-Path $npmPath) + ';' + $env:PATH
    if (!(Test-Path -LiteralPath $cli -PathType Leaf)) {
        if ($CheckOnly) { throw '缺少 Whistle。启动应用时会自动执行 npm install -g whistle。' }
        Install-CafeWhistle $npmPath
        if (!(Test-Path -LiteralPath $cli -PathType Leaf)) {
            throw 'npm 安装完成但未找到 Whistle，请检查 npm root -g，或手动执行 npm install -g whistle 后重试。'
        }
    }
    return @{ node = $node.Source; npm = $npmPath; whistle = $cli; version = $version }
}

try {
    if (!$CheckOnly -and !(Test-Path -LiteralPath (Join-Path $ToolsRoot 'whistle.cafe-projects\package.json') -PathType Leaf)) {
        throw '找不到工具内置插件，请重新安装 Cybercafe。'
    }
    $environment = Find-CafeEnvironment
    if ($CheckOnly) {
        $environment | ConvertTo-Json -Compress
    } else {
        # Use the user's Node/Whistle with the app's plugin; no global plugin link
        # and no global plugin link is required. Missing Whistle is installed once.
        & $environment.node $environment.whistle start -H 127.0.0.1 -p 8899 --addon $ToolsRoot
        if ($LASTEXITCODE -ne 0) { throw '启动 Whistle 失败。请确认本机 Whistle 可正常运行及 8899 端口未被其他程序占用。' }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}

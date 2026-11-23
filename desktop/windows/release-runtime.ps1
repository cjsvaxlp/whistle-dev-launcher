param([Parameter(Mandatory = $true)][string]$RuntimePath)

$ErrorActionPreference = 'Stop'
$runtime = [IO.Path]::GetFullPath($RuntimePath)
if (!(Test-Path -LiteralPath $runtime -PathType Leaf)) { exit 0 }

try {
    foreach ($process in @(Get-Process -Name node -ErrorAction SilentlyContinue)) {
        if ($process.Path -eq $runtime) {
            Stop-Process -InputObject $process -ErrorAction Stop
            [void]$process.WaitForExit(5000)
        }
    }

    # Confirm the file is unlocked and writable before the installer copies files.
    $stream = [IO.File]::Open($runtime, 'Open', 'ReadWrite', 'None')
    $stream.Dispose()
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}

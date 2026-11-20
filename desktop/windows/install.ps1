$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Join-Path $env:LOCALAPPDATA 'Cybercafe'
$staging = Join-Path $env:TEMP ('Cybercafe-' + [Guid]::NewGuid())
[System.IO.Directory]::CreateDirectory($staging) | Out-Null
try {
    $archive = Join-Path $staging 'payload.zip'
    [System.IO.File]::WriteAllBytes($archive, $payload)
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
    [System.IO.Directory]::CreateDirectory($root) | Out-Null
    $target = Join-Path $root 'tools'
    $backup = Join-Path $root ('tools-previous-' + [Guid]::NewGuid())
    if (Test-Path -LiteralPath $target) {
        Move-Item -LiteralPath $target -Destination $backup
    }
    try {
        Move-Item -LiteralPath (Join-Path $staging 'tools') -Destination $target
    } catch {
        if (Test-Path -LiteralPath $backup) {
            Move-Item -LiteralPath $backup -Destination $target
        }
        throw
    }
    if (Test-Path -LiteralPath $backup) {
        Remove-Item -LiteralPath $backup -Recurse -Force
    }

    $programs = [Environment]::GetFolderPath('Programs')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $programs 'Cybercafe.lnk'))
    $shortcut.TargetPath = Join-Path $target 'Open-Cybercafe.cmd'
    $shortcut.WorkingDirectory = $target
    $shortcut.Save()
    Write-Host 'Cybercafe was installed. Open Cybercafe from the Start menu.'
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force
}

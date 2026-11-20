import base64
import io
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "packaging"))
from resources import collect, version

desktop = Path(__file__).resolve().parent
release_version = version()
dist = Path(os.environ.get("CAFE_DIST_DIR", desktop.parent / "dist")).resolve() / release_version
dist.mkdir(parents=True, exist_ok=True)
output = dist / f"Cybercafe-{release_version}-Windows.zip"

with tempfile.TemporaryDirectory(prefix=".windows-package-", dir=dist) as directory:
    staging = Path(directory)
    tools = staging / "tools"
    collect(tools, "windows")
    payload = io.BytesIO()
    with ZipFile(payload, "w", ZIP_DEFLATED) as archive:
        for asset in sorted(tools.rglob("*")):
            if asset.is_file():
                archive.write(asset, f"tools/{asset.relative_to(tools).as_posix()}")

    install_script = base64.b64encode((desktop / "windows/install.ps1").read_bytes()).decode()
    payload_lines = base64.encodebytes(payload.getvalue()).decode().splitlines()
    bootstrap = [
        "@echo off",
        "setlocal",
        'set "CAFE_INSTALLER=%~f0"',
        'powershell.exe -NoProfile -Command "$ErrorActionPreference = \'Stop\'; '
        '$lines = [IO.File]::ReadAllLines($env:CAFE_INSTALLER); '
        '$marker = [Array]::IndexOf($lines, \':CYBERCAFE_DATA\'); '
        '$script = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($lines[$marker+1])); '
        '$payload = [Convert]::FromBase64String(($lines[($marker+2)..($lines.Length-1)] -join \'\')); '
        '& ([ScriptBlock]::Create($script))"',
        'set "CAFE_RESULT=%errorlevel%"',
        "pause",
        "exit /b %CAFE_RESULT%",
        ":CYBERCAFE_DATA",
        install_script,
        *payload_lines,
    ]

    candidate = staging / output.name
    with ZipFile(candidate, "w", ZIP_DEFLATED) as archive:
        archive.writestr("Install-Cybercafe-Windows.cmd", "\r\n".join(bootstrap) + "\r\n")
    candidate.replace(output)

print(output)

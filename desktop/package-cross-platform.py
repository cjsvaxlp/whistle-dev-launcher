import base64
import io
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

desktop = Path(__file__).resolve().parent
dist = desktop.parent / "dist"
mac_archive = dist / "Cybercafe-macOS-arm64-installer.zip"
output = dist / "Cybercafe-macOS-Windows.zip"

with tempfile.TemporaryDirectory(prefix="cybercafe-distribution-") as directory:
    staging = Path(directory)
    with ZipFile(mac_archive) as archive:
        package = archive.read("Cybercafe.pkg")
    pkg_file = staging / "Cybercafe.pkg"
    pkg_file.write_bytes(package)
    expanded = staging / "expanded"
    subprocess.run(["pkgutil", "--expand-full", pkg_file, expanded], check=True)
    plugin = expanded / "Payload/Cybercafe.app/Contents/Resources/tools/whistle.cafe-projects"
    if not (plugin / "package.json").is_file():
        raise RuntimeError("The macOS installer is missing its bundled Whistle plugin.")

    payload = io.BytesIO()
    with ZipFile(payload, "w", ZIP_DEFLATED) as archive:
        for asset in sorted(plugin.rglob("*")):
            if asset.is_file():
                archive.write(asset, f"tools/whistle.cafe-projects/{asset.relative_to(plugin).as_posix()}")
        archive.writestr("tools/.installed", "")
        launcher = (desktop / "windows/Open-Cybercafe.cmd").read_text()
        archive.writestr("tools/Open-Cybercafe.cmd", launcher.replace("\n", "\r\n"))

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
        archive.writestr("Cybercafe-macOS-arm64.pkg", package)
        archive.writestr("Install-Cybercafe-Windows.cmd", "\r\n".join(bootstrap) + "\r\n")
    candidate.replace(output)

print(output)

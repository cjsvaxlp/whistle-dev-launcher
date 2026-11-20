"""Collect the runtime files shared by macOS and Windows distributions."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

REPOSITORY = Path(__file__).resolve().parents[2]


def version():
    manifest = (REPOSITORY / "desktop/Cargo.toml").read_text()
    package = manifest.split("[package]", 1)[1].split("\n[", 1)[0]
    value = re.search(r'^version\s*=\s*"([^"]+)"', package, re.MULTILINE).group(1)
    configured = json.loads((REPOSITORY / "desktop/tauri.conf.json").read_text())["version"]
    if value != configured:
        raise ValueError("Cargo.toml 和 tauri.conf.json 的版本不一致")
    return value


def collect(destination, platform):
    plugin = REPOSITORY / "whistle.cafe-projects"
    target = destination / plugin.name
    target.mkdir(parents=True, exist_ok=True)
    terser = os.environ.get("TERSER_CLI") or shutil.which("terser")
    for source in sorted(plugin.rglob("*")):
        relative = source.relative_to(plugin)
        if not source.is_file() or any(part in {"test", "node_modules"} for part in relative.parts):
            continue
        if source.suffix not in {".cjs", ".mjs", ".js", ".html", ".css"} and relative != Path("package.json"):
            continue
        output = target / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix in {".cjs", ".mjs", ".js"}:
            if terser:
                args = ["node", terser, str(source), "--compress", "--mangle",
                        "--comments", "false", "--output", str(output)]
                if source.suffix == ".mjs":
                    args.append("--module")
                subprocess.run(args, check=True)
            else:
                shutil.copy2(source, output)
            subprocess.run(["node", "--check", str(output)], check=True)
        else:
            shutil.copy2(source, output)
    (destination / ".installed").touch()
    if platform == "macos":
        for relative in [
            "scripts/commands/启动任意项目.command",
            "scripts/commands/打开测试环境.command",
            "scripts/browser/open-browser.js",
        ]:
            output = destination / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPOSITORY / relative, output)
    else:
        shutil.copy2(REPOSITORY / "desktop/windows/Open-Cybercafe.cmd", destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--platform", choices=["macos", "windows"])
    args = parser.parse_args()
    if args.version:
        print(version())
    elif args.output and args.platform:
        version()
        collect(args.output, args.platform)
    else:
        parser.error("需要 --version 或 --output 与 --platform")

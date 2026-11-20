#!/bin/zsh
set -eu
set -o pipefail

desktop_dir=${0:A:h}
repo_dir=${desktop_dir:h}
export CARGO_TARGET_DIR="$repo_dir/.cafe-tools/desktop-target"

# Set TERSER_CLI to the path of a Terser executable or its Node.js entry point.
terser_cli=${TERSER_CLI:-$(whence -p terser || true)}
if [[ -z "$terser_cli" || ! -f "$terser_cli" ]]; then
  print -u2 '请安装 Terser，或通过 TERSER_CLI 指定已安装的 Terser 入口。'
  exit 1
fi
cargo build --locked --profile dev --manifest-path "$desktop_dir/Cargo.toml" "$@"

staging=$(mktemp -d "${TMPDIR:-/tmp}/cybercafe-package.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
app="$staging/payload/Cybercafe.app"
contents="$app/Contents"
tools="$contents/Resources/tools"
plugin="$tools/whistle.cafe-projects"
mkdir -p "$contents/MacOS" "$plugin" "$tools/scripts/browser"
/bin/cp -X "$CARGO_TARGET_DIR/debug/cybercafe-desktop" "$contents/MacOS/"
/usr/bin/strip -S "$contents/MacOS/cybercafe-desktop"
/bin/cp -X "$desktop_dir/Info.plist" "$contents/"
/bin/cp -X "$desktop_dir/icons/Cybercafe.icns" "$contents/Resources/"
: > "$tools/.installed"
/bin/cp -X "$repo_dir"/{打开测试环境,启动任意项目}.command "$tools/"
/bin/cp -X "$repo_dir/scripts/browser/open-browser.js" "$tools/scripts/browser/"

source_plugin="$repo_dir/whistle.cafe-projects"
while IFS= read -r -d '' asset; do
  relative=${asset#"$source_plugin"/}
  mkdir -p "$(dirname "$plugin/$relative")"
  case "$asset" in
    *.cjs|*.mjs|*.js)
      args=(--compress --mangle --comments false)
      if [[ "$asset" == *.mjs ]]; then args+=(--module); fi
      node "$terser_cli" "$asset" "${args[@]}" --output "$plugin/$relative"
      node --check "$plugin/$relative"
      ;;
    *)
      /bin/cp -X "$asset" "$plugin/$relative"
      ;;
  esac
done < <(find "$source_plugin" -type d \( -name test -o -name node_modules \) -prune -o \
  -type f \( -name '*.cjs' -o -name '*.mjs' -o -name '*.js' -o -name '*.html' -o -name '*.css' -o -name package.json \) -print0)

/usr/bin/codesign --force --sign - "$app"
/usr/bin/codesign --verify --strict "$app"

/usr/bin/pkgbuild --analyze --root "$staging/payload" "$staging/components.plist"
/usr/bin/plutil -replace 0.BundleIsRelocatable -bool NO "$staging/components.plist"
version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$contents/Info.plist")
/usr/bin/pkgbuild --root "$staging/payload" --component-plist "$staging/components.plist" \
  --identifier local.cybercafe.desktop.installer --version "$version" \
  --install-location /Applications "$staging/Cybercafe.pkg"

output="$repo_dir/dist/Cybercafe-macOS-$(uname -m)-installer.zip"
/usr/bin/zip -j "$staging/installer.zip" "$staging/Cybercafe.pkg"
mkdir -p "$repo_dir/dist"
mv "$staging/installer.zip" "$output"
print -r -- "$output"

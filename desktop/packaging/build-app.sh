#!/bin/zsh
# Arguments: destination.app, dev|release, repository|bundled
set -eu
set -o pipefail
desktop_dir=${0:A:h:h}
repo_dir=${desktop_dir:h}
app=$1
profile=$2
resources=$3
[[ "$profile" == dev || "$profile" == release ]]
[[ "$resources" == repository || "$resources" == bundled ]]
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo_dir/.cafe-tools/desktop-target}"
version=$(python3 "$desktop_dir/packaging/resources.py" --version)
cargo build --locked --profile "$profile" --manifest-path "$desktop_dir/Cargo.toml" >&2
binary_dir=$profile
[[ "$profile" != dev ]] || binary_dir=debug
contents="$app/Contents"
mkdir -p "$contents/MacOS" "$contents/Resources"
/bin/cp -X "$CARGO_TARGET_DIR/$binary_dir/cybercafe-desktop" "$contents/MacOS/"
/bin/cp -X "$desktop_dir/Info.plist" "$contents/"
/usr/libexec/PlistBuddy -c "Set CFBundleShortVersionString $version" "$contents/Info.plist"
/bin/cp -X "$desktop_dir/icons/Cybercafe.icns" "$contents/Resources/"
if [[ "$resources" == bundled ]]; then
  python3 "$desktop_dir/packaging/resources.py" --platform macos --output "$contents/Resources/tools"
else
  printf '%s\n' "$(whence -p w2 || true)" > "$contents/Resources/w2-path"
fi
/bin/chmod -R a+rX "$app"
/usr/bin/codesign --force --sign - "$app" >&2
/usr/bin/codesign --verify --strict "$app" >&2

#!/bin/zsh
set -eu
set -o pipefail
desktop_dir=${0:A:h}
repo_dir=${desktop_dir:h}
version=$(python3 "$desktop_dir/packaging/resources.py" --version)
output_dir="${CAFE_DIST_DIR:-$repo_dir/dist}/$version"
staging=$(mktemp -d "${TMPDIR:-/tmp}/cybercafe-package.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
app="$staging/image/Cybercafe.app"
"$desktop_dir/packaging/build-app.sh" "$app" release bundled
ln -s /Applications "$staging/image/Applications"
/usr/bin/hdiutil create -volname "Cybercafe $version" -srcfolder "$staging/image" \
  -format UDZO -ov "$staging/Cybercafe.dmg" >&2
/usr/bin/hdiutil verify "$staging/Cybercafe.dmg" >&2
mkdir -p "$output_dir"
candidate=$(mktemp "$output_dir/.macos-package.XXXXXX")
trap 'rm -rf -- "$staging"; rm -f -- "$candidate"' EXIT
/bin/cp -X "$staging/Cybercafe.dmg" "$candidate"
output="$output_dir/Cybercafe-$version-macOS-$(uname -m).dmg"
mv -f "$candidate" "$output"
print -r -- "$output"

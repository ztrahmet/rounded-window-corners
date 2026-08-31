#!/usr/bin/env bash
#
# Builds the extensions.gnome.org upload package into dist/.
#
# gnome-extensions pack only includes metadata.json, extension.js and
# stylesheet.css unless every other source is named explicitly. Miss one and it
# produces a package that installs, enables, and then silently does nothing.
# The check at the end exists so that failure mode cannot come back.

set -euo pipefail

cd "$(dirname "$0")/.."

# Everything the extension needs at runtime. Anything added here must also be
# added to the pack invocation below.
RUNTIME=(extension.js metadata.json stylesheet.css lib shaders tools)

OUT=dist

command -v gnome-extensions >/dev/null || {
    echo "gnome-extensions not found; install gnome-shell" >&2
    exit 1
}

rm -rf "$OUT"
mkdir -p "$OUT"

gnome-extensions pack --force -o "$OUT" \
    --extra-source=lib \
    --extra-source=shaders \
    --extra-source=tools \
    --extra-source=LICENSE \
    .

zip=$(echo "$OUT"/*.shell-extension.zip)
[ -f "$zip" ] || { echo "pack produced no archive" >&2; exit 1; }

contents=$(unzip -Z1 "$zip")

# metadata.json has to sit at the archive root; EGO rejects a wrapped folder.
grep -qx 'metadata.json' <<<"$contents" || {
    echo "metadata.json is not at the archive root" >&2
    exit 1
}

# Every runtime file must have made it in.
missing=0
while read -r f; do
    grep -qx "$f" <<<"$contents" || { echo "missing from package: $f" >&2; missing=1; }
done < <(find "${RUNTIME[@]}" -type f | sort)
[ "$missing" -eq 0 ] || {
    echo "add the missing paths to --extra-source in $0" >&2
    exit 1
}

files=$(grep -c . <<<"$contents")
echo
echo "$zip"
echo "  $files entries, $(du -h "$zip" | cut -f1)"
echo
echo "Upload that at https://extensions.gnome.org/upload/"
echo "The icon and screenshot are uploaded separately on the form:"
echo "  icon        data/icon.png"
echo "  screenshot  data/screenshot.png"

#!/usr/bin/env bash
# Builds the extensions.gnome.org upload into dist/.
set -euo pipefail
cd "$(dirname "$0")/.."

# gnome-extensions pack takes only extension.js and metadata.json unless told
# otherwise, so everything else the extension needs is listed here.
EXTRA=(lib tools LICENSE)

# gnome-extensions 51.1 crashes when the output directory does not exist.
rm -rf dist
mkdir dist
gnome-extensions pack --force -o dist "${EXTRA[@]/#/--extra-source=}" .
zip=$(echo dist/*.shell-extension.zip)

missing=$(comm -23 <(find extension.js metadata.json "${EXTRA[@]}" -type f | sort) <(unzip -Z1 "$zip" | sort))
if [ -n "$missing" ]; then
    printf 'missing from %s:\n%s\n' "$zip" "$missing" >&2
    exit 1
fi

echo "$PWD/$zip ($(du -h "$zip" | cut -f1))"
echo "Upload it at https://extensions.gnome.org/upload/ with data/icon.png and data/screenshot.png."

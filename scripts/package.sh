#!/usr/bin/env bash
# Builds the extensions.gnome.org upload into dist/.
set -euo pipefail
cd "$(dirname "$0")/.."

# gnome-extensions pack only takes extension.js and metadata.json unless told, so list the rest.
EXTRA=(lib tools LICENSE)

# gnome-extensions pack crashes if the output directory is missing.
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

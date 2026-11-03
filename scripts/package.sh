#!/usr/bin/env bash
# Builds the extensions.gnome.org upload into dist/.
set -euo pipefail
cd "$(dirname "$0")/.."

# gnome-extensions pack only takes its standard files, like extension.js and metadata.json, so list the rest.
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

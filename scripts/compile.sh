#!/usr/bin/env bash
# Compiles the settings schemas and translations in place, so the extension runs from the source tree.
set -euo pipefail
cd "$(dirname "$0")/.."

glib-compile-schemas --strict schemas/

# The translations are found under the extension's UUID, as gnome-extensions pack names them.
uuid=$(sed -n 's/^ *"uuid": *"\([^"]*\)".*/\1/p' metadata.json)
rm -rf locale
for po in po/*.po; do
    dir=locale/$(basename "$po" .po)/LC_MESSAGES
    mkdir -p "$dir"
    msgfmt --check -o "$dir/$uuid.mo" "$po"
done

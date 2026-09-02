#!/usr/bin/env bash
# lib/cssParse.js and lib/shadowProfile.js import nothing from GNOME, so they
# run under plain node. Node decides module type from the nearest package.json,
# and the extension deliberately ships none, so the sources and their tests are
# copied somewhere that has one.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '{"type":"module"}\n' > "$work/package.json"
cp "$root/lib/cssParse.js" "$root/lib/shadowProfile.js" "$work/"
cp "$here"/*.test.mjs "$work/"
cd "$work" && node --test

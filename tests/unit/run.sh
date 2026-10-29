#!/usr/bin/env bash
# Node loads these as modules only next to a package.json, which the extension doesn't ship, so run a copy.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '{"type":"module"}\n' > "$work/package.json"
cp "$root/lib/cssParse.js" "$root/lib/cssValues.js" "$root/lib/shadowProfile.js" "$work/"
cp "$here"/*.test.mjs "$work/"
cd "$work" && node --test

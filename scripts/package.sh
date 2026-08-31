#!/usr/bin/env bash
#
# Builds the extensions.gnome.org upload package into dist/.
#
# gnome-extensions pack only includes metadata.json, extension.js and
# stylesheet.css unless every other source is named explicitly. Miss one and it
# produces a package that installs, enables, and then silently does nothing.
# The check at the end exists so that failure mode cannot come back.

# Bash arrays and herestrings are used below, so re-exec if invoked as `sh`.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

# Everything the extension needs at runtime. Anything added here must also be
# added to the pack invocation below.
RUNTIME=(extension.js metadata.json stylesheet.css lib shaders tools)

OUT=dist

# The nearest ancestor of $1 holding an extension, or nothing.
find_root() {
    local dir=$1
    while [ "$dir" != / ] && [ -n "$dir" ]; do
        if [ -f "$dir/metadata.json" ] && [ -f "$dir/extension.js" ]; then
            printf '%s\n' "$dir"
            return 0
        fi
        dir=$(dirname "$dir")
    done
    return 1
}

# Resolve the script's own location through any symlinks, so this still works
# when it is linked onto PATH rather than run from the checkout. readlink -f
# would be shorter but is not portable to BSD.
self=$0
while [ -L "$self" ]; do
    link=$(readlink "$self")
    case $link in
        /*) self=$link ;;
        *)  self=$(dirname "$self")/$link ;;
    esac
done
self_dir=$(cd "$(dirname "$self")" && pwd)

# Prefer the checkout the script lives in; fall back to the working directory so
# a copy of this script still works from inside another checkout.
root=$(find_root "$self_dir") || root=$(find_root "$PWD") || {
    if [ "$self_dir" = "$PWD" ]; then searched=$PWD; else searched="$self_dir or $PWD"; fi
    echo "no extension found: no metadata.json at or above $searched" >&2
    exit 1
}
cd "$root"

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
echo "$root/$zip"
echo "  $files entries, $(du -h "$zip" | cut -f1)"
echo
echo "Upload that at https://extensions.gnome.org/upload/"
echo "The icon and screenshot are uploaded separately on the form:"
echo "  icon        data/icon.png"
echo "  screenshot  data/screenshot.png"

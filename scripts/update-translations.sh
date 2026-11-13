#!/usr/bin/env bash
# Updates the translation template from the preferences and merges it into every translation.
set -euo pipefail
cd "$(dirname "$0")/.."
# Globs sort by locale, so files would come out in another order elsewhere.
export LC_ALL=C

uuid=$(sed -n 's/^ *"uuid": *"\([^"]*\)".*/\1/p' metadata.json)
pot=po/$uuid.pot

# Locations name only the file, so an edit to the preferences doesn't rewrite every translation.
xgettext --from-code=UTF-8 --add-comments=Translators --add-location=file \
    --package-name=rounded-window-corners \
    --msgid-bugs-address=https://github.com/ztrahmet/rounded-window-corners/issues \
    -o "$pot" prefs.js prefs/*.js
for po in po/*.po; do
    msgmerge --quiet --update --no-wrap --backup=none "$po" "$pot"
    msgattrib --no-obsolete --no-wrap -o "$po" "$po"
done

# Development

No build step. The source tree is the extension, so a symlink and its compiled settings
schema are the whole install.

## Layout

```
extension.js                  enable() and disable()
prefs.js                      the preferences window, with its pages in prefs/
lib/windowTracker.js          which windows get an effect, and their geometry
lib/roundedCornersEffect.js   the shader effect, and the one that makes room for the shadow
lib/styleResolver.js          reads libadwaita's stylesheet and gtk.css
lib/customStyle.js            the window style from the settings, no GNOME imports
lib/cssParse.js               the cascade, no GNOME imports
lib/cssValues.js              numbers, lengths and colors, no GNOME imports
lib/shadowProfile.js          box-shadow to shader values, no GNOME imports
lib/toolkitProbe.js           detects each app's toolkit
tools/adw-probe.js            helper that prints libadwaita's stylesheet
schemas/                      the settings
po/                           translations of the preferences
scripts/package.sh            builds the upload archive, not shipped
tests/                        unit and integration tests
data/                         icon and screenshots, not shipped
```

## A shell to test in

Run a nested shell with its own config, so a crash doesn't take your session with it.
`--devkit` shows it in a window, and needs mutter's devkit (`mutter-devkit` on Fedora):

```bash
ROOT=/tmp/rwc-dev
mkdir -p $ROOT/{config,cache,data/gnome-shell/extensions}
glib-compile-schemas schemas/
ln -sfn "$PWD" $ROOT/data/gnome-shell/extensions/rounded-window-corners@ztrahmet.github.io

XDG_CONFIG_HOME=$ROOT/config XDG_DATA_HOME=$ROOT/data XDG_CACHE_HOME=$ROOT/cache \
dbus-run-session -- bash -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"rounded-window-corners@ztrahmet.github.io\"]"
  gnome-shell --devkit --wayland-display=rwc-test
'
```

Start apps in it with `WAYLAND_DISPLAY=rwc-test`. For scripts, use
`--headless --virtual-monitor 1400x900` instead of `--devkit`; it shows nothing.

## Tests

The unit tests cover the CSS reading, the shadow math and the custom style, under plain
`node`:

```bash
./tests/unit/run.sh
```

The integration tests run a real headless GNOME Shell in a Fedora container, open
Wayland, XWayland and libadwaita windows, and check what the extension does with them,
the settings included, and that the preferences open:

```bash
podman build -f tests/integration/Containerfile -t rwc-test tests/integration/
podman run --rm --privileged --user 0 -v "$PWD:/src:ro,z" -v "$PWD/tests:/tests:ro,z" \
    rwc-test /tests/integration/entrypoint.sh
```

Without `--privileged` the pixel checks are skipped.

The drift canary checks that libadwaita's window style still matches the built-in copy:

```bash
podman run --rm -v "$PWD:/src:ro,z" rwc-test gjs -m /src/tests/integration/drift-canary.js
```

For your own screenshots, capture with `global.stage.paint_to_content()` through the
shell's `Eval` D-Bus method, in a `--privileged` container.

CI runs the unit tests on every push. The container suite and the canary run on pushes
that change more than the docs and images, and weekly, to notice when libadwaita changes.

## Translations

After changing the text of the preferences, update the template and the translations:

```bash
POT=po/rounded-window-corners@ztrahmet.github.io.pot
xgettext --from-code=UTF-8 --add-comments=Translators --package-name=rounded-window-corners \
    --msgid-bugs-address=https://github.com/ztrahmet/rounded-window-corners/issues \
    -o $POT prefs.js prefs/*.js
for po in po/*.po; do msgmerge --update --backup=none "$po" $POT; done
```

A new language starts from the template, with
`msginit -i $POT -l <language> -o po/<language>.po`.

The package compiles the translations. To see them in a shell running from the source
tree, compile them into `locale/` first:

```bash
for po in po/*.po; do
    dir=locale/$(basename "$po" .po)/LC_MESSAGES
    mkdir -p $dir && msgfmt -o $dir/rounded-window-corners@ztrahmet.github.io.mo "$po"
done
```

## Packaging

```bash
./scripts/package.sh
```

Builds the upload archive into `dist/`, with the translations compiled. It stops if a
translation's placeholders don't match the English text. The icon and screenshot from
`data/` are uploaded separately on the extensions.gnome.org form.

To regenerate the icon:

```bash
magick -background none data/icon.svg -resize 128x128 -depth 8 -strip PNG32:data/icon.png
```

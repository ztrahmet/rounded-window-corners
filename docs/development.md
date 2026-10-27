# Development

No build step. The source tree is the extension, so a symlink is the whole install.

## Layout

```
extension.js                  enable() and disable()
lib/windowTracker.js          which windows get an effect, and their geometry
lib/roundedCornersEffect.js   the shader effect
lib/styleResolver.js          reads libadwaita's stylesheet and gtk.css
lib/cssParse.js               the cascade, no GNOME imports
lib/shadowProfile.js          box-shadow to shader values, no GNOME imports
lib/toolkitProbe.js           detects libadwaita apps
tools/adw-probe.js            helper that prints libadwaita's stylesheet
scripts/package.sh            builds the upload archive, not shipped
tests/                        unit and integration tests
data/                         icon and screenshots, not shipped
```

## A shell to test in

Run a nested headless shell with its own config, so a crash doesn't take your session
with it:

```bash
ROOT=/tmp/rwc-dev
mkdir -p $ROOT/{config,cache,data/gnome-shell/extensions}
ln -sfn "$PWD" $ROOT/data/gnome-shell/extensions/rounded-window-corners@ztrahmet.github.io

XDG_CONFIG_HOME=$ROOT/config XDG_DATA_HOME=$ROOT/data XDG_CACHE_HOME=$ROOT/cache \
dbus-run-session -- bash -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"rounded-window-corners@ztrahmet.github.io\"]"
  gnome-shell --headless --virtual-monitor 1400x900 --wayland-display=rwc-test
'
```

Start apps in it with `WAYLAND_DISPLAY=rwc-test`.

## Tests

The unit tests cover the CSS reading and the shadow maths, under plain `node`:

```bash
./tests/unit/run.sh
```

The integration tests run a real headless GNOME Shell 51 in a Fedora rawhide container,
open Wayland, XWayland and libadwaita windows, and check what the extension does with
them:

```bash
podman build -f tests/integration/Containerfile --build-arg FEDORA=rawhide -t rwc-test tests/integration/
podman run --rm --user 0 -v "$PWD:/src:ro,z" -v "$PWD/tests:/tests:ro,z" \
    rwc-test /tests/integration/entrypoint.sh
```

The drift canary checks that libadwaita's window style still matches the built-in copy:

```bash
podman run --rm -v "$PWD:/src:ro,z" rwc-test gjs -m /src/tests/integration/drift-canary.js
```

Screenshots work in the container too. Run it with `--privileged`, which the image
loaders need, and capture with `global.stage.paint_to_content()` through the shell's
`Eval` D-Bus method.

CI runs the unit tests on every push, and the container suite and canary on pushes and
weekly.

## Packaging

```bash
./scripts/package.sh
```

Builds the upload archive into `dist/`. The icon and screenshot from `data/` are uploaded
separately on the extensions.gnome.org form.

To regenerate the icon:

```bash
magick -background none data/icon.svg -resize 128x128 -depth 8 -strip PNG32:data/icon.png
```

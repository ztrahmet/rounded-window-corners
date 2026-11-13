# Development

There is no build step: the source tree is the extension. A symlink and the compiled
settings schema are the whole install.

## Layout

| Path | What's there |
| --- | --- |
| `extension.js`, `prefs.js` | The entry points |
| `lib/` | The extension itself. The CSS reading and the style math have no GNOME imports, so the unit tests run them under Node. |
| `prefs/` | The pages of the preferences window |
| `tools/` | The helper that reads libadwaita's stylesheet |
| `schemas/`, `po/` | The settings and the translations |
| `tests/`, `scripts/`, `data/` | Tests, packaging and images, not shipped |

## Running it

Try changes in a nested GNOME Shell with its own config, so a crash doesn't take your
session with it. `--devkit` shows it in a window, and needs mutter's devkit
(`mutter-devkit` on Fedora):

```bash
ROOT=/tmp/rwc-dev
mkdir -p $ROOT/{config,cache,data/gnome-shell/extensions}
./scripts/compile.sh
ln -sfn "$PWD" $ROOT/data/gnome-shell/extensions/rounded-window-corners@ztrahmet.github.io

XDG_CONFIG_HOME=$ROOT/config XDG_DATA_HOME=$ROOT/data XDG_CACHE_HOME=$ROOT/cache \
dbus-run-session -- bash -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"rounded-window-corners@ztrahmet.github.io\"]"
  gnome-shell --devkit --wayland-display=rwc-test
'
```

Start apps in it with `WAYLAND_DISPLAY=rwc-test`. For scripts, use
`--headless --virtual-monitor 1400x900` instead of `--devkit`.

> [!NOTE]
> `./scripts/compile.sh` compiles the settings schema and the translations into the source
> tree. Run it again after changing either.

## Tests

The unit tests cover the CSS reading, the shadow math and the custom style:

```bash
./tests/unit/run.sh
```

The integration tests run a real headless GNOME Shell in a Fedora container. They open
Wayland, XWayland and libadwaita windows, check what the extension does with them under
every setting, and open the preferences:

```bash
podman build -f tests/integration/Containerfile -t rwc-test tests/integration/
podman run --rm --privileged --user 0 -v "$PWD:/src:ro,z" -v "$PWD/tests:/tests:ro,z" \
    rwc-test /tests/integration/entrypoint.sh
```

Without `--privileged`, the checks that read pixels are skipped.

The drift canary checks that libadwaita's window style still matches the extension's
built-in copy:

```bash
podman run --rm -v "$PWD:/src:ro,z" rwc-test gjs -m /src/tests/integration/drift-canary.js
```

CI runs the unit tests on every push. The integration tests and the canary run on every
push that changes more than the docs and images, and weekly, to catch libadwaita changes.

## Translations

After changing the text in the preferences, update the template and every translation:

```bash
./scripts/update-translations.sh
```

Then translate the new and changed strings, following the terms and punctuation GNOME's own
translations use for each language, and check them:

```bash
./scripts/compile.sh
```

A new language starts from the template:

```bash
msginit -i po/rounded-window-corners@ztrahmet.github.io.pot -l <language> -o po/<language>.po
```

## Packaging

```bash
./scripts/package.sh
```

This builds the upload archive into `dist/`, with the translations compiled, and stops if
a translation's placeholders don't match the English text. The icon and screenshot in
`data/` are uploaded separately on the extensions.gnome.org form.

To regenerate the icon:

```bash
magick -background none data/icon.svg -resize 128x128 -depth 8 -strip PNG32:data/icon.png
```

# Development

No build step. The source tree is the extension, so a symlink is the whole install.

## Layout

```
extension.js                  enable/disable, signal wiring
lib/windowTracker.js          which windows get an effect
lib/roundedCornersEffect.js   the Shell.GLSLEffect subclass
lib/styleResolver.js          the theme cascade
lib/cssParse.js               small CSS reader, no GNOME imports
lib/shadowProfile.js          box-shadow to uniforms, no GNOME imports
lib/toolkitProbe.js           /proc/<pid>/maps sniff
shaders/rounded.frag          the fragment shader
stylesheet.css                empty hook for shell themes
tools/adw-probe.js            subprocess that dumps libadwaita's stylesheet
scripts/package.sh            builds the upload archive, never shipped
data/                         icon and screenshots, never loaded at runtime
```

## A shell you can break safely

GNOME 49 dropped `--nested`, so run headless with a virtual monitor. Its own
`XDG_CONFIG_HOME` and `XDG_DATA_HOME` isolate it from your session, which matters on
Wayland where a shell crash logs you out.

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

Point clients at it with `WAYLAND_DISPLAY=rwc-test`. For XWayland, take `DISPLAY` and
`XAUTHORITY` from the shell process or the client fails on the magic cookie.

Two traps. The isolated config persists between runs, so a `color-scheme` left over from
an earlier session will hand you a photo wallpaper when your test expects flat colour. And
with nothing focused the shell sits in the overview, so screenshots catch a scaled preview
instead of the window.

## Testing

`lib/cssParse.js` and `lib/shadowProfile.js` import nothing from GNOME. Copy them
somewhere with a `{"type":"module"}` package.json and run them under `node`.

Test the parser against the real stylesheet, not fixtures:

```bash
gjs -m tools/adw-probe.js > /tmp/adw.css
```

Expect a 15px radius, a 1px outline at `rgba(255,255,255,0.07)` rising to `0.30` under
high contrast, and a three-layer shadow whose last layer goes from alpha 0.05 to 0.80.

To check corners, put a window at a known position, screenshot the stage, and fit a radius
to the measured coverage. Give the window a solid saturated fill and the desktop a flat
background in a different channel, then read coverage from one channel. The shadow is
black, so it does not interfere. Blue window, green background works.

## Packaging

```bash
./scripts/package.sh
```

Builds the upload archive into `dist/`, which is gitignored.

`gnome-extensions pack` with no arguments ships `metadata.json`, `extension.js` and
`stylesheet.css` and nothing else, silently dropping `lib/`, `shaders/` and `tools/`. The
result installs, enables, and does nothing. The script names every source and then checks
the archive actually contains each runtime file, so that failure cannot come back.

If you add a new runtime directory, add it to both `RUNTIME` and the `--extra-source`
flags in the script. The check will tell you if you forget.

`scripts/` is build-time and never shipped. `tools/` is runtime and is.

## data/

Never loaded at runtime. GNOME Shell validates only `uuid`, `name`, `description` and
`shell-version` from `metadata.json`, and shows no per-extension icon.
extensions.gnome.org shows an icon and screenshot but stores what you upload through its
form, not what is in the package.

Regenerate the icon PNG:

```bash
magick -background none data/icon.svg -resize 128x128 -depth 8 -strip PNG32:data/icon.png
```

The screenshots are already at best compression. Re-encoding makes them 22% larger.

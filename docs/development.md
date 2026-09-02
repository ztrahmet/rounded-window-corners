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
tests/unit/                   node tests for the two GNOME-free modules
tests/integration/            headless shell tests, one container per version
.github/workflows/            what CI runs, and when
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

Point clients at it with `WAYLAND_DISPLAY=rwc-test`. For XWayland, take `DISPLAY` from
the shell's own log line and the cookie from the newest
`/run/user/$UID/.mutter-Xwaylandauth.*`, or the client fails on the magic cookie. The
shell process environment is no help here: mutter writes that file after starting, so the
value it was launched with is a stale one from an earlier run.

Two traps. The isolated config persists between runs, so a `color-scheme` left over from
an earlier session will hand you a photo wallpaper when your test expects flat colour. And
with nothing focused the shell sits in the overview, so screenshots catch a scaled preview
instead of the window.

## Testing

Two layers, both runnable by hand and both run by CI.

```bash
./tests/unit/run.sh                      # no GNOME needed, about a second
tests/integration/                       # a real shell per GNOME version
```

`lib/cssParse.js` and `lib/shadowProfile.js` import nothing from GNOME, so the unit tests
run under plain `node`. The runner copies them somewhere with a `{"type":"module"}`
package.json first, because the extension deliberately ships none.

The integration tests start a headless GNOME Shell in a container, one per claimed
version: Fedora 42 is GNOME 48, 43 is 49, 44 is 50. Adding a version is one line in the
matrix in `.github/workflows/integration.yml`.

```bash
podman build -f tests/integration/Containerfile --build-arg FEDORA=44 -t rwc-test tests/integration/
podman run --rm --user 0 -v "$PWD:/src:ro,z" -v "$PWD/tests:/tests:ro,z" \
    rwc-test /tests/integration/entrypoint.sh
```

Three things about that container are not obvious, and each one costs an afternoon to
rediscover. The image ships `/run/systemd/seats` but no logind, so the shell picks its
systemd login manager and aborts during startup; deleting `/run/systemd` makes it use the
dummy one. XWayland needs `/tmp/.X11-unix` at mode 1777, and on GNOME 48 a failed
XWayland start is fatal to the whole shell rather than a warning. And a system bus has to
run alongside the session bus from `dbus-run-session`.

Mutter needs no GPU: with no `/dev/dri` it says `Created surfaceless renderer without GPU`
and carries on. Nothing has to be privileged.

What that costs is pixels. There is no output surface, so nothing drives a frame clock and
framebuffer readback gives back empty images: every screenshot method returns success and
writes a zero byte file. The integration tests therefore assert the state and geometry fed
to the shader, including that Clutter still pads the paint volume by 3px, rather than the
pixels it produces. Rendering itself is checked by hand on real hardware, as below.

`tests/integration/drift-canary.js` compares the live libadwaita stylesheet against the
constants in `lib/styleResolver.js`, so a change in Adwaita shows up as a test result
rather than as a surprise. It reports rather than fails when it cannot find the stylesheet
at all, which is the case on libadwaita 1.7 and 1.8.

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

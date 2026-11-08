#!/usr/bin/env bash
# Functional tests against a real headless GNOME Shell. The checks run inside the shell are in helpers.js.
set -u
UUID=rounded-window-corners@ztrahmet.github.io
EXT_SRC=${EXT_SRC:-/src}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=/tmp/rwc
PASS=0; FAIL=0

rm -rf $ROOT; mkdir -p $ROOT/{config,cache,data/gnome-shell/extensions,log}
# Installing an extension compiles its settings schemas, which neither the source nor the package has.
EXT=$ROOT/data/gnome-shell/extensions/$UUID
cp -r "$EXT_SRC" $EXT
glib-compile-schemas --strict $EXT/schemas

# Flips unsafe mode so the harness can drive the shell over D-Bus.
H=$ROOT/data/gnome-shell/extensions/rwc-test-helper@local; mkdir -p $H
printf '%s\n' '{"name":"RWC Test Helper","description":"Test only.","uuid":"rwc-test-helper@local","shell-version":["51"]}' > $H/metadata.json
cat > $H/extension.js <<'JS'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class TestHelper extends Extension {
    enable() { global.context.unsafe_mode = true; }
    disable() { global.context.unsafe_mode = false; }
}
JS

export XDG_CONFIG_HOME=$ROOT/config XDG_DATA_HOME=$ROOT/data XDG_CACHE_HOME=$ROOT/cache
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/1000}

dbus-run-session -- bash -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"rounded-window-corners@ztrahmet.github.io\",\"rwc-test-helper@local\"]"
  gsettings set org.gnome.desktop.background picture-uri ""
  gsettings set org.gnome.desktop.interface enable-animations false
  exec gnome-shell --headless --virtual-monitor 1440x900 --wayland-display=rwc-ci
' > $ROOT/log/shell.log 2>&1 &

find_shell() {
  for d in /proc/[0-9]*; do
    [ "$(cat $d/comm 2>/dev/null)" = "gnome-shell" ] && { echo "${d#/proc/}"; return 0; }
  done
  return 1
}
for _ in $(seq 40); do SPID=$(find_shell) && break; sleep 1; done
if [ -z "${SPID:-}" ]; then
  echo "FATAL: gnome-shell did not start"; tail -25 $ROOT/log/shell.log; exit 1
fi
sleep 8
BUS=$(tr '\0' '\n' < /proc/$SPID/environ | grep '^DBUS_SESSION_BUS_ADDRESS=' | cut -d= -f2-)

ev() { DBUS_SESSION_BUS_ADDRESS=$BUS gdbus call --session --dest org.gnome.Shell \
        --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1" 2>/dev/null; }
gset() { DBUS_SESSION_BUS_ADDRESS=$BUS gsettings "$@"; }
val() { ev "$1" | sed 's/^(true, .//; s/.)$//; s/^"//; s/"$//'; }
chk() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1));
        else echo "  FAIL  $1 (want '$2' got '$3')"; FAIL=$((FAIL+1)); fi; }
# Polls a JS expression for up to 15 s and prints its last value.
wait_for() {
  local want=$1 expr=$2 got=
  for _ in $(seq 75); do
    got=$(val "$expr")
    [ "$got" = "$want" ] && break
    sleep 0.2
  done
  printf '%s' "$got"
}
# Waits for the test's own setup, without which the checks would mean nothing.
need() {
  local got
  got=$(wait_for "$1" "$2")
  [ "$got" = "$1" ] || { echo "FATAL: $3 (want '$1' got '$got')"; exit 1; }
}
# Captures the screen and prints the measure a JS expression takes of it, or why there is none.
measure() {
  local got=
  ev "rwcTest.capture(); 0" >/dev/null
  for _ in $(seq 50); do
    got=$(val "$1")
    [ "$got" != pending ] && break
    sleep 0.2
  done
  printf '%s' "$got"
}

# Test windows: Wayland GTK3, XWayland GTK3, libadwaita.
wl='global.get_window_actors().find(a=>a.metaWindow.get_client_type()!==Meta.WindowClientType.X11 && /rwc|gjs/i.test(a.metaWindow.get_wm_class()||""))'
x11='global.get_window_actors().find(a=>a.metaWindow.get_client_type()===Meta.WindowClientType.X11)'
adw='global.get_window_actors().find(a=>/adwaita/i.test(a.metaWindow.get_wm_class()||""))'
windows='""+global.get_window_actors().length'
rounded() { echo "\"\"+rwcTest.rounded($1)"; }
# GJS can deadlock collecting a Gio.Settings while dconf delivers a change to it (GNOME/gjs!1134), so the settings of
# the disabled extension are collected at once, before the next change.
disable_ext() {
  ev "Main.extensionManager.disableExtension('$UUID'); 0" >/dev/null
  wait_for 2 "''+Main.extensionManager.lookup('$UUID').state" >/dev/null
  ev "imports.system.gc(); 0" >/dev/null
}

echo "$(gnome-shell --version)"
ev "$(cat "$HERE/helpers.js"); 0" >/dev/null
if [ "$(val 'typeof rwcTest')" != "object" ]; then
  echo "FATAL: helpers.js did not load"; exit 1
fi
chk "extension enables cleanly" "1|none" \
  "$(wait_for '1|none' "const e=Main.extensionManager.lookup('$UUID'); \`\${e.state}|\${e.error||'none'}\`")"

# Re-sync while the new windows are still being probed, as a style change can; the libadwaita window must still be left alone.
ev "globalThis.rwcHook = global.display.connect('window-created', () => rwcTest.tracker()._syncAll()); 0" >/dev/null

CLIENT=/tests/integration/clients/bordered-gtk3.js
open_wl() { WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland gjs $CLIENT >/dev/null 2>&1 & }
open_wl
WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland adwaita-1-demo >/dev/null 2>&1 &
XDISPLAY=$(grep -oE 'public X11 display :[0-9]+' $ROOT/log/shell.log | tail -1 | grep -oE ':[0-9]+')
XAUTH=$(ls -t /run/user/1000/.mutter-Xwaylandauth.* 2>/dev/null | head -1)
open_x11() { DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH GDK_BACKEND=x11 gjs $CLIENT >/dev/null 2>&1 & }
open_x11
need 3 "$windows" "the test windows did not open"
ev 'global.display.disconnect(rwcHook); Main.overview.hide(); 0' >/dev/null
echo "  windows: $(val 'global.get_window_actors().map(a=>a.metaWindow.get_wm_class()+"/"+(a.metaWindow.get_client_type()===Meta.WindowClientType.X11?"x11":"wl")).join(" ")')"

chk "non-libadwaita window is rounded" "true" "$(wait_for true "$(rounded "$wl")")"
chk "X11 window is rounded" "true" "$(wait_for true "$(rounded "$x11")")"
# Nothing to wait for when the answer is "never", so let the probes settle.
sleep 1
chk "libadwaita window is left alone" "false" "$(val "$(rounded "$adw")")"

# Popups are never rounded, so they are neither probed nor tracked.
ev "globalThis.rwcPopups = [];
    globalThis.rwcHook = global.display.connect('window-created', (d, w) =>
      rwcPopups.push(\`\${w.get_window_type() === Meta.WindowType.NORMAL}/\${rwcTest.tracker()._windows.has(w.get_compositor_private())}\`)); 0" >/dev/null
POPOVER=/tests/integration/clients/popover-gtk4.js
WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland gjs $POPOVER >/dev/null 2>&1 &
DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH GDK_BACKEND=x11 gjs $POPOVER >/dev/null 2>&1 &
wait_for 7 "$windows" >/dev/null
# Each entry is normal/tracked.
chk "windows are tracked, their popups are not" "false/false,false/false,true/true,true/true" \
  "$(val 'global.display.disconnect(rwcHook); rwcPopups.sort().join()')"
ev 'global.get_window_actors().filter(a => a.metaWindow.get_title() === "rwc-popover")
    .forEach(a => a.metaWindow.delete(global.get_current_time())); 0' >/dev/null
need 3 "$windows" "the popover windows did not close"

ev "rwcTest.spy(rwcTest.effect($wl)); const t = rwcTest.tracker(); t._windows.forEach(w => w && (w._updated = [])); t._syncAll(); 0" >/dev/null
chk "Wayland: effect bounds match the window frame" "ok" "$(wait_for ok "rwcTest.boundsError($wl) || 'ok'")"
chk "X11: effect bounds match the window frame" "ok" "$(wait_for ok "rwcTest.boundsError($x11) || 'ok'")"
# On X11 the effect goes on the window actor too, so it replaces mutter's own shadow.
chk "X11: effect on the window actor, not its surface" "true|0" \
  "$(val "const a=$x11; \`\${rwcTest.rounded(a)}|\${a.get_children().filter(rwcTest.ours).length}\`")"

# The look changes only after the app redraws (#12), so the same call must still see the old one.
for kind in Wayland X11; do
  a=$wl; [ $kind = X11 ] && a=$x11
  chk "$kind: maximizing keeps the rounding until the app redraws" "true" \
    "$(val "$a.metaWindow.maximize(); $(rounded "$a")")"
  chk "$kind: maximized: effect off" "false" "$(wait_for false "$(rounded "$a")")"
  chk "$kind: unmaximizing stays square until the app redraws" "false" \
    "$(val "$a.metaWindow.unmaximize(); $(rounded "$a")")"
  chk "$kind: unmaximized: effect restored at the right bounds" "true|ok" \
    "$(wait_for 'true|ok' "$(rounded "$a")+'|'+(rwcTest.boundsError($a) || 'ok')")"
done
chk "fullscreen keeps the rounding until the app redraws" "true" \
  "$(val "$wl.metaWindow.make_fullscreen(); $(rounded "$wl")")"
chk "fullscreen: effect off" "false" "$(wait_for false "$(rounded "$wl")")"
# mutter only scans a fullscreen window out directly when its paint box is the monitor.
chk "fullscreen: the paint box is the monitor" "ok" \
  "$(val "const a=$wl; const [, b]=a.get_paint_box(); const m=global.display.get_monitor_geometry(a.metaWindow.get_monitor());
     const box=[b.x1, b.y1, b.x2, b.y2].map(Math.round);
     ''+box === ''+[m.x, m.y, m.x + m.width, m.y + m.height] ? 'ok' : ''+box")"
chk "leaving fullscreen stays square until the app redraws" "false" \
  "$(val "$wl.metaWindow.unmake_fullscreen(); $(rounded "$wl")")"
chk "unfullscreen: effect restored" "true" "$(wait_for true "$(rounded "$wl")")"

# An offscreen effect added later, like the Shell's dimmer, must come after ours or it cuts the shadow.
ev "$wl.add_effect_with_name('foreign-dimmer', new imports.gi.Clutter.BrightnessContrastEffect());
    $wl.metaWindow.maximize(); 0" >/dev/null
wait_for false "$(rounded "$wl")" >/dev/null
ev "$wl.metaWindow.unmaximize(); 0" >/dev/null
wait_for true "$(rounded "$wl")" >/dev/null
chk "a later offscreen effect stays after ours" "rounded-window-corners-room,rounded-window-corners,foreign-dimmer" \
  "$(val "$wl.get_effects().map(e=>e.get_name()).join()")"
ev "$wl.remove_effect_by_name('foreign-dimmer'); 0" >/dev/null
# So must one the window already has when the extension is enabled, like the Shell's dimmer after unlocking.
disable_ext
ev "$wl.add_effect_with_name('earlier-dimmer', new imports.gi.Clutter.BrightnessContrastEffect()); 0" >/dev/null
ev "Main.extensionManager.enableExtension('$UUID'); 0" >/dev/null
chk "an earlier offscreen effect goes after ours" "rounded-window-corners-room,rounded-window-corners,earlier-dimmer" \
  "$(wait_for rounded-window-corners-room,rounded-window-corners,earlier-dimmer "$wl.get_effects().map(e=>e.get_name()).join()")"
ev "$wl.remove_effect_by_name('earlier-dimmer'); 0" >/dev/null

for size in "700 500" "900 650" "800 600"; do
  ev "$x11.metaWindow.move_resize_frame(true, 100, 100, ${size% *}, ${size#* }); 0" >/dev/null; sleep 0.3
done
chk "X11: bounds follow every resize" "ok" "$(wait_for ok "rwcTest.boundsError($x11) || 'ok'")"
# Spoil the bounds, then let only the app's picture report a new size: the bounds must recover.
ev "const a=$x11; const e=rwcTest.effect(a);
    e.update([0, 0, 1, 1], ...e.rwcArgs.slice(1)); rwcTest.tracker()._windows.get(a)._updated = [];
    a.get_texture().emit('size-changed'); 0" >/dev/null
chk "X11: a late redraw re-syncs the bounds" "ok" "$(wait_for ok "rwcTest.boundsError($x11) || 'ok'")"
ev "$wl.metaWindow.move_resize_frame(true, 300, 200, 640, 480); 0" >/dev/null
chk "Wayland: bounds follow a resize" "ok" "$(wait_for ok "rwcTest.boundsError($wl) || 'ok'")"

# A type change reaches an unfocused X11 window, which gets no other update for it (#16).
ev "$wl.metaWindow.activate(global.get_current_time()); 0" >/dev/null
wait_for false "''+$x11.metaWindow.appearsFocused" >/dev/null
XID=$(val "$x11.metaWindow.get_description().split(' ')[0]")
retype() { DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH xprop -id $XID -f _NET_WM_WINDOW_TYPE 32a -set _NET_WM_WINDOW_TYPE _NET_WM_WINDOW_TYPE_$1; }
retype UTILITY
chk "X11: an unfocused window that becomes a utility window is not rounded" "false" "$(wait_for false "$(rounded "$x11")")"
retype NORMAL
chk "X11: it is rounded again once it becomes a normal window" "true" "$(wait_for true "$(rounded "$x11")")"

# The shader relies on Clutter's framebuffer padding, which no API exposes, so catch it changing.
chk "offscreen padding is still +3, and the effect has painted" "true|true" \
  "$(wait_for 'true|true' "const a=$wl; const r=rwcTest.effect(a).get_target_size();
     const v=a.get_paint_volume(); const s=a.get_resource_scale();
     \`\${r[0]}|\${r[1]===(Math.round(v.get_width())+3)*s && r[2]===(Math.round(v.get_height())+3)*s}\`")"

# gtk.css edits must reach the effect live. At a radius of 0 the window keeps its outline and shadow, as in libadwaita.
mkdir -p $ROOT/config/gtk-4.0
radii="\"\"+rwcTest.effect($wl).rwcArgs[1]"
printf 'window.csd { border-radius: 0px; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "a live gtk.css radius of 0 keeps the effect, with square corners" "true|0,0,0,0" \
  "$(wait_for 'true|0,0,0,0' "$(rounded "$wl")+'|'+$radii")"
printf 'window.csd { border-radius: 7px; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "a live gtk.css radius reaches the effect" "7,7,7,7" "$(wait_for 7,7,7,7 "$radii")"
printf 'window.csd { border-radius: 20px 20px 0 0; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "each corner keeps its own radius" "20,20,0,0" "$(wait_for 20,20,0,0 "$radii")"
rm -f $ROOT/config/gtk-4.0/gtk.css
chk "removing it restores libadwaita's radius" "15,15,15,15" "$(wait_for 15,15,15,15 "$radii")"

# libadwaita's values as the effect is given them, following the system settings.
outline="const [, r, l]=rwcTest.effect($wl).rwcArgs; \`\${r[0]}|\${l.outlineWidth}|\${l.outlineOffset}|\${l.outlineColor.map(v=>v.toFixed(2))}\`"
chk "libadwaita: radius, outline and offset" "15|1|-1|1.00,1.00,1.00,0.07" "$(wait_for '15|1|-1|1.00,1.00,1.00,0.07' "$outline")"
gset set org.gnome.desktop.a11y.interface high-contrast true
chk "high contrast: libadwaita's outline" "15|1|-1|1.00,1.00,1.00,0.30" "$(wait_for '15|1|-1|1.00,1.00,1.00,0.30' "$outline")"
gset set org.gnome.desktop.a11y.interface high-contrast false
printf 'window { outline: 2px solid; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "an outline without a color takes the window's" "15|2|-1|0.00,0.00,0.02,0.80" "$(wait_for '15|2|-1|0.00,0.00,0.02,0.80' "$outline")"
gset set org.gnome.desktop.interface color-scheme prefer-dark
chk "dark: the window's color is libadwaita's" "15|2|-1|1.00,1.00,1.00,1.00" "$(wait_for '15|2|-1|1.00,1.00,1.00,1.00' "$outline")"
gset set org.gnome.desktop.interface color-scheme default

printf 'window { outline-color: red; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "a color name reaches the effect" "15|1|-1|1.00,0.00,0.00,1.00" "$(wait_for '15|1|-1|1.00,0.00,0.00,1.00' "$outline")"
# The outline follows focus, as libadwaita's does (#17).
printf 'window { outline: 2px solid red; }\nwindow:backdrop { outline-color: blue; }\n' > $ROOT/config/gtk-4.0/gtk.css
ev "$wl.metaWindow.activate(global.get_current_time()); 0" >/dev/null
chk "focused: the focused outline" "15|2|-1|1.00,0.00,0.00,1.00" "$(wait_for '15|2|-1|1.00,0.00,0.00,1.00' "$outline")"
ev "$x11.metaWindow.activate(global.get_current_time()); 0" >/dev/null
chk "backdrop: the backdrop outline" "15|2|-1|0.00,0.00,1.00,1.00" "$(wait_for '15|2|-1|0.00,0.00,1.00,1.00' "$outline")"
# Only libadwaita's own stylesheet defines --accent-bg-color.
printf 'window { outline-color: var(--accent-bg-color); }\n' > $ROOT/config/gtk-4.0/gtk.css
gset set org.gnome.desktop.interface accent-color teal
chk "the system accent color reaches the effect" "15|1|-1|0.13,0.56,0.64,1.00" "$(wait_for '15|1|-1|0.13,0.56,0.64,1.00' "$outline")"
# libadwaita computes --accent-color with oklab(); GTK names the desktop's accent accent_color.
printf 'window { outline-color: var(--accent-color); }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "libadwaita's computed accent color reaches the effect" "15|1|-1|0.00,0.44,0.52,1.00" "$(wait_for '15|1|-1|0.00,0.44,0.52,1.00' "$outline")"
printf 'window { outline-color: @accent_color; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "the desktop's accent_color reaches the effect" "15|1|-1|0.13,0.56,0.64,1.00" "$(wait_for '15|1|-1|0.13,0.56,0.64,1.00' "$outline")"
gset reset org.gnome.desktop.interface accent-color

printf 'window { box-shadow: 0 3px 9px 1px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.75); }\n' > $ROOT/config/gtk-4.0/gtk.css
layers="rwcTest.effect($wl).rwcArgs[2].slots.filter(s => s.color[3] > 0).map(s => s.shape.join(' ')).join('|')"
chk "each shadow layer keeps its own offset, in GTK's order" "0 3 1 4.5|0 0 1 0" "$(wait_for '0 3 1 4.5|0 0 1 0' "$layers")"
# A wider shadow grows the window's framebuffer, which must be drawn again, not reused from before.
printf 'window { box-shadow: 0 8px 40px 12px rgba(0,0,0,.6); }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "a wider shadow redraws an idle window at its new size" "true" \
  "$(wait_for true "const a=$wl; const r=rwcTest.effect(a).get_target_size();
     const v=a.get_paint_volume(); const s=a.get_resource_scale();
     ''+(r[1]===(Math.round(v.get_width())+3)*s && r[2]===(Math.round(v.get_height())+3)*s)")"

# libadwaita ignores the GTK theme, so the extension must too.
theme=$(for t in Yaru Arc-Dark Breeze; do [ -e /usr/share/themes/$t/gtk-4.0/gtk.css ] && echo $t && break; done)
if [ -z "$theme" ]; then
  echo "  SKIP  the GTK theme is ignored (needs one of the GTK 4 themes from the Containerfile)"
else
  gset set org.gnome.desktop.interface gtk-theme $theme
  printf 'window { outline-width: 3px; }\n' > $ROOT/config/gtk-4.0/gtk.css
  chk "the GTK theme is ignored" "15|3" "$(wait_for '15|3' "const a=rwcTest.effect($wl).rwcArgs; a[1][0]+'|'+a[2].outlineWidth")"
  gset reset org.gnome.desktop.interface gtk-theme
fi
rm -f $ROOT/config/gtk-4.0/gtk.css

# The settings apply live, as when the preferences change them.
SCHEMA=org.gnome.shell.extensions.rounded-window-corners-native
eset() { gset --schemadir $EXT/schemas set $SCHEMA "$@"; }
eget() { gset --schemadir $EXT/schemas get $SCHEMA "$@"; }
app_of() { val "imports.gi.Shell.WindowTracker.get_default().get_window_app(($1).metaWindow).get_id()"; }
WL_APP=$(app_of "$wl"); X11_APP=$(app_of "$x11"); ADW_APP=$(app_of "$adw")
# Whether the Wayland, X11 and libadwaita windows are rounded.
states="[$wl,$x11,$adw].map(rwcTest.rounded).join()"
eset round-libadwaita-apps true
chk "settings: Round libadwaita Apps rounds the libadwaita window" "true,true,true" "$(wait_for true,true,true "$states")"
eset round-libadwaita-apps false
chk "settings: and turned off, leaves it alone again" "true,true,false" "$(wait_for true,true,false "$states")"

# Tiled and maximized windows take libadwaita's look for them: square, no outline, and only a 1 px line around a tiled
# window; maximized, nothing, so no effect at all.
look="(() => { const a = rwcTest.effect($wl).rwcArgs; return a[1][0] + '|' + a[2].outlineWidth + '|' + a[2].slots.filter(s => s.color[3] > 0).map(s => s.shape.join(' ')).join(); })()"
ev "$wl.metaWindow.set_maximize_flags(Meta.MaximizeFlags.VERTICAL); 0" >/dev/null
chk "a tiled window is square, with libadwaita's line for its outline and shadow" "true|0|0|0 0 1 0" \
  "$(wait_for 'true|0|0|0 0 1 0' "$(rounded "$wl")+'|'+$look")"
printf 'window.csd.tiled, window.csd.tiled-left { --window-radius: 6px; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "gtk.css can round tiled windows" "true|6|0|0 0 1 0" "$(wait_for 'true|6|0|0 0 1 0' "$(rounded "$wl")+'|'+$look")"
rm -f $ROOT/config/gtk-4.0/gtk.css
ev "$wl.metaWindow.maximize(); 0" >/dev/null
chk "a maximized window has no effect" "false" "$(wait_for false "$(rounded "$wl")")"
eset round-maximized true
chk "settings: a maximized window stays rounded, without an outline or shadow" "true|15|0|" \
  "$(wait_for 'true|15|0|' "$(rounded "$wl")+'|'+$look")"
ev "$wl.metaWindow.set_maximize_flags(Meta.MaximizeFlags.VERTICAL); $wl.metaWindow.unmaximize(); $wl.metaWindow.set_maximize_flags(Meta.MaximizeFlags.VERTICAL); 0" >/dev/null
chk "settings: a tiled window stays rounded, with libadwaita's line" "true|15|0|0 0 1 0" \
  "$(wait_for 'true|15|0|0 0 1 0' "$(rounded "$wl")+'|'+$look")"
ev "$wl.metaWindow.maximize(); 0" >/dev/null
eset round-maximized false
chk "settings: and turned off, a maximized window loses it again" "false" "$(wait_for false "$(rounded "$wl")")"
ev "$wl.metaWindow.unmaximize(); 0" >/dev/null
wait_for true "$(rounded "$wl")" >/dev/null

eset blocklist "['$WL_APP']"
chk "settings: a blocklisted app is not rounded" "false,true,false" "$(wait_for false,true,false "$states")"
eset blocklist "[]"; eset blocklist-toolkits "['gtk3']"
chk "settings: nor are the apps of a blocklisted toolkit" "false,false,false" "$(wait_for false,false,false "$states")"
eset blocklist-toolkits "[]"; eset use-allowlist true; eset allowlist "['$WL_APP']"
chk "settings: with the allowlist, only its apps are rounded" "true,false,false" "$(wait_for true,false,false "$states")"
eset allowlist "[]"; eset allowlist-toolkits "['libadwaita']"
chk "settings: an allowlisted toolkit is rounded whatever its switch" "false,false,true" "$(wait_for false,false,true "$states")"
eset allowlist-toolkits "[]"; eset use-allowlist false

# A window whose WM class changes moves to another app, and the lists must follow once the Shell has found it.
reclass() { DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH python3 -c '
import ctypes, sys
x = ctypes.CDLL("libX11.so.6")
class Hint(ctypes.Structure):
    _fields_ = [("res_name", ctypes.c_char_p), ("res_class", ctypes.c_char_p)]
x.XOpenDisplay.restype = ctypes.c_void_p
x.XSetClassHint.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(Hint)]
x.XCloseDisplay.argtypes = [ctypes.c_void_p]
d = x.XOpenDisplay(None)
x.XSetClassHint(d, int(sys.argv[1], 16), ctypes.byref(Hint(sys.argv[2].encode(), sys.argv[3].encode())))
x.XCloseDisplay(d)' $XID "$1" "$2"; }
X11_CLASS=($(val "const w=$x11.metaWindow; w.get_wm_class_instance()+' '+w.get_wm_class()"))
x11_app="imports.gi.Shell.WindowTracker.get_default().get_window_app($x11.metaWindow).get_id()"
ev "$wl.metaWindow.activate(global.get_current_time()); 0" >/dev/null
eset blocklist "['org.gnome.Settings.desktop']"
reclass org.gnome.Settings org.gnome.Settings
need org.gnome.Settings.desktop "$x11_app" "the X11 window did not move to org.gnome.Settings.desktop"
# Read at once: the window syncs in the same signal as the Shell's change, and a later unrelated sync would hide a missed one.
chk "settings: a window that becomes a blocklisted app is not rounded" "false" "$(val "$(rounded "$x11")")"
reclass "${X11_CLASS[@]}"
need "$X11_APP" "$x11_app" "the X11 window did not move back to its own app"
chk "settings: and it is rounded again once it changes back" "true" "$(val "$(rounded "$x11")")"
eset blocklist "[]"

# The Shell gives a dialog from another process, like the file chooser portal's, and that dialog's own dialog the app
# they are over; their own app's settings apply.
DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH GDK_BACKEND=x11 gjs /tests/integration/clients/foreign-dialog-gtk3.js $XID >/dev/null 2>&1 &
foreign='global.get_window_actors().find(a=>a.metaWindow.get_title()==="rwc-foreign")'
sub='global.get_window_actors().find(a=>a.metaWindow.get_title()==="rwc-foreign-sub")'
need "$X11_APP,$X11_APP" "const d=($foreign)?.metaWindow, s=($sub)?.metaWindow, shell=imports.gi.Shell.WindowTracker.get_default();
  d?.get_transient_for() === ($x11).metaWindow && s?.get_transient_for() === d ? [d, s].map(w => shell.get_window_app(w).get_id()).join() : 'none'" \
  "the Shell did not give the foreign dialog and its own dialog the X11 window's app"
dialogs="[$x11,$foreign,$sub].map(rwcTest.rounded).join()"
eset blocklist "['$X11_APP']"
chk "settings: a dialog from another process, and its own dialog, do not follow the app they are over onto the blocklist" \
  "false,true,true" "$(wait_for false,true,true "$dialogs")"
eset blocklist "['org.gnome.Settings.desktop']"
chk "settings: but follow their own app onto it" "true,false,false" "$(wait_for true,false,false "$dialogs")"
eset blocklist "[]"
eset app-styles "{'$X11_APP': {'custom-style': <true>, 'corner-radius': <21>}}"
chk "settings: nor take that app's style" "21,15,15" \
  "$(wait_for 21,15,15 "[$x11,$foreign,$sub].map(a=>rwcTest.effect(a).rwcArgs[1][0]).join()")"
eset app-styles "{}"
ev "($foreign).metaWindow.delete(global.get_current_time()); 0" >/dev/null
need 3 "$windows" "the foreign dialog did not close"

eset custom-style true; eset corner-radius 9
eset outline-color "'rgb(255,0,0)'"; eset outline-opacity 0.5
chk "settings: the custom style reaches the effect" "9|1|-1|1.00,0.00,0.00,0.50" "$(wait_for '9|1|-1|1.00,0.00,0.00,0.50' "$outline")"
eset outline-position "'outside'"
chk "settings: the outline position reaches the effect" "9|1|0|1.00,0.00,0.00,0.50" "$(wait_for '9|1|0|1.00,0.00,0.00,0.50' "$outline")"
eset outline-position "'inside'"
# With the custom style gtk.css is not read, and an edit made meanwhile counts once it is off again.
radius="''+rwcTest.effect($wl).rwcArgs[1][0]"
printf 'window.csd { border-radius: 7px; }\n' > $ROOT/config/gtk-4.0/gtk.css
sleep 1.5
chk "settings: the custom style stops reading gtk.css" "9|15" \
  "$(val "$radius+'|'+rwcTest.tracker()._styles.style.normal.radii[0]")"
eset custom-style false
chk "settings: and turned off, gtk.css counts again" "7" "$(wait_for 7 "$radius")"
rm -f $ROOT/config/gtk-4.0/gtk.css
eset custom-style true
wait_for 9 "$radius" >/dev/null

# The test windows are GTK 3, whose toolkit is listed out of the box with the border left alone.
eset toolkit-styles "{}"
eset border-method "'clip'"; eset border-width 3
chk "settings: the border method reaches the effect" "clip|3" "$(wait_for 'clip|3' "rwcTest.effect($wl).rwcArgs.slice(3).join('|')")"
# The outline covers the app's border, so drop it to measure the border alone.
eset outline-width 0
ev "const w = ($wl).metaWindow; w.move_resize_frame(true, 40, 40, 400, 300); w.activate(global.get_current_time()); 0" >/dev/null
wait_for ok "rwcTest.boundsError($wl) || 'ok'" >/dev/null
border_with() {
  eset border-method "'$1'"
  wait_for "$1" "rwcTest.effect($wl).rwcArgs[3]" >/dev/null
  sleep 0.5
  measure "rwcTest.borderShowing($wl)"
}
border_off=$(border_with off)
border_clip=$(border_with clip)
# Some renderers capture the screen in other colors than the app draws, which the border measures can't read.
colors=$(measure "rwcTest.trueColors($wl)")
if [ "$border_off" = unsupported ]; then
  echo "  SKIP  settings: Off shows the app's border and Clip cuts it off (needs --privileged)"
elif [ "$colors" != ok ]; then
  echo "  SKIP  settings: Off shows the app's border and Clip cuts it off (the capture shows the window's blue as $colors)"
else
  chk "settings: Off shows the app's border and Clip cuts it off" "shown|hidden" \
    "$(awk -v o=$border_off -v c=$border_clip 'BEGIN { print ((o > 0.5) ? "shown" : "hidden " o) "|" ((c < 0.05) ? "hidden" : "showing " c) }')"
fi

eset toolkit-styles "{'gtk3': {'custom-style': <true>, 'corner-radius': <4>}}"
eset app-styles "{'$X11_APP': {'custom-style': <true>, 'corner-radius': <21>}, '$ADW_APP': {}}"
entries="[$wl,$x11,$adw].map(a=>rwcTest.rounded(a) && rwcTest.effect(a).rwcArgs[1][0]).join()"
# The X11 app's own style comes before its toolkit's, and an entry doesn't round the libadwaita app; its switch does.
chk "settings: app and toolkit styles come before the general one" "4,21,false" "$(wait_for 4,21,false "$entries")"
eset round-libadwaita-apps true
chk "settings: and the libadwaita app's entry styles it once its switch is on" "4,21,9" "$(wait_for 4,21,9 "$entries")"
# Values of the wrong type or out of range keep their defaults.
eset toolkit-styles "{'gtk3': {'custom-style': <true>, 'corner-radius': <'4'>, 'outline-width': <99>, 'outline-position': <'nowhere'>}}"
chk "settings: an app or toolkit style's invalid values keep their defaults" "15|1|-1" \
  "$(wait_for '15|1|-1' "const a = rwcTest.effect($wl).rwcArgs; a[1][0] + '|' + a[2].outlineWidth + '|' + a[2].outlineOffset")"
eset toolkit-styles "{'gtk3': {'custom-style': <true>, 'corner-radius': <4>}}"
# Marks the effects, so the next check sees only those made after enabling again.
ev "[$wl,$x11,$adw].forEach(a => { rwcTest.effect(a).rwcStale = true; }); 0" >/dev/null
disable_ext
ev "Main.extensionManager.enableExtension('$UUID'); 0" >/dev/null
chk "settings: they apply again after disable and enable" "4,21,9" \
  "$(wait_for 4,21,9 "[$wl,$x11,$adw].map(a=>rwcTest.rounded(a) && !rwcTest.effect(a).rwcStale && rwcTest.effect(a).rwcArgs[1][0]).join()")"

gset --schemadir $EXT/schemas reset-recursively $SCHEMA
chk "settings: resetting them all restores libadwaita's style" "15,15,false" \
  "$(wait_for 15,15,false "[$wl,$x11,$adw].map(a=>rwcTest.rounded(a) && rwcTest.effect(a).rwcArgs[1][0]).join()")"
borders="[$wl,$x11].map(a=>rwcTest.effect(a).rwcArgs[3]).join()"
chk "settings: GTK 3 apps start with their border left alone" "off,off" "$(wait_for off,off "$borders")"
eset app-styles "{'$WL_APP': {}}"
chk "settings: an app's style inherits how its toolkit hides the border" "off,off" "$(wait_for off,off "$borders")"
eset app-styles "{'$WL_APP': {'border-method': <'clip'>}}"
chk "settings: until it sets its own" "clip,off" "$(wait_for clip,off "$borders")"
eset app-styles "{}"
eset toolkit-styles "{}"

# At fractional scales the app's border must stay hidden at every position (#10).
monitor_scale="''+global.display.get_monitor_scale(0)"
smear="''+rwcTest.effect($wl)._smear"
for scale in 1.25 1.5; do
  ev "rwcTest.setScale($scale); 0" >/dev/null
  wait_for $scale "$monitor_scale" >/dev/null
  worst=0
  for x in 40 41 42 43; do
    ev "const w = ($wl).metaWindow; w.move_resize_frame(true, $x, 40, 400, 300); w.activate(global.get_current_time()); 0" >/dev/null
    wait_for ok "rwcTest.boundsError($wl) || 'ok'" >/dev/null
    sleep 0.5
    shown=$(measure "rwcTest.borderShowing($wl)")
    [ "$shown" = unsupported ] && break
    worst=$(awk -v a=$worst -v b=$shown 'BEGIN { print (b > a) ? b : a }')
  done
  chk "at $scale: smear handling is on and the bounds match" "1|ok" \
    "$(val "$smear+'|'+(rwcTest.boundsError($wl) || 'ok')")"
  if [ "$shown" = unsupported ]; then
    echo "  SKIP  at $scale: the app's border stays hidden (needs --privileged)"
  elif [ "$colors" != ok ]; then
    echo "  SKIP  at $scale: the app's border stays hidden (the capture shows the window's blue as $colors)"
  else
    chk "at $scale: the app's border stays hidden at every position" "ok" \
      "$(awk -v w=$worst 'BEGIN { print (w < 0.05) ? "ok" : "showing " w }')"
  fi
done
ev "rwcTest.setScale(1); 0" >/dev/null
wait_for 1 "$monitor_scale" >/dev/null
chk "back at 100%: smear handling is off" "0" "$(wait_for 0 "$smear")"

# Windows that leave no room of their own still get the whole shadow (#14), and on X11 only ours.
RWC_BARE=1 WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland gjs $CLIENT >/dev/null 2>&1 &
RWC_BARE=1 DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH GDK_BACKEND=x11 gjs $CLIENT >/dev/null 2>&1 &
bare='global.get_window_actors().filter(a=>a.metaWindow.get_title()==="rwc-bare")'
bare_wl="$bare.find(a=>!rwcTest.isX11(a))"
bare_x11="$bare.find(a=>rwcTest.isX11(a))"
need '2|0' "const ws=$bare.map(a=>a.metaWindow); ws.length+'|'+Math.max(...ws.map(w=>{const f=w.get_frame_rect(),b=w.get_buffer_rect();
     return Math.max(f.x-b.x,f.y-b.y,b.x+b.width-f.x-f.width,b.y+b.height-f.y-f.height);}))" \
  "the bare windows did not open, or left room of their own"
chk "every rounded window has room for the whole shadow" "ok" \
  "$(wait_for ok "const ws=[...$bare,$wl,$x11]; ws.every(rwcTest.rounded) ?
     ws.map(a=>rwcTest.room(a)).filter(r=>r<27).join() || 'ok' : 'not rounded yet'")"
# Show a window alone in the same place and print how much its shadow darkens the background.
shadow_of() {
  ev "const b=$1; for (const a of global.get_window_actors()) if (a !== b) a.metaWindow.minimize();
      b.metaWindow.unminimize(); b.metaWindow.move_resize_frame(true, 100, 60, 300, 250);
      b.metaWindow.activate(global.get_current_time()); 0" >/dev/null
  wait_for 100,60 "const f=($1).metaWindow.get_frame_rect(); f.x+','+f.y" >/dev/null
  sleep 1
  measure "rwcTest.shadowShowing($1)"
}
shadow_wl=$(shadow_of "$bare_wl")
shadow_x11=$(shadow_of "$bare_x11")
if [ "$shadow_wl" = unsupported ]; then
  echo "  SKIP  the shadow is drawn beside a bare window, once (needs --privileged)"
else
  chk "the shadow is drawn beside a bare window" "ok" \
    "$(val "Number('$shadow_wl'.split(',')[2]) > 0.05 ? 'ok' : 'darkens 3 px out by $shadow_wl'")"
  chk "X11: mutter's own shadow does not add to it" "ok" \
    "$(val "const w='$shadow_wl'.split(',').map(Number), x='$shadow_x11'.split(',').map(Number);
       w.every((v, i) => Math.abs(v - x[i]) < 0.02) ? 'ok' : 'Wayland $shadow_wl, X11 $shadow_x11'")"
fi
# A window that already fills a monitor without the top bar changes state without changing size (#24); its look must
# follow anyway.
struts() { ev "const l = Main.layoutManager; l._trackedActors.find(a => a.actor === l.panelBox).affectsStruts = $1; l._queueUpdateRegions(); 0" >/dev/null; }
struts false
for kind in Wayland X11; do
  a=$bare_wl; [ $kind = X11 ] && a=$bare_x11
  ev "const w=($a).metaWindow, m=global.display.get_monitor_geometry(w.get_monitor()); w.unminimize(); w.move_resize_frame(false, m.x, m.y, m.width, m.height); 0" >/dev/null
  need "true|true" "const w=($a).metaWindow, f=w.get_frame_rect(), m=global.display.get_monitor_geometry(w.get_monitor());
    (f.width===m.width && f.height===m.height)+'|'+rwcTest.rounded($a)" "the $kind bare window did not fill the monitor"
  ev "($a).metaWindow.make_fullscreen(); 0" >/dev/null
  chk "$kind: a window that fills the monitor loses its rounding when it goes fullscreen" "false" "$(wait_for false "$(rounded "$a")")"
  ev "($a).metaWindow.unmake_fullscreen(); 0" >/dev/null
  chk "$kind: and gets it back when it leaves fullscreen" "true" "$(wait_for true "$(rounded "$a")")"
done
struts true
ev "$bare.forEach(a=>a.metaWindow.delete(global.get_current_time()));
    global.get_window_actors().forEach(a=>a.metaWindow.unminimize()); 0" >/dev/null
need 3 "$windows" "the bare windows did not close"

# A window whose main buffer is 1x1, stretched by a viewport, must still show what it draws (#27).
if command -v gst-launch-1.0 >/dev/null; then
  WAYLAND_DISPLAY=rwc-ci gst-launch-1.0 videotestsrc pattern=red ! waylandsink >/dev/null 2>&1 &
  video='global.get_window_actors().find(a=>/gst/i.test(a.metaWindow.get_wm_class()||""))'
  need true "''+!!($video)" "the video window did not open"
  ev "const w=($video).metaWindow; w.move_resize_frame(true, 60, 60, 320, 240); w.activate(global.get_current_time()); 0" >/dev/null
  wait_for 60,60 "const f=($video).metaWindow.get_frame_rect(); f.x+','+f.y" >/dev/null
  sleep 1
  shown=$(measure "rwcTest.colorAt($video)")
  if [ "$shown" = unsupported ]; then
    echo "  SKIP  a viewport-stretched window shows its video (needs --privileged)"
  else
    chk "a viewport-stretched window is rounded and shows its video" "true|red" \
      "$(val "$(rounded "$video")+'|'+('$shown'.split(',').map(Number).every((v, i) => i === 0 ? v > 200 : v < 60) ? 'red' : '$shown')")"
  fi
  ev "($video).metaWindow.delete(global.get_current_time()); 0" >/dev/null
  need 3 "$windows" "the video window did not close"
else
  echo "  SKIP  a viewport-stretched window shows its video (needs GStreamer's waylandsink)"
fi

# Stress: churn windows, states, the style and the extension itself, then audit every window.
open_wl; open_wl; open_x11
need 6 "$windows" "the stress windows did not open"
for _ in $(seq 10); do
  ev 'for (const a of global.get_window_actors()) { a.metaWindow.maximize(); a.metaWindow.unmaximize(); } 0' >/dev/null
done
for i in $(seq 10); do
  ev "for (const a of global.get_window_actors().filter(rwcTest.isX11)) a.metaWindow.move_resize_frame(true, 100, 100, $((500 + i * 30)), $((400 + i * 20))); 0" >/dev/null
done
ev 'for (const a of global.get_window_actors().filter(a => !rwcTest.isAdwaita(a)).slice(0, 2)) a.metaWindow.delete(global.get_current_time()); 0' >/dev/null
need 4 "$windows" "the stress windows did not close"
open_wl; open_x11
need 6 "$windows" "the stress windows did not reopen"
for _ in $(seq 3); do
  ev 'Main.overview.show(); Main.overview.hide(); 0' >/dev/null
  printf 'window.csd { border-radius: 0px; }\n' > $ROOT/config/gtk-4.0/gtk.css; sleep 0.3
  rm -f $ROOT/config/gtk-4.0/gtk.css; sleep 0.3
done
# Enabling and disabling complete asynchronously, so wait for each one.
state="''+Main.extensionManager.lookup('$UUID').state"
for _ in $(seq 5); do
  disable_ext
  ev "Main.extensionManager.enableExtension('$UUID'); 0" >/dev/null
  wait_for 1 "$state" >/dev/null
done
chk "after the stress, every window is in the right state" "ok" "$(wait_for ok 'rwcTest.audit()')"

disable_ext
chk "disable leaves no effects behind" "0" \
  "$(wait_for 0 'let n=0; const walk=a=>{if(a.get_effects)n+=rwcTest.ours(a);a.get_children().forEach(walk);};
     global.get_window_actors().forEach(walk); ""+n')"
ev "Main.extensionManager.enableExtension('$UUID'); 0" >/dev/null
chk "enabling again restores every effect" "ok" "$(wait_for ok 'rwcTest.audit()')"

# The preferences find every file they import, or they open as an error page.
prefs='global.get_window_actors().find(a=>a.metaWindow.get_wm_class()==="org.gnome.Shell.Extensions")'
# The preferences must show these without writing them back: colors spelled unlike GTK, a style that inherits the
# border, and a custom style switch never used.
eset outline-color "'#ffffff'"; eset shadow-color "'red'"; eset toolkit-styles "{'gtk3': {}}"
DBUS_SESSION_BUS_ADDRESS=$BUS gnome-extensions prefs $UUID >/dev/null 2>&1
name=$(val "Main.extensionManager.lookup('$UUID').metadata.name")
chk "the preferences open" "$name" "$(wait_for "$name" "($prefs)?.metaWindow.get_title() ?? 'no window'")"
sleep 1
chk "opening the preferences leaves the stored values alone" "'#ffffff'|'red'|{'gtk3': @a{sv} {}}|unset" \
  "$(eget outline-color)|$(eget shadow-color)|$(eget toolkit-styles)|$(val "rwcTest.tracker()._settings.get_user_value('custom-style') ?? 'unset'")"
gset --schemadir $EXT/schemas reset-recursively $SCHEMA
ev "$prefs.metaWindow.delete(global.get_current_time()); 0" >/dev/null
need false "''+!!($prefs)" "the preferences did not close"

chk "no errors or warnings logged by the extension" "0" \
  "$(grep -cE "rounded-window-corners:|JS ERROR|JS WARNING: [^ ]*$UUID|Unhandled promise rejection" $ROOT/log/shell.log)"

echo; echo "  RESULT: $PASS passed, $FAIL failed"
kill $SPID 2>/dev/null
exit $FAIL

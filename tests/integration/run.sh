#!/usr/bin/env bash
# Functional tests against a real GNOME Shell, headless and without a GPU.
#
# These check the state and geometry each effect is given, not the pixels the
# shader draws. The checks that run inside the shell are in helpers.js.
set -u
UUID=rounded-window-corners@ztrahmet.github.io
EXT_SRC=${EXT_SRC:-/src}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=/tmp/rwc
PASS=0; FAIL=0

# The extension needs the Clutter.ShaderEffect snippet API of GNOME 51. The
# image tracks rawhide, which is not pinned to a release, so an older shell is
# reported rather than failed.
MAJOR=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
if [ "${MAJOR:-0}" -lt 51 ]; then
  echo "$(gnome-shell --version)"
  echo "  SKIP  the extension requires GNOME Shell 51 or newer"
  exit 0
fi

rm -rf $ROOT; mkdir -p $ROOT/{config,cache,data/gnome-shell/extensions,log}
ln -sfn "$EXT_SRC" $ROOT/data/gnome-shell/extensions/$UUID

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
val() { ev "$1" | sed 's/^(true, .//; s/.)$//; s/^"//; s/"$//'; }
chk() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1));
        else echo "  FAIL  $1 (want '$2' got '$3')"; FAIL=$((FAIL+1)); fi; }
# Polls a JS expression until it gives the wanted value, for up to 15s, and
# prints the last value it gave.
wait_for() {
  local want=$1 expr=$2 got=
  for _ in $(seq 75); do
    got=$(val "$expr")
    [ "$got" = "$want" ] && break
    sleep 0.2
  done
  printf '%s' "$got"
}

# Test windows: Wayland GTK3, XWayland GTK3, libadwaita.
wl='global.get_window_actors().find(a=>a.metaWindow.get_client_type()!==Meta.WindowClientType.X11 && /rwc|gjs/i.test(a.metaWindow.get_wm_class()||""))'
x11='global.get_window_actors().find(a=>a.metaWindow.get_client_type()===Meta.WindowClientType.X11)'
adw='global.get_window_actors().find(a=>/adwaita/i.test(a.metaWindow.get_wm_class()||""))'
windows='""+global.get_window_actors().length'
rounded() { echo "\"\"+!!rwcTest.effect(rwcTest.target($1))"; }

echo "$(gnome-shell --version)"
ev "$(cat "$HERE/helpers.js"); 0" >/dev/null
if [ "$(val 'typeof rwcTest')" != "object" ]; then
  echo "FATAL: helpers.js did not load"; exit 1
fi
chk "extension enables cleanly" "1|none" \
  "$(wait_for '1|none' "const e=Main.extensionManager.lookup('$UUID'); \`\${e.state}|\${e.error||'none'}\`")"

# Re-sync from inside window-created, while the extension is still probing the
# new window's toolkit, the way a theme change can.
ev "globalThis.rwcCreated = [];
    globalThis.rwcHook = global.display.connect('window-created', (d, w) => {
      const a = w.get_compositor_private();
      if (!a) return;
      rwcTest.tracker()._syncAll();
      rwcCreated.push([a, !!rwcTest.effect(a)]);
    }); 0" >/dev/null

CLIENT=/tests/integration/clients/bordered-gtk3.js
open_wl() { WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland gjs $CLIENT >/dev/null 2>&1 & }
open_wl
WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland adwaita-1-demo >/dev/null 2>&1 &
XDISPLAY=$(grep -oE 'public X11 display :[0-9]+' $ROOT/log/shell.log | tail -1 | grep -oE ':[0-9]+')
XAUTH=$(ls -t /run/user/1000/.mutter-Xwaylandauth.* 2>/dev/null | head -1)
open_x11() { DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH GDK_BACKEND=x11 gjs $CLIENT >/dev/null 2>&1 & }
open_x11
chk "the test windows opened" "3" "$(wait_for 3 "$windows")"
ev 'global.display.disconnect(rwcHook); Main.overview.hide(); 0' >/dev/null
echo "  windows: $(val 'global.get_window_actors().map(a=>a.metaWindow.get_wm_class()+"/"+(a.metaWindow.get_client_type()===Meta.WindowClientType.X11?"x11":"wl")).join(" ")')"

chk "non-libadwaita window is rounded" "true" "$(wait_for true "$(rounded "$wl")")"
chk "X11 window is rounded" "true" "$(wait_for true "$(rounded "$x11")")"
# Nothing to wait for when the answer is "never", so let the probes settle.
sleep 1
chk "libadwaita window is left alone" "false" "$(val "$(rounded "$adw")")"
chk "a re-sync while probing does not round a libadwaita window" "false" \
  "$(val 'rwcCreated.filter(([a]) => rwcTest.isAdwaita(a)).map(([, e]) => e).join()')"

ev "rwcTest.spy(rwcTest.effect($wl)); rwcTest.tracker()._syncAll(); 0" >/dev/null
chk "Wayland: effect bounds match the window frame" "ok" "$(wait_for ok "rwcTest.boundsError($wl) || 'ok'")"
chk "X11: effect bounds match the window frame" "ok" "$(wait_for ok "rwcTest.boundsError($x11) || 'ok'")"
chk "X11: effect on the surface, not the window actor" "false|true" \
  "$(val "const a=$x11; \`\${!!rwcTest.effect(a)}|\${!!rwcTest.effect(rwcTest.surface(a))}\`")"

# Blur My Shell parents its blur to the window actor at index 0. The surface
# must still be found by type rather than by position.
ev "const C=imports.gi.Clutter; const a=$x11;
    a.insert_child_at_index(new C.Actor({width:1440,height:900,name:'foreign-blur'}),0);
    a.metaWindow.focus(global.get_current_time()); 0" >/dev/null
chk "a foreign actor at index 0 does not steal the effect" "false|true" \
  "$(wait_for 'false|true' "const a=$x11; const f=a.get_children().find(c=>c.name==='foreign-blur');
     \`\${!!(f&&rwcTest.effect(f))}|\${!!rwcTest.effect(rwcTest.surface(a))}\`")"

# The look changes only once the app has redrawn (#12). Reading it in the same
# call as the change sees the moment before that.
for kind in Wayland X11; do
  a=$wl; [ $kind = X11 ] && a=$x11
  chk "$kind: maximizing keeps the rounding until the app redraws" "true" \
    "$(val "$a.metaWindow.maximize(); $(rounded "$a")")"
  chk "$kind: maximized: effect removed" "false" "$(wait_for false "$(rounded "$a")")"
  chk "$kind: unmaximizing stays square until the app redraws" "false" \
    "$(val "$a.metaWindow.unmaximize(); $(rounded "$a")")"
  chk "$kind: unmaximized: effect restored at the right bounds" "true|ok" \
    "$(wait_for 'true|ok' "$(rounded "$a")+'|'+(rwcTest.boundsError($a) || 'ok')")"
done
chk "fullscreen keeps the rounding until the app redraws" "true" \
  "$(val "$wl.metaWindow.make_fullscreen(); $(rounded "$wl")")"
chk "fullscreen: effect removed" "false" "$(wait_for false "$(rounded "$wl")")"
chk "leaving fullscreen stays square until the app redraws" "false" \
  "$(val "$wl.metaWindow.unmake_fullscreen(); $(rounded "$wl")")"
chk "unfullscreen: effect restored" "true" "$(wait_for true "$(rounded "$wl")")"

for size in "700 500" "900 650" "800 600"; do
  ev "$x11.metaWindow.move_resize_frame(true, 100, 100, ${size% *}, ${size#* }); 0" >/dev/null; sleep 0.3
done
chk "X11: bounds follow every resize" "ok" "$(wait_for ok "rwcTest.boundsError($x11) || 'ok'")"
# Spoil the bounds, then let only the surface report a new size: it must re-sync.
ev "const s=rwcTest.surface($x11); const e=rwcTest.effect(s);
    e.update([0, 0, 1, 1], ...e.rwcArgs.slice(1)); s.notify('size'); 0" >/dev/null
chk "X11: a late surface resize re-syncs the bounds" "ok" "$(wait_for ok "rwcTest.boundsError($x11) || 'ok'")"
ev "$wl.metaWindow.move_resize_frame(true, 300, 200, 640, 480); 0" >/dev/null
chk "Wayland: bounds follow a resize" "ok" "$(wait_for ok "rwcTest.boundsError($wl) || 'ok'")"

# The offscreen framebuffer is the paint volume enlarged by Clutter. If that
# padding ever changes, every sampled pixel shifts and the corners shrink.
chk "offscreen padding is still +3, and the effect has painted" "true|true" \
  "$(wait_for 'true|true' "const a=$wl; const r=rwcTest.effect(a).get_target_size();
     const s=Math.max(Math.ceil(a.get_resource_scale()),1);
     \`\${r[0]}|\${r[1]===(Math.round(a.width)+3)*s && r[2]===(Math.round(a.height)+3)*s}\`")"

# The theme's values must reach the effect live, including "square".
mkdir -p $ROOT/config/gtk-4.0
printf 'window.csd { border-radius: 0px; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "a live gtk.css with radius 0 removes the effect" "false" "$(wait_for false "$(rounded "$wl")")"
printf 'window.csd { border-radius: 7px; }\n' > $ROOT/config/gtk-4.0/gtk.css
radii="\"\"+rwcTest.effect($wl).rwcArgs[1]"
chk "a live gtk.css radius reaches the effect" "7,7,7,7" "$(wait_for 7,7,7,7 "$radii")"
printf 'window.csd { border-radius: 20px 20px 0 0; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "each corner keeps its own radius" "20,20,0,0" "$(wait_for 20,20,0,0 "$radii")"
printf 'window.csd { border-radius: 0 !important; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "a declaration GTK rejects is ignored" "15,15,15,15" "$(wait_for 15,15,15,15 "$radii")"
rm -f $ROOT/config/gtk-4.0/gtk.css
chk "removing it restores libadwaita's radius" "15,15,15,15" "$(wait_for 15,15,15,15 "$radii")"

# libadwaita's own values, per mode, as the effect is given them.
outline="const a=rwcTest.effect($wl).rwcArgs; \`\${a[1][0]}|\${a[2]}|\${a[3]}|\${a[4].map(v=>v.toFixed(2))}\`"
chk "libadwaita: radius, outline and offset" "15|1|-1|1.00,1.00,1.00,0.07" "$(wait_for '15|1|-1|1.00,1.00,1.00,0.07' "$outline")"
DBUS_SESSION_BUS_ADDRESS=$BUS gsettings set org.gnome.desktop.a11y.interface high-contrast true
chk "libadwaita high contrast: outline" "15|1|-1|1.00,1.00,1.00,0.30" "$(wait_for '15|1|-1|1.00,1.00,1.00,0.30' "$outline")"
DBUS_SESSION_BUS_ADDRESS=$BUS gsettings set org.gnome.desktop.interface color-scheme prefer-dark
chk "libadwaita dark high contrast: outline" "15|1|-1|1.00,1.00,1.00,0.30" "$(wait_for '15|1|-1|1.00,1.00,1.00,0.30' "$outline")"
DBUS_SESSION_BUS_ADDRESS=$BUS gsettings set org.gnome.desktop.a11y.interface high-contrast false
chk "libadwaita dark: outline" "15|1|-1|1.00,1.00,1.00,0.07" "$(wait_for '15|1|-1|1.00,1.00,1.00,0.07' "$outline")"
DBUS_SESSION_BUS_ADDRESS=$BUS gsettings set org.gnome.desktop.interface color-scheme default

# The fallback has the same values as libadwaita, so only a variable that
# libadwaita alone defines shows its stylesheet was read.
printf 'window { outline-color: var(--accent-blue); }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "libadwaita's own stylesheet is read" "15|1|-1|0.21,0.52,0.89,1.00" "$(wait_for '15|1|-1|0.21,0.52,0.89,1.00' "$outline")"

# Selectors GTK also matches to the window, and an outline drawn inset.
printf 'window, .csd, decoration {\n    outline: 8px solid #3584e4;\n    outline-offset: -8px;\n}\n' > $ROOT/config/gtk-4.0/gtk.css
chk "a gtk.css outline on window and .csd reaches the effect" "15|8|-8|0.21,0.52,0.89,1.00" \
  "$(wait_for '15|8|-8|0.21,0.52,0.89,1.00' "$outline")"

# libadwaita ignores the GTK theme, so the windows rounded to match it must
# too. Each switch is followed by a gtk.css edit, which forces a re-read.
width=2
for theme in Yaru Arc-Dark Breeze; do
  if [ ! -e /usr/share/themes/$theme/gtk-4.0/gtk.css ]; then
    echo "  SKIP  theme $theme is not installed"; continue
  fi
  DBUS_SESSION_BUS_ADDRESS=$BUS gsettings set org.gnome.desktop.interface gtk-theme $theme
  printf 'window { outline-width: %dpx; }\n' $width > $ROOT/config/gtk-4.0/gtk.css
  chk "theme $theme is ignored" "15|$width" "$(wait_for "15|$width" "const a=rwcTest.effect($wl).rwcArgs; a[1][0]+'|'+a[2]")"
  width=$((width + 1))
done
DBUS_SESSION_BUS_ADDRESS=$BUS gsettings reset org.gnome.desktop.interface gtk-theme
rm -f $ROOT/config/gtk-4.0/gtk.css

# At fractional scales the blur changes with the window's position (#10).
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
    ev "rwcTest.capture(); 0" >/dev/null
    for _ in $(seq 50); do
      shown=$(val "rwcTest.borderShowing($wl)")
      [ "$shown" != pending ] && break
      sleep 0.2
    done
    [ "$shown" = unsupported ] && break
    worst=$(awk -v a=$worst -v b=$shown 'BEGIN { print (b > a) ? b : a }')
  done
  chk "at $scale: smear handling is on and the bounds match" "1|ok" \
    "$(val "$smear+'|'+(rwcTest.boundsError($wl) || 'ok')")"
  if [ "$shown" = unsupported ]; then
    echo "  SKIP  at $scale: the app's border stays hidden (needs --privileged)"
  else
    chk "at $scale: the app's border stays hidden at every position" "ok" \
      "$(awk -v w=$worst 'BEGIN { print (w < 0.05) ? "ok" : "showing " w }')"
  fi
done
ev "rwcTest.setScale(1); 0" >/dev/null
wait_for 1 "$monitor_scale" >/dev/null
chk "back at 100%: smear handling is off" "0" "$(wait_for 0 "$smear")"

# Stress: churn windows, states, the theme and the extension itself, then
# check that everything ended up where it should.
open_wl; open_wl; open_x11
chk "stress: three more windows opened" "6" "$(wait_for 6 "$windows")"
for _ in $(seq 10); do
  ev 'for (const a of global.get_window_actors()) { a.metaWindow.maximize(); a.metaWindow.unmaximize(); } 0' >/dev/null
done
for i in $(seq 10); do
  ev "for (const a of global.get_window_actors().filter(rwcTest.isX11)) a.metaWindow.move_resize_frame(true, 100, 100, $((500 + i * 30)), $((400 + i * 20))); 0" >/dev/null
done
ev 'for (const a of global.get_window_actors().filter(a => !rwcTest.isAdwaita(a)).slice(0, 2)) a.metaWindow.delete(global.get_current_time()); 0' >/dev/null
chk "stress: two windows closed" "4" "$(wait_for 4 "$windows")"
open_wl; open_x11
chk "stress: two windows reopened" "6" "$(wait_for 6 "$windows")"
for _ in $(seq 3); do
  ev 'Main.overview.show(); Main.overview.hide(); 0' >/dev/null
  printf 'window.csd { border-radius: 0px; }\n' > $ROOT/config/gtk-4.0/gtk.css; sleep 0.3
  rm -f $ROOT/config/gtk-4.0/gtk.css; sleep 0.3
done
# GNOME applies these asynchronously, so wait for each one to take effect.
state="''+Main.extensionManager.lookup('$UUID').state"
for _ in $(seq 5); do
  ev "Main.extensionManager.disableExtension('$UUID'); 0" >/dev/null
  wait_for 2 "$state" >/dev/null
  ev "Main.extensionManager.enableExtension('$UUID'); 0" >/dev/null
  wait_for 1 "$state" >/dev/null
done
chk "after the stress, every window is in the right state" "ok" "$(wait_for ok 'rwcTest.audit()')"

ev "Main.extensionManager.disableExtension('$UUID'); 0" >/dev/null
chk "disable leaves no effects behind" "0" \
  "$(wait_for 0 'let n=0; const walk=a=>{if(a.get_effect&&rwcTest.effect(a))n++;a.get_children().forEach(walk);};
     global.get_window_actors().forEach(walk); ""+n')"
ev "Main.extensionManager.enableExtension('$UUID'); 0" >/dev/null
chk "enabling again restores every effect" "ok" "$(wait_for ok 'rwcTest.audit()')"

chk "no errors or warnings logged by the extension" "0" \
  "$(grep -cE "rounded-window-corners:|JS ERROR|JS WARNING: [^ ]*$UUID|Unhandled promise rejection" $ROOT/log/shell.log)"

echo; echo "  RESULT: $PASS passed, $FAIL failed"
kill $SPID 2>/dev/null
exit $FAIL

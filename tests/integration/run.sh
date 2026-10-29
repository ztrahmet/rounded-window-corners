#!/usr/bin/env bash
# Functional tests against a real headless GNOME Shell. The checks run inside the shell are in helpers.js.
set -u
UUID=rounded-window-corners@ztrahmet.github.io
EXT_SRC=${EXT_SRC:-/src}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=/tmp/rwc
PASS=0; FAIL=0

# The image follows rawhide, so a shell older than the extension needs is skipped, not failed.
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

# Test windows: Wayland GTK3, XWayland GTK3, libadwaita.
wl='global.get_window_actors().find(a=>a.metaWindow.get_client_type()!==Meta.WindowClientType.X11 && /rwc|gjs/i.test(a.metaWindow.get_wm_class()||""))'
x11='global.get_window_actors().find(a=>a.metaWindow.get_client_type()===Meta.WindowClientType.X11)'
adw='global.get_window_actors().find(a=>/adwaita/i.test(a.metaWindow.get_wm_class()||""))'
windows='""+global.get_window_actors().length'
rounded() { echo "\"\"+rwcTest.rounded($1)"; }

echo "$(gnome-shell --version)"
ev "$(cat "$HERE/helpers.js"); 0" >/dev/null
if [ "$(val 'typeof rwcTest')" != "object" ]; then
  echo "FATAL: helpers.js did not load"; exit 1
fi
chk "extension enables cleanly" "1|none" \
  "$(wait_for '1|none' "const e=Main.extensionManager.lookup('$UUID'); \`\${e.state}|\${e.error||'none'}\`")"

# Re-sync while the new windows are still being probed, as a style change can.
ev "globalThis.rwcCreated = [];
    globalThis.rwcHook = global.display.connect('window-created', (d, w) => {
      const a = w.get_compositor_private();
      if (!a) return;
      rwcTest.tracker()._syncAll();
      rwcCreated.push([a, rwcTest.rounded(a)]);
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

for size in "700 500" "900 650" "800 600"; do
  ev "$x11.metaWindow.move_resize_frame(true, 100, 100, ${size% *}, ${size#* }); 0" >/dev/null; sleep 0.3
done
chk "X11: bounds follow every resize" "ok" "$(wait_for ok "rwcTest.boundsError($x11) || 'ok'")"
# Spoil the bounds, then let only the app's picture report a new size: the bounds must recover.
ev "const a=$x11; const e=rwcTest.effect(a);
    e.update([0, 0, 1, 1], ...e.rwcArgs.slice(1)); a.get_texture().emit('size-changed'); 0" >/dev/null
chk "X11: a late redraw re-syncs the bounds" "ok" "$(wait_for ok "rwcTest.boundsError($x11) || 'ok'")"
ev "$wl.metaWindow.move_resize_frame(true, 300, 200, 640, 480); 0" >/dev/null
chk "Wayland: bounds follow a resize" "ok" "$(wait_for ok "rwcTest.boundsError($wl) || 'ok'")"

# The shader relies on Clutter's framebuffer padding, which no API exposes, so catch it changing.
chk "offscreen padding is still +3, and the effect has painted" "true|true" \
  "$(wait_for 'true|true' "const a=$wl; const r=rwcTest.effect(a).get_target_size();
     const v=a.get_paint_volume(); const s=a.get_resource_scale();
     \`\${r[0]}|\${r[1]===(Math.round(v.get_width())+3)*s && r[2]===(Math.round(v.get_height())+3)*s}\`")"

# gtk.css edits must reach the effect live, including a radius of 0.
mkdir -p $ROOT/config/gtk-4.0
printf 'window.csd { border-radius: 0px; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "a live gtk.css with radius 0 turns the effect off" "false" "$(wait_for false "$(rounded "$wl")")"
printf 'window.csd { border-radius: 7px; }\n' > $ROOT/config/gtk-4.0/gtk.css
radii="\"\"+rwcTest.effect($wl).rwcArgs[1]"
chk "a live gtk.css radius reaches the effect" "7,7,7,7" "$(wait_for 7,7,7,7 "$radii")"
printf 'window.csd { border-radius: 20px 20px 0 0; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "each corner keeps its own radius" "20,20,0,0" "$(wait_for 20,20,0,0 "$radii")"
rm -f $ROOT/config/gtk-4.0/gtk.css
chk "removing it restores libadwaita's radius" "15,15,15,15" "$(wait_for 15,15,15,15 "$radii")"

# libadwaita's values as the effect is given them, following the system settings.
outline="const a=rwcTest.effect($wl).rwcArgs; \`\${a[1][0]}|\${a[2]}|\${a[3]}|\${a[4].map(v=>v.toFixed(2))}\`"
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
layers="rwcTest.effect($wl).rwcArgs[5].filter(s => s.color[3] > 0).map(s => s.shape.join(' ')).join('|')"
chk "each shadow layer keeps its own offset, in GTK's order" "0 3 1 4.5|0 0 1 0" "$(wait_for '0 3 1 4.5|0 0 1 0' "$layers")"

# libadwaita ignores the GTK theme, so the extension must too.
for theme in Yaru Arc-Dark Breeze; do
  [ -e /usr/share/themes/$theme/gtk-4.0/gtk.css ] && break
done
gset set org.gnome.desktop.interface gtk-theme $theme
printf 'window { outline-width: 3px; }\n' > $ROOT/config/gtk-4.0/gtk.css
chk "the GTK theme is ignored" "15|3" "$(wait_for '15|3' "const a=rwcTest.effect($wl).rwcArgs; a[1][0]+'|'+a[2]")"
gset reset org.gnome.desktop.interface gtk-theme
rm -f $ROOT/config/gtk-4.0/gtk.css

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

# Windows that leave no room of their own still get the whole shadow (#14), and on X11 only ours.
RWC_BARE=1 WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland gjs $CLIENT >/dev/null 2>&1 &
RWC_BARE=1 DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH GDK_BACKEND=x11 gjs $CLIENT >/dev/null 2>&1 &
bare='global.get_window_actors().filter(a=>a.metaWindow.get_title()==="rwc-bare")'
bare_wl="$bare.find(a=>!rwcTest.isX11(a))"
bare_x11="$bare.find(a=>rwcTest.isX11(a))"
chk "bare windows leave no room of their own" "2|0" \
  "$(wait_for '2|0' "const ws=$bare.map(a=>a.metaWindow); ws.length+'|'+Math.max(...ws.map(w=>{const f=w.get_frame_rect(),b=w.get_buffer_rect();
     return Math.max(f.x-b.x,f.y-b.y,b.x+b.width-f.x-f.width,b.y+b.height-f.y-f.height);}))")"
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
  ev "rwcTest.capture(); 0" >/dev/null
  for _ in $(seq 50); do
    shown=$(val "rwcTest.shadowShowing($1)")
    [ "$shown" != pending ] && break
    sleep 0.2
  done
  printf '%s' "$shown"
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
ev "$bare.forEach(a=>a.metaWindow.delete(global.get_current_time()));
    global.get_window_actors().forEach(a=>a.metaWindow.unminimize()); 0" >/dev/null
chk "bare windows closed" "3" "$(wait_for 3 "$windows")"

# Stress: churn windows, states, the style and the extension itself, then audit every window.
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
# Enabling and disabling complete asynchronously, so wait for each one.
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
  "$(wait_for 0 'let n=0; const walk=a=>{if(a.get_effects)n+=rwcTest.ours(a);a.get_children().forEach(walk);};
     global.get_window_actors().forEach(walk); ""+n')"
ev "Main.extensionManager.enableExtension('$UUID'); 0" >/dev/null
chk "enabling again restores every effect" "ok" "$(wait_for ok 'rwcTest.audit()')"

chk "no errors or warnings logged by the extension" "0" \
  "$(grep -cE "rounded-window-corners:|JS ERROR|JS WARNING: [^ ]*$UUID|Unhandled promise rejection" $ROOT/log/shell.log)"

echo; echo "  RESULT: $PASS passed, $FAIL failed"
kill $SPID 2>/dev/null
exit $FAIL

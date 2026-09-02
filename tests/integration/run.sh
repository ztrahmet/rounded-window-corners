#!/usr/bin/env bash
# Functional tests against a real GNOME Shell, headless and without a GPU.
#
# There is no framebuffer readback under the surfaceless renderer, so these
# assert the state and geometry the shader is fed rather than the pixels it
# produces. Rendering itself is checked by hand on real hardware.
set -u
UUID=rounded-window-corners@ztrahmet.github.io
EXT_SRC=${EXT_SRC:-/src}
ROOT=/tmp/rwc
PASS=0; FAIL=0

rm -rf $ROOT; mkdir -p $ROOT/{config,cache,data/gnome-shell/extensions,log}
ln -sfn "$EXT_SRC" $ROOT/data/gnome-shell/extensions/$UUID

# Flips unsafe mode so the harness can drive the shell over D-Bus.
H=$ROOT/data/gnome-shell/extensions/rwc-test-helper@local; mkdir -p $H
printf '%s\n' '{"name":"RWC Test Helper","description":"Test only.","uuid":"rwc-test-helper@local","shell-version":["48","49","50","51","52"]}' > $H/metadata.json
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
  exec gnome-shell --headless --virtual-monitor 1400x900 --wayland-display=rwc-ci
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
# A window of the given client type: 1 is X11, anything else Wayland.
wl='global.get_window_actors().find(a=>a.metaWindow.get_client_type()!==Meta.WindowClientType.X11 && /rwc|gjs/i.test(a.metaWindow.get_wm_class()||""))'
x11='global.get_window_actors().find(a=>a.metaWindow.get_client_type()===Meta.WindowClientType.X11)'
adw='global.get_window_actors().find(a=>/adwaita/i.test(a.metaWindow.get_wm_class()||""))'

echo "$(gnome-shell --version)"
chk "extension enables cleanly" "1|none" \
  "$(val "const e=Main.extensionManager.lookup('$UUID'); \`\${e.state}|\${e.error||'none'}\`")"

CLIENT=/tests/integration/clients/bordered-gtk3.js
WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland gjs $CLIENT >/dev/null 2>&1 &
WAYLAND_DISPLAY=rwc-ci GDK_BACKEND=wayland adwaita-1-demo >/dev/null 2>&1 &
XDISPLAY=$(grep -oE 'public X11 display :[0-9]+' $ROOT/log/shell.log | tail -1 | grep -oE ':[0-9]+')
XAUTH=$(ls -t /run/user/1000/.mutter-Xwaylandauth.* 2>/dev/null | head -1)
DISPLAY=$XDISPLAY XAUTHORITY=$XAUTH GDK_BACKEND=x11 gjs $CLIENT >/dev/null 2>&1 &
sleep 10
ev 'Main.overview.hide(); 0' >/dev/null; sleep 1
echo "  windows: $(val 'global.get_window_actors().map(a=>a.metaWindow.get_wm_class()+"/"+(a.metaWindow.get_client_type()===Meta.WindowClientType.X11?"x11":"wl")).join(" ")')"

chk "non-libadwaita window is rounded" "true" "$(val "const a=$wl; a?\"\"+!!a.get_effect('rounded-window-corners'):'no-window'")"
chk "libadwaita window is left alone" "false" "$(val "const a=$adw; a?\"\"+!!a.get_effect('rounded-window-corners'):'no-window'")"
chk "X11: effect on the surface, not the window actor" "false|true" \
  "$(val "const a=$x11; const s=a.get_children().find(c=>c.constructor.\$gtype.name.startsWith('MetaSurfaceActor'));
     \`\${!!a.get_effect('rounded-window-corners')}|\${!!(s&&s.get_effect('rounded-window-corners'))}\`")"

# Blur My Shell parents its blur to the window actor at index 0. The surface
# must still be found by type rather than by position.
ev "const C=imports.gi.Clutter; const a=$x11;
    a.insert_child_at_index(new C.Actor({width:1400,height:900,name:'foreign-blur'}),0);
    a.metaWindow.focus(global.get_current_time()); 0" >/dev/null
sleep 2
chk "a foreign actor at index 0 does not steal the effect" "false|true" \
  "$(val "const a=$x11; const f=a.get_children().find(c=>c.name==='foreign-blur');
     const s=a.get_children().find(c=>c.constructor.\$gtype.name.startsWith('MetaSurfaceActor'));
     \`\${!!(f&&f.get_effect('rounded-window-corners'))}|\${!!(s&&s.get_effect('rounded-window-corners'))}\`")"

ev "const a=$wl; a.metaWindow.maximize(Meta.MaximizeFlags.BOTH); 0" >/dev/null; sleep 2
chk "maximized: effect removed" "false" "$(val "const a=$wl; \"\"+!!a.get_effect('rounded-window-corners')")"
ev "const a=$wl; a.metaWindow.unmaximize(Meta.MaximizeFlags.BOTH); 0" >/dev/null; sleep 2
chk "unmaximized: effect restored" "true" "$(val "const a=$wl; \"\"+!!a.get_effect('rounded-window-corners')")"
ev "const a=$wl; a.metaWindow.make_fullscreen(); 0" >/dev/null; sleep 2
chk "fullscreen: effect removed" "false" "$(val "const a=$wl; \"\"+!!a.get_effect('rounded-window-corners')")"
ev "const a=$wl; a.metaWindow.unmake_fullscreen(); 0" >/dev/null; sleep 2
chk "unfullscreen: effect restored" "true" "$(val "const a=$wl; \"\"+!!a.get_effect('rounded-window-corners')")"

# The offscreen framebuffer is the paint volume enlarged by Clutter. If that
# padding ever changes, every sampled pixel shifts and the corners shrink.
chk "offscreen padding is still +3, and the effect has painted" "true|true" \
  "$(val "const a=$wl; const e=a.get_effect('rounded-window-corners'); const r=e.get_target_size();
     const s=Math.max(Math.ceil(a.get_resource_scale()),1);
     \`\${r[0]}|\${r[1]===(Math.round(a.width)+3)*s && r[2]===(Math.round(a.height)+3)*s}\`")"

# A theme saying windows are square must be obeyed, live.
mkdir -p $ROOT/config/gtk-4.0
printf 'window.csd { border-radius: 0px; }\n' > $ROOT/config/gtk-4.0/gtk.css
sleep 5
chk "a live gtk.css with radius 0 removes the effect" "false" "$(val "const a=$wl; \"\"+!!a.get_effect('rounded-window-corners')")"
rm -f $ROOT/config/gtk-4.0/gtk.css
sleep 5
chk "removing it restores the effect" "true" "$(val "const a=$wl; \"\"+!!a.get_effect('rounded-window-corners')")"

ev "Main.extensionManager.disableExtension('$UUID'); 0" >/dev/null; sleep 3
chk "disable leaves no effects behind" "0" \
  "$(val 'let n=0; const walk=a=>{if(a.get_effect&&a.get_effect("rounded-window-corners"))n++;a.get_children().forEach(walk);};
     global.get_window_actors().forEach(walk); ""+n')"
chk "disable leaves no style probe on the stage" "0" \
  "$(val 'let n=0; const walk=a=>{if(a.style_class==="rounded-window-corners")n++;a.get_children().forEach(walk);};
     walk(global.stage); ""+n')"
chk "no errors logged by the extension" "0" "$(grep -c 'rounded-window-corners:\|JS ERROR' $ROOT/log/shell.log)"

echo; echo "  RESULT: $PASS passed, $FAIL failed"
kill $SPID 2>/dev/null
exit $FAIL

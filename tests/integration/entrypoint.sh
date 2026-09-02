#!/usr/bin/env bash
# Root-side setup for the container, then hand over to an unprivileged user.
set -eu

# Mutter renders through a surfaceless renderer when there is no GPU, which is
# the case on a CI runner. Nothing extra is needed for that.
rm -rf /run/systemd
mkdir -p /run/dbus && dbus-daemon --system --fork 2>/dev/null || true

# XWayland needs a writable socket directory. On GNOME 48 a failed XWayland
# start is fatal to the whole shell, so this is not optional.
mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

mkdir -p /run/user/1000
chown runner:runner /run/user/1000
chmod 700 /run/user/1000

exec runuser -u runner -- env XDG_RUNTIME_DIR=/run/user/1000 \
    EXT_SRC="${EXT_SRC:-/src}" /tests/integration/run.sh

# How it works

One shader effect per window that needs it. Nothing else.

## Which windows

Normal windows and dialogs of apps that don't use libadwaita. Whether an app uses
libadwaita is found by looking at the libraries its process has loaded. libadwaita apps
are left alone, since they already round themselves.

A window is left square while it is maximized, tiled or fullscreen, and when the radius is
0. The effect is removed in those states, not just hidden. As in libadwaita, the look
changes once the app has redrawn at its new size, not when the state changes.

On X11 (XWayland) the effect goes on the window's surface rather than the whole window, so
mutter's own frame and shadow on server-side decorated windows are kept. The surface is
found by its type, because other extensions, such as Blur My Shell, add actors to windows
too.

## Where the values come from

The extension works out the window style the way GTK does for a libadwaita window:
libadwaita's stylesheet first, then your `~/.config/gtk-4.0/gtk.css` on top, with GTK's
rules for which declaration wins. Light, dark and high contrast are picked by the same
media queries libadwaita uses.

GNOME Shell can't load libadwaita, so a short `gjs` helper in `tools/` reads its stylesheet.
If that fails, a built-in copy of libadwaita's window rules is used instead. A weekly CI
check notices when libadwaita changes them.

Like GTK, anything the extension can't read is skipped rather than guessed. It reads pixel
lengths and the usual colour syntaxes. Each corner can have its own radius; an elliptical
corner is drawn as a circle.

Edits to `gtk.css`, and to files it imports, apply live.

## Drawing

The shader clips the window to its rounded shape and replaces the app's own thin border
just inside the edge, so only one outline is left. It then draws the shadow outside and
the outline on top, in the same order GTK does.

The shadow is fitted into the space the app already leaves around its window, so nothing
is drawn beyond what the window covers anyway. Edges are drawn at the screen's pixel
density, so at 200% they are as crisp as libadwaita's.

Because the outline and shadow are part of the same effect, the overview, alt-tab and
screenshots show them without any patching.

## Cost

Each rounded window is drawn through an offscreen buffer about its own size, and the
shader runs as the window repaints. Windows that aren't repainting cost nothing, and
maximized and fullscreen windows have no effect at all.

## Enable and disable

Everything is created in `enable()` and destroyed in `disable()`, including what was read
from the stylesheets. GNOME disables extensions while the screen is locked, so everything
is set up again after unlocking.

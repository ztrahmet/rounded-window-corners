# How it works

One shader effect per window that needs it, and a small one that makes room for its
shadow. Nothing else.

## Which windows

Normal windows and dialogs of apps that don't use libadwaita. Whether an app uses
libadwaita is found by looking at the libraries its process has loaded. libadwaita apps
are left alone, since they already round themselves.

A window is left square while it is maximized, tiled or fullscreen, and when the radius is
0. The effect is turned off in those states. As in libadwaita, the look changes once the
app has drawn its new picture, not when the state changes.

The effect goes on the whole window, on X11 (XWayland) too. Mutter's title bar on
server-side decorated windows is rounded with the rest, and the shadow mutter would give
the window is replaced like the app's own.

## Where the values come from

The extension works out the window style the way GTK does for a libadwaita window:
libadwaita's stylesheet first, then your accent color, then your
`~/.config/gtk-4.0/gtk.css` on top, with GTK's rules for which declaration wins. Light,
dark and high contrast are picked by the same media queries libadwaita uses.

GNOME Shell can't load libadwaita, so a short `gjs` helper in `tools/` reads its stylesheet.
If that fails, a built-in copy of libadwaita's window rules is used instead. A weekly CI
check notices when libadwaita changes them.

Like GTK, anything the extension can't read is skipped rather than guessed. It reads pixel
lengths, the color syntaxes libadwaita uses, color names, `var()` and `@define-color`, so
`var(--accent-bg-color)` in your gtk.css follows your accent color. Colors computed with
functions such as `oklab()` aren't read. Each corner can have its own radius; an elliptical
corner is drawn as a circle.

Edits to `gtk.css`, and to files it imports, apply live.

## Drawing

The shader clips the window to its rounded shape and replaces the app's own thin border
just inside the edge, so only one outline is left. At fractional scales it reaches a little
further in, because the border is blurred there. It then draws the shadow outside and
the outline on top, in the same order GTK does.

The shadow is libadwaita's at its full size, whatever room the app leaves around its
window, so every window gets the same one. It is computed as GTK's renderer does, so it
matches libadwaita's. Edges are drawn at the screen's pixel density, so at 200% they are
as crisp as libadwaita's.

Because the outline and shadow are part of the same effect, the overview and alt-tab show
them without any patching. Window screenshots only cover what the app itself draws, so the
shadow is cut there for apps that leave little room. The same happens while a window is
dimmed behind a dialog, if it was first dimmed before the extension was turned on, for
example before the screen was locked.

## Cost

Each rounded window is drawn through an offscreen buffer the size of the window and its
shadow, and the shader runs as the window repaints. Windows that aren't repainting cost
nothing to draw, and neither do maximized and fullscreen windows, whose effect is off and
only keeps the buffer it last drew into.

## Enable and disable

Everything is created in `enable()` and destroyed in `disable()`, including what was read
from the stylesheets. GNOME disables extensions while the screen is locked, so everything
is set up again after unlocking.

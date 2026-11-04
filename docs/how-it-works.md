# How it works

One shader effect per window that needs it, and a small one that makes room for its
shadow. Nothing else.

## Which windows

Normal windows and dialogs. An app's toolkit is found by looking at the libraries its
process has loaded: libadwaita, libhandy, Chromium and Electron, Firefox and Thunderbird,
Java, Qt, GTK 4 or GTK 3. libadwaita apps are left alone by default, since they already
round themselves, and the settings can leave libhandy apps alone too.

Apps are matched by their desktop file, the way GNOME Shell matches them, except that a
dialog another process puts over an app, like the file chooser, counts as its own app's.
Apps and toolkits on the blacklist are never rounded; with the whitelist on, only the ones
on it are. A libadwaita or libhandy app whose switch is off is still rounded when its
toolkit is whitelisted, or when the app itself is whitelisted or has a style of its own.

A window is left square while it is maximized, tiled or fullscreen. The effect is turned
off in those states. A setting rounds maximized and tiled windows too, without a shadow;
fullscreen windows always stay square. As in libadwaita, the look changes once the app has
drawn its new picture, not when the state changes. At a radius of 0 the window keeps its
outline and shadow, as libadwaita's do.

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

Edits to `gtk.css`, and to files it imports, apply live.

## Custom styles

A custom style takes the radius, outline and shadow from the settings instead. It starts
as libadwaita's light style, and doesn't change with dark or high contrast. Its shadow is
libadwaita's, moved by the light angle and distance, with its blur and opacity scaled and
its color replaced.

An app's style comes first, then its toolkit's, then the general one. The first of them
with Custom Style on gives the look; with none, it comes from libadwaita and `gtk.css`,
which are only read while the general style isn't custom. How the app's border is hidden
always comes from the first of them, custom or not.

## Drawing

The shader draws each window in four steps:

<div align="center">
  <img src="../data/corner-steps.gif" width="480" alt="A window corner, magnified: without the extension, then after each step" />
</div>

1. **Fill.** The app's own thin border just inside the edge takes the color next to it.
   The settings can cut it off instead, or keep it, and set how wide it is.
2. **Clip.** The window is cut to its rounded shape.
3. **Shadow.** The shadow is drawn outside.
4. **Outline.** The outline is drawn on top, in the same order GTK draws it.

The shadow is libadwaita's at its full size, whatever room the app leaves around its
window, so every window gets the same one. It is computed as GTK's renderer does, so it
matches libadwaita's. Each layer of a `box-shadow` keeps its own offset and color, and
they are stacked in GTK's order; past six layers, the faintest are left out. Edges are
drawn at the screen's pixel density, so at 200% they are as crisp as libadwaita's.

Because the outline and shadow are part of the same effect, the overview and alt-tab show
them without any patching. Window screenshots only cover what the app itself draws, so the
shadow is cut there for apps that leave little room. The same happens while a window is
dimmed behind a dialog, if it was first dimmed before the extension was turned on, for
example before the screen was locked.

## Cost

Each rounded window is drawn through an offscreen buffer the size of the window and its
shadow, and the shader runs as the window repaints. Windows that aren't repainting cost
nothing to draw, and neither do maximized and fullscreen windows, whose effect is off and
only keeps the buffer it last drew into. Rounding maximized windows gives each of them a
buffer the size of the screen.

## Enable and disable

Everything is created in `enable()` and destroyed in `disable()`, including what was read
from the stylesheets. GNOME disables extensions while the screen is locked, so everything
is set up again after unlocking.

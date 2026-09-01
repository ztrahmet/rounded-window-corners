# How it works

One `Shell.GLSLEffect` per window that needs it. Nothing else.

## Which windows

| Toolkit | Ships with | Gets |
| --- | --- | --- |
| GTK4 + libadwaita | 15px, all four | nothing, already right |
| GTK3, libhandy | `8px 8px 0 0` | corners, outline, new shadow |
| GTK4 without libadwaita | `8px 8px 0 0` | corners, outline, new shadow |
| Qt, Electron, Java, terminals | square | corners, outline, new shadow |
| X11 server-side frame | top only | corners and outline, mutter's shadow kept |

Skipped when the window is maximized, tiled or fullscreen, since libadwaita squares its
own corners there too. The effect is removed, not disabled, which returns its framebuffer
when the window is largest.

Toolkit detection greps `/proc/<pid>/maps` once per window for `libadwaita-1.so`.
Unreadable processes count as unknown and get rounded. Real maps files are 36 to 150 KB.

On X11 the effect goes on the surface child, not the window actor, so mutter's frame
shadow survives.

## Why there is no shadow actor

Clipping the corners destroys the shadow the app drew, so something has to replace it.

The usual answer is a second actor behind the window with a CSS `box-shadow`. That drags
a lot along: it must sit below its window in `global.windowGroup`, so restacks need
intercepting; it needs bind constraints and property bindings; and since it is a sibling,
`ClutterClone` ignores it, so the overview and workspace switcher need patching to clone
it separately.

Drawing the shadow in the same shader removes all of that. `ClutterClone` paints its
source through `clutter_actor_paint()`, which runs the effect chain, so the effect appears
in the overview, alt-tab, workspace switching and screenshots for free.

No shell method is patched anywhere in this codebase.

## The shader

`shaders/rounded.frag` runs on one signed distance field.

```glsl
float d = sdRoundRect(p - center, halfSize, r);   // negative inside

if (d >= -(outlineWidth + 1.0)) {
    float content = clamp(0.5 - d, 0.0, 1.0);
    cogl_color_out *= content;                    // clip, and erase the app's shadow
    ...                                           // hairline, then drop shadow
}
```

Pixels well inside the window skip the branch, which is nearly all of them. Clipping to
the frame rect also erases the app's own shadow, so the replacement goes in the same pass.

## The shadow

A CSS shadow layer is a rounded box, grown by its spread, blurred by a Gaussian of
`blur / 2`. Its coverage depends only on distance to that box, which the shader already
has.

`lib/shadowProfile.js` compiles the `box-shadow` list into four `(spread, sigma, alpha)`
triples and a colour. Per pixel that is one `exp` per layer, inside the border band only.

The shadow is scaled to fit the client-side-decoration margin the buffer already has, so
the paint volume never grows and mutter's culling stays intact. GTK3 windows carry 23 to
26px, nearly enough for libadwaita's shadow at full size. Under 4px it is dropped.

## Where the values come from

`lib/styleResolver.js`, later sources winning:

1. Built-in constants matching libadwaita 1.7 to 1.9. Last resort.
2. libadwaita's compiled stylesheet. It sits in a GResource inside `libadwaita-1.so`, and
   reading it needs the library loaded, which cannot happen in gnome-shell without pulling
   in GTK4. So `tools/adw-probe.js` runs as a short `gjs` subprocess and prints it. Async,
   and failure costs nothing.
3. A custom GTK4 theme's `gtk.css`, which in GTK replaces Adwaita rather than layering on
   it, so it replaces source 2 here too. Then `~/.config/gtk-4.0/gtk.css`, which does
   layer. Every file read is watched with `Gio.FileMonitor`, imports included, and
   `@import` is followed up to three levels. adw-gtk3 is why that matters: its
   `gtk-4.0/gtk.css` is 69 bytes of `@import` pointing at a 365 KB copy of libadwaita's
   stylesheet next to it, and without following those the theme looks empty.
4. A shell theme styling `.rounded-window-corners`. The shipped `stylesheet.css` declares
   the class and sets nothing, so a resolved radius of 0 means nobody has an opinion.

Light, dark and high contrast are never picked here. The cascade is re-resolved against
the current environment, because `@media` is how the stylesheets express those variants.
Parsing is cached per environment, so toggling dark mode re-parses nothing, and the cache
lives as long as the shell rather than as long as one enable, which matters because GNOME
disables extensions at every screen lock.

## The framebuffer is not the size you think

`ClutterOffscreenEffect` does not render an actor into a texture the actor's size. It
takes the paint volume, enlarges it, scales by the ceiled resource scale and rounds up.
From `clutter/clutter/clutter-actor-box.c`:

```c
box->x2 = ceilf (box->x2 + 0.75f);
box->x1 = box->x2 - width - 3;
```

A 652x452 actor gets a 655x455 texture with its content offset inside.

So `textureCoord * actorSize`, the obvious way to get a pixel coordinate, is wrong. Every
sample lands off, and the error grows across the actor. With that formula in place here, a
configured 15px radius rendered at 10.1px and 8px at 3.3px. Both existing extensions use
it.

The fix takes the span from `get_target_size()` and reconstructs the origin from Clutter's
own formula. If Clutter changes the padding it degrades to a sub-pixel error. Measured by
screenshot, 15px now renders at 15.0px.

## Fractional scaling

Theme values are logical pixels, the shader works in actor pixels, and those diverge under
fractional scaling. Everything is derived from the actor-to-buffer ratio instead of mixing
the two.

Checked at 100%, 150% and 200%: 15.0 logical pixels in all three. At 150% the paint volume
goes non-integer (452 x 352.333) and the origin reconstruction still matches Clutter
exactly.

## Known limitation

A hard border running flush into a window corner gets cut by the arc. It tapers out, the
corner has none, and it resumes on the other side.

GTK does the same thing. Tested side by side against a libadwaita window with a 3px border
into every corner, the two are pixel-identical apart from four antialiasing pixels.
Adwaita apps rarely show it because they are designed for round corners; GTK3 apps were
not. Nothing at the compositor level can fix it, because the widgets are already drawn by
then.

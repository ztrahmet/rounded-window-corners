<div align="center">
  <h1>Rounded Window Corners Native</h1>
  <p><i>Rounds every window to match libadwaita. Nothing to configure.</i></p>

  <a href="https://extensions.gnome.org/extension/10809/rounded-window-corners-native/">
    <img src="https://img.shields.io/badge/Install%20from-extensions.gnome.org-4A86CF?style=for-the-badge&logo=Gnome&logoColor=white" alt="Install from GNOME Extensions" />
  </a>

  <br>

  <a href="https://extensions.gnome.org/extension/10809/rounded-window-corners-native/">
    <img src="https://img.shields.io/badge/GNOME_Shell-51-blue" alt="GNOME Shell Version" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/ztrahmet/rounded-window-corners" alt="License" />
  </a>
</div>

<br>

![Screenshot](data/screenshot.png)

Gives GTK3, Qt, Electron, Java, and all other apps the exact corners, border, and shadow of native libadwaita windows.

In the screenshot above, Text Editor (top left) is built with **libadwaita**. IntelliJ IDEA (top right) is Java, LibreOffice (bottom left) is GTK3, and Chromium (bottom right) is GTK. All non-libadwaita windows are rounded by this extension to seamlessly match.

Requires GNOME Shell 51.

## How it behaves

**Like libadwaita.** The radius, outline and shadow come from libadwaita's own stylesheet,
so light, dark and high contrast follow on their own.

**Your gtk.css counts.** Change the window radius or outline in
`~/.config/gtk-4.0/gtk.css`, even to your accent color, and the other windows follow your
libadwaita apps, live. Your GTK theme is ignored, because libadwaita ignores it too.

**Patches nothing.** No GNOME Shell method is overridden, so there is nothing to fight
with your dock or tiling extension.

## Recommended themes

[adw-gtk3](https://github.com/lassekongo83/adw-gtk3) for GTK3 apps, or
[Monolith](https://github.com/ztrahmet/gnome-theme-monolith), a monochrome GTK and shell
theme that includes adw-gtk3.

## Compared to the others

[Rounded Window Corners](https://github.com/yilozt/rounded-window-corners) and
[Reborn](https://github.com/flexagoon/rounded-window-corners) came first, and this project
learned from both.

| | This | The others |
| --- | --- | --- |
| Border color | from libadwaita and your gtk.css | one you pick |
| Light / dark / contrast | automatic | one color serves both |
| Shell methods patched | none | three, for the overview and workspace switching |
| Per window | two effects | an effect, plus a shadow actor with its own effect and four constraints |

Use theirs if you want squircles or different corners for one app. Use this one if you
would rather it match the rest of GNOME and never think about it.

## Docs

- [How it works](docs/how-it-works.md)
- [Development](docs/development.md)

## License

GPL-3.0-or-later.

Some parts are adapted from LGPL-2.1-or-later projects:

- the shadow, from GTK's renderer (`gsk/gpu/shaders/gskgpuboxshadow.glsl`)
- the color conversions, from GTK (`gtk/gtkcolorutils.c`, `gdk/gdkhsla.c`)
- the built-in window style, from libadwaita's stylesheet

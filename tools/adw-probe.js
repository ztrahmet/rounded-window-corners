// Prints libadwaita's compiled stylesheet on stdout.
//
// This runs as a short-lived `gjs -m` subprocess and never inside gnome-shell:
// libadwaita is a GTK4 library, and loading GTK into the compositor process is
// not something an extension may do. Out of process it is harmless.
//
// The stylesheet lives in a GResource compiled into libadwaita-1.so, so the
// only way to read it is to have the library loaded. We do that without
// initialising GTK and without needing a display.
//
// Any failure exits non-zero and the extension keeps the value it already had.
// That covers a missing typelib, a missing libadwaita, or a renamed resource.

import Gio from 'gi://Gio';
import Adw from 'gi://Adw?version=1';

// Importing the typelib is not enough: GI dlopens the shared library lazily, on
// first use of a symbol, and it is that dlopen which registers the GResource.
Adw.get_major_version();

const bytes = Gio.resources_lookup_data(
    '/org/gnome/Adwaita/styles/gtk.css',
    Gio.ResourceLookupFlags.NONE);

print(new TextDecoder().decode(bytes.get_data()));

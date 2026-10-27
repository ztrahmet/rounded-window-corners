#!@GJS@ -m
/**
 * Prints libadwaita's stylesheet
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';
import Adw from 'gi://Adw?version=1';

// The first call loads the library, which registers its resources.
Adw.get_major_version();

const bytes = Gio.resources_lookup_data(
    '/org/gnome/Adwaita/styles/gtk.css',
    Gio.ResourceLookupFlags.NONE);

print(new TextDecoder().decode(bytes.get_data()));

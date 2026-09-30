/**
 * Out-of-process Libadwaita stylesheet probe
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';
import Adw from 'gi://Adw?version=1';

// Force typelib symbol resolution to register the embedded GResource.
Adw.get_major_version();

const bytes = Gio.resources_lookup_data(
    '/org/gnome/Adwaita/styles/gtk.css',
    Gio.ResourceLookupFlags.NONE);

print(new TextDecoder().decode(bytes.get_data()));

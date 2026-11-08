/**
 * Preferences for which apps are rounded: the blocklist and the allowlist
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AppListGroup} from './appListGroup.js';

export const AppsPage = GObject.registerClass(
class AppsPage extends Adw.PreferencesPage {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({title: _('Apps'), icon_name: 'view-app-grid-symbolic'});

        const mode = new Adw.ComboRow({
            title: _('Active List'),
            subtitle: _('Switching keeps both lists'),
            model: Gtk.StringList.new([_('Blocklist'), _('Allowlist')]),
        });
        const refresh = () => {
            mode.selected = settings.get_boolean('use-allowlist') ? 1 : 0;
        };
        const changed = settings.connect('changed::use-allowlist', refresh);
        this.connect('destroy', () => settings.disconnect(changed));
        refresh();
        mode.connect('notify::selected', () => {
            if ((mode.selected === 1) !== settings.get_boolean('use-allowlist'))
                settings.set_boolean('use-allowlist', mode.selected === 1);
        });
        const group = new Adw.PreferencesGroup();
        group.add(mode);
        this.add(group);

        const blocklist = new AppListGroup(settings, 'blocklist', 'blocklist-toolkits', {
            title: _('Blocklist'),
            description: _('These apps are never rounded'),
        });
        const allowlist = new AppListGroup(settings, 'allowlist', 'allowlist-toolkits', {
            title: _('Allowlist'),
            description: _('Only these apps are rounded'),
        });
        settings.bind('use-allowlist', blocklist, 'visible',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        settings.bind('use-allowlist', allowlist, 'visible', Gio.SettingsBindFlags.GET);
        this.add(blocklist);
        this.add(allowlist);
    }
});

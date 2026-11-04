/**
 * Preferences for which apps are rounded: the blacklist and the whitelist
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
            title: _('List'),
            subtitle: _('Switching keeps both lists'),
            model: Gtk.StringList.new([_('Blacklist'), _('Whitelist')]),
        });
        const refresh = () => {
            mode.selected = settings.get_boolean('use-whitelist') ? 1 : 0;
        };
        const changed = settings.connect('changed::use-whitelist', refresh);
        this.connect('destroy', () => settings.disconnect(changed));
        refresh();
        mode.connect('notify::selected', () => {
            if ((mode.selected === 1) !== settings.get_boolean('use-whitelist'))
                settings.set_boolean('use-whitelist', mode.selected === 1);
        });
        const group = new Adw.PreferencesGroup();
        group.add(mode);
        this.add(group);

        const blacklist = new AppListGroup(settings, 'blacklist', 'blacklist-categories', {
            title: _('Blacklist'),
            description: _('These apps are never rounded'),
        });
        const whitelist = new AppListGroup(settings, 'whitelist', 'whitelist-categories', {
            title: _('Whitelist'),
            description: _('Only these apps are rounded'),
        });
        settings.bind('use-whitelist', blacklist, 'visible',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        settings.bind('use-whitelist', whitelist, 'visible', Gio.SettingsBindFlags.GET);
        this.add(blacklist);
        this.add(whitelist);
    }
});

/**
 * General preferences: behavior and the general style
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {addAppearanceGroups} from './appearanceGroups.js';

export const GeneralPage = GObject.registerClass(
class GeneralPage extends Adw.PreferencesPage {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({title: _('General'), icon_name: 'preferences-system-symbolic'});

        const behavior = new Adw.PreferencesGroup({title: _('Behavior')});
        this.add(behavior);
        for (const [key, title, subtitle] of [
            ['round-libadwaita-apps', _('Round libadwaita Apps'), _('They round their own windows; turn on to give them your style')],
            ['round-libhandy-apps', _('Round libhandy Apps'), _('Most of them round their own windows too')],
            ['round-maximized', _('Round Maximized and Tiled Windows'), _('Fullscreen windows stay square')],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            behavior.add(row);
        }

        addAppearanceGroups(this, settings.get_child('appearance'), true);
    }
});

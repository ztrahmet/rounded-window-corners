/**
 * General preferences: which windows are rounded, and the general style
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

        const windows = new Adw.PreferencesGroup({title: _('Windows')});
        this.add(windows);
        for (const [key, title, subtitle] of [
            ['round-libadwaita-apps', _('Round libadwaita Apps'), _('Only needed for a custom style or when maximized')],
            ['round-libhandy-apps', _('Round libhandy Apps'), _('Not all of them round their own windows')],
            ['round-maximized', _('Round Maximized and Tiled Windows'),
                _('They get no shadow, and fullscreen windows stay square')],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            windows.add(row);
        }

        addAppearanceGroups(this, settings.get_child('appearance'), _('Replaces libadwaita’s style and gtk.css'));
    }
});

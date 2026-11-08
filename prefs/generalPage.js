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

import {addStyleGroups} from './styleGroups.js';

export const GeneralPage = GObject.registerClass(
class GeneralPage extends Adw.PreferencesPage {
    /**
     * @param {Gio.Settings} settings
     * @param {GeneralStyle} general
     */
    constructor(settings, general) {
        super({title: _('General'), icon_name: 'preferences-system-symbolic'});

        const windows = new Adw.PreferencesGroup({title: _('Windows')});
        this.add(windows);
        for (const [key, title, subtitle] of [
            ['round-libadwaita-apps', _('Round libadwaita Apps'), _('Only needed for a custom style or when maximized')],
            ['round-libhandy-apps', _('Round libhandy Apps'), _('Not all of them round their own windows')],
            ['round-maximized', _('Round Maximized and Tiled Windows'),
                _('Without a shadow, as in libadwaita; fullscreen stays square')],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            windows.add(row);
        }

        addStyleGroups(this, general, _('Replaces libadwaita’s style and gtk.css'));

        const reset = new Adw.ButtonRow({title: _('Reset All Settings…')});
        reset.add_css_class('destructive-action');
        reset.connect('activated', () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Reset All Settings?'),
                body: _('Every switch, list and style goes back to its default'),
                close_response: 'cancel',
            });
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('reset', _('Reset'));
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (_dialog, response) => {
                if (response === 'reset')
                    settings.settings_schema.list_keys().forEach(key => settings.reset(key));
            });
            dialog.present(this);
        });
        const group = new Adw.PreferencesGroup();
        group.add(reset);
        this.add(group);
    }
});

/**
 * A list of apps kept in a settings key
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {appRow, chooseApp, installedApps} from './appChooser.js';

export const AppListGroup = GObject.registerClass(
class AppListGroup extends Adw.PreferencesGroup {
    /**
     * @param {Gio.Settings} settings
     * @param {string} key - The key holding the apps' desktop IDs.
     * @param {object} params
     * @param {string} params.title
     * @param {string} params.description
     * @param {?function(string, string): void} [params.open] - Opens the page
     *   of an app, given its desktop ID and name.
     * @param {function(string): void} [params.removed] - Called with the
     *   desktop ID of an app taken off the list.
     */
    constructor(settings, key, {title, description, open = null, removed = () => {}}) {
        super({title, description});
        this._settings = settings;
        this._key = key;
        this._open = open;
        this._removed = removed;
        this._rows = [];

        const add = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add App…'),
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        add.connect('clicked', () => chooseApp(this, this._ids(), id => settings.set_strv(key, [...this._ids(), id])));
        this.header_suffix = add;

        const changed = settings.connect(`changed::${key}`, () => this._fill());
        this.connect('destroy', () => settings.disconnect(changed));
        this._fill();
    }

    _ids() {
        return this._settings.get_strv(this._key);
    }

    _fill() {
        for (const row of this._rows)
            this.remove(row);

        const apps = installedApps();
        this._rows = this._ids().map(id => {
            const row = appRow(id, apps.get(id));
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: _('Remove'),
                css_classes: ['flat'],
                valign: Gtk.Align.CENTER,
            });
            remove.connect('clicked', () => {
                this._settings.set_strv(this._key, this._ids().filter(other => other !== id));
                this._removed(id);
            });
            row.add_suffix(remove);

            if (this._open) {
                row.activatable = true;
                row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
                row.connect('activated', () => this._open(id, row.title));
            }
            this.add(row);
            return row;
        });
    }
});

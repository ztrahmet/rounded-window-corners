/**
 * A list of toolkits and apps, kept in two settings keys
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {appRow, chooseApp, installedApps} from './appChooser.js';

// The toolkits the extension recognizes.
function toolkits() {
    return [
        ['libadwaita', _('libadwaita Apps')],
        ['libhandy', _('libhandy Apps')],
        ['chromium', _('Chromium and Electron Apps')],
        ['firefox', _('Firefox and Thunderbird')],
        ['java', _('Java Apps')],
        ['qt', _('Qt Apps')],
        ['gtk4', _('GTK 4 Apps')],
        ['gtk3', _('GTK 3 Apps')],
    ];
}

/**
 * Shows how many entries a page has as a badge on its tab.
 *
 * @param {Adw.PreferencesPage} page
 * @param {Gio.Settings} settings
 * @param {Function} count - Returns the number of entries.
 */
export function countOnTab(page, settings, count) {
    // The preferences window keeps its pages in a view stack, whose pages carry the badges.
    const refresh = () => {
        const stack = page.get_parent();
        if (stack instanceof Adw.ViewStack)
            stack.get_page(page).badge_number = count();
    };
    const changed = settings.connect('changed', refresh);
    page.connect('destroy', () => settings.disconnect(changed));
    page.connect('notify::parent', refresh);
    refresh();
}

export const AppListGroup = GObject.registerClass(
class AppListGroup extends Adw.PreferencesGroup {
    /**
     * @param {Gio.Settings} settings
     * @param {string} key - The key holding the apps, by desktop ID: a list, or styles by ID.
     * @param {string} toolkitKey - The key holding the toolkits, as key holds the apps.
     * @param {object} params
     * @param {string} params.title
     * @param {string} params.description
     * @param {Map<string, string>} [params.notes] - Notes on some toolkits.
     * @param {?function(string, string, string): void} [params.open] - Opens an entry's page from its key, ID and name.
     */
    constructor(settings, key, toolkitKey, {title, description, notes = new Map(), open = null}) {
        super({title, description});
        this._settings = settings;
        this._key = key;
        this._toolkitKey = toolkitKey;
        this._notes = notes;
        this._open = open;
        this._rows = [];

        this._add = new Adw.SplitButton({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add App…'),
            dropdown_tooltip: _('Add Toolkit'),
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        this._add.connect('clicked', () => chooseApp(this, this._ids(key), id => this._append(key, id)));
        this.header_suffix = this._add;

        const addToolkit = new Gio.SimpleAction({name: 'add-toolkit', parameter_type: new GLib.VariantType('s')});
        addToolkit.connect('activate', (_action, id) => this._append(toolkitKey, id.unpack()));
        const actions = new Gio.SimpleActionGroup();
        actions.add_action(addToolkit);
        this.insert_action_group('list', actions);

        const changed = [key, toolkitKey].map(k => settings.connect(`changed::${k}`, () => this._fill()));
        this.connect('destroy', () => changed.forEach(id => settings.disconnect(id)));
        this._fill();
    }

    // Lists of apps or toolkits are string arrays, their styles dictionaries by ID.
    _ids(key) {
        const value = this._settings.get_value(key).deepUnpack();
        return Array.isArray(value) ? value : Object.keys(value);
    }

    _append(key, id) {
        const value = this._settings.get_value(key).deepUnpack();
        if (Array.isArray(value)) {
            this._settings.set_strv(key, [...value, id]);
            return;
        }
        // A style starts as the key's default one, if it has one.
        value[id] = this._settings.get_default_value(key).deepUnpack()[id] ?? {};
        this._settings.set_value(key, new GLib.Variant('a{sa{sv}}', value));
    }

    _remove(key, id) {
        const value = this._settings.get_value(key).deepUnpack();
        if (Array.isArray(value)) {
            this._settings.set_strv(key, value.filter(other => other !== id));
            return;
        }
        delete value[id];
        this._settings.set_value(key, new GLib.Variant('a{sa{sv}}', value));
    }

    _fill() {
        for (const row of this._rows)
            this.remove(row);
        this._rows = [];

        const added = this._ids(this._toolkitKey);
        const menu = new Gio.Menu();
        for (const [id, name] of toolkits()) {
            if (added.includes(id)) {
                const row = new Adw.ActionRow({title: name, subtitle: this._notes.get(id) ?? '', use_markup: false});
                const image = Gtk.Image.new_from_icon_name('view-app-grid-symbolic');
                image.icon_size = Gtk.IconSize.LARGE;
                row.add_prefix(image);
                this._addRow(row, this._toolkitKey, id);
            } else {
                menu.append(name, `list.add-toolkit::${id}`);
            }
        }
        this._add.menu_model = menu;

        const apps = installedApps();
        for (const id of this._ids(this._key))
            this._addRow(appRow(id, apps.get(id)), this._key, id);
    }

    _addRow(row, key, id) {
        const remove = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: _('Remove'),
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        remove.connect('clicked', () => this._remove(key, id));
        row.add_suffix(remove);

        if (this._open) {
            row.activatable = true;
            row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
            row.connect('activated', () => this._open(key, id, row.title));
        }
        this.add(row);
        this._rows.push(row);
    }
});

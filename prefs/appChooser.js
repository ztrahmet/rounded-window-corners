/**
 * Installed apps: their rows and a dialog to choose one
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * @returns {Map<string, Gio.AppInfo>} Every installed app, by desktop ID.
 */
export function installedApps() {
    return new Map(Gio.AppInfo.get_all().map(app => [app.get_id(), app]));
}

/**
 * A row showing an app, or its desktop ID if it is not installed.
 *
 * @param {string} id
 * @param {?Gio.AppInfo} app
 * @returns {Adw.ActionRow}
 */
export function appRow(id, app) {
    const icon = app?.get_icon();
    const image = icon ? Gtk.Image.new_from_gicon(icon) : Gtk.Image.new_from_icon_name('application-x-executable');
    image.icon_size = Gtk.IconSize.LARGE;

    const row = new Adw.ActionRow({title: app ? app.get_display_name() : id, use_markup: false});
    row.add_prefix(image);
    return row;
}

/**
 * Asks for one of the apps shown in the app grid.
 *
 * @param {Gtk.Widget} parent
 * @param {string[]} exclude - Desktop IDs not to offer.
 * @param {function(string): void} chosen - Called with the chosen app's desktop ID.
 */
export function chooseApp(parent, exclude, chosen) {
    const dialog = new Adw.Dialog({title: _('Add App'), content_width: 420, content_height: 560});
    const search = new Gtk.SearchEntry({placeholder_text: _('Search apps'), hexpand: true});
    const list = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        css_classes: ['boxed-list'],
        valign: Gtk.Align.START,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });

    const apps = [...installedApps().values()]
        .filter(app => app.should_show() && !exclude.includes(app.get_id()))
        .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));
    for (const app of apps) {
        const row = appRow(app.get_id(), app);
        row.activatable = true;
        row.connect('activated', () => {
            dialog.close();
            chosen(app.get_id());
        });
        list.append(row);
    }
    list.set_filter_func(row => row.title.toLowerCase().includes(search.text.toLowerCase()));
    search.connect('search-changed', () => list.invalidate_filter());

    const view = new Adw.ToolbarView({
        content: new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER}),
    });
    view.add_top_bar(new Adw.HeaderBar({title_widget: search}));
    dialog.child = view;
    dialog.present(parent);
}

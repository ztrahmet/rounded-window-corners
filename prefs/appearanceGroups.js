/**
 * Rows for a set of appearance settings
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const BORDER_METHODS = ['off', 'extend', 'clip'];

function spinRow(appearance, key, title, lower, upper) {
    const row = Adw.SpinRow.new_with_range(lower, upper, 1);
    row.title = title;
    appearance.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function colorRow(appearance) {
    const rgba = new Gdk.RGBA();
    rgba.parse(appearance.get_string('outline-color'));
    const button = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog(), rgba, valign: Gtk.Align.CENTER});
    button.connect('notify::rgba', () => appearance.set_string('outline-color', button.rgba.to_string()));

    const row = new Adw.ActionRow({title: _('Outline Color'), activatable_widget: button});
    row.add_suffix(button);
    return row;
}

function shadowRow(appearance) {
    const percent = new Intl.NumberFormat(undefined, {style: 'percent'});
    const scale = new Gtk.Scale({
        adjustment: new Gtk.Adjustment({lower: 0, upper: 2, step_increment: 0.05, page_increment: 0.25}),
        draw_value: true,
        value_pos: Gtk.PositionType.LEFT,
        width_request: 240,
    });
    scale.set_format_value_func((_scale, value) => percent.format(value));
    scale.add_mark(1, Gtk.PositionType.BOTTOM, null);
    appearance.bind('shadow-strength', scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const row = new Adw.ActionRow({title: _('Shadow'), subtitle: _('100% is libadwaita’s')});
    row.add_suffix(scale);
    return row;
}

/**
 * Adds the groups for a set of appearance settings to a page.
 *
 * @param {Adw.PreferencesPage} page
 * @param {Gio.Settings} appearance
 * @param {boolean} general - Whether this is the general style, which follows
 *   libadwaita unless the custom style is on.
 */
export function addAppearanceGroups(page, appearance, general) {
    const style = new Adw.PreferencesGroup({title: _('Appearance')});
    page.add(style);

    const rows = [
        spinRow(appearance, 'corner-radius', _('Corner Radius'), 0, 48),
        spinRow(appearance, 'outline-width', _('Outline Width'), 0, 8),
        colorRow(appearance),
        shadowRow(appearance),
    ];
    if (general) {
        const custom = new Adw.SwitchRow({
            title: _('Custom Style'),
            subtitle: _('Use these values instead of libadwaita’s style and your gtk.css'),
        });
        appearance.bind('custom-style', custom, 'active', Gio.SettingsBindFlags.DEFAULT);
        style.add(custom);
        for (const row of rows)
            appearance.bind('custom-style', row, 'sensitive', Gio.SettingsBindFlags.GET);
    }
    for (const row of rows)
        style.add(row);

    const border = new Adw.PreferencesGroup({
        title: _('App Border'),
        description: _('Many apps draw a thin border of their own, which the outline replaces.'),
    });
    page.add(border);

    const method = new Adw.ComboRow({
        title: _('Hide App Border'),
        subtitle: _('Extend covers it with the pixels next to it, Clip cuts it off'),
        model: Gtk.StringList.new([_('Off'), _('Extend'), _('Clip')]),
        selected: BORDER_METHODS.indexOf(appearance.get_string('border-method')),
    });
    const width = spinRow(appearance, 'border-width', _('Width'), 1, 8);
    width.sensitive = method.selected !== 0;
    method.connect('notify::selected', () => {
        appearance.set_string('border-method', BORDER_METHODS[method.selected]);
        width.sensitive = method.selected !== 0;
    });
    border.add(method);
    border.add(width);
}

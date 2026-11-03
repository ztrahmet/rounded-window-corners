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

const percent = new Intl.NumberFormat(undefined, {style: 'percent'});

function spinRow(appearance, key, title, lower, upper) {
    const row = Adw.SpinRow.new_with_range(lower, upper, 1);
    row.title = title;
    appearance.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function colorRow(appearance, key, title) {
    const rgba = new Gdk.RGBA();
    rgba.parse(appearance.get_string(key));
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: false}),
        rgba,
        valign: Gtk.Align.CENTER,
    });
    button.connect('notify::rgba', () => appearance.set_string(key, button.rgba.to_string()));

    const row = new Adw.ActionRow({title, activatable_widget: button});
    row.add_suffix(button);
    return row;
}

function opacityRow(appearance, key) {
    const scale = new Gtk.Scale({
        adjustment: new Gtk.Adjustment({upper: 1, step_increment: 0.01, page_increment: 0.1}),
        digits: 2,
        draw_value: true,
        value_pos: Gtk.PositionType.RIGHT,
        hexpand: true,
        valign: Gtk.Align.CENTER,
    });
    scale.set_format_value_func((_scale, value) => percent.format(value));
    appearance.bind(key, scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const row = new Adw.ActionRow({title: _('Opacity')});
    row.add_suffix(scale);
    return row;
}

function expanderRow(title, rows) {
    const row = new Adw.ExpanderRow({title});
    for (const child of rows)
        row.add_row(child);
    return row;
}

/**
 * Adds the groups for a set of appearance settings to a page.
 *
 * @param {Adw.PreferencesPage} page
 * @param {Gio.Settings} appearance
 * @param {string} customSubtitle
 */
export function addAppearanceGroups(page, appearance, customSubtitle) {
    const style = new Adw.PreferencesGroup({title: _('Appearance')});
    page.add(style);

    const custom = new Adw.SwitchRow({title: _('Custom Style'), subtitle: customSubtitle});
    appearance.bind('custom-style', custom, 'active', Gio.SettingsBindFlags.DEFAULT);
    style.add(custom);

    const radius = spinRow(appearance, 'corner-radius', _('Corner Radius'), 0, 48);
    const angle = spinRow(appearance, 'shadow-angle', _('Angle'), 0, 359);
    angle.wrap = true;
    const outline = expanderRow(_('Outline'), [
        spinRow(appearance, 'outline-width', _('Width'), 0, 8),
        colorRow(appearance, 'outline-color', _('Color')),
        opacityRow(appearance, 'outline-opacity'),
    ]);
    const shadow = expanderRow(_('Shadow'), [
        angle,
        spinRow(appearance, 'shadow-distance', _('Distance'), 0, 32),
        spinRow(appearance, 'shadow-blur', _('Blur'), 0, 48),
        colorRow(appearance, 'shadow-color', _('Color')),
        opacityRow(appearance, 'shadow-opacity'),
    ]);
    for (const row of [radius, outline, shadow]) {
        appearance.bind('custom-style', row, 'sensitive', Gio.SettingsBindFlags.GET);
        style.add(row);
    }

    const summarize = () => {
        outline.subtitle = [
            `${_('Width')} ${appearance.get_int('outline-width')} px`,
            `${_('Opacity')} ${percent.format(appearance.get_double('outline-opacity'))}`,
        ].join(', ');
        shadow.subtitle = [
            `${_('Angle')} ${appearance.get_int('shadow-angle')}°`,
            `${_('Distance')} ${appearance.get_int('shadow-distance')} px`,
            `${_('Blur')} ${appearance.get_int('shadow-blur')} px`,
            `${_('Opacity')} ${percent.format(appearance.get_double('shadow-opacity'))}`,
        ].join(', ');
    };
    const changed = appearance.connect('changed', summarize);
    page.connect('destroy', () => appearance.disconnect(changed));
    summarize();

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

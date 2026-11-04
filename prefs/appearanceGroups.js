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
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: false}),
        valign: Gtk.Align.CENTER,
    });
    button.connect('notify::rgba', () => {
        const color = button.rgba.to_string();
        if (color !== appearance.get_string(key))
            appearance.set_string(key, color);
    });

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
    const style = new Adw.PreferencesGroup({title: _('Style')});
    page.add(style);

    const custom = new Adw.SwitchRow({title: _('Custom Style'), subtitle: customSubtitle});
    appearance.bind('custom-style', custom, 'active', Gio.SettingsBindFlags.DEFAULT);
    style.add(custom);

    const angle = spinRow(appearance, 'shadow-angle', _('Light Angle'), 0, 359);
    angle.wrap = true;
    const outlineColor = colorRow(appearance, 'outline-color', _('Color'));
    const shadowColor = colorRow(appearance, 'shadow-color', _('Color'));
    const outline = expanderRow(_('Outline'), [
        spinRow(appearance, 'outline-width', _('Width'), 0, 8),
        outlineColor,
        opacityRow(appearance, 'outline-opacity'),
    ]);
    const shadow = expanderRow(_('Shadow'), [
        angle,
        spinRow(appearance, 'shadow-distance', _('Distance'), 0, 32),
        spinRow(appearance, 'shadow-blur', _('Blur'), 0, 48),
        shadowColor,
        opacityRow(appearance, 'shadow-opacity'),
    ]);
    for (const row of [spinRow(appearance, 'corner-radius', _('Corner Radius'), 0, 48), outline, shadow]) {
        appearance.bind('custom-style', row, 'sensitive', Gio.SettingsBindFlags.GET);
        style.add(row);
    }

    const border = new Adw.PreferencesGroup({
        title: _('App Border'),
        description: _('Many apps draw a thin border that the outline replaces'),
    });
    page.add(border);

    const method = new Adw.ComboRow({
        title: _('Hide App Border'),
        // Translators: Extend and Clip are this row's options.
        subtitle: _('Extend paints over it, Clip cuts it off'),
        model: Gtk.StringList.new([_('Off'), _('Extend'), _('Clip')]),
    });
    const width = spinRow(appearance, 'border-width', _('Width'), 1, 8);
    border.add(method);
    border.add(width);

    // Rows show changes made elsewhere too, but write a key only when the user changes it, so a reset key stays reset.
    const refresh = () => {
        outline.subtitle = [
            // Translators: a summary's parts are joined with commas, as in "Width 1 px, opacity 7%".
            _('Width %d px').replace('%d', appearance.get_int('outline-width')),
            _('opacity %s').replace('%s', percent.format(appearance.get_double('outline-opacity'))),
        ].join(', ');
        shadow.subtitle = [
            _('Light angle %d°').replace('%d', appearance.get_int('shadow-angle')),
            _('distance %d px').replace('%d', appearance.get_int('shadow-distance')),
            _('blur %d px').replace('%d', appearance.get_int('shadow-blur')),
            _('opacity %s').replace('%s', percent.format(appearance.get_double('shadow-opacity'))),
        ].join(', ');
        for (const [row, key] of [[outlineColor, 'outline-color'], [shadowColor, 'shadow-color']]) {
            const rgba = new Gdk.RGBA();
            if (rgba.parse(appearance.get_string(key)) && !rgba.equal(row.activatable_widget.rgba))
                row.activatable_widget.rgba = rgba;
        }
        method.selected = BORDER_METHODS.indexOf(appearance.get_string('border-method'));
        width.sensitive = method.selected !== 0;
    };
    const changed = appearance.connect('changed', refresh);
    page.connect('destroy', () => appearance.disconnect(changed));
    refresh();

    method.connect('notify::selected', () => {
        const value = BORDER_METHODS[method.selected];
        if (value !== appearance.get_string('border-method'))
            appearance.set_string('border-method', value);
    });
}

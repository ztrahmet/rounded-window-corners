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

const OUTLINE_POSITIONS = ['inside', 'center', 'outside'];
const BORDER_METHODS = ['inherit', 'off', 'extend', 'clip'];

// What a style keeps besides the values it is drawn with.
const NOT_DRAWN = new Set(['custom-style', 'border-method', 'border-width']);

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
        const stored = new Gdk.RGBA();
        if (!stored.parse(appearance.get_string(key)) || !stored.equal(button.rgba))
            appearance.set_string(key, button.rgba.to_string());
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

function comboRow(appearance, key, title, values, labels) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(labels)});
    row.connect('notify::selected', () => {
        const value = values[row.selected];
        if (value !== undefined && value !== appearance.get_string(key))
            appearance.set_string(key, value);
    });
    return row;
}

function expanderRow(title, rows) {
    const row = new Adw.ExpanderRow({title});
    for (const child of rows)
        row.add_row(child);
    return row;
}

// A style starts from the custom one it comes after, else from its defaults.
function startFrom(appearance, parent) {
    if (!parent?.get_boolean('custom-style'))
        return;
    for (const key of parent.settings_schema.list_keys()) {
        if (!NOT_DRAWN.has(key))
            appearance.set_value(key, parent.get_value(key));
    }
}

/**
 * Resets every key of some settings.
 *
 * @param {Gio.Settings} settings
 */
export function resetKeys(settings) {
    for (const key of settings.settings_schema.list_keys())
        settings.reset(key);
}

/**
 * Adds the groups for a set of appearance settings to a page.
 *
 * @param {Adw.PreferencesPage} page
 * @param {Gio.Settings} appearance
 * @param {string} customSubtitle
 * @param {?Gio.Settings} [parent] - The style it comes after; none for the general style.
 */
export function addAppearanceGroups(page, appearance, customSubtitle, parent = null) {
    const border = new Adw.PreferencesGroup({
        title: _('App Border'),
        description: _('Many apps draw a thin border that the outline replaces'),
    });
    page.add(border);

    const first = parent ? 0 : 1;
    const methods = BORDER_METHODS.slice(first);
    const method = comboRow(appearance, 'border-method', _('Hide App Border'), methods,
        [_('Inherit'), _('Off'), _('Extend'), _('Clip')].slice(first));
    method.subtitle = _('Extend paints over it, Clip cuts it off');
    const width = spinRow(appearance, 'border-width', _('Width'), 1, 8);
    border.add(method);
    border.add(width);

    const style = new Adw.PreferencesGroup({title: _('Style')});
    page.add(style);

    const custom = new Adw.SwitchRow({title: _('Custom Style'), subtitle: customSubtitle});
    custom.connect('notify::active', () => {
        // Read first, since starting the style refreshes the switch.
        const active = custom.active;
        if (active === appearance.get_boolean('custom-style'))
            return;
        if (appearance.get_user_value('custom-style') === null)
            startFrom(appearance, parent);
        appearance.set_boolean('custom-style', active);
    });
    style.add(custom);

    const angle = spinRow(appearance, 'shadow-angle', _('Light Angle'), 0, 359);
    angle.wrap = true;
    const outlineColor = colorRow(appearance, 'outline-color', _('Color'));
    const shadowColor = colorRow(appearance, 'shadow-color', _('Color'));
    const position = comboRow(appearance, 'outline-position', _('Position'), OUTLINE_POSITIONS,
        [_('Inside'), _('Center'), _('Outside')]);
    const outline = expanderRow(_('Outline'), [
        spinRow(appearance, 'outline-width', _('Width'), 0, 8),
        position,
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
    const drawn = [spinRow(appearance, 'corner-radius', _('Corner Radius'), 0, 48), outline, shadow];
    for (const row of drawn) {
        appearance.bind('custom-style', row, 'sensitive', Gio.SettingsBindFlags.GET);
        style.add(row);
    }

    // Rows show changes made elsewhere too, but write a key only when the user changes it, so a reset key stays reset.
    const refresh = () => {
        // A style shows its values once it has been switched on.
        custom.active = appearance.get_boolean('custom-style');
        const started = appearance.get_user_value('custom-style') !== null;
        for (const row of drawn)
            row.visible = started;
        // Translators: Keep the values in this order.
        outline.subtitle = _('Width %d px, opacity %s')
            .replace('%d', appearance.get_int('outline-width'))
            .replace('%s', percent.format(appearance.get_double('outline-opacity')));
        // Translators: Keep the values in this order.
        shadow.subtitle = _('Light angle %d°, distance %d px, blur %d px, opacity %s')
            .replace('%d', appearance.get_int('shadow-angle'))
            .replace('%d', appearance.get_int('shadow-distance'))
            .replace('%d', appearance.get_int('shadow-blur'))
            .replace('%s', percent.format(appearance.get_double('shadow-opacity')));
        for (const [row, key] of [[outlineColor, 'outline-color'], [shadowColor, 'shadow-color']]) {
            const rgba = new Gdk.RGBA();
            if (rgba.parse(appearance.get_string(key)) && !rgba.equal(row.activatable_widget.rgba))
                row.activatable_widget.rgba = rgba;
        }
        position.selected = OUTLINE_POSITIONS.indexOf(appearance.get_string('outline-position'));
        // The general style doesn't offer inherit, so a stored one selects nothing.
        const index = methods.indexOf(appearance.get_string('border-method'));
        method.selected = index < 0 ? Gtk.INVALID_LIST_POSITION : index;
        width.sensitive = ['extend', 'clip'].includes(methods[index]);
    };
    const changed = appearance.connect('changed', refresh);
    page.connect('destroy', () => appearance.disconnect(changed));
    refresh();
}

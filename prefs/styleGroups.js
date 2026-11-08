/**
 * Rows for a style: the general one, or an app's or toolkit's
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {STYLE_KEYS, StyleValues} from '../lib/styleSettings.js';

const OUTLINE_POSITIONS = ['inside', 'center', 'outside'];

// What a style keeps besides the values it is drawn with.
const NOT_DRAWN = new Set(['custom-style', 'border-method', 'border-width']);

const percent = new Intl.NumberFormat(undefined, {style: 'percent'});

const typeOf = (settings, key) => settings.settings_schema.get_key(key).get_value_type().dup_string();

/**
 * The general style, kept in keys of its own.
 */
export class GeneralStyle {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        this._settings = settings;
    }

    get(key) {
        return this._settings.get_value(key).deepUnpack();
    }

    isSet(key) {
        return this._settings.get_user_value(key) !== null;
    }

    /**
     * Writes the values that differ from the stored ones, so showing a value never writes it.
     *
     * @param {object} values - By key.
     */
    set(values) {
        for (const [key, value] of Object.entries(values)) {
            if (value !== this.get(key))
                this._settings.set_value(key, new GLib.Variant(typeOf(this._settings, key), value));
        }
    }

    connect(callback) {
        return this._settings.connect('changed', callback);
    }

    disconnect(id) {
        this._settings.disconnect(id);
    }
}

/**
 * An app's or toolkit's style, kept in app-styles or toolkit-styles.
 */
export class EntryStyle {
    /**
     * @param {Gio.Settings} settings
     * @param {string} key - 'app-styles' or 'toolkit-styles'.
     * @param {string} id - The app's desktop ID, or the toolkit.
     */
    constructor(settings, key, id) {
        this._settings = settings;
        this._values = new StyleValues(settings);
        this._key = key;
        this._id = id;
    }

    _entry() {
        return this._settings.get_value(this._key).deepUnpack()[this._id] ?? {};
    }

    // Without a border method, undefined: the style inherits it.
    get(key) {
        return this._values.of(this._entry())[key];
    }

    isSet(key) {
        return key in this._values.setIn(this._entry());
    }

    /**
     * Writes the values that differ from the shown ones, all at once; null removes a value.
     *
     * @param {object} values - By key.
     */
    set(values) {
        const styles = this._settings.get_value(this._key).deepUnpack();
        const entry = {...styles[this._id]};
        const changed = Object.entries(values).filter(([key, value]) =>
            value === null ? this.isSet(key) : value !== this.get(key));
        if (changed.length === 0)
            return;
        for (const [key, value] of changed) {
            if (value === null)
                delete entry[key];
            else
                entry[key] = new GLib.Variant(typeOf(this._settings, key), value);
        }
        styles[this._id] = entry;
        this._settings.set_value(this._key, new GLib.Variant('a{sa{sv}}', styles));
    }

    connect(callback) {
        return this._settings.connect(`changed::${this._key}`, callback);
    }

    disconnect(id) {
        this._settings.disconnect(id);
    }
}

function expanderRow(title, rows) {
    const row = new Adw.ExpanderRow({title});
    for (const child of rows)
        row.add_row(child);
    return row;
}

/**
 * Adds the groups for a style to a page.
 *
 * @param {Adw.PreferencesPage} page
 * @param {GeneralStyle|EntryStyle} style
 * @param {string} customSubtitle
 * @param {?GeneralStyle} [parent] - The style it comes after; none for the general style.
 */
export function addStyleGroups(page, style, customSubtitle, parent = null) {
    // Shows the stored values in each row; set() skips equal values, so this writes nothing.
    const shows = [];

    const spinRow = (key, title, lower, upper) => {
        const row = Adw.SpinRow.new_with_range(lower, upper, 1);
        row.title = title;
        row.connect('notify::value', () => style.set({[key]: row.value}));
        shows.push(() => (row.value = style.get(key)));
        return row;
    };

    const colorRow = (key, title) => {
        const button = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        // Compared as colors, so one stored in another spelling is kept.
        const stored = () => {
            const rgba = new Gdk.RGBA();
            return rgba.parse(style.get(key)) ? rgba : null;
        };
        button.connect('notify::rgba', () => {
            if (!stored()?.equal(button.rgba))
                style.set({[key]: button.rgba.to_string()});
        });
        shows.push(() => {
            const rgba = stored();
            if (rgba && !rgba.equal(button.rgba))
                button.rgba = rgba;
        });

        const row = new Adw.ActionRow({title, activatable_widget: button});
        row.add_suffix(button);
        return row;
    };

    const opacityRow = key => {
        const adjustment = new Gtk.Adjustment({upper: 1, step_increment: 0.01, page_increment: 0.1});
        const scale = new Gtk.Scale({
            adjustment,
            digits: 2,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        scale.set_format_value_func((_scale, value) => percent.format(value));
        adjustment.connect('value-changed', () => style.set({[key]: adjustment.value}));
        shows.push(() => (adjustment.value = style.get(key)));

        const row = new Adw.ActionRow({title: _('Opacity')});
        row.add_suffix(scale);
        return row;
    };

    const comboRow = (key, title, values, labels) => {
        const row = new Adw.ComboRow({title, model: Gtk.StringList.new(labels)});
        row.connect('notify::selected', () => style.set({[key]: values[row.selected]}));
        shows.push(() => (row.selected = values.indexOf(style.get(key))));
        return row;
    };

    const border = new Adw.PreferencesGroup({
        title: _('App Border'),
        description: _('Many apps draw a thin border that the outline replaces'),
    });
    page.add(border);

    // App and toolkit styles can inherit the method, and its width with it.
    const methods = parent ? [null, 'off', 'extend', 'clip'] : ['off', 'extend', 'clip'];
    const method = new Adw.ComboRow({
        title: _('Hide App Border'),
        subtitle: _('Extend paints over it, Clip cuts it off'),
        model: Gtk.StringList.new([_('Inherit'), _('Off'), _('Extend'), _('Clip')].slice(parent ? 0 : 1)),
    });
    method.connect('notify::selected', () => {
        const value = methods[method.selected];
        style.set(value ? {'border-method': value} : {'border-method': null, 'border-width': null});
    });
    const width = spinRow('border-width', _('Width'), 1, 8);
    shows.push(() => {
        const value = style.get('border-method') ?? null;
        method.selected = methods.indexOf(value);
        width.sensitive = value === 'extend' || value === 'clip';
    });
    border.add(method);
    border.add(width);

    const group = new Adw.PreferencesGroup({title: _('Style')});
    page.add(group);

    // Switched on for the first time, a style starts from its parent's custom style.
    const custom = new Adw.SwitchRow({title: _('Custom Style'), subtitle: customSubtitle});
    custom.connect('notify::active', () => {
        const values = {'custom-style': custom.active};
        if (!style.isSet('custom-style') && parent?.get('custom-style')) {
            for (const key of STYLE_KEYS.filter(k => !NOT_DRAWN.has(k)))
                values[key] = parent.get(key);
        }
        style.set(values);
    });
    group.add(custom);

    const angle = spinRow('shadow-angle', _('Light Angle'), 0, 359);
    angle.wrap = true;
    const outline = expanderRow(_('Outline'), [
        spinRow('outline-width', _('Width'), 0, 8),
        comboRow('outline-position', _('Position'), OUTLINE_POSITIONS, [_('Inside'), _('Center'), _('Outside')]),
        colorRow('outline-color', _('Color')),
        opacityRow('outline-opacity'),
    ]);
    const shadow = expanderRow(_('Shadow'), [
        angle,
        spinRow('shadow-distance', _('Distance'), 0, 32),
        spinRow('shadow-blur', _('Blur'), 0, 48),
        colorRow('shadow-color', _('Color')),
        opacityRow('shadow-opacity'),
    ]);
    const drawn = [spinRow('corner-radius', _('Corner Radius'), 0, 48), outline, shadow];
    for (const row of drawn)
        group.add(row);

    const refresh = () => {
        custom.active = style.get('custom-style');
        // A style shows its values once it has been switched on, greyed out while it is off.
        for (const row of drawn) {
            row.visible = style.isSet('custom-style');
            row.sensitive = custom.active;
        }
        // Translators: Keep the values in this order.
        outline.subtitle = _('Width %d px, opacity %s')
            .replace('%d', style.get('outline-width'))
            .replace('%s', percent.format(style.get('outline-opacity')));
        // Translators: Keep the values in this order.
        shadow.subtitle = _('Light angle %d°, distance %d px, blur %d px, opacity %s')
            .replace('%d', style.get('shadow-angle'))
            .replace('%d', style.get('shadow-distance'))
            .replace('%d', style.get('shadow-blur'))
            .replace('%s', percent.format(style.get('shadow-opacity')));
        for (const show of shows)
            show();
    };
    const changed = style.connect(refresh);
    page.connect('destroy', () => style.disconnect(changed));
    refresh();
}

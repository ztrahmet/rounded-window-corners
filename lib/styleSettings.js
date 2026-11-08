/**
 * Style values from the settings: the general style's keys and the styles of apps and toolkits
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

// A style's keys. The general style has them all; app and toolkit styles only those they set.
export const STYLE_KEYS = [
    'custom-style', 'corner-radius',
    'outline-width', 'outline-position', 'outline-color', 'outline-opacity',
    'shadow-angle', 'shadow-distance', 'shadow-blur', 'shadow-color', 'shadow-opacity',
    'border-method', 'border-width',
];

export class StyleValues {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        this._settings = settings;
        this._keys = new Map(STYLE_KEYS.map(key => [key, settings.settings_schema.get_key(key)]));
        this._defaults = Object.fromEntries(STYLE_KEYS.map(key => [key, settings.get_default_value(key).deepUnpack()]));
    }

    /**
     * @returns {object} The general style's values, by key.
     */
    general() {
        return Object.fromEntries(STYLE_KEYS.map(key => [key, this._settings.get_value(key).deepUnpack()]));
    }

    /**
     * The values an app's or toolkit's style sets that their key's type and range allow.
     *
     * @param {object} entry - From app-styles or toolkit-styles, as GLib.Variants by key.
     * @returns {object} Unpacked values, by key.
     */
    setIn(entry) {
        return Object.fromEntries(STYLE_KEYS.filter(key => {
            const value = entry[key];
            const schemaKey = this._keys.get(key);
            return value && value.is_of_type(schemaKey.get_value_type()) && schemaKey.range_check(value);
        }).map(key => [key, entry[key].deepUnpack()]));
    }

    /**
     * An app's or toolkit's style with defaults for the rest, except the border method.
     *
     * @param {object} entry - As for setIn().
     * @returns {object} Values by key, as general() gives them.
     */
    of(entry) {
        const set = this.setIn(entry);
        const values = {...this._defaults, ...set};
        if (!('border-method' in set))
            delete values['border-method'];
        return values;
    }
}

/**
 * Appearance settings of the apps and toolkits with a style of their own
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';

export class EntrySettings {
    /**
     * @param {Gio.Settings} settings
     * @param {string} extensionPath
     */
    constructor(settings, extensionPath) {
        this._settings = settings;

        // Where Shell's getSettings() finds the schemas: the extension's own, else those installed with the Shell.
        const dir = Gio.File.new_for_path(`${extensionPath}/schemas`);
        const defaults = Gio.SettingsSchemaSource.get_default();
        const source = dir.query_exists(null)
            ? Gio.SettingsSchemaSource.new_from_directory(dir.get_path(), defaults, false)
            : defaults;
        const id = settings.settings_schema.get_id();
        this._borderInherit = source.lookup(`${id}.appearance-border-inherit`, true);
        this._borderOff = source.lookup(`${id}.appearance-border-off`, true);

        // Their apps draw little or no border of their own, so their styles start with it left alone.
        this._listedByDefault = settings.settings_schema.get_key('styled-toolkits').get_default_value().deepUnpack();

        // Each is kept, since GJS can deadlock collecting a Gio.Settings while dconf delivers a change.
        this._byPath = new Map();
    }

    /**
     * @param {string} key - 'styled-apps' or 'styled-toolkits'.
     * @param {string} id
     * @returns {Gio.Settings}
     */
    of(key, id) {
        const path = `${this._settings.path}${key === 'styled-apps' ? 'apps' : 'toolkits'}/${id}/`;
        if (!this._byPath.has(path)) {
            const borderOff = key === 'styled-toolkits' && this._listedByDefault.includes(id);
            this._byPath.set(path, new Gio.Settings({settings_schema: borderOff ? this._borderOff : this._borderInherit, path}));
        }
        return this._byPath.get(path);
    }
}

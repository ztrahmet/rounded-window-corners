/**
 * Window style from libadwaita and gtk.css
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {FALLBACK_CSS, readWindowStyle} from './cssParse.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const IMPORT = /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?\s*;/g;
const COMMENT = /\/\*[\s\S]*?\*\//g;

const isCancelled = e => e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

export class StyleResolver {
    /**
     * @param {string} extensionPath
     * @param {function(): void} onChanged - Called when the style changes.
     */
    constructor(extensionPath, onChanged) {
        this._probeScript = GLib.build_filenamev([extensionPath, 'tools', 'adw-probe.js']);
        this._onChanged = onChanged;
        this._cancellable = new Gio.Cancellable();
        this._userCss = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-4.0', 'gtk.css']));
        this._sheets = [FALLBACK_CSS];
        this._libadwaita = null;
        this._serial = 0;
        this._monitors = [];

        this._settings = St.Settings.get();
        this._signals = [
            this._settings.connect('notify::color-scheme', () => this._update()),
            this._settings.connect('notify::high-contrast', () => this._update()),
        ];

        this.style = this._compute();
        this._watch([this._userCss]);
        this._reload();
    }

    destroy() {
        this._cancellable.cancel();

        for (const id of this._signals)
            this._settings.disconnect(id);
        this._unwatch();
    }

    _compute() {
        return readWindowStyle(this._sheets, {
            dark: this._settings.colorScheme === St.SystemColorScheme.PREFER_DARK,
            highContrast: this._settings.highContrast,
        });
    }

    _update() {
        const style = this._compute();
        if (JSON.stringify(style) === JSON.stringify(this.style))
            return;
        this.style = style;
        this._onChanged();
    }

    async _reload() {
        const serial = ++this._serial;
        try {
            this._libadwaita ??= this._readLibadwaita();
            const files = [];
            const [libadwaita, user] = await Promise.all([
                this._libadwaita,
                this._readCss(this._userCss, files, []),
            ]);
            if (serial !== this._serial)
                return;

            this._sheets = [FALLBACK_CSS, libadwaita, user];
            this._watch(files);
            this._update();
        } catch (e) {
            if (!isCancelled(e))
                throw e;
        }
    }

    // Only loading libadwaita registers its stylesheet, which the Shell must not do.
    async _readLibadwaita() {
        try {
            const subprocess = Gio.Subprocess.new(['gjs', '-m', this._probeScript],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            const [stdout] = await subprocess.communicate_utf8_async(null, this._cancellable);
            return subprocess.get_successful() ? stdout : '';
        } catch (e) {
            if (isCancelled(e))
                throw e;
            return '';
        }
    }

    // The stylesheet with its imports inlined; files collects every file read.
    async _readCss(file, files, importers) {
        if (importers.some(f => f.equal(file)))
            return '';
        if (!files.some(f => f.equal(file)))
            files.push(file);

        let text;
        try {
            const [bytes] = await file.load_contents_async(this._cancellable);
            text = new TextDecoder().decode(bytes).replace(COMMENT, ' ');
        } catch (e) {
            if (isCancelled(e))
                throw e;
            return '';
        }

        const imports = await Promise.all([...text.matchAll(IMPORT)].map(([, reference]) => {
            const child = /^[a-z][\w+.-]*:/i.test(reference)
                ? Gio.File.new_for_uri(reference)
                : file.get_parent().resolve_relative_path(reference);
            return this._readCss(child, files, [...importers, file]);
        }));
        return text.replace(IMPORT, () => imports.shift());
    }

    _watch(files) {
        this._unwatch();
        for (const file of files) {
            const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitors.push([monitor, monitor.connect('changed', () => this._reload())]);
        }
    }

    _unwatch() {
        for (const [monitor, id] of this._monitors) {
            monitor.disconnect(id);
            monitor.cancel();
        }
        this._monitors = [];
    }
}

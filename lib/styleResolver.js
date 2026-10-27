/**
 * Style resolver for GTK and Shell themes
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {readWindowStyle} from './cssParse.js';

const FALLBACK = {
    radius: 15,
    outlineWidth: 1,
    outlineColor: [1, 1, 1, 0.07],
    shadow: [
        {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
        {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.10]},
        {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
    ],
    shadowBackdrop: [
        {dx: 0, dy: 0, blur: 10, spread: 5, color: [0, 0, 0, 0.08]},
        {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
    ],
};

const FALLBACK_HIGH_CONTRAST = {
    radius: 15,
    outlineWidth: 1,
    outlineColor: [1, 1, 1, 0.30],
    shadow: [
        {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
        {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.10]},
        {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.80]},
    ],
    shadowBackdrop: [
        {dx: 0, dy: 0, blur: 10, spread: 5, color: [0, 0, 0, 0.08]},
        {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.80]},
    ],
};

const BUILTIN_THEMES = /^Adwaita(-dark)?$/;

// Kept, so an unlock needs no re-read.
const sessionCache = {sources: null, stamps: new Map(), styles: new Map(), adwCss: null};

const MAX_IMPORT_DEPTH = 3;

async function readFile(path, cancellable) {
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
        return new TextDecoder().decode(bytes);
    } catch (e) {
        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw e;
        return '';
    }
}

function stamp(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info(
            'time::modified,time::modified-usec,standard::size',
            Gio.FileQueryInfoFlags.NONE, null);
        return [
            info.get_attribute_uint64('time::modified'),
            info.get_attribute_uint32('time::modified-usec'),
            info.get_size(),
        ].join(':');
    } catch {
        return 'absent';
    }
}

function serialize(stamps) {
    return [...stamps].map(([path, value]) => `${path}=${value}`).join('\n');
}

async function readStylesheet(path, stamps, cancellable, depth = 0) {
    if (stamps.has(path))
        return '';
    // Taken before reading, so a file that changes mid-read is read again.
    stamps.set(path, stamp(path));

    const text = await readFile(path, cancellable);
    if (!text || depth >= MAX_IMPORT_DEPTH)
        return text;

    const dir = GLib.path_get_dirname(path);
    const pattern = /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?\s*;/g;
    const parts = [];
    let cursor = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        parts.push(text.slice(cursor, match.index));
        cursor = match.index + match[0].length;

        const reference = match[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(reference))
            continue;

        const child = reference.startsWith('/')
            ? reference
            : GLib.build_filenamev([dir, reference]);
        // In order: the cascade depends on it.
        // eslint-disable-next-line no-await-in-loop
        parts.push(await readStylesheet(child, stamps, cancellable, depth + 1));
    }
    parts.push(text.slice(cursor));
    return parts.join('');
}

function fallback(env) {
    return env.highContrast ? FALLBACK_HIGH_CONTRAST : FALLBACK;
}

function cacheKey(env) {
    return `${env.dark ? 'dark' : 'light'}/${env.highContrast ? 'hc' : 'normal'}`;
}

function merge(base, next) {
    const merged = {...base};
    for (const [key, value] of Object.entries(next)) {
        if (value !== null && value !== undefined)
            merged[key] = value;
    }
    return merged;
}

export class StyleResolver {
    /**
     * @param {string} extensionPath - Path to extension directory.
     * @param {function(): void} onChanged - Callback when style changes.
     */
    constructor(extensionPath, onChanged) {
        this._extensionPath = extensionPath;
        this._onChanged = onChanged;
        this._probeWidget = null;
        this._idleId = 0;
        this._signals = [];
        this._monitors = [];
        this._watched = '';
        this._cancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._refreshQueued = false;
        this._probeStarted = false;

        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });

        const cached = this._cached(this._sources());
        this._style = cached
            ? merge(cached, this._shellThemeOverride())
            : fallback(this._environment());

        const settings = St.Settings.get();
        this._track(settings, 'notify::color-scheme');
        this._track(settings, 'notify::high-contrast');
        this._track(St.ThemeContext.get_for_stage(global.stage), 'changed');
        this._track(this._interfaceSettings, 'changed::gtk-theme');

        this._queueRefresh();
    }

    get style() {
        return this._style;
    }

    _track(object, signal) {
        this._signals.push([object, object.connect(signal, () => this._queueRefresh())]);
    }

    _queueRefresh() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh() {
        if (this._refreshing) {
            this._refreshQueued = true;
            return;
        }
        this._refreshing = true;
        this._refreshQueued = false;

        try {
            const next = await this._compute();
            if (JSON.stringify(next) !== JSON.stringify(this._style)) {
                this._style = next;
                this._onChanged();
            }
        } catch (e) {
            if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            throw e;
        } finally {
            this._refreshing = false;
        }

        if (this._refreshQueued)
            this._queueRefresh();
    }

    _environment() {
        const settings = St.Settings.get();
        return {
            dark: settings.color_scheme === St.SystemColorScheme.PREFER_DARK,
            highContrast: settings.high_contrast,
        };
    }

    // The cached style for the current environment, or null when it was never
    // read or a file it was read from has changed since.
    _cached(sources) {
        if (sessionCache.sources !== sources.paths.join('\n'))
            return null;
        for (const [path, value] of sessionCache.stamps) {
            if (stamp(path) !== value)
                return null;
        }
        return sessionCache.styles.get(cacheKey(this._environment())) ?? null;
    }

    async _compute() {
        const sources = this._sources();
        let style = this._cached(sources);
        if (style) {
            this._watchFiles([...sessionCache.stamps.keys()]);
        } else {
            this._watchFiles(sources.paths);
            style = await this._read(this._environment(), sources);
        }
        return merge(style, this._shellThemeOverride());
    }

    async _read(env, sources) {
        const stamps = new Map();
        const sheets = [];
        if (sources.themeFile)
            sheets.push(await readStylesheet(sources.themeFile, stamps, this._cancellable));
        else if (sessionCache.adwCss === null)
            this._probeLibadwaita();
        else
            sheets.push(sessionCache.adwCss);
        sheets.push(await readStylesheet(sources.userCss, stamps, this._cancellable));

        let style = fallback(env);
        for (const css of sheets)
            style = merge(style, readWindowStyle(css, env));

        this._watchFiles([...stamps.keys()]);
        // Without a theme, the result is only complete once the probe has answered.
        if (sources.themeFile || sessionCache.adwCss !== null)
            this._store(sources, stamps, cacheKey(env), style);
        return style;
    }

    // Every cached style was read from the same files at the same stamps.
    _store(sources, stamps, key, style) {
        const paths = sources.paths.join('\n');
        if (sessionCache.sources !== paths || serialize(sessionCache.stamps) !== serialize(stamps)) {
            sessionCache.sources = paths;
            sessionCache.stamps = stamps;
            sessionCache.styles.clear();
        }
        sessionCache.styles.set(key, style);
    }

    _sources() {
        const themeFile = this._findThemeFile();
        const userCss = GLib.build_filenamev([
            GLib.get_user_config_dir(), 'gtk-4.0', 'gtk.css',
        ]);
        return {
            themeFile,
            userCss,
            paths: themeFile ? [themeFile, userCss] : [userCss],
        };
    }

    _watchFiles(paths) {
        const key = paths.join('\n');
        if (key === this._watched)
            return;
        this._watched = key;

        this._unwatchFiles();
        for (const path of paths) {
            const monitor = Gio.File.new_for_path(path)
                .monitor_file(Gio.FileMonitorFlags.NONE, null);
            const id = monitor.connect('changed', () => this._queueRefresh());
            this._monitors.push([monitor, id]);
        }
    }

    _unwatchFiles() {
        for (const [monitor, id] of this._monitors) {
            monitor.disconnect(id);
            monitor.cancel();
        }
        this._monitors = [];
    }

    _findThemeFile() {
        const name = this._interfaceSettings.get_string('gtk-theme');
        if (!name || BUILTIN_THEMES.test(name))
            return null;

        const roots = [
            GLib.build_filenamev([GLib.get_home_dir(), '.themes']),
            GLib.build_filenamev([GLib.get_user_data_dir(), 'themes']),
            ...GLib.get_system_data_dirs().map(dir =>
                GLib.build_filenamev([dir, 'themes'])),
        ];

        for (const root of roots) {
            const path = GLib.build_filenamev([root, name, 'gtk-4.0', 'gtk.css']);
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                return path;
        }
        return null;
    }

    _shellThemeOverride() {
        if (!this._probeWidget) {
            this._probeWidget = new St.Widget({
                style_class: 'rounded-window-corners',
                visible: false,
            });
            global.stage.add_child(this._probeWidget);
        }

        const node = this._probeWidget.get_theme_node();
        if (!node)
            return {};

        const radius = node.get_border_radius(St.Corner.TOPLEFT);
        if (!(radius > 0))
            return {};

        const width = node.get_border_width(St.Side.TOP);
        const color = node.get_border_color(St.Side.TOP);
        return {
            radius,
            outlineWidth: width,
            outlineColor: [
                color.red / 255, color.green / 255,
                color.blue / 255, color.alpha / 255,
            ],
        };
    }

    _probeLibadwaita() {
        if (this._probeStarted)
            return;
        this._probeStarted = true;

        const script = GLib.build_filenamev([
            this._extensionPath, 'tools', 'adw-probe.js',
        ]);

        let process;
        try {
            process = Gio.Subprocess.new(
                ['gjs', '-m', script],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            sessionCache.adwCss = '';
            return;
        }

        process.communicate_utf8_async(null, this._cancellable, (source, result) => {
            try {
                const [, stdout] = source.communicate_utf8_finish(result);
                sessionCache.adwCss = source.get_successful() ? stdout : '';
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                sessionCache.adwCss = '';
            }
            this._queueRefresh();
        });
    }

    destroy() {
        this._cancellable.cancel();

        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];

        this._unwatchFiles();

        this._probeWidget?.destroy();
        this._probeWidget = null;
        this._interfaceSettings = null;
    }
}

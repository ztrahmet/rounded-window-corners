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

const sessionCache = {signature: null, files: [], styles: new Map(), adwCss: null};

const MAX_IMPORT_DEPTH = 3;

async function readFile(path) {
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
        return new TextDecoder().decode(bytes);
    } catch {
        return '';
    }
}

// Reads a stylesheet and recursively inlines @import rules.
async function readStylesheet(path, seen, depth = 0) {
    if (seen.has(path))
        return '';
    seen.add(path);

    const text = await readFile(path);
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
        parts.push(await readStylesheet(child, seen, depth + 1));
    }
    parts.push(text.slice(cursor));
    return parts.join('');
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
        this._alive = true;
        this._refreshing = false;
        this._refreshQueued = false;
        this._probeStarted = false;

        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });

        this._style = this._environment().highContrast
            ? FALLBACK_HIGH_CONTRAST
            : FALLBACK;

        const settings = St.Settings.get();
        this._track(settings, 'notify::color-scheme');
        this._track(settings, 'notify::high-contrast');
        this._track(St.ThemeContext.get_for_stage(global.stage), 'changed');
        this._track(this._interfaceSettings, 'changed::gtk-theme', true);

        this._queueRefresh();
    }

    get style() {
        return this._style;
    }

    _track(object, signal, invalidates = false) {
        this._signals.push([object, object.connect(signal, () => {
            if (invalidates)
                sessionCache.styles.clear();
            this._queueRefresh();
        })]);
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
        do {
            this._refreshQueued = false;
            const next = await this._compute();
            if (!this._alive) {
                this._refreshing = false;
                return;
            }
            if (JSON.stringify(next) === JSON.stringify(this._style))
                continue;
            this._style = next;
            this._onChanged();
        } while (this._refreshQueued);
        this._refreshing = false;
    }

    _environment() {
        const settings = St.Settings.get();
        return {
            dark: settings.color_scheme === St.SystemColorScheme.PREFER_DARK,
            highContrast: settings.high_contrast,
        };
    }

    async _compute() {
        if (!this._alive)
            return this._style;

        const env = this._environment();
        const key = `${env.dark ? 'dark' : 'light'}/${env.highContrast ? 'hc' : 'normal'}`;

        const sources = this._sources();
        const watched = [...new Set([...sources.paths, ...sessionCache.files])];
        this._watchFiles(watched);

        const signature = this._signature(watched);
        if (sessionCache.signature !== signature)
            sessionCache.styles.clear();

        let style = sessionCache.styles.get(key);
        if (!style) {
            style = env.highContrast ? FALLBACK_HIGH_CONTRAST : FALLBACK;
            const read = new Set();
            const sheets = await this._stylesheets(sources, read);

            if (!this._alive)
                return this._style;

            for (const css of sheets)
                style = merge(style, readWindowStyle(css, env));

            sessionCache.files = [...new Set([...sources.paths, ...read])];
            sessionCache.signature = this._signature(sessionCache.files);
            sessionCache.styles.set(key, style);
            this._watchFiles(sessionCache.files);
        }

        return merge(style, this._shellThemeOverride());
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

    _signature(paths) {
        return paths.map(path => {
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null))
                return `${path}=absent`;

            try {
                const info = file.query_info(
                    'time::modified,time::modified-usec,standard::size',
                    Gio.FileQueryInfoFlags.NONE, null);
                const stamp = [
                    info.get_attribute_uint64('time::modified'),
                    info.get_attribute_uint32('time::modified-usec'),
                    info.get_size(),
                ].join(':');
                return `${path}=${stamp}`;
            } catch {
                return `${path}=absent`;
            }
        }).join('\n');
    }

    async _stylesheets({themeFile, userCss}, seen) {
        const sheets = [];

        if (themeFile && GLib.file_test(themeFile, GLib.FileTest.EXISTS))
            sheets.push(await readStylesheet(themeFile, seen));

        if (sheets.length === 0) {
            if (sessionCache.adwCss)
                sheets.push(sessionCache.adwCss);
            else
                this._probeLibadwaita();
        }

        if (GLib.file_test(userCss, GLib.FileTest.EXISTS))
            sheets.push(await readStylesheet(userCss, seen));

        return sheets;
    }

    _watchFiles(paths) {
        const key = paths.join('\n');
        if (key === this._watched)
            return;
        this._watched = key;

        for (const monitor of this._monitors)
            monitor.cancel();
        this._monitors = [];

        for (const path of paths) {
            try {
                const monitor = Gio.File.new_for_path(path)
                    .monitor_file(Gio.FileMonitorFlags.NONE, null);
                monitor.connect('changed', () => {
                    sessionCache.styles.clear();
                    this._queueRefresh();
                });
                this._monitors.push(monitor);
            } catch {
                // Ignore paths that cannot be monitored.
            }
        }
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

    // Theme overrides specified by the active GNOME Shell theme.
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
            return;
        }

        process.communicate_utf8_async(null, null, (source, result) => {
            if (!this._alive)
                return;

            try {
                const [, stdout] = source.communicate_utf8_finish(result);
                if (!source.get_successful() || !stdout)
                    return;
                sessionCache.adwCss = stdout;
                sessionCache.styles.clear();
                this._refresh();
            } catch {
                // Ignore probe failure and retain fallback styles.
            }
        });
    }

    destroy() {
        this._alive = false;

        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];

        for (const monitor of this._monitors)
            monitor.cancel();
        this._monitors = [];

        this._probeWidget?.destroy();
        this._probeWidget = null;
        this._interfaceSettings = null;
    }
}

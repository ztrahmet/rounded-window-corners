/**
 * Works out what a window should look like, by asking the system rather than by
 * hardcoding.
 *
 * The corner radius, hairline outline and drop shadow are the ones libadwaita
 * applies to `window.csd`. They are resolved from these sources, in increasing
 * order of priority:
 *
 *   1. Built-in constants, matching libadwaita 1.7-1.9 (GNOME 48-50). Only ever
 *      used if every other source is unavailable.
 *   2. libadwaita's own compiled stylesheet, read once via a helper subprocess
 *      (tools/adw-probe.js). This is what makes us track future Adwaita changes.
 *   3. The active GTK4 theme's `gtk.css` when the user runs a custom theme. In
 *      GTK that replaces Adwaita rather than layering on it, so it replaces
 *      source 2 here too. Then `~/.config/gtk-4.0/gtk.css`, which in GTK layers
 *      on top, and does here as well.
 *   4. A shell theme styling `.rounded-window-corners`, for theme authors who
 *      want the window frame to match their shell rather than GTK.
 *
 * Light/dark and high contrast are handled by resolving the cascade against the
 * current environment, because `@media` is how the stylesheets themselves
 * express those variants. This extension never picks a colour of its own.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {readWindowStyle} from './cssParse.js';

/**
 * libadwaita's `window.csd`, as of 1.7 through 1.9 (GNOME 48, 49, 50), where
 * the values are identical. A last resort: normally source 2 or 3 supplies
 * these, and then a newer Adwaita is followed automatically.
 */
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

/** The same rules under `@media (prefers-contrast: more)`. */
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

/** Themes named this have no files on disk; their CSS lives inside libadwaita. */
const BUILTIN_THEMES = /^Adwaita(-dark)?$/;

const MAX_IMPORT_DEPTH = 3;

function readFile(path) {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok)
        throw new Error(`could not read ${path}`);
    return new TextDecoder().decode(bytes);
}

/**
 * Read a stylesheet, inlining `@import`s so the parser sees one document.
 * GTK themes routinely split colours into an imported file, and our parser
 * ignores `@import` statements rather than following them.
 */
function readStylesheet(path, depth = 0) {
    const text = readFile(path);
    if (depth >= MAX_IMPORT_DEPTH)
        return text;

    const dir = GLib.path_get_dirname(path);
    return text.replace(
        /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?\s*;/g,
        (_match, reference) => {
            // resource:// and other non-file URIs are not readable from here.
            if (/^[a-z][a-z0-9+.-]*:/i.test(reference))
                return '';
            const child = reference.startsWith('/')
                ? reference
                : GLib.build_filenamev([dir, reference]);
            try {
                return readStylesheet(child, depth + 1);
            } catch {
                return '';
            }
        });
}

/** Copy the fields `next` actually determined over `base`. */
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
     * @param {string} extensionPath - Directory holding tools/adw-probe.js.
     * @param {function(): void} onChanged - Called whenever the resolved style
     *     differs from the previous one.
     */
    constructor(extensionPath, onChanged) {
        this._extensionPath = extensionPath;
        this._onChanged = onChanged;
        this._adwCss = null;
        this._probeWidget = null;
        this._idleId = 0;
        this._signals = [];
        this._monitors = [];
        this._watched = '';

        // Parsed results per environment. Reparsing the GTK stylesheets is by
        // far the most expensive thing here, and a single theme change fires
        // several signals at once, so it is cached and invalidated only by the
        // events that can actually change the source text.
        this._parsed = new Map();

        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });

        this._style = this._compute();

        const settings = St.Settings.get();
        this._track(settings, 'notify::color-scheme');
        this._track(settings, 'notify::high-contrast');
        this._track(St.ThemeContext.get_for_stage(global.stage), 'changed');
        // A different GTK theme means different source files.
        this._track(this._interfaceSettings, 'changed::gtk-theme', true);

        this._probeLibadwaita();
    }

    /** @returns The current resolved style. Never null. */
    get style() {
        return this._style;
    }

    /**
     * @param {boolean} [invalidates] - Whether the signal means the stylesheet
     *     text itself changed, as opposed to which variant of it applies.
     */
    _track(object, signal, invalidates = false) {
        this._signals.push([object, object.connect(signal, () => {
            if (invalidates)
                this._parsed.clear();
            this._queueRefresh();
        })]);
    }

    /**
     * Several of the signals we watch fire together for a single user action.
     * Switching to dark mode notifies St.Settings and reloads the shell theme,
     * so resolution is coalesced to once per main loop iteration.
     */
    _queueRefresh() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        const next = this._compute();
        if (JSON.stringify(next) === JSON.stringify(this._style))
            return;
        this._style = next;
        this._onChanged();
    }

    _environment() {
        const settings = St.Settings.get();
        return {
            dark: settings.color_scheme === St.SystemColorScheme.PREFER_DARK,
            highContrast: settings.high_contrast,
        };
    }

    _compute() {
        const env = this._environment();
        const key = `${env.dark ? 'dark' : 'light'}/${env.highContrast ? 'hc' : 'normal'}`;

        let style = this._parsed.get(key);
        if (!style) {
            style = env.highContrast ? FALLBACK_HIGH_CONTRAST : FALLBACK;
            const {sheets, paths} = this._stylesheets();
            for (const css of sheets) {
                try {
                    style = merge(style, readWindowStyle(css, env));
                } catch (error) {
                    logError(error, 'rounded-window-corners: could not read a stylesheet');
                }
            }
            this._watchFiles(paths);
            this._parsed.set(key, style);
        }

        // Not cached: a shell theme can be restyled without any of our
        // invalidation signals firing, and reading it is cheap.
        return merge(style, this._shellThemeOverride());
    }

    /**
     * The GTK stylesheets in effect, lowest priority first, along with the file
     * paths they came from so those can be watched for edits.
     *
     * A custom theme's `gtk.css` replaces Adwaita in GTK, so it replaces the
     * libadwaita source here rather than stacking on it. The user's own
     * `~/.config/gtk-4.0/gtk.css` does stack, in both.
     */
    _stylesheets() {
        const sheets = [];
        const paths = [];

        const themeFile = this._findThemeFile();
        if (themeFile) {
            paths.push(themeFile);
            try {
                sheets.push(readStylesheet(themeFile));
            } catch {
                // Unreadable theme; fall through to libadwaita below.
            }
        }
        if (sheets.length === 0 && this._adwCss)
            sheets.push(this._adwCss);

        // Watched whether or not it exists: creating it later is exactly the
        // case we want to notice.
        const userCss = GLib.build_filenamev([
            GLib.get_user_config_dir(), 'gtk-4.0', 'gtk.css',
        ]);
        paths.push(userCss);
        if (GLib.file_test(userCss, GLib.FileTest.EXISTS)) {
            try {
                sheets.push(readStylesheet(userCss));
            } catch {
                // Ignore an unreadable user override.
            }
        }

        return {sheets, paths};
    }

    /**
     * Watch the stylesheets we read, so that editing one takes effect without a
     * restart. The settings signals alone would not tell us.
     *
     * Monitors are only rebuilt when the set of files changes, which happens
     * when the user switches GTK theme.
     */
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
                    this._parsed.clear();
                    this._queueRefresh();
                });
                this._monitors.push(monitor);
            } catch {
                // A path we cannot watch will not live-update.
            }
        }
    }

    /** Locate the active GTK4 theme's stylesheet, or null if it is built in. */
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

    /**
     * Values from a shell theme styling `.rounded-window-corners`.
     *
     * Our own stylesheet declares the class but sets nothing, so a radius of 0
     * means no shell theme has an opinion. A window with no radius needs no
     * effect anyway, which makes 0 a safe sentinel rather than a real value.
     */
    _shellThemeOverride() {
        try {
            if (!this._probeWidget) {
                this._probeWidget = new St.Widget({
                    style_class: 'rounded-window-corners',
                    visible: false,
                });
                global.stage.add_child(this._probeWidget);
            }

            const node = this._probeWidget.get_theme_node();
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
        } catch {
            return {};
        }
    }

    /**
     * Read libadwaita's compiled stylesheet out of process, asynchronously.
     *
     * Nothing waits on this: the built-in values are already in effect, and if
     * the probe disagrees the style is refreshed. A missing gjs, a missing
     * typelib or a renamed resource therefore costs nothing.
     */
    _probeLibadwaita() {
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
            try {
                const [, stdout] = source.communicate_utf8_finish(result);
                if (!source.get_successful() || !stdout)
                    return;
                this._adwCss = stdout;
                this._parsed.clear();
                this._refresh();
            } catch {
                // Keep whatever we already resolved.
            }
        });
    }

    destroy() {
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

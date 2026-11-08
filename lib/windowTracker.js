/**
 * Window tracker and effect lifecycle manager
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {customStyle} from './customStyle.js';
import {RoundedCornersEffect, ShadowRoomEffect} from './roundedCornersEffect.js';
import {compileStyle} from './shadowProfile.js';
import {STYLE_KEYS, StyleValues} from './styleSettings.js';
import {StyleResolver} from './styleResolver.js';
import {windowToolkit} from './toolkitProbe.js';

const EFFECT_NAME = 'rounded-window-corners';
const ROOM_NAME = 'rounded-window-corners-room';

const ROUNDABLE_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

// The toolkits whose apps round their windows themselves, and their switches.
const SWITCHES = new Map([
    ['libadwaita', 'round-libadwaita-apps'],
    ['libhandy', 'round-libhandy-apps'],
]);

const RULE_KEYS = [
    ...SWITCHES.values(), 'round-maximized',
    'use-allowlist', 'blocklist', 'allowlist', 'blocklist-toolkits', 'allowlist-toolkits',
];

// Override-redirect windows and Wayland popups never take a type that is rounded.
function neverRounded(win) {
    return win.is_override_redirect() ||
        (win.get_client_type() === Meta.WindowClientType.WAYLAND && !ROUNDABLE_TYPES.has(win.windowType));
}

function tilingOf(win) {
    if (win.maximizedHorizontally && win.maximizedVertically)
        return 'maximized';
    return win.maximizedHorizontally || win.maximizedVertically ? 'tiled' : null;
}

// A dialog from another process, like the file chooser portal's, takes that process's app.
function appId(win) {
    let top = win;
    let parent = win.get_transient_for();
    while (parent?.get_pid() === top.get_pid()) {
        top = parent;
        parent = top.get_transient_for();
    }
    if (!parent)
        return Shell.WindowTracker.get_default().get_window_app(win)?.get_id();
    const apps = Shell.AppSystem.get_default();
    const wmClass = top.get_wm_class();
    return (apps.lookup_startup_wmclass(wmClass) ?? apps.lookup_desktop_wmclass(wmClass))?.get_id();
}

// A style's values, its custom style built once. Without a border method, the next style's applies.
function readStyle(values) {
    return {
        style: values['custom-style'] ? compileStyle(customStyle(values)) : null,
        border: values['border-method'],
        borderWidth: values['border-width'],
    };
}

export class WindowTracker {
    /**
     * @param {string} extensionPath
     * @param {Gio.Settings} settings
     */
    constructor(extensionPath, settings) {
        // A window maps to null while its toolkit is being probed.
        this._windows = new Map();
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._values = new StyleValues(settings);
        this._styles = null;

        this._settings.connectObject('change-event', (_settings, keys) => {
            this._settingsChanged(keys && keys.map(key => GLib.quark_to_string(key)));
            return false;
        }, this);
        this._settingsChanged(null);

        for (const actor of global.get_window_actors())
            this._track(actor);

        global.display.connectObject('window-created',
            (_display, win) => this._track(win.get_compositor_private()), this);
    }

    destroy() {
        global.display.disconnectObject(this);
        this._settings.disconnectObject(this);

        for (const actor of this._windows.keys())
            this._untrack(actor);

        this._styles?.destroy();
    }

    /**
     * @param {Meta.Window} win
     * @param {?string} toolkit - From windowToolkit().
     * @returns {?object} {style, border, borderWidth}, or null if the window isn't rounded.
     */
    roundingFor(win, toolkit) {
        const {allowlist, apps, toolkits, switchedOff} = this._rules;
        const app = appId(win);
        const listed = toolkits.includes(toolkit) || apps.includes(app);
        if (allowlist ? !listed : listed || switchedOff.has(toolkit))
            return null;

        // The app's style, then its toolkit's, then the general one, which has a border method.
        const chain = [this._appStyles.get(app), this._toolkitStyles.get(toolkit), this._general].filter(Boolean);
        const {border, borderWidth} = chain.find(entry => entry.border);
        return {style: chain.find(entry => entry.style)?.style ?? this._styles.style, border, borderWidth};
    }

    get roundsMaximized() {
        return this._rules.maximized;
    }

    // Rereads only what the changed keys affect; null means any key may have changed.
    _settingsChanged(keys) {
        const changed = names => !keys || keys.some(key => names.includes(key));
        if (changed(RULE_KEYS))
            this._readRules();
        if (changed(STYLE_KEYS)) {
            this._general = readStyle(this._values.general());
            // libadwaita and gtk.css are read only while the general style follows them.
            if (this._general.style) {
                this._styles?.destroy();
                this._styles = null;
            } else {
                this._styles ??= new StyleResolver(this._extensionPath, () => this._syncAll());
            }
        }
        if (changed(['app-styles']))
            this._appStyles = this._readStyles('app-styles');
        if (changed(['toolkit-styles']))
            this._toolkitStyles = this._readStyles('toolkit-styles');
        this._syncAll();
    }

    _readRules() {
        const allowlist = this._settings.get_boolean('use-allowlist');
        const list = allowlist ? 'allowlist' : 'blocklist';
        this._rules = {
            allowlist,
            apps: this._settings.get_strv(list),
            toolkits: this._settings.get_strv(`${list}-toolkits`),
            switchedOff: new Set([...SWITCHES.keys()].filter(toolkit =>
                !this._settings.get_boolean(SWITCHES.get(toolkit)))),
            maximized: this._settings.get_boolean('round-maximized'),
        };
    }

    _readStyles(key) {
        const entries = Object.entries(this._settings.get_value(key).deepUnpack());
        return new Map(entries.map(([id, entry]) => [id, readStyle(this._values.of(entry))]));
    }

    _syncAll() {
        for (const window of this._windows.values())
            window?.sync();
    }

    async _track(actor) {
        if (neverRounded(actor.metaWindow))
            return;

        this._windows.set(actor, null);
        actor.connectObject('destroy', () => this._untrack(actor), this);

        const toolkit = await windowToolkit(actor.metaWindow);
        if (this._windows.get(actor) === null)
            this._windows.set(actor, new RoundedWindow(actor, toolkit, this));
    }

    _untrack(actor) {
        actor.disconnectObject(this);
        this._windows.get(actor)?.destroy();
        this._windows.delete(actor);
    }
}

class RoundedWindow {
    constructor(actor, toolkit, tracker) {
        this._actor = actor;
        this._metaWindow = actor.metaWindow;
        this._toolkit = toolkit;
        this._tracker = tracker;
        this._effect = null;
        this._room = null;
        this._texture = null;
        this._width = 0;
        this._height = 0;
        this._updated = [];
        this._tiling = tilingOf(this._metaWindow);
        this._fullscreen = this._metaWindow.fullscreen;

        const sync = () => this.sync();
        // An X11 window gets its surface, or a new one, after it is created.
        actor.connectObject('notify::size', sync, 'child-added', sync, 'damaged', () => {
            if (this._pictureDrawn())
                this.sync();
        }, this);
        // The Shell finds the window's app again on these, so sync after it.
        this._metaWindow.connectObject('notify::appears-focused', sync, 'notify::window-type', sync,
            'notify::wm-class', sync, GObject.ConnectFlags.AFTER,
            'notify::gtk-application-id', sync, GObject.ConnectFlags.AFTER, this);
        this.sync();
    }

    destroy() {
        this._actor.disconnectObject(this);
        this._metaWindow.disconnectObject(this);
        this._texture?.disconnectObject(this);
        if (this._effect) {
            this._actor.remove_effect(this._effect);
            this._actor.remove_effect(this._room);
        }
    }

    sync() {
        this._watchTexture();
        [, this._width, this._height] = this._texture ? this._texture.get_preferred_size() : [false, 0, 0];

        const drawing = this._drawing();
        if (drawing && !this._effect)
            this._addEffects();
        if (drawing)
            this._update(drawing);
        if (this._effect && this._effect.enabled !== (drawing !== null)) {
            this._room.enabled = drawing !== null;
            this._effect.enabled = drawing !== null;
            this._actor.invalidate_paint_volume();
        }
    }

    /**
     * As in libadwaita, a new state shows with the app's next picture, whatever its size.
     *
     * @returns {boolean} Whether the state shown changed.
     */
    _pictureDrawn() {
        const tiling = tilingOf(this._metaWindow);
        const {fullscreen} = this._metaWindow;
        if (tiling === this._tiling && fullscreen === this._fullscreen)
            return false;
        this._tiling = tiling;
        this._fullscreen = fullscreen;
        return true;
    }

    // Follow the app's picture, which an X11 window can swap for a new one.
    _watchTexture() {
        const texture = this._actor.get_texture();
        if (texture === this._texture)
            return;
        this._texture?.disconnectObject(this);
        this._texture = texture;
        this._texture?.connectObject('size-changed', () => {
            this._pictureDrawn();
            this.sync();
        }, this);
    }

    // What the window is drawn with, or null when its look draws nothing, as when maximized.
    _drawing() {
        const win = this._metaWindow;
        if (this._width === 0 || this._fullscreen || !ROUNDABLE_TYPES.has(win.windowType))
            return null;
        const rounding = this._tracker.roundingFor(win, this._toolkit);
        if (!rounding)
            return null;

        // Tiled and maximized windows take libadwaita's look, rounded only if the settings say so.
        const state = rounding.style[this._tiling ?? 'normal'];
        const radii = this._tiling && this._tracker.roundsMaximized ? rounding.style.normal.radii : state.radii;
        return state.draws || radii.some(r => r > 0) ? {...rounding, state, radii} : null;
    }

    // Ours go first, as effects like the Shell's dimmer size themselves from those before them.
    // Moving an effect drops its animations, so this happens once; later, ours are only disabled.
    _addEffects() {
        this._room = new ShadowRoomEffect();
        this._effect = new RoundedCornersEffect();
        const others = this._actor.get_effects();
        others.forEach(effect => this._actor.remove_effect(effect));
        this._actor.add_effect_with_name(ROOM_NAME, this._room);
        this._actor.add_effect_with_name(EFFECT_NAME, this._effect);
        others.forEach(effect => this._actor.add_effect(effect));
    }

    // The frame's margins sit inside the app's picture, which on X11 can lag behind the buffer.
    _update({state, radii, border, borderWidth}) {
        const buffer = this._metaWindow.get_buffer_rect();
        const frame = this._metaWindow.get_frame_rect();
        const x1 = frame.x - buffer.x;
        const y1 = frame.y - buffer.y;
        const x2 = this._width - (buffer.x + buffer.width - frame.x - frame.width);
        const y2 = this._height - (buffer.y + buffer.height - frame.y - frame.height);
        const {reach} = state;
        if (this._room.setBox([x1 - reach, y1 - reach, x2 + reach, y2 + reach])) {
            this._actor.invalidate_paint_volume();
            this._actor.queue_redraw();
        }

        // Each update repaints the window, so one that changes nothing is skipped.
        const look = this._metaWindow.appearsFocused ? state.focused : state.backdrop;
        const update = [x1, y1, x2, y2, radii, look, border, borderWidth];
        if (update.every((value, i) => value === this._updated[i]))
            return;
        this._updated = update;
        this._effect.update([x1, y1, x2, y2], radii, look, border, borderWidth);
    }
}

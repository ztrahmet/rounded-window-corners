/**
 * Window tracker and effect lifecycle manager
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {customStyle} from './customStyle.js';
import {EntrySettings} from './entrySettings.js';
import {RoundedCornersEffect, ShadowRoomEffect} from './roundedCornersEffect.js';
// sharp-windows start
import {SharpRoundedCornersEffect} from './sharpRoundedCornersEffect.js';
// sharp-windows end
import {compileShadow, shadowExtent} from './shadowProfile.js';
import {StyleResolver} from './styleResolver.js';
import {windowToolkit} from './toolkitProbe.js';

const EFFECT_NAME = 'rounded-window-corners';
const ROOM_NAME = 'rounded-window-corners-room';
// sharp-windows start
const SHARP_NAME = 'rounded-window-corners-sharp';
// sharp-windows end

const DESKTOP_APP_IDS = new Set(['com.rastersoft.ding']);

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

// The Shell gives windows the app they're over even from another process, like the file chooser portal's, so they
// take their own process's app.
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

// An appearance's values, with its custom style built once.
function readAppearance(appearance) {
    return {
        style: appearance.get_boolean('custom-style') ? customStyle({
            radius: appearance.get_int('corner-radius'),
            outlineWidth: appearance.get_int('outline-width'),
            outlinePosition: appearance.get_string('outline-position'),
            outlineColor: appearance.get_string('outline-color'),
            outlineOpacity: appearance.get_double('outline-opacity'),
            shadowAngle: appearance.get_int('shadow-angle'),
            shadowDistance: appearance.get_int('shadow-distance'),
            shadowBlur: appearance.get_int('shadow-blur'),
            shadowColor: appearance.get_string('shadow-color'),
            shadowOpacity: appearance.get_double('shadow-opacity'),
        }) : null,
        border: appearance.get_string('border-method'),
        borderWidth: appearance.get_int('border-width'),
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
        this._settings = settings;
        this._appearance = settings.get_child('appearance');
        this._entrySettings = new EntrySettings(settings, extensionPath);
        this._watchedEntries = [];
        this._styles = new StyleResolver(extensionPath, () => this._syncAll());

        this._settings.connectObject('changed', (_settings, key) => {
            if (key === 'styled-apps' || key === 'styled-toolkits')
                this._loadEntries();
            this._readRules();
            this._syncAll();
        }, this);
        this._appearance.connectObject('changed', () => this._appearanceChanged(), this);
        this._readRules();
        this._loadEntries();
        this._appearanceChanged();

        for (const actor of global.get_window_actors())
            this._track(actor);

        global.display.connectObject('window-created',
            (_display, win) => this._track(win.get_compositor_private()), this);
    }

    destroy() {
        global.display.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._appearance.disconnectObject(this);
        this._dropEntries();

        for (const actor of this._windows.keys())
            this._untrack(actor);

        this._styles.destroy();
    }

    /**
     * @param {Meta.Window} win
     * @param {?string} toolkit - From windowToolkit().
     * @returns {boolean} Whether the settings let the window be rounded.
     */
    rounds(win, toolkit) {
        const {allowlist, apps, toolkits, switchedOff} = this._rules;
        const listed = toolkits.includes(toolkit) || apps.includes(appId(win));
        return allowlist ? listed : !listed && !switchedOff.has(toolkit);
    }

    get roundsMaximized() {
        return this._rules.maximized;
    }

    // sharp-windows start
    get sharpWindows() {
        return this._rules.sharp;
    }
    // sharp-windows end

    /**
     * @param {Meta.Window} win
     * @param {?string} toolkit - From windowToolkit().
     * @returns {{style: object, border: string, borderWidth: number}} How the window is rounded.
     */
    roundingFor(win, toolkit) {
        // An app's own entry comes first, then its toolkit's, then the general one, which can't inherit.
        const chain = [this._appEntries.get(appId(win)), this._toolkitEntries.get(toolkit), this._general]
            .filter(Boolean);
        const {border, borderWidth} = chain.find(entry => entry.border !== 'inherit') ?? this._general;
        return {style: chain.find(entry => entry.style)?.style ?? this._styles.style, border, borderWidth};
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
            // sharp-windows start
            sharp: this._settings.get_boolean('sharp-windows'),
            // sharp-windows end
        };
    }

    _loadEntries() {
        this._dropEntries();
        this._appEntries = this._entriesIn('styled-apps');
        this._toolkitEntries = this._entriesIn('styled-toolkits');
    }

    _entriesIn(key) {
        const entries = new Map();
        for (const id of this._settings.get_strv(key)) {
            const appearance = this._entrySettings.of(key, id);
            const read = () => entries.set(id, readAppearance(appearance));
            appearance.connectObject('changed', () => {
                read();
                this._syncAll();
            }, this);
            read();
            this._watchedEntries.push(appearance);
        }
        return entries;
    }

    _dropEntries() {
        for (const appearance of this._watchedEntries)
            appearance.disconnectObject(this);
        this._watchedEntries = [];
    }

    // Only the general style can follow libadwaita, so the stylesheets are read only for it.
    _appearanceChanged() {
        this._general = readAppearance(this._appearance);
        this._styles.setReading(this._general.style === null);
        this._syncAll();
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
        // sharp-windows start
        this._sharp = null;
        // sharp-windows end
        this._texture = null;
        this._width = 0;
        this._height = 0;
        this._tiling = null;
        this._fullscreen = false;

        const sync = () => this.sync();
        // An X11 window gets its surface, or a new one, after it is created.
        actor.connectObject('notify::size', sync, 'child-added', sync, this);
        // The Shell finds the window's app again when its WM class or application ID changes, so sync after it does.
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
            // sharp-windows start
            this._actor.remove_effect(this._sharp);
            // sharp-windows end
        }
    }

    sync() {
        this._watchTexture();

        // As in libadwaita, the look changes once the app has drawn its new size.
        const win = this._metaWindow;
        const tiling = tilingOf(win);
        const [, width, height] = this._texture ? this._texture.get_preferred_size() : [false, 0, 0];
        if (width !== this._width || height !== this._height) {
            this._width = width;
            this._height = height;
            this._tiling = tiling;
            this._fullscreen = win.fullscreen;
        } else if (tiling !== this._tiling || win.fullscreen !== this._fullscreen) {
            return;
        }

        if (this._shouldRound() !== this._isRounded())
            this._apply();
        else if (this._isRounded())
            this._update();
    }

    // Follow the app's picture, which an X11 window can swap for a new one.
    _watchTexture() {
        const texture = this._actor.get_texture();
        if (texture === this._texture)
            return;
        this._texture?.disconnectObject(this);
        this._texture = texture;
        this._texture?.connectObject('size-changed', () => this.sync(), this);
    }

    _shouldRound() {
        return this._width > 0 &&
            this._tracker.rounds(this._metaWindow, this._toolkit) &&
            ROUNDABLE_TYPES.has(this._metaWindow.windowType) &&
            !DESKTOP_APP_IDS.has(this._metaWindow.gtkApplicationId) &&
            !this._fullscreen &&
            (!this._tiling || this._tracker.roundsMaximized);
    }

    _isRounded() {
        // sharp-windows removed
        // return this._effect !== null && this._effect.enabled;
        // sharp-windows start: only the effect the setting picks counts, so changing the setting rounds it again.
        const effect = this._tracker.sharpWindows ? this._sharp : this._effect;
        return effect !== null && effect.enabled;
        // sharp-windows end
    }

    // Once added, the effects are only turned off, to stay before later offscreen effects like the Shell's dimmer.
    _apply() {
        if (!this._effect) {
            this._room = new ShadowRoomEffect();
            this._effect = new RoundedCornersEffect();
            // sharp-windows start: one of the two draws the window.
            this._sharp = new SharpRoundedCornersEffect();
            this._effect.enabled = !this._tracker.sharpWindows;
            this._sharp.enabled = this._tracker.sharpWindows;
            // sharp-windows end
            this._update();
            this._actor.add_effect_with_name(ROOM_NAME, this._room);
            this._actor.add_effect_with_name(EFFECT_NAME, this._effect);
            // sharp-windows start
            this._actor.add_effect_with_name(SHARP_NAME, this._sharp);
            // sharp-windows end
            return;
        }

        const round = this._shouldRound();
        if (round)
            this._update();
        this._room.enabled = round;
        // sharp-windows removed
        // this._effect.enabled = round;
        // sharp-windows start
        this._effect.enabled = round && !this._tracker.sharpWindows;
        this._sharp.enabled = round && this._tracker.sharpWindows;
        // sharp-windows end
        this._actor.invalidate_paint_volume();
    }

    // The frame keeps its margins inside the app's picture, which on X11 can lag behind the buffer while resizing.
    _update() {
        const buffer = this._metaWindow.get_buffer_rect();
        const frame = this._metaWindow.get_frame_rect();
        const x1 = frame.x - buffer.x;
        const y1 = frame.y - buffer.y;
        const x2 = this._width - (buffer.x + buffer.width - frame.x - frame.width);
        const y2 = this._height - (buffer.y + buffer.height - frame.y - frame.height);
        const {style, border, borderWidth} = this._tracker.roundingFor(this._metaWindow, this._toolkit);
        // Tiled and maximized windows take libadwaita's look for them, with the style's corners.
        const state = this._tiling ? style[this._tiling] : style;

        // Room for both looks, so it doesn't change when focus does.
        const reach = Math.max(...[state, state.backdrop].map(look =>
            Math.max(shadowExtent(look.shadow), look.outlineOffset + look.outlineWidth))) + 1;
        if (this._room.setBox([x1 - reach, y1 - reach, x2 + reach, y2 + reach])) {
            this._actor.invalidate_paint_volume();
            this._actor.queue_redraw();
        }

        const look = this._metaWindow.appearsFocused ? state : state.backdrop;
        this._effect.update(
            [x1, y1, x2, y2],
            style.radii,
            look.outlineWidth,
            look.outlineOffset,
            look.outlineColor,
            compileShadow(look.shadow),
            border,
            borderWidth);
        // sharp-windows start
        this._sharp.update(
            [x1, y1, x2, y2],
            style.radii,
            look.outlineWidth,
            look.outlineOffset,
            look.outlineColor,
            compileShadow(look.shadow),
            border,
            borderWidth);
        // sharp-windows end
    }
}

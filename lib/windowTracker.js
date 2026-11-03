/**
 * Window tracker and effect lifecycle manager
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Meta from 'gi://Meta';

import {RoundedCornersEffect, ShadowRoomEffect} from './roundedCornersEffect.js';
import {compileShadow, shadowExtent} from './shadowProfile.js';
import {StyleResolver} from './styleResolver.js';
import {windowToolkit} from './toolkitProbe.js';

const EFFECT_NAME = 'rounded-window-corners';
const ROOM_NAME = 'rounded-window-corners-room';

const DESKTOP_APP_IDS = new Set(['com.rastersoft.ding']);

const ROUNDABLE_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

// Override-redirect windows and Wayland popups never take a type that is rounded.
function neverRounded(win) {
    return win.is_override_redirect() ||
        (win.get_client_type() === Meta.WindowClientType.WAYLAND && !ROUNDABLE_TYPES.has(win.windowType));
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
        this._styles = new StyleResolver(extensionPath, () => this._syncAll());

        this._settings.connectObject('changed', () => this._syncAll(), this);

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

        this._styles.destroy();
    }

    /**
     * @param {?string} toolkit - From windowToolkit().
     * @returns {boolean} Whether windows of this toolkit are rounded.
     */
    rounds(toolkit) {
        return toolkit === null || this._settings.get_boolean(`round-${toolkit}-apps`);
    }

    get roundsMaximized() {
        return this._settings.get_boolean('round-maximized');
    }

    get style() {
        return this._styles.style;
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
        this._maximized = false;
        this._fullscreen = false;

        const sync = () => this.sync();
        // An X11 window gets its surface, or a new one, after it is created.
        actor.connectObject('notify::size', sync, 'child-added', sync, this);
        this._metaWindow.connectObject('notify::appears-focused', sync, 'notify::window-type', sync, this);
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

        // As in libadwaita, the look changes once the app has drawn its new size.
        const win = this._metaWindow;
        const maximized = win.maximizedHorizontally || win.maximizedVertically;
        const [, width, height] = this._texture ? this._texture.get_preferred_size() : [false, 0, 0];
        if (width !== this._width || height !== this._height) {
            this._width = width;
            this._height = height;
            this._maximized = maximized;
            this._fullscreen = win.fullscreen;
        } else if (maximized !== this._maximized || win.fullscreen !== this._fullscreen) {
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
            this._tracker.style.radii.some(r => r > 0) &&
            this._tracker.rounds(this._toolkit) &&
            ROUNDABLE_TYPES.has(this._metaWindow.windowType) &&
            !DESKTOP_APP_IDS.has(this._metaWindow.gtkApplicationId) &&
            !this._fullscreen &&
            (!this._maximized || this._tracker.roundsMaximized);
    }

    _isRounded() {
        return this._effect !== null && this._effect.enabled;
    }

    // Once added, the effects are only turned off, to stay before later offscreen effects like the Shell's dimmer.
    _apply() {
        if (!this._effect) {
            this._room = new ShadowRoomEffect();
            this._effect = new RoundedCornersEffect();
            this._update();
            this._actor.add_effect_with_name(ROOM_NAME, this._room);
            this._actor.add_effect_with_name(EFFECT_NAME, this._effect);
            return;
        }

        const round = this._shouldRound();
        if (round)
            this._update();
        this._room.enabled = round;
        this._effect.enabled = round;
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
        const style = this._tracker.style;

        // Room for both looks, so it doesn't change when focus does.
        const reach = Math.max(...[style, style.backdrop].map(look =>
            Math.max(shadowExtent(look.shadow), look.outlineOffset + look.outlineWidth))) + 1;
        if (this._room.setBox([x1 - reach, y1 - reach, x2 + reach, y2 + reach]))
            this._actor.invalidate_paint_volume();

        const look = this._metaWindow.appearsFocused ? style : style.backdrop;
        this._effect.update(
            [x1, y1, x2, y2],
            style.radii,
            look.outlineWidth,
            look.outlineOffset,
            look.outlineColor,
            compileShadow(look.shadow));
    }
}

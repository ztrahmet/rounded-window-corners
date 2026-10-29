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
import {usesLibadwaita} from './toolkitProbe.js';

const EFFECT_NAME = 'rounded-window-corners';
const ROOM_NAME = 'rounded-window-corners-room';

const DESKTOP_APP_IDS = new Set(['com.rastersoft.ding']);

const ROUNDABLE_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

export class WindowTracker {
    constructor(extensionPath) {
        // A window maps to null while its toolkit is being probed.
        this._windows = new Map();
        this._styles = new StyleResolver(extensionPath, () => this._syncAll());

        for (const actor of global.get_window_actors())
            this._track(actor);

        global.display.connectObject('window-created',
            (_display, win) => this._track(win.get_compositor_private()), this);
    }

    destroy() {
        global.display.disconnectObject(this);

        for (const actor of this._windows.keys())
            this._untrack(actor);

        this._styles.destroy();
    }

    _syncAll() {
        for (const window of this._windows.values())
            window?.sync();
    }

    // libadwaita apps round their windows themselves.
    async _track(actor) {
        this._windows.set(actor, null);
        actor.connectObject('destroy', () => this._untrack(actor), this);

        const adwaita = await usesLibadwaita(actor.metaWindow);
        if (this._windows.get(actor) !== null)
            return;

        if (adwaita)
            this._untrack(actor);
        else
            this._windows.set(actor, new RoundedWindow(actor, this._styles));
    }

    _untrack(actor) {
        actor.disconnectObject(this);
        this._windows.get(actor)?.destroy();
        this._windows.delete(actor);
    }
}

class RoundedWindow {
    constructor(actor, styles) {
        this._actor = actor;
        this._metaWindow = actor.metaWindow;
        this._styles = styles;
        this._effect = null;
        this._room = null;
        this._texture = null;
        this._width = 0;
        this._height = 0;
        this._square = false;

        const sync = () => this.sync();
        // An X11 window gets its surface, or a new one, after it is created.
        actor.connectObject('notify::size', sync, 'child-added', sync, this);
        this._metaWindow.connectObject('notify::appears-focused', sync, this);
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
        const square = win.maximizedHorizontally || win.maximizedVertically || win.fullscreen;
        const [, width, height] = this._texture ? this._texture.get_preferred_size() : [false, 0, 0];
        if (width !== this._width || height !== this._height) {
            this._width = width;
            this._height = height;
            this._square = square;
        } else if (square !== this._square) {
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
            this._styles.style.radii.some(r => r > 0) &&
            ROUNDABLE_TYPES.has(this._metaWindow.windowType) &&
            !DESKTOP_APP_IDS.has(this._metaWindow.gtkApplicationId) &&
            !this._square;
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
        const style = this._styles.style;

        // Room for both shadows, so it doesn't change when focus does.
        const reach = Math.max(shadowExtent(style.shadow), shadowExtent(style.shadowBackdrop),
            style.outlineOffset + style.outlineWidth) + 1;
        if (this._room.setBox([x1 - reach, y1 - reach, x2 + reach, y2 + reach]))
            this._actor.invalidate_paint_volume();

        this._effect.update(
            [x1, y1, x2, y2],
            style.radii,
            style.outlineWidth,
            style.outlineOffset,
            style.outlineColor,
            compileShadow(this._metaWindow.appearsFocused ? style.shadow : style.shadowBackdrop));
    }
}

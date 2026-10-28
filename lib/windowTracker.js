/**
 * Window tracker and effect lifecycle manager
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import GLib from 'gi://GLib';
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
        this._states = new Map();
        this._styles = new StyleResolver(extensionPath, () => this._syncAll());

        for (const actor of global.get_window_actors())
            this._track(actor);

        this._windowCreatedId = global.display.connect('window-created',
            (_display, win) => this._track(win.get_compositor_private()));
    }

    destroy() {
        global.display.disconnect(this._windowCreatedId);

        for (const actor of this._states.keys())
            this._untrack(actor);

        this._styles.destroy();
    }

    _syncAll() {
        for (const [actor, state] of this._states)
            this._sync(actor, state);
    }

    async _track(actor) {
        // Left alone until the probe answers.
        const state = {
            adwaita: true, effect: null, room: null, target: null,
            square: false, width: 0, height: 0,
            surface: null, surfaceSizeId: 0, laterId: 0, signals: [],
        };
        this._states.set(actor, state);
        state.signals.push([actor, actor.connect('destroy', () => this._untrack(actor))]);

        const win = actor.metaWindow;
        state.adwaita = await usesLibadwaita(win);
        if (state.adwaita || this._states.get(actor) !== state)
            return;

        const sync = () => this._sync(actor, state);
        state.signals.push(
            [actor, actor.connect('notify::size', sync)],
            [actor, actor.connect('resource-scale-changed', sync)],
            [win, win.connect('notify::appears-focused', sync)]);

        // The X11 surface the effect goes on can arrive, or change, later.
        if (isX11(win))
            state.signals.push([actor, actor.connect('child-added', sync)]);

        sync();
    }

    _untrack(actor) {
        const state = this._states.get(actor);
        this._states.delete(actor);
        if (state.laterId)
            global.compositor.get_laters().remove(state.laterId);
        this._detach(state);
        if (state.surface)
            state.surface.disconnect(state.surfaceSizeId);
        for (const [object, id] of state.signals)
            object.disconnect(id);
    }

    _sync(actor, state) {
        const win = actor.metaWindow;
        const picture = effectTarget(actor);
        this._watchSurface(actor, state, picture);

        // Like libadwaita, switch for maximize and fullscreen once the app has
        // redrawn, which changes its size.
        const square = win.maximizedHorizontally || win.maximizedVertically || win.fullscreen;
        if (picture && (picture.width !== state.width || picture.height !== state.height)) {
            state.width = picture.width;
            state.height = picture.height;
            state.square = square;
        } else if (square !== state.square) {
            return;
        }

        // An X11 surface can resize during a paint, where Clutter forbids effect changes.
        const target = this._shouldRound(win, state) ? picture : null;
        if (state.target !== target && !state.laterId) {
            state.laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                state.laterId = 0;
                this._attach(actor, state);
                return GLib.SOURCE_REMOVE;
            });
        }

        if (state.effect)
            this._update(state, win);
    }

    _attach(actor, state) {
        const win = actor.metaWindow;
        const target = this._shouldRound(win, state) ? effectTarget(actor) : null;
        if (state.target !== target)
            this._detach(state);
        if (!target || state.effect)
            return;

        state.room = new ShadowRoomEffect();
        state.effect = new RoundedCornersEffect();
        state.target = target;
        target.add_effect_with_name(ROOM_NAME, state.room);
        target.add_effect_with_name(EFFECT_NAME, state.effect);
        this._update(state, win);
    }

    // An X11 surface takes its new size after the window actor does.
    _watchSurface(actor, state, picture) {
        if (picture === actor || picture === state.surface)
            return;
        if (state.surface)
            state.surface.disconnect(state.surfaceSizeId);
        state.surface = picture;
        state.surfaceSizeId = picture ? picture.connect('notify::size', () => this._sync(actor, state)) : 0;
    }

    _shouldRound(win, state) {
        return !state.adwaita &&
            this._styles.style.radii.some(r => r > 0) &&
            ROUNDABLE_TYPES.has(win.windowType) &&
            !DESKTOP_APP_IDS.has(win.gtkApplicationId) &&
            !state.square;
    }

    _detach(state) {
        if (!state.effect)
            return;
        state.target.remove_effect(state.effect);
        state.target.remove_effect(state.room);
        state.effect = null;
        state.room = null;
        state.target = null;
    }

    _update(state, win) {
        const geometry = measure(state.target, win);
        if (!geometry)
            return;

        const {bounds, scale} = geometry;
        const style = this._styles.style;
        const layers = win.appearsFocused ? style.shadow : style.shadowBackdrop;

        // Covers both shadows and the outline, so focus changes keep it.
        const reach = scale * Math.max(shadowExtent(style.shadow), shadowExtent(style.shadowBackdrop),
            style.outlineOffset + style.outlineWidth) + 1;
        const [x1, y1, x2, y2] = bounds;
        if (state.room.setBox([x1 - reach, y1 - reach, x2 + reach, y2 + reach]))
            state.target.invalidate_paint_volume();

        state.effect.update(
            bounds,
            style.radii.map(r => r * scale),
            style.outlineWidth * scale,
            style.outlineOffset * scale,
            style.outlineColor,
            compileShadow(layers, scale));
    }
}

function isX11(win) {
    return win.get_client_type() === Meta.WindowClientType.X11;
}

// MetaSurfaceActor is not introspected, so it is found by type name.
function effectTarget(actor) {
    if (!isX11(actor.metaWindow))
        return actor;
    return actor.get_children().find(child => child.constructor.$gtype.name.startsWith('MetaSurfaceActor')) ?? null;
}

// The frame within the target actor, in actor pixels.
function measure(target, win) {
    const buffer = win.get_buffer_rect();
    const frame = win.get_frame_rect();
    const width = target.width;
    const height = target.height;

    if (!(width > 0 && height > 0 && buffer.width > 0 && buffer.height > 0))
        return null;

    const sx = width / buffer.width;
    const sy = height / buffer.height;

    const x1 = (frame.x - buffer.x) * sx;
    const y1 = (frame.y - buffer.y) * sy;
    const x2 = x1 + frame.width * sx;
    const y2 = y1 + frame.height * sy;

    return {
        bounds: [x1, y1, x2, y2],
        scale: Math.min(sx, sy),
    };
}

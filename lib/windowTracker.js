/**
 * Window tracker and effect lifecycle manager
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Meta from 'gi://Meta';

import {RoundedCornersEffect} from './roundedCornersEffect.js';
import {compileShadow} from './shadowProfile.js';
import {usesLibadwaita} from './toolkitProbe.js';

const EFFECT_NAME = 'rounded-window-corners';

const DESKTOP_APP_IDS = new Set(['com.rastersoft.ding']);

const ROUNDABLE_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

export class WindowTracker {
    /**
     * @param {object} styleResolver - Supplies resolved theme values.
     */
    constructor(styleResolver) {
        this._styles = styleResolver;
        this._states = new Map();
        this._globalSignals = [];
        this._alive = true;
        this._enabled = false;
    }

    enable() {
        if (this._enabled || !this._alive)
            return;
        this._enabled = true;

        for (const actor of global.get_window_actors())
            this._track(actor);

        this._connectGlobal(global.display, 'window-created', (_display, win) => {
            const actor = win.get_compositor_private();
            if (actor)
                this._track(actor);
        });
    }

    /**
     * Re-evaluates every tracked window after a theme change.
     */
    refreshAll() {
        for (const actor of [...this._states.keys()])
            this._sync(actor);
    }

    destroy() {
        this._alive = false;
        for (const [object, id] of this._globalSignals)
            object.disconnect(id);
        this._globalSignals = [];

        for (const actor of [...this._states.keys()])
            this._untrack(actor);
    }

    _connectGlobal(object, signal, handler) {
        this._globalSignals.push([object, object.connect(signal, handler)]);
    }

    async _track(actor) {
        if (!this._alive || this._states.has(actor))
            return;

        const win = actor.metaWindow;
        if (!win)
            return;

        const state = {adwaita: false, effect: null, target: null, signals: []};
        this._states.set(actor, state);

        state.adwaita = await usesLibadwaita(win);

        if (!this._alive || this._states.get(actor) !== state || actor.is_destroyed()) {
            this._states.delete(actor);
            return;
        }

        const sync = () => this._sync(actor);

        state.signals.push(
            [actor, actor.connect('destroy', () => this._untrack(actor))],
            [actor, actor.connect('notify::size', sync)],
            [actor, actor.connect('resource-scale-changed', sync)],
            [win, win.connect('notify::maximized-horizontally', sync)],
            [win, win.connect('notify::maximized-vertically', sync)],
            [win, win.connect('notify::fullscreen', sync)],
            [win, win.connect('notify::appears-focused', sync)],
        );

        const texture = actor.get_texture?.();
        if (texture)
            state.signals.push([texture, texture.connect('size-changed', sync)]);

        this._sync(actor);
    }

    _untrack(actor) {
        const state = this._states.get(actor);
        if (!state)
            return;

        this._states.delete(actor);
        this._detach(state);
        for (const [object, id] of state.signals)
            object.disconnect(id);
        state.signals = [];
    }

    _sync(actor) {
        const state = this._states.get(actor);
        if (!state || actor.is_destroyed())
            return;

        const win = actor.metaWindow;
        if (!win)
            return;

        if (!this._shouldRound(win, state)) {
            this._detach(state);
            return;
        }

        const target = this._effectTarget(actor, state);
        if (!target)
            return;

        if (state.effect && state.target !== target)
            this._detach(state);

        if (!state.effect) {
            const effect = new RoundedCornersEffect();
            target.add_effect_with_name(EFFECT_NAME, effect);
            state.effect = effect;
            state.target = target;
        }

        this._update(state, win);
    }

    // Resolves target actor on which the effect should be attached.
    _effectTarget(actor, state) {
        if (actor.metaWindow.get_client_type() !== Meta.WindowClientType.X11)
            return actor;

        const surface = findSurface(actor);
        if (surface)
            return surface;

        if (!state.waitingForChild) {
            state.waitingForChild = true;
            let signalEntry;
            const id = actor.connect('child-added', () => {
                if (!findSurface(actor))
                    return;
                actor.disconnect(id);
                const idx = state.signals.indexOf(signalEntry);
                if (idx !== -1)
                    state.signals.splice(idx, 1);
                state.waitingForChild = false;
                this._sync(actor);
            });
            signalEntry = [actor, id];
            state.signals.push(signalEntry);
        }
        return null;
    }

    _shouldRound(win, state) {
        if (state.adwaita)
            return false;
        if (!(this._styles.style.radius > 0))
            return false;
        if (!ROUNDABLE_TYPES.has(win.window_type))
            return false;
        if (win.is_override_redirect())
            return false;
        if (DESKTOP_APP_IDS.has(win.gtkApplicationId))
            return false;

        return !(win.maximizedHorizontally || win.maximizedVertically || win.fullscreen);
    }

    _detach(state) {
        if (!state.effect)
            return;
        state.target?.remove_effect(state.effect);
        state.effect = null;
        state.target = null;
    }

    _update(state, win) {
        const geometry = measure(state.target, win);
        if (!geometry)
            return;

        const style = this._styles.style;
        const scale = geometry.scale;

        const layers = win.appears_focused ? style.shadow : style.shadowBackdrop;
        const shadow = compileShadow(layers, geometry.margin / scale, scale);

        state.effect.update(
            geometry.bounds,
            style.radius * scale,
            style.outlineWidth * scale,
            style.outlineColor,
            shadow);
    }
}

/**
 * Calculates window frame bounds and margins within the target actor.
 *
 * @param {Clutter.Actor} target
 * @param {Meta.Window} win
 * @returns {?{bounds: number[], margin: number, scale: number}}
 */
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
        margin: Math.max(Math.min(x1, y1, width - x2, height - y2), 0),
        scale: Math.min(sx, sy),
    };
}

// Locates MetaSurfaceActor containing the window buffer.
function findSurface(actor) {
    const children = actor.get_children();
    for (const child of children) {
        const type = child.constructor?.$gtype?.name;
        if (type && type.startsWith('MetaSurfaceActor'))
            return child;
    }
    for (const child of children) {
        const nested = findSurface(child);
        if (nested)
            return nested;
    }
    return null;
}

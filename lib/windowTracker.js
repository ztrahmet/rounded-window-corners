/**
 * Decides which windows carry the effect, and keeps their uniforms current.
 *
 * There is one moving part per window: a Shell.GLSLEffect on its actor. Because
 * a ClutterClone paints its source through the full effect chain, that one
 * effect is reproduced in the overview, in alt-tab, during workspace switches
 * and in screenshots. This file therefore never patches a GNOME Shell method,
 * never inserts an actor into the window group, and never has to care about
 * restacking.
 */

import Meta from 'gi://Meta';

import {RoundedCornersEffect} from './roundedCornersEffect.js';
import {compileShadow} from './shadowProfile.js';
import {usesLibadwaita} from './toolkitProbe.js';

const EFFECT_NAME = 'rounded-window-corners';

/**
 * Windows that paint the desktop itself. Desktop Icons NG usually reports a
 * desktop window type, which the type check below already excludes, but not
 * always, and a rounded desktop is clearly wrong.
 */
const DESKTOP_APP_IDS = new Set(['com.rastersoft.ding']);

const ROUNDABLE_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

export class WindowTracker {
    /** @param {object} styleResolver - Supplies the resolved theme values. */
    constructor(styleResolver) {
        this._styles = styleResolver;
        this._states = new Map();
        this._globalSignals = [];
        this._alive = true;
    }

    enable() {
        for (const actor of global.get_window_actors())
            this._track(actor);

        this._connectGlobal(global.display, 'window-created', (_display, win) => {
            const actor = win.get_compositor_private();
            if (actor)
                this._track(actor);
        });
    }

    /** Re-evaluate every tracked window, after the theme changed. */
    refreshAll() {
        for (const actor of [...this._states.keys()])
            this._sync(actor);
    }

    destroy() {
        this._alive = false;
        for (const [object, id] of this._globalSignals)
            disconnect(object, id);
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

        // Claim the slot before awaiting, so a second event for the same actor
        // cannot start a parallel track.
        const state = {adwaita: false, effect: null, target: null, signals: []};
        this._states.set(actor, state);

        state.adwaita = await usesLibadwaita(win);

        // The extension may have been disabled, or the window closed, while we
        // were reading /proc.
        if (!this._alive || this._states.get(actor) !== state || actor.is_destroyed()) {
            this._states.delete(actor);
            return;
        }

        const connect = (object, signal, handler) => {
            try {
                state.signals.push([object, object.connect(signal, handler)]);
            } catch {
                // A signal this shell version does not have; skip it.
            }
        };
        const sync = () => this._sync(actor);

        connect(actor, 'destroy', () => this._untrack(actor));
        connect(actor, 'notify::size', sync);
        connect(win, 'notify::maximized-horizontally', sync);
        connect(win, 'notify::maximized-vertically', sync);
        connect(win, 'notify::fullscreen', sync);
        connect(win, 'notify::appears-focused', sync);

        // The actor's own size does not always change when the surface behind
        // it does, as happens with XWayland clients, so the texture is watched
        // too.
        const texture = actor.get_texture();
        if (texture)
            connect(texture, 'size-changed', sync);

        this._sync(actor);
    }

    _untrack(actor) {
        const state = this._states.get(actor);
        if (!state)
            return;

        this._states.delete(actor);
        this._detach(state);
        for (const [object, id] of state.signals)
            disconnect(object, id);
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
            state.effect = new RoundedCornersEffect();
            state.target = target;
            target.add_effect_with_name(EFFECT_NAME, state.effect);
        }

        this._update(state, win);
    }

    /**
     * The actor the effect belongs on.
     *
     * For X11 clients that is the surface child rather than the window actor:
     * mutter paints the server-side frame shadow outside it, and leaving that
     * shadow alone is what we want, since such windows have no buffer margin in
     * which to draw a replacement.
     */
    _effectTarget(actor, state) {
        if (actor.metaWindow.get_client_type() !== Meta.WindowClientType.X11)
            return actor;

        const child = actor.get_first_child();
        if (child)
            return child;

        // An XWayland surface is sometimes not attached yet when its window
        // appears; come back when it is.
        if (!state.waitingForChild) {
            state.waitingForChild = true;
            const id = actor.connect('notify::first-child', () => {
                disconnect(actor, id);
                state.waitingForChild = false;
                this._sync(actor);
            });
            state.signals.push([actor, id]);
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

        // libadwaita drops the radius, the outline and the shadow entirely once
        // a window is maximized, tiled or fullscreen. Matching that means
        // removing the effect, and with it the offscreen framebuffer, at the
        // point where it is largest.
        return !(win.maximizedHorizontally || win.maximizedVertically || win.fullscreen);
    }

    _detach(state) {
        if (!state.effect)
            return;
        try {
            state.target?.remove_effect(state.effect);
        } catch {
            // The actor may already be on its way out.
        }
        state.effect = null;
        state.target = null;
    }

    _update(state, win) {
        const geometry = measure(state.target, win);
        if (!geometry)
            return;

        const style = this._styles.style;

        // Theme values are logical pixels; the shader works in actor pixels.
        // The two agree except when fractional scaling makes an actor's size
        // disagree with its window's buffer rectangle, which is the case the
        // reference extensions get wrong.
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
 * Where the window's frame sits inside its actor, in actor pixels, along with
 * how much client-side-decoration margin surrounds it.
 *
 * Everything is derived from the actor-to-buffer ratio rather than by mixing
 * actor sizes with Meta rectangles, so it stays correct when those two units
 * diverge under fractional scaling.
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

function disconnect(object, id) {
    try {
        object.disconnect(id);
    } catch {
        // Already gone, or disconnected by a one-shot handler.
    }
}

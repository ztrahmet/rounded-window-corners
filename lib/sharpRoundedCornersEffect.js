/**
 * Rounded corners drawn through a buffer at the scale the window is shown at
 *
 * sharp-windows: works around mutter#2214 and gnome-shell#7903. Remove once both are fixed upstream.
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

import {CODE, DECLARATIONS} from './roundedCornersEffect.js';

// Buffers kept at once, such as the desktop's, the overview's and a second monitor's.
const BUFFERS = 3;
// Places remembered while none of them is rendered.
const MISSES = 4;
// A buffer not drawn for this long is dropped, unless it's the last drawn or the sharpest aligned one.
const KEEP_USEC = 2 * GLib.USEC_PER_SEC;
// In pixels, how far from a whole one a projected value still counts as whole.
const EPSILON = 1e-3;

const isWhole = v => Math.abs(v - Math.round(v)) < EPSILON;

// Buffer pixels per actor pixel of the app's picture.
function bufferScale(actor) {
    const content = actor.get_texture();
    const buffer = content ? content.get_texture() : null;
    if (!buffer)
        return 1;
    const [, logicalWidth, logicalHeight] = content.get_preferred_size();
    return Math.sqrt(buffer.get_width() * buffer.get_height() / (logicalWidth * logicalHeight));
}

function samePlace(a, b) {
    return Object.keys(a).every(key => a[key] === b[key]);
}

function sharpest(buffers) {
    return buffers.reduce((a, b) => !a || b.place.texelScale > a.place.texelScale ? b : a, null);
}

export const SharpRoundedCornersEffect = GObject.registerClass(
class SharpRoundedCornersEffect extends Clutter.Effect {
    constructor() {
        super();
        // By name, [size, values], for buffers made later.
        this._uniforms = new Map();
        this._locations = new Map();
        this._pipeline = null;
        // Most recently drawn first.
        this._buffers = [];
        this._misses = [];
        this._lastPaint = null;
        this._point = new Graphene.Vec4();
        this._color = new Cogl.Color();
    }

    /**
     * As RoundedCornersEffect.update().
     *
     * @param {number[]} bounds
     * @param {number[]} radii
     * @param {number} outlineWidth
     * @param {number} outlineOffset
     * @param {number[]} outlineColor
     * @param {Array<object>} shadow
     * @param {string} border
     * @param {number} borderWidth
     */
    update(bounds, radii, outlineWidth, outlineOffset, outlineColor, shadow, border, borderWidth) {
        this._setUniform('borderRemovalWidth', 1, [border === 'off' ? 0 : borderWidth]);
        this._setUniform('clip', 1, [border === 'clip' ? 1 : 0]);
        this._setUniform('bounds', 4, bounds);
        this._setUniform('radii', 4, radii);
        this._setUniform('outlineWidth', 1, [outlineWidth]);
        this._setUniform('outlineOffset', 1, [outlineOffset]);
        this._setUniform('outlineColor', 4, outlineColor);
        shadow.forEach(({shape, color}, i) => {
            this._setUniform(`shadowShape${i}`, 4, shape);
            this._setUniform(`shadowColor${i}`, 4, color);
        });
        this._lastPaint = null;
        this.queue_repaint();
    }

    vfunc_set_actor(actor) {
        this._release();
        super.vfunc_set_actor(actor);
    }

    vfunc_set_enabled(enabled) {
        this._release();
        super.vfunc_set_enabled(enabled);
    }

    vfunc_paint(node, paintContext, flags) {
        if (flags & Clutter.EffectPaintFlags.BYPASS_EFFECT) {
            this._release();
            node.add_child(Clutter.ActorNode.new(this.get_actor(), -1));
            return;
        }
        const dirty = flags & Clutter.EffectPaintFlags.ACTOR_DIRTY;
        if (dirty)
            this._buffers.forEach(buffer => (buffer.stale = true));
        this._prune();

        const framebuffer = paintContext.get_framebuffer();
        const place = this._placement(framebuffer, dirty);

        // On screen, a density gets a buffer and a buffer a place once asked for again, as when an animation ends.
        let buffer = this._buffers.find(b => b.place.key === place.key);
        if (!buffer && this._settled(framebuffer, p => p.key === place.key)) {
            this._misses = [];
            buffer = this._newBuffer();
        }
        if (buffer && (buffer.stale || samePlace(buffer.place, place) ||
            this._settled(framebuffer, p => samePlace(p, place)))) {
            this._fill(node, buffer, place);
            this._draw(node, buffer, place.texelScale, place.smear);
            return;
        }

        // Until then, it's drawn from its buffer elsewhere, or scaled down from the sharpest or a resource-scale one.
        this._misses = [place, ...this._misses.slice(0, MISSES - 1)];
        if (!buffer) {
            const scale = this.get_actor().get_resource_scale();
            const best = sharpest(this._buffers);
            const from = best && best.place.texelScale >= place.texelScale ? best.place : this._fit(false, scale, scale);
            buffer = this._buffers.find(b => b.place.key === from.key) ?? this._newBuffer();
            if (buffer.stale)
                this._fill(node, buffer, this._fit(from.aligned, from.densityX, from.densityY));
        }
        this._draw(node, buffer, place.texelScale, 1);
        this.queue_repaint();
    }

    // Whether a place matching was asked for just before, or the paint is off screen, where it's rendered at once.
    _settled(framebuffer, matches) {
        return this._misses.some(matches) || !this._onScreen(framebuffer);
    }

    _setUniform(name, size, values) {
        this._uniforms.set(name, [size, values]);
        for (const buffer of this._buffers)
            this._upload(buffer.pipeline, name, size, values);
    }

    _onScreen(framebuffer) {
        return this.get_actor().get_stage().peek_stage_views().some(view => view.get_framebuffer() === framebuffer);
    }

    // Where an actor-local point lands in the framebuffer, in its pixels.
    _project(transform, [vx, vy, vw, vh], x, y) {
        const p = transform.transform_vec4(this._point.init(x, y, 0, 1));
        return [(p.get_x() / p.get_w() / 2 + 0.5) * vw + vx, (0.5 - p.get_y() / p.get_w() / 2) * vh + vy];
    }

    // A clean paint through the same transform as the last one keeps its place.
    _placement(framebuffer, dirty) {
        const modelview = framebuffer.get_modelview_matrix();
        const last = this._lastPaint;
        if (!dirty && last?.framebuffer === framebuffer && last.modelview.equal_fast(modelview))
            return last.place;

        const transform = modelview.multiply(framebuffer.get_projection_matrix());
        const viewport = framebuffer.get_viewport4fv();
        const [ox, oy] = this._project(transform, viewport, 0, 0);
        const [rx, ry] = this._project(transform, viewport, 100, 0);
        const [dx, dy] = this._project(transform, viewport, 0, 100);
        const scaleX = (rx - ox) / 100;
        const scaleY = (dy - oy) / 100;

        // Rotated, mirrored and magnified paints are buffered at the actor's resource scale.
        const scale = this.get_actor().get_resource_scale();
        const aligned = Math.abs(ry - oy) < 0.1 && Math.abs(dx - ox) < 0.1 &&
            scaleX > 0 && scaleY > 0 && Math.max(scaleX, scaleY) <= scale + EPSILON;
        const place = aligned ? this._fit(true, scaleX, scaleY, ox, oy) : this._fit(false, scale, scale);
        this._lastPaint = {framebuffer, modelview, place};
        return place;
    }

    // The paint volume at a density, in a buffer whose pixels line up with the framebuffer's from ox, oy.
    _fit(aligned, densityX, densityY, ox = 0, oy = 0) {
        const actor = this.get_actor();
        const volume = actor.get_paint_volume();
        let [x1, y1, x2, y2] = [0, 0, actor.width, actor.height];
        if (volume) {
            const origin = volume.get_origin();
            [x1, y1, x2, y2] = [origin.x, origin.y, origin.x + volume.get_width(), origin.y + volume.get_height()];
        }
        x1 = Math.floor(x1);
        y1 = Math.floor(y1);

        // Unless the app's picture lands pixel for pixel, the window is blurred by up to a texel.
        let smear = 1;
        if (aligned && [densityX, densityY, ox, oy].every(isWhole)) {
            const app = bufferScale(actor);
            smear = Math.abs(app - densityX) < EPSILON && Math.abs(app - densityY) < EPSILON ? 0 : 1;
        }

        const startX = ox + densityX * x1;
        const startY = oy + densityY * y1;
        return {
            key: `${densityX.toFixed(4)} ${densityY.toFixed(4)}`,
            aligned, densityX, densityY, x1, y1,
            shiftX: aligned ? Math.max(0, startX - Math.floor(startX + EPSILON)) : 0,
            shiftY: aligned ? Math.max(0, startY - Math.floor(startY + EPSILON)) : 0,
            width: Math.ceil((Math.ceil(x2) - x1) * densityX - EPSILON) + 2,
            height: Math.ceil((Math.ceil(y2) - y1) * densityY - EPSILON) + 2,
            texelScale: (densityX + densityY) / 2,
            smear,
        };
    }

    // In place of the least recently drawn one, once all are taken.
    _newBuffer() {
        if (!this._pipeline) {
            const context = this.get_actor().get_context().get_backend().get_cogl_context();
            this._pipeline = Cogl.Pipeline.new(context);
            this._pipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE));
            this._pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
        }
        const buffer = {
            pipeline: this._pipeline.copy(),
            framebuffer: null,
            box: new Clutter.ActorBox(),
            place: null,
            stale: true,
            drawn: 0,
            texelScale: 0,
            smear: 0,
        };
        this._uniforms.forEach(([size, values], name) => this._upload(buffer.pipeline, name, size, values));
        this._buffers = [buffer, ...this._buffers.slice(0, BUFFERS - 1)];
        return buffer;
    }

    // Renders the window into the buffer, unless it already holds it at that place.
    _fill(node, buffer, place) {
        if (!buffer.place || !samePlace(buffer.place, place)) {
            this._place(buffer, place);
            buffer.stale = true;
        }
        if (!buffer.stale)
            return;
        const layer = Clutter.LayerNode.new_to_framebuffer(buffer.framebuffer, buffer.pipeline);
        node.add_child(layer);
        layer.add_child(Clutter.ActorNode.new(this.get_actor(), 255));
        buffer.stale = false;
    }

    _place(buffer, place) {
        const {densityX, densityY, x1, y1, shiftX, shiftY, width, height} = place;
        const texture = buffer.framebuffer?.get_texture();
        if (!texture || texture.get_width() !== width || texture.get_height() !== height) {
            const context = this.get_actor().get_context().get_backend().get_cogl_context();
            buffer.framebuffer = Cogl.Offscreen.new_with_texture(Cogl.Texture2D.new_with_size(context, width, height));
            buffer.framebuffer.allocate();
            buffer.framebuffer.orthographic(0, 0, width, height, -1, 1);
            buffer.pipeline.set_layer_texture(0, buffer.framebuffer.get_texture());
        }
        const modelview = new Graphene.Matrix().init_scale(densityX, densityY, 1);
        modelview.translate(new Graphene.Point3D({x: shiftX - x1 * densityX, y: shiftY - y1 * densityY, z: 0}));
        buffer.framebuffer.set_modelview_matrix(modelview);

        const left = x1 - shiftX / densityX;
        const top = y1 - shiftY / densityY;
        const spanX = width / densityX;
        const spanY = height / densityY;
        this._upload(buffer.pipeline, 'fboMap', 4, [left, top, spanX, spanY]);
        buffer.box.init(left, top, left + spanX, top + spanY);
        buffer.place = place;
    }

    _draw(node, buffer, texelScale, smear) {
        if (buffer.texelScale !== texelScale || buffer.smear !== smear) {
            this._upload(buffer.pipeline, 'texelScale', 1, [texelScale]);
            this._upload(buffer.pipeline, 'smear', 1, [smear]);
            buffer.texelScale = texelScale;
            buffer.smear = smear;
        }
        const opacity = this.get_actor().get_paint_opacity() / 255;
        this._color.init_from_4f(opacity, opacity, opacity, opacity);
        buffer.pipeline.set_color(this._color);
        const pipelineNode = Clutter.PipelineNode.new(buffer.pipeline);
        node.add_child(pipelineNode);
        pipelineNode.add_rectangle(buffer.box);

        buffer.drawn = GLib.get_monotonic_time();
        if (this._buffers[0] !== buffer)
            this._buffers = [buffer, ...this._buffers.filter(b => b !== buffer)];
    }

    _prune() {
        const now = GLib.get_monotonic_time();
        if (this._buffers.every(buffer => now - buffer.drawn < KEEP_USEC))
            return;
        const kept = sharpest(this._buffers.filter(buffer => buffer.place.aligned));
        this._buffers = this._buffers.filter((buffer, i) =>
            i === 0 || buffer === kept || now - buffer.drawn < KEEP_USEC);
    }

    _upload(pipeline, name, size, values) {
        if (!this._locations.has(name))
            this._locations.set(name, pipeline.get_uniform_location(name));
        pipeline.set_uniform_float(this._locations.get(name), size, 1, values);
    }

    _release() {
        this._pipeline = null;
        this._buffers = [];
        this._misses = [];
        this._lastPaint = null;
    }
});

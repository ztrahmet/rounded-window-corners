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
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

import {CODE, DECLARATIONS, RoundedCornersEffect} from './roundedCornersEffect.js';

const isWhole = v => Math.abs(v - Math.round(v)) < 1e-3;

// Buffer pixels per actor pixel of the app's picture.
function bufferScale(actor) {
    const content = actor.get_texture();
    const buffer = content ? content.get_texture() : null;
    if (!buffer)
        return 1;
    const [, logicalWidth, logicalHeight] = content.get_preferred_size();
    return Math.sqrt(buffer.get_width() * buffer.get_height() / (logicalWidth * logicalHeight));
}

export const SharpRoundedCornersEffect = GObject.registerClass(
class SharpRoundedCornersEffect extends Clutter.Effect {
    constructor() {
        super();
        this._borderWidth = 0;
        // Kept for the next pipeline, by name: [size, values].
        this._uniforms = new Map();
        this._locations = new Map();
        this._pipeline = null;
        this._framebuffer = null;
        this._rendered = null;
        this._point = new Graphene.Vec4();
        this._color = new Cogl.Color();
        this._box = new Clutter.ActorBox();
    }

    /**
     * Sets a shader uniform, as Clutter.ShaderEffect does.
     *
     * @param {string} name
     * @param {number} size - Components per value.
     * @param {number[]} values
     */
    set_uniform_float(name, size, values) {
        this._uniforms.set(name, [size, values]);
        if (this._pipeline)
            this._upload(name, size, values);
        this.queue_repaint();
    }

    /**
     * As RoundedCornersEffect.update().
     *
     * @param {...any} args
     */
    update(...args) {
        RoundedCornersEffect.prototype.update.apply(this, args);
        this.set_uniform_float('borderRemovalWidth', 1, [this._borderWidth]);
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
        const actor = this.get_actor();
        if (flags & Clutter.EffectPaintFlags.BYPASS_EFFECT) {
            this._release();
            node.add_child(Clutter.ActorNode.new(actor, -1));
            return;
        }

        const place = this._placement(paintContext);
        const moved = !this._rendered || Object.keys(place).some(key => place[key] !== this._rendered[key]);
        if (moved || flags & Clutter.EffectPaintFlags.ACTOR_DIRTY)
            this._render(node, place);

        const opacity = actor.get_paint_opacity() / 255;
        this._color.init_from_4f(opacity, opacity, opacity, opacity);
        this._pipeline.set_color(this._color);
        const pipelineNode = Clutter.PipelineNode.new(this._pipeline);
        node.add_child(pipelineNode);
        pipelineNode.add_rectangle(this._box);
    }

    // Where an actor-local point lands in the framebuffer, in its pixels.
    _project(framebuffer, transform, x, y) {
        const [vx, vy, vw, vh] = framebuffer.get_viewport4fv();
        const p = transform.transform_vec4(this._point.init(x, y, 0, 1));
        return [(p.get_x() / p.get_w() / 2 + 0.5) * vw + vx, (0.5 - p.get_y() / p.get_w() / 2) * vh + vy];
    }

    // The area to buffer, in actor pixels, with the density and offset that line its pixels up with the framebuffer's.
    _placement(paintContext) {
        const actor = this.get_actor();
        const framebuffer = paintContext.get_framebuffer();
        const transform = framebuffer.get_modelview_matrix().multiply(framebuffer.get_projection_matrix());
        const [ox, oy] = this._project(framebuffer, transform, 0, 0);
        const [rx, ry] = this._project(framebuffer, transform, 100, 0);
        const [dx, dy] = this._project(framebuffer, transform, 0, 100);

        // Rotated, mirrored and magnified paints are buffered at the actor's resource scale and filtered.
        const scale = actor.get_resource_scale();
        const [scaleX, scaleY] = [(rx - ox) / 100, (dy - oy) / 100];
        const aligned = Math.abs(ry - oy) < 0.1 && Math.abs(dx - ox) < 0.1 &&
            scaleX > 0 && scaleY > 0 && Math.max(scaleX, scaleY) <= scale;
        const [densityX, densityY] = aligned ? [scaleX, scaleY] : [scale, scale];
        const app = bufferScale(actor);
        const exact = aligned && Math.abs(app - densityX) < 1e-3 && Math.abs(app - densityY) < 1e-3 &&
            isWhole(ox) && isWhole(oy);

        const volume = actor.get_paint_volume();
        let [x1, y1, x2, y2] = [0, 0, actor.width, actor.height];
        if (volume) {
            const origin = volume.get_origin();
            [x1, y1, x2, y2] = [origin.x, origin.y, origin.x + volume.get_width(), origin.y + volume.get_height()];
        }
        [x1, y1, x2, y2] = [Math.floor(x1), Math.floor(y1), Math.ceil(x2), Math.ceil(y2)];

        const shiftX = aligned ? ox + densityX * x1 - Math.floor(ox + densityX * x1) : 0;
        const shiftY = aligned ? oy + densityY * y1 - Math.floor(oy + densityY * y1) : 0;
        return {
            aligned, exact, densityX, densityY, x1, y1, shiftX, shiftY,
            width: Math.ceil((x2 - x1) * densityX + shiftX) + 1,
            height: Math.ceil((y2 - y1) * densityY + shiftY) + 1,
        };
    }

    _render(node, place) {
        const {aligned, exact, densityX, densityY, x1, y1, shiftX, shiftY, width, height} = place;
        const actor = this.get_actor();
        const context = actor.get_context().get_backend().get_cogl_context();
        if (!this._pipeline) {
            this._pipeline = Cogl.Pipeline.new(context);
            this._pipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE));
            this._uniforms.forEach(([size, values], name) => this._upload(name, size, values));
        }
        const texture = this._framebuffer?.get_texture();
        if (texture?.get_width() !== width || texture?.get_height() !== height) {
            this._framebuffer = Cogl.Offscreen.new_with_texture(Cogl.Texture2D.new_with_size(context, width, height));
            this._framebuffer.allocate();
        }
        this._pipeline.set_layer_texture(0, this._framebuffer.get_texture());
        const filter = aligned ? Cogl.PipelineFilter.NEAREST : Cogl.PipelineFilter.LINEAR;
        this._pipeline.set_layer_filters(0, filter, filter);

        const left = x1 - shiftX / densityX;
        const top = y1 - shiftY / densityY;
        this._upload('fboMap', 4, [left, top, width / densityX, height / densityY]);
        this._upload('texelScale', 1, [(densityX + densityY) / 2]);
        // Unless the app's picture lands pixel for pixel, the window is blurred by up to a texel.
        this._upload('smear', 1, [exact && isWhole(densityX) && isWhole(densityY) ? 0 : 1]);
        this._box.init(left, top, left + width / densityX, top + height / densityY);

        this._framebuffer.set_viewport(0, 0, width, height);
        this._framebuffer.orthographic(0, 0, width, height, -1, 1);
        const modelview = new Graphene.Matrix().init_translate(new Graphene.Point3D({x: -x1, y: -y1, z: 0}));
        modelview.scale(densityX, densityY, 1);
        modelview.translate(new Graphene.Point3D({x: shiftX, y: shiftY, z: 0}));
        this._framebuffer.set_modelview_matrix(modelview);

        const layer = Clutter.LayerNode.new_to_framebuffer(this._framebuffer, this._pipeline);
        node.add_child(layer);
        layer.add_child(Clutter.ActorNode.new(actor, 255));
        this._rendered = place;
    }

    _upload(name, size, values) {
        if (!this._locations.has(name))
            this._locations.set(name, this._pipeline.get_uniform_location(name));
        this._pipeline.set_uniform_float(this._locations.get(name), size, 1, values);
    }

    _release() {
        this._pipeline = null;
        this._framebuffer = null;
        this._rendered = null;
    }
});

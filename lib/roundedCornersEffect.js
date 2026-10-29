/**
 * Rounded corners Clutter shader effect
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

import {SHADOW_SLOTS} from './shadowProfile.js';

// Clutter sets each uniform as a single value, so every shadow layer has uniforms of its own.
const SLOTS = Array.from({length: SHADOW_SLOTS}, (_, i) => i);

const DECLARATIONS = `
// In actor pixels; the radii run clockwise from top-left.
uniform vec4 bounds;
uniform vec4 radii;

// actorPixel = fboMap.xy + texCoord * fboMap.zw
uniform vec4 fboMap;
uniform float texelScale;
uniform float smear;
uniform float borderRemovalWidth;

uniform float outlineWidth;
uniform float outlineOffset;
uniform vec4 outlineColor;

// Per layer: (dx, dy, spread, sigma) and its color.
${SLOTS.map(i => `uniform vec4 shadowShape${i};\nuniform vec4 shadowColor${i};`).join('\n')}

const float PI = 3.14159265;

float coverage(float distance) {
    return clamp(0.5 - distance * texelScale, 0.0, 1.0);
}

float cornerRadius(vec4 corners, vec2 p) {
    vec2 side = p.x < 0.0 ? corners.xw : corners.yz;
    return p.y < 0.0 ? side.x : side.y;
}

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// GTK's box shadow, from gsk/gpu/shaders/gskgpuboxshadow.glsl (LGPL-2.1-or-later).

// Abramowitz and Stegun 7.1.27.
vec2 erfApprox(vec2 x) {
    vec2 s = sign(x);
    vec2 a = abs(x);
    x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
    x *= x;
    return s - s / (x * x);
}

float erfRange(vec2 x, float sigma) {
    vec2 fromTo = 0.5 - 0.5 * erfApprox(x / (sigma * sqrt(2.0)));
    return fromTo.y - fromTo.x;
}

// p measured inward from the corner.
float blurCorner(vec2 p, float r, float sigma) {
    if (r <= 0.0)
        return 0.0;
    p /= sigma;
    r /= sigma;
    if (min(p.x, p.y) <= -2.95 || max(p.x, p.y) - r >= 2.95)
        return 0.0;

    float start = max(p.y - 3.0, 0.0);
    float step = (min(p.y + 3.0, r) - start) / 7.0;
    float result = 0.0;
    for (int i = 0; i < 8; i++) {
        float y = start + float(i) * step;
        float t = (r - y) / r;
        float x = r - r * sqrt(max(1.0 - t * t, 0.0));
        result -= exp(-0.5 * (p.y - y) * (p.y - y)) / sqrt(2.0 * PI) * erfRange(vec2(-p.x, x - p.x), 1.0);
    }
    return step * result;
}

// Like GTK, an unblurred layer is a plain shape.
float shadowLayer(vec2 p, vec2 halfSize, float spread, float sigma) {
    vec2 h = halfSize + spread;
    vec4 corners = max(radii + sign(radii) * spread, 0.0);
    if (sigma == 0.0)
        return coverage(sdRoundRect(p, h, min(cornerRadius(corners, p), min(h.x, h.y))));

    float shadow = erfRange(vec2(-h.x - p.x, h.x - p.x), sigma) * erfRange(vec2(-h.y - p.y, h.y - p.y), sigma);
    shadow -= blurCorner(p + h, corners.x, sigma);
    shadow -= blurCorner(vec2(h.x - p.x, p.y + h.y), corners.y, sigma);
    shadow -= blurCorner(h - p, corners.z, sigma);
    shadow -= blurCorner(vec2(p.x + h.x, h.y - p.y), corners.w, sigma);
    return shadow;
}

void shadowSlot(int i, out vec4 shape, out vec4 color) {
${SLOTS.map(i => `    ${i > 0 ? 'else ' : ''}if (i == ${i}) {
        shape = shadowShape${i};
        color = shadowColor${i};
    }`).join('\n')}
}

// Premultiplied. As in GTK, each layer is drawn over the ones before it.
vec4 shadow(vec2 p, vec2 halfSize) {
    vec4 result = vec4(0.0);
    for (int i = 0; i < ${SHADOW_SLOTS}; i++) {
        vec4 shape, color;
        shadowSlot(i, shape, color);
        // The layers fill the slots from the first.
        if (color.a == 0.0)
            break;
        float a = color.a * shadowLayer(p - shape.xy, halfSize, shape.z, shape.w);
        result = vec4(color.rgb * a, a) + result * (1.0 - a);
    }
    return result;
}

// Where to take the color that replaces the app's own border.
vec2 removalSample(vec2 p, vec2 halfSize, float r, float d) {
    vec2 q = abs(p) - halfSize + r;
    vec2 edge = halfSize - abs(p);
    float reach = borderRemovalWidth + (0.5 + smear) / texelScale;

    if (q.x <= 0.0 || q.y <= 0.0 || max(edge.x, edge.y) < reach)
        return p - sign(p) * max(vec2(reach) - edge, 0.0);

    // Parallel to the nearer edge, so lines running into the arc stay straight.
    bool alongY = edge.x >= reach && (edge.y < reach || edge.x < edge.y);
    vec2 dir = alongY ? vec2(0.0, -sign(p.y)) : vec2(-sign(p.x), 0.0);
    float inward = dot(dir, -sign(p) * normalize(q));
    return p + dir * max(reach + d, 0.0) / max(inward, 0.25);
}
`;

const CODE = `
// Already applied to cogl_color_out, but not to what is added to it.
float opacity = cogl_color_in.a;

vec2 halfSize = (bounds.zw - bounds.xy) * 0.5;
vec2 p = fboMap.xy + cogl_tex_coord0_in.xy * fboMap.zw - (bounds.xy + bounds.zw) * 0.5;
float maxRadius = min(halfSize.x, halfSize.y);
float r = min(cornerRadius(radii, p), maxRadius);
float d = sdRoundRect(p, halfSize, r);

float removalWidth = borderRemovalWidth + 2.0 * smear / texelScale;

// Deeper inside the window there is nothing to replace or draw over.
if (d > -(max(removalWidth, -outlineOffset) + 0.5 / texelScale)) {
    float content = coverage(d);

    float removalBand = content - coverage(d + removalWidth);
    if (removalBand > 0.0) {
        vec2 st = cogl_tex_coord0_in.xy + (removalSample(p, halfSize, r, d) - p) / fboMap.zw;
        cogl_color_out = mix(cogl_color_out, texture2D(cogl_sampler0, st) * opacity, removalBand / content);
    }

    cogl_color_out *= content;

    if (content < 1.0)
        cogl_color_out += shadow(p, halfSize) * (1.0 - content) * opacity;

    // GTK draws the outline over the window and its shadow.
    float outlineBand = coverage(d - outlineOffset - outlineWidth) - coverage(d - outlineOffset);
    float oa = outlineBand * outlineColor.a;
    cogl_color_out = cogl_color_out * (1.0 - oa) + vec4(outlineColor.rgb, 1.0) * oa * opacity;
}
`;

export const RoundedCornersEffect = GObject.registerClass(
class RoundedCornersEffect extends Clutter.ShaderEffect {
    constructor() {
        super();
        this._smear = 0;
    }

    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE);
    }

    // Mapped on every paint, since at fractional scales the paint volume moves with the actor.
    vfunc_paint_target(node, paintContext) {
        this._mapFramebuffer();
        super.vfunc_paint_target(node, paintContext);
    }

    // Where Clutter places the framebuffer, as in clutter_offscreen_effect_pre_paint().
    _mapFramebuffer() {
        const [, width, height] = this.get_target_size();
        const actor = this.get_actor();
        const scale = actor.get_resource_scale();
        const spanX = width / scale;
        const spanY = height / scale;

        const volume = actor.get_paint_volume();
        let x, y;
        if (volume) {
            const origin = volume.get_origin();
            x = Math.ceil(origin.x + volume.get_width() + 0.75) - spanX;
            y = Math.ceil(origin.y + volume.get_height() + 0.75) - spanY;
        } else {
            const box = actor.get_allocation_box();
            x = Math.trunc(Math.ceil(box.x2 + 0.75) - spanX - box.x1);
            y = Math.trunc(Math.ceil(box.y2 + 0.75) - spanY - box.y1);
        }

        this.set_uniform_float('fboMap', 4, [x, y, spanX, spanY]);
        this.set_uniform_float('texelScale', 1, [scale]);

        // Fractional scales blur the window by up to a texel. Off screen, keep the last value, as Clutter does.
        const views = actor.peek_stage_views();
        if (views.length > 0)
            this._smear = Math.max(...views.map(view => view.get_scale())) % 1 === 0 ? 0 : 1;
        this.set_uniform_float('smear', 1, [this._smear]);

        // An app drawing at a fractional scale blurs its 1 px border over one more of its pixels.
        const content = actor.get_texture();
        const buffer = content ? content.get_texture() : null;
        let appScale = 1;
        if (buffer) {
            const [, logicalWidth, logicalHeight] = content.get_preferred_size();
            appScale = Math.sqrt(buffer.get_width() * buffer.get_height() / (logicalWidth * logicalHeight));
        }
        this.set_uniform_float('borderRemovalWidth', 1, [appScale % 1 === 0 ? 1 : 1 + 1 / appScale]);
    }

    /**
     * @param {number[]} bounds - Frame rect [x1, y1, x2, y2], in actor pixels.
     * @param {number[]} radii - Clockwise from top-left, in actor pixels.
     * @param {number} outlineWidth
     * @param {number} outlineOffset
     * @param {number[]} outlineColor - RGBA.
     * @param {Array<object>} shadow - From compileShadow().
     */
    update(bounds, radii, outlineWidth, outlineOffset, outlineColor, shadow) {
        this.set_uniform_float('bounds', 4, bounds);
        this.set_uniform_float('radii', 4, radii);
        this.set_uniform_float('outlineWidth', 1, [outlineWidth]);
        this.set_uniform_float('outlineOffset', 1, [outlineOffset]);
        this.set_uniform_float('outlineColor', 4, outlineColor);
        shadow.forEach(({shape, color}, i) => {
            this.set_uniform_float(`shadowShape${i}`, 4, shape);
            this.set_uniform_float(`shadowColor${i}`, 4, color);
        });
    }
});

// Room for the shadow and outline. It goes first, since an offscreen effect sizes itself from the effects before it.
export const ShadowRoomEffect = GObject.registerClass(
class ShadowRoomEffect extends Clutter.Effect {
    constructor() {
        super();
        this._box = new Clutter.ActorBox();
    }

    /**
     * @param {number[]} box - [x1, y1, x2, y2], in actor pixels.
     * @returns {boolean} Whether the room changed.
     */
    setBox([x1, y1, x2, y2]) {
        const box = Clutter.ActorBox.new(x1, y1, x2, y2);
        if (box.equal(this._box))
            return false;
        this._box = box;
        return true;
    }

    // Clutter asks disabled effects too.
    vfunc_modify_paint_volume(volume) {
        if (this.enabled)
            volume.union_box(this._box);
        return true;
    }
});

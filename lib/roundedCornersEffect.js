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

const DECLARATIONS = `
// In actor pixels: the frame (x1, y1, x2, y2), the corner radii clockwise from
// top-left, and (outline width, outline offset, shadow offset).
uniform vec4 bounds;
uniform vec4 radii;
uniform vec4 metrics;

// actorPixel = fboMap.xy + texCoord * fboMap.zw
uniform vec4 fboMap;
uniform float texelScale;

uniform vec4 outlineColor;
uniform vec4 shadowColor;
uniform vec4 shadowSpread;
uniform vec4 shadowSigma;
uniform vec4 shadowAlpha;

const float borderRemovalWidth = 1.0;

float coverage(float distance) {
    return clamp(0.5 - distance * texelScale, 0.0, 1.0);
}

float cornerRadius(vec2 p) {
    vec2 side = p.x < 0.0 ? radii.xw : radii.yz;
    return p.y < 0.0 ? side.x : side.y;
}

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float shadowCoverage(float d) {
    vec4 t = clamp((vec4(d) - shadowSpread) / shadowSigma, -16.0, 16.0);
    vec4 a = shadowAlpha / (1.0 + exp(1.702 * t));
    vec4 inv = vec4(1.0) - a;
    return 1.0 - inv.x * inv.y * inv.z * inv.w;
}

// Where to take the colour that replaces the app's own border.
vec2 removalSample(vec2 p, vec2 halfSize, float r, float d) {
    vec2 q = abs(p) - halfSize + r;
    vec2 edge = halfSize - abs(p);
    float reach = borderRemovalWidth + 0.5 / texelScale;

    if (q.x <= 0.0 || q.y <= 0.0 || max(edge.x, edge.y) < borderRemovalWidth)
        return p - sign(p) * max(vec2(reach) - edge, 0.0);

    // Parallel to the nearer edge, so lines running into the arc stay straight.
    bool alongY = edge.x >= borderRemovalWidth &&
        (edge.y < borderRemovalWidth || edge.x < edge.y);
    vec2 dir = alongY ? vec2(0.0, -sign(p.y)) : vec2(-sign(p.x), 0.0);
    float inward = dot(dir, -sign(p) * normalize(q));
    return p + dir * max(reach + d, 0.0) / max(inward, 0.25);
}
`;

const CODE = `
float outlineWidth = metrics.x;
float outlineOffset = metrics.y;
vec2 shadowOffset = metrics.zw;

// Already applied to cogl_color_out, but not to what is added to it.
float opacity = cogl_color_in.a;

vec2 halfSize = (bounds.zw - bounds.xy) * 0.5;
vec2 p = fboMap.xy + cogl_tex_coord0_in.xy * fboMap.zw - (bounds.xy + bounds.zw) * 0.5;
float maxRadius = min(halfSize.x, halfSize.y);
float r = min(cornerRadius(p), maxRadius);
float d = sdRoundRect(p, halfSize, r);

if (d >= -(max(-outlineOffset, borderRemovalWidth) + 1.0)) {
    float content = coverage(d);

    float removalBand = content - coverage(d + borderRemovalWidth);
    if (removalBand > 0.0) {
        vec2 st = cogl_tex_coord0_in.xy + (removalSample(p, halfSize, r, d) - p) / fboMap.zw;
        cogl_color_out = mix(cogl_color_out, texture2D(cogl_sampler0, st) * opacity, removalBand);
    }

    cogl_color_out *= content;

    if (content < 1.0) {
        vec2 s = p - shadowOffset;
        float shadow = shadowCoverage(sdRoundRect(s, halfSize, min(cornerRadius(s), maxRadius)));
        cogl_color_out += vec4(shadowColor.rgb, 1.0) * shadow * shadowColor.a * (1.0 - content) * opacity;
    }

    // GTK draws the outline over the window and its shadow.
    float outlineBand = coverage(d - outlineOffset - outlineWidth) - coverage(d - outlineOffset);
    float oa = outlineBand * outlineColor.a;
    cogl_color_out = cogl_color_out * (1.0 - oa) + vec4(outlineColor.rgb, 1.0) * oa * opacity;
}
`;

export const RoundedCornersEffect = GObject.registerClass(
class RoundedCornersEffect extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE);
    }

    // At fractional scales the paint volume moves with the actor.
    vfunc_paint_target(node, paintContext) {
        this._mapFramebuffer();
        super.vfunc_paint_target(node, paintContext);
    }

    // As in _clutter_actor_box_enlarge_for_effects().
    _mapFramebuffer() {
        const [, width, height] = this.get_target_size();
        const actor = this.get_actor();
        const volume = actor.get_paint_volume();
        const origin = volume ? volume.get_origin() : {x: 0, y: 0};
        const right = origin.x + (volume ? volume.get_width() : actor.width);
        const bottom = origin.y + (volume ? volume.get_height() : actor.height);

        const scale = actor.get_resource_scale();
        const spanX = width / scale;
        const spanY = height / scale;

        this.set_uniform_float('fboMap', 4, [
            Math.ceil(right + 0.75) - spanX,
            Math.ceil(bottom + 0.75) - spanY,
            spanX,
            spanY,
        ]);
        this.set_uniform_float('texelScale', 1, [scale]);
    }

    /**
     * @param {number[]} bounds - Frame rect [x1, y1, x2, y2], in actor pixels.
     * @param {number[]} radii - Clockwise from top-left, in actor pixels.
     * @param {number} outlineWidth
     * @param {number} outlineOffset
     * @param {number[]} outlineColor - RGBA.
     * @param {object} shadow - From compileShadow().
     */
    update(bounds, radii, outlineWidth, outlineOffset, outlineColor, shadow) {
        this.set_uniform_float('bounds', 4, bounds);
        this.set_uniform_float('radii', 4, radii);
        this.set_uniform_float('metrics', 4, [outlineWidth, outlineOffset, ...shadow.offset]);
        this.set_uniform_float('outlineColor', 4, outlineColor);
        this.set_uniform_float('shadowColor', 4, shadow.color);
        this.set_uniform_float('shadowSpread', 4, shadow.spread);
        this.set_uniform_float('shadowSigma', 4, shadow.sigma);
        this.set_uniform_float('shadowAlpha', 4, shadow.alpha);
    }
});

// Rounds a window's corners, draws libadwaita's inset hairline outline, and
// re-synthesises its drop shadow in a single pass. Keeping it to one effect on
// the window actor means every ClutterClone reproduces it: the overview,
// alt-tab, workspace switching and screenshots all come out right.
//
// Everything is expressed against a single signed distance field. A pixel well
// inside the window, which is the common case, costs one `sdRoundRect` call and
// nothing else.
//
// All coordinates are actor-local logical pixels.

// Window frame rect within the actor, as (x1, y1, x2, y2). This is the *frame*
// rect, not the buffer rect: everything outside it is the client-side-decoration
// margin, which holds the app's own shadow and which we repaint with ours.
uniform vec4 bounds;

// Corner radius, from the theme's `--window-radius`.
uniform float radius;

// Maps this effect's offscreen texture back onto actor-local pixels:
// actorPixel = fboOrigin + textureCoord * fboSpan.
//
// This is not the same as scaling by the actor's size. ClutterOffscreenEffect
// sizes its framebuffer from the actor's paint volume enlarged for effects
// (clutter-actor-box.c:_clutter_actor_box_enlarge_for_effects), which rounds the
// size up, pads it by 3px, and offsets the content within it. Assuming the
// texture spans exactly the actor, which is what the reference extensions do,
// shifts every sampled pixel and visibly shrinks the corners.
uniform vec2 fboOrigin;
uniform vec2 fboSpan;

// libadwaita's `outline: 1px solid ...; outline-offset: -1px`, i.e. a hairline
// drawn just *inside* the window edge. Width 0 disables it.
uniform float outlineWidth;
uniform vec4 outlineColor;

// Drop shadow. The CSS `box-shadow` layer list is compiled on the CPU (see
// lib/shadowProfile.js) into up to four (spread, sigma, alpha) triples sharing
// one colour. shadowColor.a is a master switch: 0 disables the shadow, which is
// what we do for windows whose buffer has no margin to draw one in.
uniform vec4 shadowColor;
uniform vec4 shadowSpread;
uniform vec4 shadowSigma;
uniform vec4 shadowAlpha;
uniform vec2 shadowOffset;

// Signed distance to a rounded rectangle centred on the origin: negative
// inside, positive outside, and (to a very good approximation) equal to the
// distance in pixels either way. That property is what lets us antialias, place
// the outline and drive the shadow from one number.
float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// Coverage of the drop shadow at signed distance `d`.
//
// A CSS shadow layer is a box blurred by a Gaussian of standard deviation
// blur/2, so its coverage across the edge is that Gaussian's CDF. We use the
// standard logistic approximation of the normal CDF (max error ~0.01, far below
// what is visible in a shadow) to keep this to one `exp` per layer, and
// composite the layers source-over.
float shadowCoverage(float d) {
    vec4 t = clamp((vec4(d) - shadowSpread) / shadowSigma, -16.0, 16.0);
    vec4 a = shadowAlpha / (1.0 + exp(1.702 * t));
    vec4 inv = vec4(1.0) - a;
    return 1.0 - inv.x * inv.y * inv.z * inv.w;
}

void main() {
    vec2 p = fboOrigin + cogl_tex_coord0_in.xy * fboSpan;
    vec2 halfSize = (bounds.zw - bounds.xy) * 0.5;
    vec2 center = (bounds.xy + bounds.zw) * 0.5;
    float r = clamp(radius, 0.0, min(halfSize.x, halfSize.y));

    float d = sdRoundRect(p - center, halfSize, r);

    // Fast path: everything deeper inside than the outline band is left exactly
    // as the application drew it. This is the overwhelming majority of pixels,
    // and the branch is coherent because the interior is one contiguous region.
    if (d >= -(outlineWidth + 1.0)) {
        // Clip to the rounded rect. The app's own shadow lives outside the
        // frame rect, so the same multiply erases it and we can draw ours
        // without a separate pass.
        float content = clamp(0.5 - d, 0.0, 1.0);
        cogl_color_out *= content;

        // Inset hairline: the band d in [-outlineWidth, 0]. cogl_color_out is
        // premultiplied, so source-over is dst*(1-a) + colour*a.
        float band = content - clamp(0.5 - d - outlineWidth, 0.0, 1.0);
        float oa = band * outlineColor.a;
        cogl_color_out = cogl_color_out * (1.0 - oa) + vec4(outlineColor.rgb, 1.0) * oa;

        // Shadow, outside only. Scaled by (1 - content) so it never darkens the
        // antialiased edge pixels the window content already covers.
        if (d > -0.5) {
            float sd = sdRoundRect(p - center - shadowOffset, halfSize, r);
            float s = shadowCoverage(sd) * shadowColor.a * (1.0 - content);
            cogl_color_out += vec4(shadowColor.rgb, 1.0) * s;
        }
    }
}

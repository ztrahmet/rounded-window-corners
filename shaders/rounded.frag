// Rounds a window's corners, draws libadwaita's inset hairline and re-synthesises
// its drop shadow in one pass. Keeping it to one effect on the window actor means
// every ClutterClone reproduces it: overview, alt-tab, workspace switch, screenshots.
//
// Everything derives from one signed distance field. All coordinates are
// actor-local logical pixels.

// Window frame rect within the actor, (x1, y1, x2, y2). Not the buffer rect:
// outside it lies the client-side-decoration margin, which holds the app's own
// shadow and which we repaint with ours.
uniform vec4 bounds;

// Corner radius, from the theme's `--window-radius`.
uniform float radius;

// Offscreen texture to actor pixels: actorPixel = fboOrigin + texCoord * fboSpan.
// This is not the actor's size. ClutterOffscreenEffect sizes its framebuffer from
// the paint volume enlarged for effects (clutter-actor-box.c,
// _clutter_actor_box_enlarge_for_effects), which rounds up, pads by 3px and offsets
// the content inside it. Assuming the texture spans the actor, which is what the
// reference extensions do, shifts every sample and visibly shrinks the corners.
uniform vec2 fboOrigin;
uniform vec2 fboSpan;

// libadwaita's `outline: 1px solid ...; outline-offset: -1px`, a hairline just
// inside the window edge. Width 0 disables it and the sampling below with it.
uniform float outlineWidth;
uniform vec4 outlineColor;

// Drop shadow. lib/shadowProfile.js compiles the CSS box-shadow list into up to
// four (spread, sigma, alpha) triples sharing one colour. shadowColor.a is a master
// switch: 0 for windows whose buffer has no margin to draw a shadow in.
uniform vec4 shadowColor;
uniform vec4 shadowSpread;
uniform vec4 shadowSigma;
uniform vec4 shadowAlpha;
uniform vec2 shadowOffset;

// Signed distance to a rounded rectangle at the origin: negative inside, and to a
// good approximation the distance in pixels either way. That is what lets one
// number drive antialiasing, the outline and the shadow.
float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// Its outward unit normal: the axis normal along a straight edge, radial inside a
// corner. The branch is what keeps q non-zero, so normalize is safe.
vec2 sdRoundRectNormal(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    vec2 n = q.x > 0.0 && q.y > 0.0
        ? normalize(q)
        : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return n * sign(p);
}

// Shadow coverage at signed distance `d`. A CSS shadow layer is a box blurred by a
// Gaussian of sigma blur/2, so its coverage across the edge is that Gaussian's CDF.
// The logistic approximation of it (max error ~0.01, far below what shows in a
// shadow) keeps this to one exp per layer, composited source-over.
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

    // Fast path: anything deeper in than the band is left as the app drew it. That
    // is nearly every pixel, and the branch is coherent because the interior is one
    // contiguous region.
    if (d >= -(outlineWidth + 1.0)) {
        // Clip to the rounded rect. The app's own shadow lives outside the frame
        // rect, so this multiply erases it and ours goes in without a second pass.
        float content = clamp(0.5 - d, 0.0, 1.0);
        float band = content - clamp(0.5 - d - outlineWidth, 0.0, 1.0);

        // The hairline replaces the outermost pixels rather than tinting them. An
        // app's own frame border sits exactly there and the arc cuts it away in the
        // corners, so tinting would keep it on the straight edges alone and the
        // corners would read as dim. Sampling from just inside drops it, and where
        // there is no such border both samples match and nothing changes.
        if (band > 0.0) {
            vec2 inward = -sdRoundRectNormal(p - center, halfSize, r);
            vec2 st = cogl_tex_coord0_in.xy + inward * (outlineWidth + 0.5) / fboSpan;
            cogl_color_out = mix(cogl_color_out, texture2D(cogl_sampler0, st), band);
        }

        cogl_color_out *= content;

        // Hairline across the band d in [-outlineWidth, 0]. cogl_color_out is
        // premultiplied, so source-over is dst*(1-a) + colour*a.
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

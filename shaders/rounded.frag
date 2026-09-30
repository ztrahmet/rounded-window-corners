// Window frame rect within actor: (x1, y1, x2, y2).
uniform vec4 bounds;

// (radius, outlineWidth, offset.x, offset.y) in actor pixels.
uniform vec4 metrics;

// FBO mapping: actorPixel = fboMap.xy + texCoord * fboMap.zw.
uniform vec4 fboMap;

// Hairline outline color RGBA.
uniform vec4 outlineColor;

// Shadow parameters.
uniform vec4 shadowColor;
uniform vec4 shadowSpread;
uniform vec4 shadowSigma;
uniform vec4 shadowAlpha;

// Signed distance to rounded rectangle.
float sdRoundRect(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// Outward unit normal for rounded rectangle.
vec2 sdRoundRectNormal(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    vec2 n = q.x > 0.0 && q.y > 0.0
        ? normalize(q)
        : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return n * sign(p);
}

// Multi-layer shadow coverage approximation using logistic sigmoid.
float shadowCoverage(float d) {
    vec4 t = clamp((vec4(d) - shadowSpread) / shadowSigma, -16.0, 16.0);
    vec4 a = shadowAlpha / (1.0 + exp(1.702 * t));
    vec4 inv = vec4(1.0) - a;
    return 1.0 - inv.x * inv.y * inv.z * inv.w;
}

void main() {
    float radius = metrics.x;
    float outlineWidth = metrics.y;
    vec2 shadowOffset = metrics.zw;

    vec2 p = fboMap.xy + cogl_tex_coord0_in.xy * fboMap.zw;
    vec2 halfSize = (bounds.zw - bounds.xy) * 0.5;
    vec2 center = (bounds.xy + bounds.zw) * 0.5;
    float r = clamp(radius, 0.0, min(halfSize.x, halfSize.y));

    float d = sdRoundRect(p - center, halfSize, r);

    // Fast path: skip interior pixels.
    if (d >= -(outlineWidth + 1.0)) {
        float content = clamp(0.5 - d, 0.0, 1.0);
        float band = content - clamp(0.5 - d - outlineWidth, 0.0, 1.0);

        if (band > 0.0) {
            vec2 inward = -sdRoundRectNormal(p - center, halfSize, r);
            vec2 st = cogl_tex_coord0_in.xy + inward * (outlineWidth + 0.5) / fboMap.zw;
            cogl_color_out = mix(cogl_color_out, texture2D(cogl_sampler0, st), band);
        }

        cogl_color_out *= content;

        float oa = band * outlineColor.a;
        cogl_color_out = cogl_color_out * (1.0 - oa) + vec4(outlineColor.rgb, 1.0) * oa;

        // Outer shadow.
        if (d > -0.5) {
            float sd = sdRoundRect(p - center - shadowOffset, halfSize, r);
            float s = shadowCoverage(sd) * shadowColor.a * (1.0 - content);
            cogl_color_out += vec4(shadowColor.rgb, 1.0) * s;
        }
    }
}

/**
 * Compiles a CSS `box-shadow` layer list into the handful of uniforms the
 * shader evaluates per pixel.
 *
 * A CSS shadow layer is a rounded box, expanded by its spread, blurred by a
 * Gaussian of standard deviation blur/2. Its coverage therefore depends only on
 * the signed distance to that box, which the shader already computes for
 * clipping. Each layer collapses to a (spread, sigma, alpha) triple, and the
 * whole shadow to four of them plus a colour.
 *
 * Doing the compilation here rather than in GLSL keeps all the CSS arithmetic in
 * plain JavaScript where it can be tested, and keeps the per-pixel cost to one
 * `exp` per layer inside the border band.
 */

/** Keeps a zero-blur layer (a hairline ring) crisp but still antialiased. */
const MIN_SIGMA = 0.35;

/** The shader evaluates four layers in one vec4 of work. */
const MAX_LAYERS = 4;

/**
 * Below this much buffer margin a synthesised shadow would be a hard dark ring
 * rather than a shadow, so we draw none. The window keeps its rounded corners
 * and outline; there was at most this many pixels of the app's own shadow to
 * lose, since the margin is what bounds it.
 */
const MIN_MARGIN = 4;

/** Coverage falls below ~0.4% at three standard deviations. */
const EXTENT_SIGMAS = 3;

const DISABLED = Object.freeze({
    color: [0, 0, 0, 0],
    spread: [0, 0, 0, 0],
    sigma: [1, 1, 1, 1],
    alpha: [0, 0, 0, 0],
    offset: [0, 0],
    extent: 0,
});

/**
 * @param {?Array<{dx: number, dy: number, blur: number, spread: number, color: number[]}>} layers
 *     Parsed `box-shadow` layers, or null/empty for no shadow.
 * @param {number} margin - Client-side-decoration margin the window's buffer
 *     actually has outside its frame rect, in theme pixels. The shadow is scaled
 *     to fit, so we never need to grow the actor's paint volume.
 * @param {number} unitScale - Theme pixels to actor pixels. Applied here so the
 *     caller does not have to re-map the returned arrays.
 * @returns Uniform values for the shader. `color[3] === 0` means "draw nothing".
 */
export function compileShadow(layers, margin, unitScale = 1) {
    if (!layers || layers.length === 0 || !(margin >= MIN_MARGIN))
        return DISABLED;

    // When a theme lists more layers than the shader evaluates, the most opaque
    // ones are the ones worth keeping.
    const usable = layers
        .filter(layer => layer.color[3] > 0.001)
        .sort((a, b) => b.color[3] - a.color[3])
        .slice(0, MAX_LAYERS);

    if (usable.length === 0)
        return DISABLED;

    const spread = [0, 0, 0, 0];
    const sigma = [1, 1, 1, 1];
    const alpha = [0, 0, 0, 0];
    let extent = 0;
    let weight = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let offsetX = 0;
    let offsetY = 0;

    usable.forEach((layer, i) => {
        const s = Math.max(layer.blur / 2, MIN_SIGMA);
        spread[i] = layer.spread;
        sigma[i] = s;
        alpha[i] = layer.color[3];

        const reach = layer.spread + EXTENT_SIGMAS * s +
            Math.hypot(layer.dx, layer.dy);
        extent = Math.max(extent, reach);

        // The shader modulates one colour by the combined coverage, which is
        // exact whenever the layers share a colour, as they do in every GTK and
        // libadwaita theme, where shadows are pure black at varying alpha.
        // Weighting by alpha keeps a mixed-colour theme close rather than wrong.
        const w = layer.color[3];
        weight += w;
        red += layer.color[0] * w;
        green += layer.color[1] * w;
        blue += layer.color[2] * w;
        offsetX += layer.dx * w;
        offsetY += layer.dy * w;
    });

    // Scale rather than clip when the shadow reaches past the buffer: a
    // proportionally tighter shadow reads correctly, a truncated one shows a
    // hard edge where the buffer ends.
    const fit = extent > margin ? margin / extent : 1;
    const unit = fit * unitScale;

    return {
        color: [red / weight, green / weight, blue / weight, 1],
        spread: spread.map(v => v * unit),
        sigma: sigma.map(v => Math.max(v * unit, MIN_SIGMA)),
        alpha,
        offset: [offsetX / weight * unit, offsetY / weight * unit],
        extent: extent * fit,
    };
}

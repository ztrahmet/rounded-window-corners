/**
 * Box-shadow compiler for shader uniforms
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

const MIN_SIGMA = 0.35;
const MAX_LAYERS = 4;
const MIN_MARGIN = 4;
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
 * Compiles parsed box-shadow layers into uniform vectors for the shader.
 *
 * @param {?Array<object>} layers - Parsed box-shadow layers.
 * @param {number} margin - Available window decoration margin.
 * @param {number} unitScale - Scale factor to actor pixels.
 * @returns {object} Compiled uniforms.
 */
export function compileShadow(layers, margin, unitScale = 1) {
    if (!layers || layers.length === 0 || !(margin >= MIN_MARGIN))
        return DISABLED;

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

        const w = layer.color[3];
        weight += w;
        red += layer.color[0] * w;
        green += layer.color[1] * w;
        blue += layer.color[2] * w;
        offsetX += layer.dx * w;
        offsetY += layer.dy * w;
    });

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

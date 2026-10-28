/**
 * Box-shadow compiler for shader uniforms
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

const MIN_SIGMA = 0.35;
const MAX_LAYERS = 4;
const EXTENT_SIGMAS = 3;

const DISABLED = Object.freeze({
    color: [0, 0, 0, 0],
    spread: [0, 0, 0, 0],
    sigma: [1, 1, 1, 1],
    alpha: [0, 0, 0, 0],
    offset: [0, 0],
});

// The layers the shader has slots for, most opaque first.
function usableLayers(layers) {
    return layers
        .filter(layer => layer.color[3] > 0.001)
        .sort((a, b) => b.color[3] - a.color[3])
        .slice(0, MAX_LAYERS);
}

// 0 marks an unblurred layer.
function sigmaOf(layer) {
    return layer.blur > 0 ? Math.max(layer.blur / 2, MIN_SIGMA) : 0;
}

/**
 * How far the shadow reaches past the frame.
 *
 * @param {Array<object>} layers - From parseBoxShadow().
 * @returns {number} In logical pixels.
 */
export function shadowExtent(layers) {
    return Math.max(0, ...usableLayers(layers).map(layer =>
        layer.spread + EXTENT_SIGMAS * sigmaOf(layer) + Math.hypot(layer.dx, layer.dy)));
}

/**
 * Compiles box-shadow layers into the shader's uniforms.
 *
 * @param {Array<object>} layers - From parseBoxShadow().
 * @param {number} unitScale - Actor pixels per logical pixel.
 * @returns {object}
 */
export function compileShadow(layers, unitScale = 1) {
    const usable = usableLayers(layers);
    if (usable.length === 0)
        return DISABLED;

    const spread = [0, 0, 0, 0];
    const sigma = [1, 1, 1, 1];
    const alpha = [0, 0, 0, 0];
    let weight = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let offsetX = 0;
    let offsetY = 0;

    usable.forEach((layer, i) => {
        spread[i] = layer.spread;
        sigma[i] = sigmaOf(layer);
        alpha[i] = layer.color[3];

        const w = layer.color[3];
        weight += w;
        red += layer.color[0] * w;
        green += layer.color[1] * w;
        blue += layer.color[2] * w;
        offsetX += layer.dx * w;
        offsetY += layer.dy * w;
    });

    return {
        color: [red / weight, green / weight, blue / weight, 1],
        spread: spread.map(v => v * unitScale),
        sigma: sigma.map(v => v > 0 ? Math.max(v * unitScale, MIN_SIGMA) : 0),
        alpha,
        offset: [offsetX / weight * unitScale, offsetY / weight * unitScale],
    };
}

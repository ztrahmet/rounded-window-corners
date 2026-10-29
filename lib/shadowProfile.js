/**
 * Box-shadow compiler for shader uniforms
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

const MAX_LAYERS = 4;
const EXTENT_SIGMAS = 3;

const NO_SHADOW = Object.freeze({
    color: [0, 0, 0],
    offset: [0, 0],
    spread: [0, 0, 0, 0],
    sigma: [0, 0, 0, 0],
    alpha: [0, 0, 0, 0],
});

// As in GTK, a layer blurred less than this is drawn as a plain shape.
function sigmaOf(layer) {
    return layer.blur < 0.01 ? 0 : layer.blur / 2;
}

/**
 * How far the shadow reaches past the frame.
 *
 * @param {Array<object>} layers - From parseBoxShadow().
 * @returns {number} In pixels.
 */
export function shadowExtent(layers) {
    return Math.max(0, ...layers.map(layer =>
        layer.spread + EXTENT_SIGMAS * sigmaOf(layer) + Math.hypot(layer.dx, layer.dy)));
}

/**
 * Compiles box-shadow layers into the shader's uniforms: the most opaque
 * layers the shader has slots for, sharing one color and offset.
 *
 * @param {Array<object>} layers - From parseBoxShadow(), so none is transparent.
 * @returns {object}
 */
export function compileShadow(layers) {
    const usable = layers.toSorted((a, b) => b.color[3] - a.color[3]).slice(0, MAX_LAYERS);
    if (usable.length === 0)
        return NO_SHADOW;

    const slots = read => Array.from({length: MAX_LAYERS}, (_, i) => i < usable.length ? read(usable[i]) : 0);
    const weight = usable.reduce((sum, layer) => sum + layer.color[3], 0);
    const mean = read => usable.reduce((sum, layer) => sum + read(layer) * layer.color[3], 0) / weight;

    return {
        color: [0, 1, 2].map(i => mean(layer => layer.color[i])),
        offset: [mean(layer => layer.dx), mean(layer => layer.dy)],
        spread: slots(layer => layer.spread),
        sigma: slots(sigmaOf),
        alpha: slots(layer => layer.color[3]),
    };
}

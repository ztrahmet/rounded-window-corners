/**
 * Box-shadow compiler for shader uniforms, and the room a style needs
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

export const SHADOW_SLOTS = 6;
const EXTENT_SIGMAS = 3;

const EMPTY_SLOT = Object.freeze({shape: [0, 0, 0, 0], color: [0, 0, 0, 0]});

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
 * Compiles box-shadow layers into the shader's slots, in the order GTK draws them.
 * With more layers than slots, the faintest are left out.
 *
 * @param {Array<object>} layers - From parseBoxShadow(), so none is transparent.
 * @returns {Array<{shape: number[], color: number[]}>} Each shape is [dx, dy, spread, sigma].
 */
export function compileShadow(layers) {
    const kept = new Set(layers.toSorted((a, b) => b.color[3] - a.color[3]).slice(0, SHADOW_SLOTS));
    const slots = layers.filter(layer => kept.has(layer))
        .map(layer => ({shape: [layer.dx, layer.dy, layer.spread, sigmaOf(layer)], color: layer.color}));
    return Array.from({length: SHADOW_SLOTS}, (_, i) => slots[i] ?? EMPTY_SLOT);
}

/**
 * Adds what drawing a style takes: each look's shader slots, and the room each state needs for both of its looks,
 * so the room doesn't change when focus does.
 *
 * @param {object} style - From readWindowStyle() or customStyle().
 * @returns {object} The style, its looks with slots and its states with reach, in pixels past the window's edge.
 */
export function compileStyle(style) {
    const compile = ({radii, focused, backdrop}) => ({
        radii,
        focused: {...focused, slots: compileShadow(focused.shadow)},
        backdrop: {...backdrop, slots: compileShadow(backdrop.shadow)},
        reach: Math.max(...[focused, backdrop].map(look =>
            Math.max(shadowExtent(look.shadow), look.outlineOffset + look.outlineWidth))) + 1,
    });
    return {normal: compile(style.normal), tiled: compile(style.tiled), maximized: compile(style.maximized)};
}

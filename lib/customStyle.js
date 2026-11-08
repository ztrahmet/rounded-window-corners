/**
 * Window style from a custom style's values
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import {FALLBACK_CSS, parseStylesheet, readWindowStyle} from './cssParse.js';
import {drawnColor, parseColor} from './cssValues.js';

// libadwaita's own window style, light and in normal contrast.
const LIBADWAITA = readWindowStyle([parseStylesheet(FALLBACK_CSS)],
    {dark: false, highContrast: false, rtl: false, colorName: () => null});

const [MAIN] = LIBADWAITA.normal.focused.shadow;

const opaque = ([r, g, b]) => [r, g, b, 1];

// outline-offset for each position, in outline widths.
const OUTLINE_OFFSETS = {inside: -1, center: -0.5, outside: 0};

// One that cannot be read gives the fallback.
const drawn = (css, fallback) => drawnColor(parseColor(css, () => null) ?? fallback);

/**
 * Builds the window style from custom values.
 *
 * @param {object} values - By settings key.
 * @returns {object} Like readWindowStyle().
 */
export function customStyle(values) {
    const {
        'corner-radius': radius,
        'outline-width': outlineWidth,
        'outline-position': outlinePosition,
        'outline-color': outlineColor,
        'outline-opacity': outlineOpacity,
        'shadow-angle': shadowAngle,
        'shadow-distance': shadowDistance,
        'shadow-blur': shadowBlur,
        'shadow-color': shadowColor,
        'shadow-opacity': shadowOpacity,
    } = values;
    const [or, og, ob, oa] = drawn(outlineColor, opaque(LIBADWAITA.normal.focused.outlineColor));
    const [r, g, b, a] = drawn(shadowColor, opaque(MAIN.color));
    const angle = shadowAngle * Math.PI / 180;
    const outline = {
        outlineWidth,
        outlineOffset: OUTLINE_OFFSETS[outlinePosition] * outlineWidth,
        outlineColor: [or, og, ob, oa * outlineOpacity],
    };
    const tint = layer => ({...layer, color: [r, g, b, layer.color[3] * a * shadowOpacity / MAIN.color[3]]});
    const light = layer => ({
        ...tint(layer),
        dx: layer.dx - shadowDistance * Math.cos(angle),
        dy: layer.dy + shadowDistance * Math.sin(angle),
        blur: layer.blur * shadowBlur / MAIN.blur,
    });
    // libadwaita's look, with the custom outline where it has one.
    const look = (base, layers) => ({
        ...outline,
        outlineWidth: base.outlineWidth > 0 ? outlineWidth : 0,
        shadow: base.shadow.map(layers).filter(layer => layer.color[3] > 0),
    });
    const state = ({radii, focused, backdrop}, layers) => ({radii, focused: look(focused, layers), backdrop: look(backdrop, layers)});
    return {
        normal: {...state(LIBADWAITA.normal, light), radii: [radius, radius, radius, radius]},
        tiled: state(LIBADWAITA.tiled, tint),
        maximized: state(LIBADWAITA.maximized, tint),
    };
}

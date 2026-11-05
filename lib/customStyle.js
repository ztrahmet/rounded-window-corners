/**
 * Window style from custom appearance values
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import {FALLBACK_CSS, readWindowStyle} from './cssParse.js';
import {parseColor} from './cssValues.js';

// libadwaita's own window style, light and in normal contrast.
const LIBADWAITA = readWindowStyle([FALLBACK_CSS],
    {dark: false, highContrast: false, rtl: false, colorName: () => null});

const [MAIN] = LIBADWAITA.shadow;

const opaque = ([r, g, b]) => [r, g, b, 1];

// outline-offset for each position, in outline widths.
const OUTLINE_OFFSETS = {inside: -1, center: -0.5, outside: 0};

// Clamped to sRGB, as GTK draws colors; one that cannot be read gives the fallback.
const drawn = (css, fallback) => (parseColor(css, () => null) ?? fallback).map(v => Math.min(Math.max(v, 0), 1));

/**
 * Builds the window style from custom values.
 *
 * @param {object} values
 * @param {number} values.radius - In pixels.
 * @param {number} values.outlineWidth - In pixels.
 * @param {string} values.outlinePosition - 'inside', 'center' or 'outside' the window's edge.
 * @param {string} values.outlineColor - A CSS color, not a color name.
 * @param {number} values.outlineOpacity - From 0 to 1.
 * @param {number} values.shadowAngle - Where the light comes from, in degrees counter-clockwise from the right.
 * @param {number} values.shadowDistance - In pixels.
 * @param {number} values.shadowBlur - In pixels.
 * @param {string} values.shadowColor - A CSS color, not a color name.
 * @param {number} values.shadowOpacity - From 0 to 1.
 * @returns {object} Like readWindowStyle().
 */
export function customStyle({
    radius, outlineWidth, outlinePosition, outlineColor, outlineOpacity,
    shadowAngle, shadowDistance, shadowBlur, shadowColor, shadowOpacity,
}) {
    const [or, og, ob, oa] = drawn(outlineColor, opaque(LIBADWAITA.outlineColor));
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
    // libadwaita's look in each state, with the custom outline where it has one.
    const look = (base, layers) => ({
        ...outline,
        outlineWidth: base.outlineWidth > 0 ? outlineWidth : 0,
        shadow: base.shadow.map(layers).filter(layer => layer.color[3] > 0),
    });
    return {
        radii: [radius, radius, radius, radius],
        ...look(LIBADWAITA, light),
        backdrop: look(LIBADWAITA.backdrop, light),
        tiled: {...look(LIBADWAITA.tiled, tint), backdrop: look(LIBADWAITA.tiled.backdrop, tint)},
        maximized: {...look(LIBADWAITA.maximized, tint), backdrop: look(LIBADWAITA.maximized.backdrop, tint)},
    };
}

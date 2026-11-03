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

/**
 * Builds the window style from custom values.
 *
 * @param {object} values
 * @param {number} values.radius - In pixels.
 * @param {number} values.outlineWidth - In pixels.
 * @param {string} values.outlineColor - A CSS color.
 * @param {number} values.outlineOpacity - From 0 to 1.
 * @param {number} values.shadowAngle - Where the light comes from, in degrees counter-clockwise from the right.
 * @param {number} values.shadowDistance - In pixels.
 * @param {number} values.shadowBlur - In pixels.
 * @param {string} values.shadowColor - A CSS color.
 * @param {number} values.shadowOpacity - From 0 to 1.
 * @returns {object} Like readWindowStyle().
 */
export function customStyle({
    radius, outlineWidth, outlineColor, outlineOpacity,
    shadowAngle, shadowDistance, shadowBlur, shadowColor, shadowOpacity,
}) {
    const [or, og, ob, oa] = parseColor(outlineColor, () => null) ?? opaque(LIBADWAITA.outlineColor);
    const [r, g, b, a] = parseColor(shadowColor, () => null) ?? opaque(MAIN.color);
    const angle = shadowAngle * Math.PI / 180;
    const look = shadow => ({
        outlineWidth,
        outlineOffset: -outlineWidth,
        outlineColor: [or, og, ob, oa * outlineOpacity],
        shadow: shadow.map(layer => ({
            dx: layer.dx - shadowDistance * Math.cos(angle),
            dy: layer.dy + shadowDistance * Math.sin(angle),
            blur: layer.blur * shadowBlur / MAIN.blur,
            spread: layer.spread,
            color: [r, g, b, Math.min(layer.color[3] * a * shadowOpacity / MAIN.color[3], 1)],
        })).filter(layer => layer.color[3] > 0),
    });
    return {
        radii: [radius, radius, radius, radius],
        ...look(LIBADWAITA.shadow),
        backdrop: look(LIBADWAITA.backdrop.shadow),
    };
}

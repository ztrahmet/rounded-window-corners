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

/**
 * Builds the window style from custom values.
 *
 * @param {object} values
 * @param {number} values.radius - In pixels.
 * @param {number} values.outlineWidth - In pixels.
 * @param {string} values.outlineColor - A CSS color.
 * @param {number} values.shadowStrength - 1 is libadwaita's own shadow.
 * @returns {object} Like readWindowStyle().
 */
export function customStyle({radius, outlineWidth, outlineColor, shadowStrength}) {
    const color = parseColor(outlineColor, () => null) ?? LIBADWAITA.outlineColor;
    const look = shadow => ({
        outlineWidth,
        outlineOffset: -outlineWidth,
        outlineColor: color,
        shadow: shadow.map(layer => {
            const [r, g, b, a] = layer.color;
            return {...layer, color: [r, g, b, Math.min(a * shadowStrength, 1)]};
        }).filter(layer => layer.color[3] > 0),
    });
    return {
        radii: [radius, radius, radius, radius],
        ...look(LIBADWAITA.shadow),
        backdrop: look(LIBADWAITA.backdrop.shadow),
    };
}

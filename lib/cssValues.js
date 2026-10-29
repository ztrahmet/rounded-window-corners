/**
 * CSS values as GTK reads them: numbers, lengths and colors
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

/**
 * Skips a quoted string.
 *
 * @param {string} text
 * @param {number} start - Index of the opening quote.
 * @returns {number} Index of the closing quote.
 */
export function skipString(text, start) {
    const quote = text[start];
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\')
            i++;
        else if (text[i] === quote)
            return i;
    }
    return text.length;
}

function splitTop(text, isSeparator) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'") {
            i = skipString(text, i);
        } else if (c === '(' || c === '[') {
            depth++;
        } else if (c === ')' || c === ']') {
            depth--;
        } else if (depth === 0 && isSeparator(c)) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

export const splitOn = (text, separator) => splitTop(text, c => c === separator);
export const tokenize = text => splitTop(text, c => /\s/.test(c)).filter(Boolean);

/**
 * @param {string} text
 * @param {number} open - Index of an opening parenthesis.
 * @returns {number} Index of the matching one, or -1.
 */
export function closingParen(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(')
            depth++;
        else if (text[i] === ')' && --depth === 0)
            return i;
    }
    return -1;
}

const TOKEN = /\s*(?:(\d*\.?\d+(?:e[+-]?\d+)?)(%|[a-z]+)?|([a-z][\w-]*)(\()?|([-+*/(),]))\s*/giy;

const ANGLES = new Map([['deg', 1], ['grad', 0.9], ['rad', 180 / Math.PI], ['turn', 360]]);

const MATH = new Map([
    ['calc', args => args.length === 1 ? args[0] : null],
    ['min', args => ({n: Math.min(...args.map(a => a.n)), unit: args[0].unit})],
    ['max', args => ({n: Math.max(...args.map(a => a.n)), unit: args[0].unit})],
    ['clamp', args => args.length === 3 ? {n: Math.max(args[0].n, Math.min(args[1].n, args[2].n)), unit: args[0].unit} : null],
]);

function dimension(n, unit = '') {
    const name = unit.toLowerCase();
    if (name === '' || name === '%' || name === 'px')
        return {n, unit: name};
    return ANGLES.has(name) ? {n: n * ANGLES.get(name), unit: 'deg'} : null;
}

/**
 * Reads a number, percentage, length in px or angle, with calc(), min(),
 * max() and clamp().
 *
 * @param {string} text
 * @param {Map<string, number>} [keywords] - Names that stand for numbers,
 *   like the channels of a relative color.
 * @returns {?{n: number, unit: string}} The unit is '', '%', 'px' or 'deg'.
 */
export function evaluate(text, keywords = new Map()) {
    const tokens = [];
    TOKEN.lastIndex = 0;
    for (let m; TOKEN.lastIndex < text.length && (m = TOKEN.exec(text));)
        tokens.push(m);
    if (TOKEN.lastIndex < text.length)
        return null;

    let i = 0;
    const take = symbol => tokens[i]?.[5] === symbol && ++i > 0;

    const factor = () => {
        const token = tokens[i++];
        if (!token)
            return null;
        const [, number, unit, name, call, symbol] = token;
        if (symbol === '-' || symbol === '+') {
            const v = factor();
            return v && {n: symbol === '-' ? -v.n : v.n, unit: v.unit};
        }
        if (symbol === '(') {
            const v = sum();
            return take(')') ? v : null;
        }
        if (number !== undefined)
            return dimension(Number(number), unit);
        if (call) {
            const args = [sum()];
            while (take(','))
                args.push(sum());
            const fn = MATH.get(name.toLowerCase());
            return take(')') && fn && args.every(a => a && a.unit === args[0].unit) ? fn(args) : null;
        }
        const keyword = name?.toLowerCase();
        return keywords.has(keyword) ? {n: keywords.get(keyword), unit: ''} : null;
    };
    const product = () => {
        let v = factor();
        for (let op; v && (op = take('*') ? '*' : take('/') && '/');) {
            const w = factor();
            if (!w || (op === '/' ? w.unit : v.unit && w.unit))
                return null;
            v = op === '*' ? {n: v.n * w.n, unit: v.unit || w.unit} : {n: v.n / w.n, unit: v.unit};
        }
        return v;
    };
    const sum = () => {
        let v = product();
        for (let sign; v && (sign = take('+') ? 1 : take('-') && -1);) {
            const w = product();
            v = w && w.unit === v.unit ? {n: v.n + sign * w.n, unit: v.unit} : null;
        }
        return v;
    };

    const value = sum();
    return value && i === tokens.length && Number.isFinite(value.n) ? value : null;
}

/**
 * Reads a length in pixels, the only unit supported.
 *
 * @param {string} value
 * @returns {?number}
 */
export function parseLength(value) {
    const v = evaluate(value);
    return v && (v.unit === 'px' || (v.unit === '' && v.n === 0)) ? v.n : null;
}

// Color conversions, from GTK's gtk/gtkcolorutils.c and gdk/gdkhsla.c (LGPL-2.1-or-later).

const toLinear = v => v >= 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
const fromLinear = v => v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const degrees = h => (h % 360 + 360) % 360;

function linearToOklab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}

function oklabToLinear([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
}

const oklabToOklch = ([L, a, b]) => [L, Math.hypot(a, b), degrees(Math.atan2(b, a) * 180 / Math.PI)];
const oklchToOklab = ([L, C, H]) => [L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];

// Saturation and lightness in 0..1.
function rgbToHsl([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return [0, 0, l];
    const delta = max - min;
    const s = l <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
    let h;
    if (r === max)
        h = (g - b) / delta;
    else if (g === max)
        h = 2 + (b - r) / delta;
    else
        h = 4 + (r - g) / delta;
    return [h < 0 ? h * 60 + 360 : h * 60, s, l];
}

function hslToRgb([h, s, l]) {
    if (s === 0)
        return [l, l, l];
    const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
    const m1 = 2 * l - m2;
    const component = offset => {
        let hue = (h + offset) % 360;
        if (hue < 0)
            hue += 360;
        if (hue < 60)
            return m1 + (m2 - m1) * hue / 60;
        if (hue < 180)
            return m2;
        if (hue < 240)
            return m1 + (m2 - m1) * (240 - hue) / 60;
        return m1;
    };
    return [component(120), component(0), component(-120)];
}

function hwbToRgb([h, w, b]) {
    if (w + b >= 1)
        return [w / (w + b), w / (w + b), w / (w + b)];
    return hslToRgb([h, 1, 0.5]).map(c => c * (1 - w - b) + w);
}

// Coordinates in each color space from and to sRGB; hue is the index of a polar space's hue.
const SPACES = new Map([
    ['srgb', {from: c => c, to: c => c}],
    ['srgb-linear', {from: c => c.map(toLinear), to: c => c.map(fromLinear)}],
    ['hsl', {
        hue: 0,
        from: c => rgbToHsl(c).map((v, i) => i ? v * 100 : v),
        to: ([h, s, l]) => hslToRgb([h, s / 100, l / 100]),
    }],
    ['hwb', {
        hue: 0,
        from: c => [rgbToHsl(c)[0], Math.min(...c) * 100, (1 - Math.max(...c)) * 100],
        to: ([h, w, b]) => hwbToRgb([h, w / 100, b / 100]),
    }],
    ['oklab', {from: c => linearToOklab(c.map(toLinear)), to: c => oklabToLinear(c).map(fromLinear)}],
    ['oklch', {
        hue: 2,
        from: c => oklabToOklch(linearToOklab(c.map(toLinear))),
        to: c => oklabToLinear(oklchToOklab(c)).map(fromLinear),
    }],
]);

// A channel's name in relative colors, the range a percentage spans, and the range an absolute value is clamped to.
const channel = (name, min, max, low = min, high = max) => ({name, min, max, low, high});
const HUE = {name: 'h', hue: true};

const FUNCTIONS = new Map([
    ['rgb', {space: 'srgb', scale: 255, channels: ['r', 'g', 'b'].map(n => channel(n, 0, 255))}],
    ['hsl', {space: 'hsl', channels: [HUE, channel('s', 0, 100), channel('l', 0, 100)]}],
    ['hwb', {space: 'hwb', channels: [HUE, channel('w', 0, 100), channel('b', 0, 100)]}],
    ['oklab', {space: 'oklab', channels: [channel('l', 0, 1), channel('a', -0.4, 0.4, -Infinity, Infinity),
        channel('b', -0.4, 0.4, -Infinity, Infinity)]}],
    ['oklch', {space: 'oklch', channels: [channel('l', 0, 1), channel('c', 0, 0.4, 0, Infinity), HUE]}],
]);
FUNCTIONS.set('rgba', FUNCTIONS.get('rgb'));
FUNCTIONS.set('hsla', FUNCTIONS.get('hsl'));

// How many arguments the comma syntax takes: rgb() has no alpha there and rgba() needs one.
const LEGACY_ARGUMENTS = new Map([['rgb', [3]], ['rgba', [4]], ['hsl', [3, 4]], ['hsla', [3, 4]]]);

// rgb(), hsl(), hwb(), oklab() and oklch(), absolute or relative to a color, as GTK reads them.
function parseFunction(name, args, names) {
    const fn = FUNCTIONS.get(name);
    const space = SPACES.get(fn.space);
    const commas = splitOn(args, ',').map(part => part.trim());
    const legacy = commas.length > 1;
    let parts;
    let origin = null;
    let keywords = new Map();
    let clamped = true;

    if (legacy) {
        if (!LEGACY_ARGUMENTS.get(name)?.includes(commas.length))
            return null;
        parts = commas;
    } else {
        const [head, alpha, ...extra] = splitOn(args, '/');
        let tokens = tokenize(head);
        if (tokens[0]?.toLowerCase() === 'from') {
            origin = tokens.length > 1 ? parseColor(tokens[1], names) : null;
            if (!origin)
                return null;
            const coords = space.from(origin.slice(0, 3)).map(v => v * (fn.scale ?? 1));
            keywords = new Map([...fn.channels.map((c, i) => [c.name, coords[i]]), ['alpha', origin[3]]]);
            // GTK resolves a relative color from a named color later, without clamping it.
            clamped = !/@|currentcolor/i.test(tokens[1]);
            tokens = tokens.slice(2);
        }
        if (tokens.length !== 3 || extra.length > 0 || alpha?.trim() === '')
            return null;
        parts = [...tokens, alpha?.trim()];
    }

    const units = [];
    const coords = fn.channels.map((c, i) => {
        if (!legacy && parts[i].toLowerCase() === 'none')
            return 0;
        const v = evaluate(parts[i], keywords);
        if (!v || !(c.hue ? ['', 'deg'] : ['', '%']).includes(v.unit))
            return NaN;
        units.push(v.unit);
        if (c.hue)
            return clamped ? degrees(v.n) : v.n;
        const value = v.unit === '%' ? c.min + v.n / 100 * (c.max - c.min) : v.n;
        return clamped ? clamp(value, c.low, c.high) : value;
    });
    // The comma syntax wants all rgb() channels alike, and hsl() saturation and lightness as percentages.
    if (coords.some(Number.isNaN) ||
        (legacy && (fn.space === 'srgb' ? new Set(units).size > 1 : units.slice(1).some(u => u !== '%'))))
        return null;

    let alpha = origin ? origin[3] : 1;
    if (parts[3] !== undefined) {
        const v = !legacy && parts[3].toLowerCase() === 'none' ? {n: 0, unit: ''} : evaluate(parts[3], keywords);
        if (!v || !(legacy ? [''] : ['', '%']).includes(v.unit))
            return null;
        alpha = clamp(v.unit === '%' ? v.n / 100 : v.n, 0, 1);
    }
    return [...space.to(coords.map(v => v / (fn.scale ?? 1))), alpha];
}

// Which way round the hue circle each method goes.
function adjustHue(a, b, h, method) {
    const d = b[h] - a[h];
    const first = {shorter: d > 180, longer: d > 0 && d < 180, increasing: false, decreasing: a[h] < b[h]};
    const second = {shorter: d < -180, longer: d > -180 && d <= 0, increasing: b[h] < a[h], decreasing: false};
    if (first[method])
        a[h] += 360;
    else if (second[method])
        b[h] += 360;
}

// A color and an optional percentage, in either order.
function parseMixSide(text, names) {
    const tokens = tokenize(text);
    if (tokens.length === 1) {
        const color = parseColor(tokens[0], names);
        return color && {color, percent: null};
    }
    if (tokens.length !== 2)
        return null;
    let color = parseColor(tokens[0], names);
    let percent = tokens[1];
    if (!color)
        [color, percent] = [parseColor(tokens[1], names), tokens[0]];
    const p = evaluate(percent);
    return color && p?.unit === '%' && p.n >= 0 && p.n <= 100 ? {color, percent: p.n} : null;
}

// color-mix() as GTK interpolates it: premultiplied, in the given color space.
function parseColorMix(args, names) {
    const [method, ...sides] = splitOn(args, ',');
    const m = /^\s*in\s+([\w-]+)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?\s*$/i.exec(method);
    const space = m && SPACES.get(m[1].toLowerCase());
    if (!space || (m[2] && space.hue === undefined) || sides.length !== 2)
        return null;
    const [first, second] = sides.map(side => parseMixSide(side, names));
    if (!first || !second)
        return null;

    let p2 = 50;
    let multiplier = 1;
    if (first.percent !== null && second.percent !== null) {
        const total = first.percent + second.percent;
        if (total < 0.001)
            return null;
        p2 = second.percent / total * 100;
        multiplier = Math.min(1, total / 100);
    } else if (first.percent !== null) {
        p2 = 100 - first.percent;
    } else if (second.percent !== null) {
        p2 = second.percent;
    }

    const h = space.hue;
    const [a, b] = [first.color, second.color].map(c => [...space.from(c.slice(0, 3)), c[3]]);
    if (h !== undefined)
        adjustHue(a, b, h, m[2]?.toLowerCase() ?? 'shorter');
    const premultiplied = c => c.map((v, i) => i === h || i === 3 ? v : v * c[3]);
    const t = p2 / 100;
    const [pa, pb] = [premultiplied(a), premultiplied(b)];
    const mixed = pa.map((v, i) => v * (1 - t) + pb[i] * t);
    if (h !== undefined)
        mixed[h] = degrees(mixed[h]);
    const alpha = mixed[3];
    const coords = mixed.slice(0, 3).map((v, i) => i === h || alpha === 0 ? v : v / alpha);
    return [...space.to(coords), alpha * multiplier];
}

// GTK's deprecated alpha(), mix(), shade(), lighter() and darker().
function parseLegacy(name, args, names) {
    const parts = splitOn(args, ',');
    const colors = parts.slice(0, name === 'mix' ? 2 : 1).map(part => parseColor(part, names));
    const number = parts.length > colors.length ? parts.at(-1).trim() : '';
    const factor = /^[+-]?(\d*\.?\d+)(e[+-]?\d+)?$/i.test(number) ? Number(number) : null;
    const arity = {alpha: 2, mix: 3, shade: 2, lighter: 1, darker: 1}[name];
    if (parts.length !== arity || colors.includes(null) || (arity > colors.length && factor === null))
        return null;

    const [color, other] = colors;
    if (name === 'alpha')
        return [...color.slice(0, 3), clamp(color[3] * factor, 0, 1)];
    if (name === 'mix') {
        const alpha = clamp(color[3] + (other[3] - color[3]) * factor, 0, 1);
        if (alpha <= 0)
            return [0, 0, 0, 0];
        const mix = i => clamp(color[i] * color[3] + (other[i] * other[3] - color[i] * color[3]) * factor, 0, 1) / alpha;
        return [mix(0), mix(1), mix(2), alpha];
    }
    const shade = {lighter: 1.3, darker: 0.7}[name] ?? factor;
    const [h, s, l] = rgbToHsl(color);
    return [...hslToRgb([h, clamp(s * shade, 0, 1), clamp(l * shade, 0, 1)]), color[3]];
}

/**
 * Reads a color as GTK does. Like GTK, the channels may lie outside sRGB
 * until the color is drawn; the alpha is always in 0..1.
 *
 * @param {string} value
 * @param {function(string): ?number[]} names - Resolves currentColor, color
 *   names and names given by define-color.
 * @returns {?number[]} RGBA.
 */
export function parseColor(value, names) {
    const text = value.trim();

    if (/^@?[a-z_-][\w-]*$/i.test(text))
        return text.toLowerCase() === 'transparent' ? [0, 0, 0, 0] : names(text);

    if (text.startsWith('#')) {
        const hex = text.slice(1);
        const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex;
        if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full))
            return null;
        const n = i => Number.parseInt(full.slice(i, i + 2), 16) / 255;
        return [n(0), n(2), n(4), full.length === 8 ? n(6) : 1];
    }

    const fn = /^([\w-]+)\((.*)\)$/s.exec(text);
    const name = fn?.[1].toLowerCase();
    if (FUNCTIONS.has(name))
        return parseFunction(name, fn[2], names);
    if (name === 'color-mix')
        return parseColorMix(fn[2], names);
    if (['alpha', 'mix', 'shade', 'lighter', 'darker'].includes(name))
        return parseLegacy(name, fn[2], names);
    return null;
}

/**
 * A small CSS reader.
 *
 * It answers three questions about a GTK stylesheet: what is `window.csd`'s
 * corner radius, its outline, and its box-shadow. That lets this extension take
 * those values from the live theme instead of hardcoding them. It is not a
 * general CSS engine and does not try to be. Anything it does not understand
 * yields null, and the caller falls back to the next source.
 *
 * It understands enough `@media` to distinguish light from dark and normal from
 * high contrast, because that is how libadwaita expresses those variants.
 */

const NAMED_COLORS = {
    transparent: [0, 0, 0, 0],
    white: [1, 1, 1, 1],
    black: [0, 0, 0, 1],
};

/** Split on `sep`, ignoring separators nested inside brackets or strings. */
function splitTop(text, sep) {
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
        } else if (c === sep && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

/** Split on whitespace, keeping bracketed groups such as `rgb(1 2 3 / 50%)` whole. */
function tokenize(text) {
    const tokens = [];
    let depth = 0;
    let start = 0;
    const push = end => {
        const token = text.slice(start, end).trim();
        if (token)
            tokens.push(token);
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'") {
            i = skipString(text, i);
        } else if (c === '(' || c === '[') {
            depth++;
        } else if (c === ')' || c === ']') {
            depth--;
        } else if (depth === 0 && /\s/.test(c)) {
            push(i);
            start = i + 1;
        }
    }
    push(text.length);
    return tokens;
}

/** Index of the closing quote of the string starting at `start`. */
function skipString(text, start) {
    const quote = text[start];
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\')
            i++;
        else if (text[i] === quote)
            return i;
    }
    return text.length;
}

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Index of the `}` matching the `{` at `open`. */
function matchBrace(css, open) {
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        const c = css[i];
        if (c === '"' || c === "'") {
            i = skipString(css, i);
        } else if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    return -1;
}

/**
 * Whether a media query applies to the environment we are resolving for.
 *
 * Unknown features return false, so an unrecognised `@media` block is skipped
 * rather than wrongly applied.
 */
function mediaMatches(query, env) {
    return splitTop(query, ',').some(clause => {
        const terms = clause.split(/\s+and\s+/i).map(t => t.trim()).filter(Boolean);
        return terms.length > 0 && terms.every(term => {
            const t = term.toLowerCase();
            if (t === 'screen' || t === 'all')
                return true;

            const m = /^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/.exec(t);
            if (!m)
                return false;

            const [, feature, value] = m;
            if (feature === 'prefers-color-scheme')
                return value === (env.dark ? 'dark' : 'light');
            if (feature === 'prefers-contrast')
                return value === (env.highContrast ? 'more' : 'no-preference');
            return false;
        });
    });
}

/** Yield every style rule that applies, descending into matching @media blocks. */
function* eachRule(css, env) {
    let i = 0;
    while (i < css.length) {
        let brace = -1;
        let semicolon = -1;
        for (let j = i; j < css.length; j++) {
            const c = css[j];
            if (c === '"' || c === "'") {
                j = skipString(css, j);
            } else if (c === '{') {
                brace = j;
                break;
            } else if (c === ';') {
                semicolon = j;
                break;
            }
        }

        if (brace < 0) {
            // A trailing statement such as `@import ...;` or `@define-color ...;`.
            if (semicolon < 0)
                return;
            i = semicolon + 1;
            continue;
        }

        const prelude = css.slice(i, brace).trim();
        const end = matchBrace(css, brace);
        if (end < 0)
            return;
        const body = css.slice(brace + 1, end);
        i = end + 1;

        if (prelude.startsWith('@')) {
            const at = /^@([\w-]+)/.exec(prelude);
            if (at && at[1].toLowerCase() === 'media' &&
                mediaMatches(prelude.slice(at[0].length).trim(), env))
                yield* eachRule(body, env);
            // Other at-rule blocks (@keyframes, @supports, @font-face) are ignored.
        } else {
            yield {prelude, body};
        }
    }
}

/** Parse a declaration block into a property -> value map. */
function parseDeclarations(body) {
    const decls = new Map();
    for (const part of splitTop(body, ';')) {
        const colon = part.indexOf(':');
        if (colon < 0)
            continue;
        const prop = part.slice(0, colon).trim().toLowerCase();
        const value = part.slice(colon + 1).trim();
        if (prop)
            decls.set(prop, value);
    }
    return decls;
}

/** Substitute `var(--name)` / `var(--name, fallback)` references. */
function resolveVars(value, vars, depth = 0) {
    if (depth > 4 || !value.includes('var('))
        return value;

    const resolved = value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g,
        (match, name, fallback) => {
            const declared = vars.get(name);
            if (declared !== undefined)
                return declared;
            const trimmed = (fallback ?? '').trim();
            return trimmed || match;
        });

    return resolved === value ? value : resolveVars(resolved, vars, depth + 1);
}

/** Parse one numeric colour channel, either `0-255` or a percentage. */
function channel(token, scale) {
    const t = token.trim();
    if (t.endsWith('%')) {
        const n = Number.parseFloat(t);
        return Number.isFinite(n) ? n / 100 : null;
    }
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? n / scale : null;
}

/**
 * Parse a CSS colour into premultiply-ready straight RGBA in the 0..1 range.
 *
 * Covers the syntaxes GTK and libadwaita actually emit: hex, `rgb()`/`rgba()`
 * in both comma and space form (libadwaita writes `RGB(0 0 0 / 15%)`), the
 * handful of named colours that appear, and the one `color-mix()` shape used
 * for border colours. `currentColor` and anything else returns null.
 */
export function parseColor(value) {
    if (!value)
        return null;
    const text = value.trim();
    const lower = text.toLowerCase();

    if (lower in NAMED_COLORS)
        return NAMED_COLORS[lower].slice();

    if (text.startsWith('#')) {
        const hex = text.slice(1);
        const expand = hex.length <= 4
            ? [...hex].map(c => c + c).join('')
            : hex;
        if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(expand))
            return null;
        const n = p => Number.parseInt(expand.slice(p, p + 2), 16) / 255;
        return [n(0), n(2), n(4), expand.length === 8 ? n(6) : 1];
    }

    const fn = /^([\w-]+)\((.*)\)$/s.exec(text);
    if (!fn)
        return null;
    const name = fn[1].toLowerCase();
    const args = fn[2];

    if (name === 'rgb' || name === 'rgba') {
        // Both `r, g, b, a` and the modern `r g b / a` are in use.
        const [head, tail] = splitTop(args, '/');
        let parts = splitTop(head, ',').map(s => s.trim()).filter(Boolean);
        if (parts.length === 1)
            parts = tokenize(head);
        if (tail !== undefined)
            parts.push(tail.trim());
        if (parts.length < 3)
            return null;

        const rgb = parts.slice(0, 3).map(p => channel(p, 255));
        if (rgb.some(c => c === null))
            return null;
        const a = parts.length > 3 ? channel(parts[3], 1) : 1;
        return [...rgb, a === null ? 1 : a];
    }

    if (name === 'color-mix') {
        // Only the `color-mix(in srgb, <colour> <pct>, transparent)` form that
        // libadwaita uses to fade a colour is supported; it is equivalent to
        // scaling alpha.
        const parts = splitTop(args, ',').map(s => s.trim());
        if (parts.length !== 3 || parts[2].toLowerCase() !== 'transparent')
            return null;
        const tokens = tokenize(parts[1]);
        const base = parseColor(tokens[0]);
        if (!base)
            return null;
        const pct = tokens[1] ? channel(tokens[1], 1) : 1;
        return [base[0], base[1], base[2], base[3] * (pct === null ? 1 : pct)];
    }

    return null;
}

/** Parse a CSS length in pixels. Unitless zero is allowed; other units are not. */
export function parseLength(value) {
    if (!value)
        return null;
    const t = value.trim();
    const m = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/.exec(t);
    if (!m)
        return null;
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n))
        return null;
    return m[2] || n === 0 ? n : null;
}

/**
 * Parse a `box-shadow` value into outer shadow layers, in paint order (the
 * first listed layer is drawn on top). `inset` layers are dropped, since we
 * only reproduce the drop shadow, as are fully transparent ones, which
 * libadwaita includes to keep shadow extents stable across the backdrop
 * transition.
 *
 * @returns {?Array<{dx: number, dy: number, blur: number, spread: number, color: number[]}>}
 */
export function parseBoxShadow(value) {
    if (!value)
        return null;
    if (value.trim().toLowerCase() === 'none')
        return [];

    const layers = [];
    for (const part of splitTop(value, ',')) {
        const tokens = tokenize(part);
        if (tokens.length === 0)
            continue;
        if (tokens.some(t => t.toLowerCase() === 'inset'))
            continue;

        const lengths = [];
        let color = null;
        for (const token of tokens) {
            const len = parseLength(token);
            if (len !== null && color === null && lengths.length < 4) {
                lengths.push(len);
                continue;
            }
            color = parseColor(token) ?? color;
        }

        if (lengths.length < 2)
            return null;
        if (!color)
            color = [0, 0, 0, 1];
        if (color[3] <= 0)
            continue;

        layers.push({
            dx: lengths[0],
            dy: lengths[1],
            blur: Math.max(lengths[2] ?? 0, 0),
            spread: lengths[3] ?? 0,
            color,
        });
    }
    return layers;
}

/**
 * Read the `window.csd` styling out of a GTK stylesheet.
 *
 * Only the rules whose selector is exactly `window.csd` (or
 * `window.csd:backdrop`) are consulted, so the `--window-radius: 0px` overrides
 * on `.maximized` and `.tiled` are correctly ignored. We never round those
 * windows anyway.
 *
 * Every field is null when the stylesheet did not say, letting the caller fall
 * through to the next source.
 *
 * @param {string} css - Stylesheet text.
 * @param {{dark: boolean, highContrast: boolean}} env - Which variants apply.
 */
export function readWindowStyle(css, env) {
    const vars = new Map();
    const csd = new Map();
    const backdrop = new Map();

    for (const {prelude, body} of eachRule(stripComments(css), env)) {
        const selectors = splitTop(prelude, ',').map(s => s.trim());
        const isRoot = selectors.some(s => s === ':root' || s === 'window' || s === '*');
        const isCsd = selectors.some(s => s === 'window.csd');
        const isBackdrop = selectors.some(s => s === 'window.csd:backdrop');
        if (!isRoot && !isCsd && !isBackdrop)
            continue;

        const decls = parseDeclarations(body);
        for (const [prop, value] of decls) {
            if ((isRoot || isCsd) && prop.startsWith('--'))
                vars.set(prop, value);
            if (isCsd)
                csd.set(prop, value);
            if (isBackdrop)
                backdrop.set(prop, value);
        }
    }

    const lookup = (map, prop) => {
        const raw = map.get(prop);
        return raw === undefined ? null : resolveVars(raw, vars);
    };

    // `border-radius` may carry up to four values; they are equal for windows.
    const radiusText = lookup(csd, 'border-radius') ??
        (vars.has('--window-radius') ? resolveVars(vars.get('--window-radius'), vars) : null);
    const radius = radiusText === null ? null : parseLength(tokenize(radiusText)[0] ?? '');

    let outlineWidth = null;
    let outlineColor = null;
    const shorthand = lookup(csd, 'outline');
    if (shorthand !== null) {
        if (shorthand.trim().toLowerCase() === 'none') {
            outlineWidth = 0;
            outlineColor = [0, 0, 0, 0];
        } else {
            for (const token of tokenize(shorthand)) {
                const len = parseLength(token);
                if (len !== null && outlineWidth === null)
                    outlineWidth = len;
                else
                    outlineColor = parseColor(token) ?? outlineColor;
            }
        }
    }
    outlineWidth = parseLength(lookup(csd, 'outline-width') ?? '') ?? outlineWidth;
    outlineColor = parseColor(lookup(csd, 'outline-color') ?? '') ?? outlineColor;

    const shadow = parseBoxShadow(lookup(csd, 'box-shadow') ?? '');
    const shadowBackdrop = parseBoxShadow(lookup(backdrop, 'box-shadow') ?? '') ?? shadow;

    return {radius, outlineWidth, outlineColor, shadow, shadowBackdrop};
}

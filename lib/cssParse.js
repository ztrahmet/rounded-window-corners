/**
 * CSS parser for window styling properties
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

const NAMED_COLORS = {
    transparent: [0, 0, 0, 0],
    white: [1, 1, 1, 1],
    black: [0, 0, 0, 1],
};

// Split on separator, ignoring nested delimiters.
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

// Split on whitespace while preserving bracketed expressions.
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
        } else {
            yield {prelude, body};
        }
    }
}

function parseDeclarations(body) {
    const decls = new Map();
    for (const part of splitTop(body, ';')) {
        const colon = part.indexOf(':');
        if (colon < 0)
            continue;
        const prop = part.slice(0, colon).trim().toLowerCase();
        const value = part.slice(colon + 1).replace(/\s*!\s*important\s*$/i, '').trim();
        if (prop)
            decls.set(prop, value);
    }
    return decls;
}

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
 * Parses a CSS color value into RGBA [r, g, b, a] in the 0..1 range.
 *
 * @param {string} value
 * @returns {?number[]}
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

/**
 * Parses a CSS length in pixels.
 *
 * @param {string} value
 * @returns {?number}
 */
export function parseLength(value) {
    if (!value)
        return null;
    const t = value.trim();
    const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px)?$/.exec(t);
    if (!m)
        return null;
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n))
        return null;
    return m[2] || n === 0 ? n : null;
}

/**
 * Parses a box-shadow value into outer shadow layers.
 *
 * @param {string} value
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
        let unreadable = false;
        for (const token of tokens) {
            const len = parseLength(token);
            if (len !== null && color === null && lengths.length < 4) {
                lengths.push(len);
                continue;
            }
            const parsed = parseColor(token);
            if (parsed)
                color = parsed;
            else
                unreadable = true;
        }

        if (lengths.length < 2 || unreadable || !color)
            return null;
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
 * Extracts corner radius, outline, and box-shadow from GTK CSS for window.csd.
 *
 * @param {string} css - Stylesheet text.
 * @param {{dark: boolean, highContrast: boolean}} env - Environment settings.
 * @returns {object}
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

/**
 * CSS reader for the window style libadwaita draws
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

// libadwaita's window style, for when its stylesheet cannot be read.
export const FALLBACK_CSS = `
:root { --window-radius: 15px; }
window.csd {
    border-radius: var(--window-radius);
    outline: 1px solid rgb(255 255 255 / 7%);
    outline-offset: -1px;
    box-shadow: 0 0 14px 5px rgb(0 0 0 / 15%), 0 0 5px 2px rgb(0 0 0 / 10%), 0 0 0 1px rgb(0 0 0 / 5%);
}
window.csd:backdrop {
    box-shadow: 0 0 14px 5px transparent, 0 0 10px 5px rgb(0 0 0 / 8%), 0 0 0 1px rgb(0 0 0 / 5%);
}
@media (prefers-contrast: more) {
    window.csd {
        outline-color: rgb(255 255 255 / 30%);
        box-shadow: 0 0 14px 5px rgb(0 0 0 / 15%), 0 0 5px 2px rgb(0 0 0 / 10%), 0 0 0 1px rgb(0 0 0 / 80%);
    }
    window.csd:backdrop {
        box-shadow: 0 0 14px 5px transparent, 0 0 10px 5px rgb(0 0 0 / 8%), 0 0 0 1px rgb(0 0 0 / 80%);
    }
}`;

const NAMED_COLORS = new Map([
    ['transparent', [0, 0, 0, 0]],
    ['white', [1, 1, 1, 1]],
    ['black', [0, 0, 0, 1]],
]);

const OUTLINE_STYLES = new Set([
    'none', 'hidden', 'solid', 'dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset',
]);

const WIDTH_KEYWORDS = new Map([['thin', '1px'], ['medium', '3px'], ['thick', '5px']]);

const CORNERS = [
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
];

// A libadwaita window is the root node, with these classes.
const WINDOW_CLASSES = new Set(['background', 'csd']);

const COMMENT = /\/\*[\s\S]*?\*\//g;

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

const splitOn = (text, separator) => splitTop(text, c => c === separator);
const tokenize = text => splitTop(text, c => /\s/.test(c)).filter(Boolean);

function channel(token, scale) {
    const n = Number.parseFloat(token);
    if (!Number.isFinite(n))
        return null;
    const value = token.trim().endsWith('%') ? n / 100 : n / scale;
    return Math.min(Math.max(value, 0), 1);
}

/**
 * Parses a colour into RGBA, each in 0..1.
 *
 * @param {string} value
 * @returns {?number[]}
 */
export function parseColor(value) {
    const text = value.trim();
    const lower = text.toLowerCase();

    if (NAMED_COLORS.has(lower))
        return [...NAMED_COLORS.get(lower)];

    if (text.startsWith('#')) {
        const hex = text.slice(1);
        const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex;
        if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full))
            return null;
        const n = i => Number.parseInt(full.slice(i, i + 2), 16) / 255;
        return [n(0), n(2), n(4), full.length === 8 ? n(6) : 1];
    }

    const fn = /^([\w-]+)\((.*)\)$/s.exec(text);
    if (!fn)
        return null;
    const name = fn[1].toLowerCase();

    if (name === 'rgb' || name === 'rgba') {
        const [head, alpha] = splitOn(fn[2], '/');
        let parts = splitOn(head, ',');
        if (parts.length === 1)
            parts = tokenize(head);
        if (alpha !== undefined)
            parts.push(alpha);
        if (parts.length < 3 || parts.length > 4)
            return null;

        const rgba = [...parts.slice(0, 3).map(p => channel(p, 255)), parts.length === 4 ? channel(parts[3], 1) : 1];
        return rgba.includes(null) ? null : rgba;
    }

    if (name === 'color-mix') {
        const parts = splitOn(fn[2], ',').map(s => s.trim());
        if (parts.length !== 3 || parts[2].toLowerCase() !== 'transparent')
            return null;
        const [base, percent] = tokenize(parts[1]);
        const color = parseColor(base ?? '');
        const amount = percent === undefined ? 1 : channel(percent, 1);
        return color && amount !== null ? [...color.slice(0, 3), color[3] * amount] : null;
    }

    return null;
}

/**
 * Parses a length in pixels, the only unit supported.
 *
 * @param {string} value
 * @returns {?number}
 */
export function parseLength(value) {
    const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px)?$/.exec(value.trim());
    if (!m)
        return null;
    const n = Number.parseFloat(m[1]);
    return Number.isFinite(n) && (m[2] || n === 0) ? n : null;
}

/**
 * Parses a box-shadow into its outer layers.
 *
 * @param {string} value
 * @returns {?Array<{dx: number, dy: number, blur: number, spread: number, color: number[]}>}
 */
export function parseBoxShadow(value) {
    if (value.trim().toLowerCase() === 'none')
        return [];

    const layers = [];
    for (const part of splitOn(value, ',')) {
        const tokens = tokenize(part);
        if (tokens.some(t => t.toLowerCase() === 'inset'))
            continue;

        const first = parseColor(tokens[0] ?? '');
        const color = first ?? parseColor(tokens.at(-1) ?? '');
        const lengths = (first ? tokens.slice(1) : tokens.slice(0, -1)).map(parseLength);
        if (!color || lengths.length < 2 || lengths.length > 4 || lengths.includes(null))
            return null;

        if (color[3] > 0) {
            const [dx, dy, blur = 0, spread = 0] = lengths;
            layers.push({dx, dy, blur: Math.max(blur, 0), spread, color});
        }
    }
    return layers;
}

const isRadius = r => r !== null && r >= 0;

// Elliptical corners are drawn as circles of their horizontal radius.
function parseRadii(value) {
    const groups = splitOn(value, '/').map(group => tokenize(group).map(parseLength));
    if (groups.length > 2 || !groups.every(g => g.length >= 1 && g.length <= 4 && g.every(isRadius)))
        return [];
    const [a, b = a, c = a, d = b] = groups[0];
    return CORNERS.map((corner, i) => [corner, [a, b, c, d][i]]);
}

function parseCorner(value) {
    const radii = tokenize(value).map(parseLength);
    return radii.length >= 1 && radii.length <= 2 && radii.every(isRadius) ? radii[0] : null;
}

function parseWidth(value) {
    const width = parseLength(WIDTH_KEYWORDS.get(value.trim().toLowerCase()) ?? value);
    return width !== null && width >= 0 ? width : null;
}

function parseStyle(value) {
    const style = value.trim().toLowerCase();
    return OUTLINE_STYLES.has(style) ? style : null;
}

// currentColor is not known here, so it leaves the colour as it was.
function parseOutline(value) {
    const parts = {};
    for (const token of tokenize(value)) {
        if (token.toLowerCase() === 'currentcolor')
            continue;
        const [name, parsed] = [
            ['outline-style', parseStyle(token)],
            ['outline-width', parseWidth(token)],
            ['outline-color', parseColor(token)],
        ].find(([, v]) => v !== null) ?? [];
        if (!name || name in parts)
            return [];
        parts[name] = parsed;
    }
    return Object.entries({'outline-width': 0, 'outline-style': 'none', ...parts});
}

const longhand = (name, parse) => [name, value => [[name, parse(value)]]];

const READERS = new Map([
    ['border-radius', parseRadii],
    ['outline', parseOutline],
    ...CORNERS.map(name => longhand(name, parseCorner)),
    longhand('outline-width', parseWidth),
    longhand('outline-style', parseStyle),
    longhand('outline-offset', parseLength),
    longhand('outline-color', parseColor),
    longhand('box-shadow', parseBoxShadow),
]);

function mediaMatches(query, env) {
    const features = new Map([
        ['prefers-color-scheme', env.dark ? 'dark' : 'light'],
        ['prefers-contrast', env.highContrast ? 'more' : 'no-preference'],
    ]);
    return query.split(',').some(condition => condition.split(/\band\b/i).every(term => {
        const m = /^\s*\(\s*([\w-]+)\s*:\s*([\w-]+)\s*\)\s*$/.exec(term);
        return m !== null && features.get(m[1].toLowerCase()) === m[2].toLowerCase();
    }));
}

function matchBrace(css, open) {
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        const c = css[i];
        if (c === '"' || c === "'")
            i = skipString(css, i);
        else if (c === '{')
            depth++;
        else if (c === '}' && --depth === 0)
            return i;
    }
    return -1;
}

function* eachRule(css, env) {
    let i = 0;
    while (i < css.length) {
        let brace = i;
        while (brace < css.length && css[brace] !== '{' && css[brace] !== ';') {
            if (css[brace] === '"' || css[brace] === "'")
                brace = skipString(css, brace);
            brace++;
        }
        if (css[brace] !== '{') {
            i = brace + 1;
            continue;
        }

        const end = matchBrace(css, brace);
        if (end < 0)
            return;
        const prelude = css.slice(i, brace).trim();
        const body = css.slice(brace + 1, end);
        i = end + 1;

        const media = /^@media\b/i.exec(prelude);
        if (media && mediaMatches(prelude.slice(media[0].length), env))
            yield* eachRule(body, env);
        else if (!prelude.startsWith('@'))
            yield {prelude, body};
    }
}

function parseDeclarations(body) {
    const declarations = [];
    for (const part of splitOn(body, ';')) {
        const colon = part.indexOf(':');
        if (colon < 1)
            continue;
        const name = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).trim();
        declarations.push([name.startsWith('--') ? name : name.toLowerCase(), value]);
    }
    return declarations;
}

const SIMPLE = /^(?:\*|[a-z][\w-]*|[.:][\w-]+)$/i;
const COMPOUND = /^(\*|[a-z][\w-]*)?((?:\.[\w-]+|:[\w-]+(?:\([^()]*\))?)*)$/i;

function matchSimple(simple, backdrop) {
    const [, kind, name, argument] = /^([.:]?)([\w-]+|\*)(?:\((.*)\))?$/s.exec(simple);
    if (kind === '')
        return [name === '*' || name === 'window', name === '*' ? 0 : 1];
    if (kind === '.')
        return [WINDOW_CLASSES.has(name), 100];
    if (name === 'not' && argument !== undefined) {
        const inner = argument.trim();
        const [matches, weight] = SIMPLE.test(inner) ? matchSimple(inner, backdrop) : [true, 0];
        return [!matches, weight];
    }
    return [argument === undefined && (name === 'root' || (name === 'backdrop' && backdrop)), 100];
}

// Specificity of a selector that matches the window, or -1.
function specificity(selector, backdrop) {
    const m = COMPOUND.exec(selector.trim());
    if (!m || !m[0])
        return -1;
    let total = 0;
    for (const simple of [m[1] ?? '*', ...m[2].match(/\.[\w-]+|:[\w-]+(?:\([^()]*\))?/g) ?? []]) {
        const [matches, weight] = matchSimple(simple, backdrop);
        if (!matches)
            return -1;
        total += weight;
    }
    return total;
}

function resolveVars(value, vars) {
    for (let i = 0; i < 5 && value.includes('var('); i++) {
        value = value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g,
            (match, name, fallback) => vars.get(name) ?? fallback?.trim() ?? match);
    }
    return value;
}

// As in GTK, a value that cannot be read is dropped.
function cascade(rules, state) {
    const ordered = rules
        .filter(rule => rule[state] >= 0)
        .sort((a, b) => a.sheet - b.sheet || a[state] - b[state]);

    const vars = new Map();
    for (const rule of ordered) {
        for (const [name, value] of rule.declarations) {
            if (name.startsWith('--'))
                vars.set(name, value);
        }
    }

    const values = new Map();
    for (const rule of ordered) {
        for (const [name, value] of rule.declarations) {
            const read = READERS.get(name);
            if (!read)
                continue;
            for (const [property, parsed] of read(resolveVars(value, vars))) {
                if (parsed !== null)
                    values.set(property, parsed);
            }
        }
    }
    return values;
}

/**
 * Computes the window's corner radii, outline and shadows the way GTK does.
 *
 * @param {string[]} sheets - Stylesheets, lowest priority first.
 * @param {{dark: boolean, highContrast: boolean}} env
 * @returns {object}
 */
export function readWindowStyle(sheets, env) {
    const rules = [];
    sheets.forEach((css, sheet) => {
        for (const {prelude, body} of eachRule(css.replace(COMMENT, ' '), env)) {
            const selectors = splitOn(prelude, ',');
            const focused = Math.max(...selectors.map(s => specificity(s, false)));
            const backdrop = Math.max(...selectors.map(s => specificity(s, true)));
            if (focused >= 0 || backdrop >= 0)
                rules.push({sheet, focused, backdrop, declarations: parseDeclarations(body)});
        }
    });

    const values = cascade(rules, 'focused');
    const style = values.get('outline-style');
    return {
        radii: CORNERS.map(corner => values.get(corner)),
        outlineWidth: style === 'none' || style === 'hidden' ? 0 : values.get('outline-width'),
        outlineOffset: values.get('outline-offset'),
        outlineColor: values.get('outline-color'),
        shadow: values.get('box-shadow'),
        shadowBackdrop: cascade(rules, 'backdrop').get('box-shadow'),
    };
}

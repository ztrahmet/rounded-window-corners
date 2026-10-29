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
.background { color: RGB(0 0 6 / 80%); }
window.csd {
    border-radius: var(--window-radius);
    outline: 1px solid rgb(255 255 255 / 7%);
    outline-offset: -1px;
    box-shadow: 0 0 14px 5px rgb(0 0 0 / 15%), 0 0 5px 2px rgb(0 0 0 / 10%), 0 0 0 1px rgb(0 0 0 / 5%);
}
window.csd:backdrop {
    box-shadow: 0 0 14px 5px transparent, 0 0 10px 5px rgb(0 0 0 / 8%), 0 0 0 1px rgb(0 0 0 / 5%);
}
@media (prefers-color-scheme: dark) {
    .background { color: white; }
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

const COMMENT = /\/\*[\s\S]*?\*\//g;

const OUTLINE_STYLES = new Set([
    'none', 'hidden', 'solid', 'dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset',
]);

const CORNERS = [
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
];

// GTK's initial values. The window is the root, so inherit is initial too.
const INITIAL = new Map([
    ...CORNERS.map(corner => [corner, '0']),
    ['outline-width', '0'],
    ['outline-style', 'none'],
    ['outline-color', 'currentColor'],
    ['outline-offset', '0'],
    ['box-shadow', 'none'],
    ['color', '#fff'],
]);

const INITIAL_COLOR = [1, 1, 1, 1];

const CSS_WIDE_KEYWORDS = /^(?:initial|inherit|unset)$/i;

// A libadwaita window is the root node, with these classes.
const WINDOW_CLASSES = new Set(['background', 'csd']);

/**
 * Removes comments, which GTK ignores everywhere.
 *
 * @param {string} css
 * @returns {string}
 */
export function stripComments(css) {
    return css.replace(COMMENT, ' ');
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

function closingParen(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(')
            depth++;
        else if (text[i] === ')' && --depth === 0)
            return i;
    }
    return -1;
}

function channel(token, scale) {
    const n = Number.parseFloat(token);
    if (!Number.isFinite(n))
        return null;
    const value = token.trim().endsWith('%') ? n / 100 : n / scale;
    return Math.min(Math.max(value, 0), 1);
}

// color-mix() with transparent, which keeps the color and scales its alpha.
function mixWithTransparent(args, names) {
    const parts = splitOn(args, ',').map(tokenize);
    if (parts.length !== 3 || parts.slice(1).some(p => p.length < 1 || p.length > 2))
        return null;
    const [, first, second] = parts;
    const clear = [first, second].findIndex(([color]) => color.toLowerCase() === 'transparent');
    if (clear < 0)
        return null;
    const [color, percent] = clear === 0 ? second : first;
    const [, clearPercent] = clear === 0 ? first : second;
    const rgba = parseColor(color, names);
    let weight = 0.5;
    if (percent !== undefined)
        weight = channel(percent, 1);
    else if (clearPercent !== undefined)
        weight = 1 - channel(clearPercent, 1);
    return rgba && weight !== null ? [...rgba.slice(0, 3), rgba[3] * weight] : null;
}

/**
 * Parses a color into RGBA, each in 0..1.
 *
 * @param {string} value
 * @param {function(string): ?number[]} names - Resolves currentColor, color
 *   names and names given by define-color.
 * @returns {?number[]}
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

    if (name === 'color-mix')
        return mixWithTransparent(fn[2], names);

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

// The lengths, inset and color come in any order, each once, as in GTK.
function parseShadowLayer(text, names) {
    const tokens = tokenize(text);
    let lengths = null;
    let inset = false;
    let color = null;
    for (let i = 0; i < tokens.length;) {
        const run = [];
        while (run.length < 4 && i < tokens.length && parseLength(tokens[i]) !== null)
            run.push(parseLength(tokens[i++]));

        if (run.length > 0) {
            if (lengths || run.length < 2 || run[2] < 0)
                return null;
            lengths = run;
        } else if (!inset && tokens[i].toLowerCase() === 'inset') {
            inset = true;
            i++;
        } else if (!color) {
            color = parseColor(tokens[i++], names);
            if (!color)
                return null;
        } else {
            return null;
        }
    }
    if (!lengths)
        return null;

    const [dx, dy, blur = 0, spread = 0] = lengths;
    return {dx, dy, blur, spread, color: color ?? names('currentColor'), inset};
}

/**
 * Parses a box-shadow into its outer layers that show.
 *
 * @param {string} value
 * @param {function(string): ?number[]} names - As for parseColor().
 * @returns {?Array<{dx: number, dy: number, blur: number, spread: number, color: number[]}>}
 */
export function parseBoxShadow(value, names) {
    if (value.trim().toLowerCase() === 'none')
        return [];

    const layers = [];
    for (const part of splitOn(value, ',')) {
        const layer = parseShadowLayer(part, names);
        if (!layer)
            return null;
        const {dx, dy, blur, spread, color, inset} = layer;
        if (!inset && color[3] > 0)
            layers.push({dx, dy, blur, spread, color});
    }
    return layers;
}

const isRadius = r => r !== null && r >= 0;

// Elliptical corners are drawn as circles of their horizontal radius.
function parseRadii(value) {
    const groups = splitOn(value, '/').map(group => tokenize(group).map(parseLength));
    if (groups.length > 2 || !groups.every(g => g.length >= 1 && g.length <= 4 && g.every(isRadius)))
        return null;
    const [a, b = a, c = a, d = b] = groups[0];
    return new Map(CORNERS.map((corner, i) => [corner, [a, b, c, d][i]]));
}

function parseCorner(value) {
    const radii = tokenize(value).map(parseLength);
    return radii.length >= 1 && radii.length <= 2 && radii.every(isRadius) ? radii[0] : null;
}

function parseWidth(value) {
    const width = parseLength(value);
    return width !== null && width >= 0 ? width : null;
}

function parseStyle(value) {
    const style = value.trim().toLowerCase();
    return OUTLINE_STYLES.has(style) ? style : null;
}

// Width, style and color in any order; what is left out is reset.
function parseOutline(value, names) {
    const tokens = tokenize(value);
    if (tokens.length === 0)
        return null;
    const parts = new Map();
    for (const token of tokens) {
        const [name, parsed] = [
            ['outline-width', parseWidth(token)],
            ['outline-style', parseStyle(token)],
            ['outline-color', parseColor(token, names)],
        ].find(([, v]) => v !== null) ?? [];
        if (!name || parts.has(name))
            return null;
        parts.set(name, parsed);
    }
    for (const name of ['outline-width', 'outline-style', 'outline-color']) {
        if (!parts.has(name))
            parts.set(name, readLonghand(name, INITIAL.get(name), names));
    }
    return parts;
}

const LONGHANDS = new Map([
    ...CORNERS.map(corner => [corner, parseCorner]),
    ['outline-width', parseWidth],
    ['outline-style', parseStyle],
    ['outline-color', parseColor],
    ['outline-offset', parseLength],
    ['box-shadow', parseBoxShadow],
    ['color', parseColor],
]);

const SHORTHANDS = new Map([
    ['border-radius', {longhands: CORNERS, parse: parseRadii}],
    ['outline', {longhands: ['outline-width', 'outline-style', 'outline-color'], parse: parseOutline}],
    // GTK's all takes nothing but initial, inherit and unset.
    ['all', {longhands: [...LONGHANDS.keys()], parse: () => null}],
]);

const PROPERTIES = new Set([...LONGHANDS.keys(), ...SHORTHANDS.keys()]);
const COLOR_PROPERTIES = new Set(['color', 'all']);

function readLonghand(name, value, names) {
    return LONGHANDS.get(name)(value, names);
}

// The longhands a declaration sets, or null when its value cannot be read.
function readDeclaration(name, value, names) {
    const shorthand = SHORTHANDS.get(name);
    if (CSS_WIDE_KEYWORDS.test(value)) {
        const longhands = shorthand ? shorthand.longhands : [name];
        return new Map(longhands.map(longhand => [longhand, readLonghand(longhand, INITIAL.get(longhand), names)]));
    }
    if (shorthand)
        return shorthand.parse(value, names);
    const parsed = readLonghand(name, value, names);
    return parsed === null ? null : new Map([[name, parsed]]);
}

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

// Rules and @define-color statements, inside the media queries that match.
function* eachRule(css, env) {
    let i = 0;
    while (i < css.length) {
        let brace = i;
        while (brace < css.length && css[brace] !== '{' && css[brace] !== ';') {
            if (css[brace] === '"' || css[brace] === "'")
                brace = skipString(css, brace);
            brace++;
        }
        const prelude = css.slice(i, brace).trim();
        if (css[brace] !== '{') {
            const define = /^@define-color\s+([\w-]+)\s+(.+)$/is.exec(prelude);
            if (define)
                yield {define: [define[1], define[2]]};
            i = brace + 1;
            continue;
        }

        const end = matchBrace(css, brace);
        if (end < 0)
            return;
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

// The value with every var() replaced, or null when one cannot be resolved.
function substituteVars(value, vars, resolving = new Set()) {
    let result = '';
    let from = 0;
    for (const match of value.matchAll(/\bvar\(/gi)) {
        if (match.index < from)
            continue;
        const end = closingParen(value, match.index + 3);
        if (end < 0)
            return null;
        const [reference, ...fallback] = splitOn(value.slice(match.index + 4, end), ',');
        const name = reference.trim();

        let replacement = null;
        if (vars.has(name) && !resolving.has(name)) {
            resolving.add(name);
            replacement = substituteVars(vars.get(name), vars, resolving);
            resolving.delete(name);
        }
        if (replacement === null && fallback.length > 0)
            replacement = substituteVars(fallback.join(',').trim(), vars, resolving);
        if (replacement === null)
            return null;

        result += value.slice(from, match.index) + replacement;
        from = end + 1;
    }
    return result + value.slice(from);
}

// @define-color names resolve across stylesheets, the last definition winning.
function colorNames(defines, colorName, currentColor) {
    const resolving = new Set();
    const names = name => {
        if (name.toLowerCase() === 'currentcolor')
            return currentColor;
        if (!name.startsWith('@'))
            return colorName(name);

        const key = name.slice(1);
        if (!defines.has(key) || resolving.has(key))
            return null;
        resolving.add(key);
        const color = parseColor(defines.get(key), names);
        resolving.delete(key);
        return color;
    };
    return names;
}

// The window's values when focused or in backdrop.
function computeState(rules, state, defines, colorName) {
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

    // As in GTK, a value that cannot be read is dropped, but one using var() becomes unset.
    const cascade = (currentColor, properties) => {
        const names = colorNames(defines, colorName, currentColor);
        const values = readDeclaration('all', 'initial', names);
        for (const rule of ordered) {
            for (const [name, value] of rule.declarations) {
                if (!properties.has(name))
                    continue;
                const usesVars = /\bvar\(/i.test(value);
                const substituted = usesVars ? substituteVars(value, vars) : value;
                let read = substituted === null ? null : readDeclaration(name, substituted, names);
                if (read === null && usesVars)
                    read = readDeclaration(name, 'unset', names);
                for (const [property, parsed] of read ?? [])
                    values.set(property, parsed);
            }
        }
        return values;
    };

    // For the window's own color, currentColor is the initial color, since the window is the root.
    const color = cascade(INITIAL_COLOR, COLOR_PROPERTIES).get('color');
    return cascade(color, PROPERTIES);
}

/**
 * Computes the window's corner radii, outline and shadows the way GTK does.
 *
 * @param {string[]} sheets - Stylesheets, lowest priority first.
 * @param {object} env
 * @param {boolean} env.dark
 * @param {boolean} env.highContrast
 * @param {function(string): ?number[]} env.colorName - Looks up a color
 *   name, as Pango does for GTK.
 * @returns {object}
 */
export function readWindowStyle(sheets, env) {
    const rules = [];
    const defines = new Map();
    sheets.forEach((css, sheet) => {
        for (const item of eachRule(stripComments(css), env)) {
            if (item.define) {
                defines.set(...item.define);
                continue;
            }
            const selectors = splitOn(item.prelude, ',');
            const focused = Math.max(...selectors.map(s => specificity(s, false)));
            const backdrop = Math.max(...selectors.map(s => specificity(s, true)));
            if (focused >= 0 || backdrop >= 0)
                rules.push({sheet, focused, backdrop, declarations: parseDeclarations(item.body)});
        }
    });

    const values = computeState(rules, 'focused', defines, env.colorName);
    const style = values.get('outline-style');
    return {
        radii: CORNERS.map(corner => values.get(corner)),
        outlineWidth: style === 'none' || style === 'hidden' ? 0 : values.get('outline-width'),
        outlineOffset: values.get('outline-offset'),
        outlineColor: values.get('outline-color'),
        shadow: values.get('box-shadow'),
        shadowBackdrop: computeState(rules, 'backdrop', defines, env.colorName).get('box-shadow'),
    };
}

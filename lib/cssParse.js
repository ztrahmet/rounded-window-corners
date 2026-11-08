/**
 * CSS reader for the window style libadwaita draws
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import {closingParen, drawnColor, parseColor, parseLength, skipString, splitOn, tokenize} from './cssValues.js';

// libadwaita's window style (LGPL-2.1-or-later), for when its stylesheet cannot be read.
export const FALLBACK_CSS = `
:root { --window-radius: 15px; --border-opacity: 15%; }
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
    :root { --border-opacity: 50%; }
    window.csd {
        outline-color: rgb(255 255 255 / 30%);
        box-shadow: 0 0 14px 5px rgb(0 0 0 / 15%), 0 0 5px 2px rgb(0 0 0 / 10%), 0 0 0 1px rgb(0 0 0 / 80%);
    }
    window.csd:backdrop {
        box-shadow: 0 0 14px 5px transparent, 0 0 10px 5px rgb(0 0 0 / 8%), 0 0 0 1px rgb(0 0 0 / 80%);
    }
}
window.csd.tiled, window.csd.tiled-top, window.csd.tiled-left, window.csd.tiled-right, window.csd.tiled-bottom {
    --window-radius: 0px;
    outline: none;
    box-shadow: 0 0 0 1px color-mix(in srgb, currentColor var(--border-opacity), transparent), 0 0 0 20px transparent;
}
window.csd.tiled:backdrop, window.csd.tiled-top:backdrop, window.csd.tiled-left:backdrop,
window.csd.tiled-right:backdrop, window.csd.tiled-bottom:backdrop {
    box-shadow: 0 0 0 1px color-mix(in srgb, currentColor var(--border-opacity), transparent), 0 0 0 20px transparent;
}
window.csd.maximized, window.csd.fullscreen { --window-radius: 0px; outline: none; box-shadow: none; }`;

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

// The window's classes, as GTK sets them. Mutter doesn't tell the Shell which edges are tiled, so all are.
const NORMAL = ['background', 'csd'];
const TILED = [...NORMAL, 'tiled-top', 'tiled-right', 'tiled-bottom', 'tiled-left'];
const MAXIMIZED = [...TILED, 'maximized'];

// Normal, tiled and maximized, each focused and in backdrop.
const LOOKS = [NORMAL, TILED, MAXIMIZED].flatMap(classes =>
    [false, true].map(backdrop => ({classes: new Set(classes), backdrop})));

/**
 * Removes comments, which GTK ignores everywhere.
 *
 * @param {string} css
 * @returns {string}
 */
export function stripComments(css) {
    return css.replace(COMMENT, ' ');
}

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

// Rules and @define-color statements, each with the media queries it is inside.
function* eachRule(css, media = []) {
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
                yield {media, define: [define[1], define[2]]};
            i = brace + 1;
            continue;
        }

        const end = matchBrace(css, brace);
        if (end < 0)
            return;
        const body = css.slice(brace + 1, end);
        i = end + 1;

        const at = /^@media\b/i.exec(prelude);
        if (at)
            yield* eachRule(body, [...media, prelude.slice(at[0].length)]);
        else if (!prelude.startsWith('@'))
            yield {media, prelude, body};
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

const SIMPLE = /^(?:\*|[a-z][\w-]*|\.[\w-]+|:[\w-]+(?:\([^()]*\))?)$/i;
const PSEUDO = String.raw`:[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?`;
const COMPOUND = new RegExp(String.raw`^(\*|[a-z][\w-]*)?((?:\.[\w-]+|${PSEUDO})*)$`, 'i');
const PARTS = new RegExp(String.raw`\.[\w-]+|${PSEUDO}`, 'g');

// state holds the window's classes, whether it is in backdrop and whether text runs right to left.
function matchSimple(simple, state) {
    const [, kind, name, argument] = /^([.:]?)([\w-]+|\*)(?:\((.*)\))?$/s.exec(simple);
    if (kind === '')
        return [name === '*' || name === 'window', name === '*' ? 0 : 1];
    if (kind === '.')
        return [state.classes.has(name), 100];
    if (name === 'not' && argument !== undefined) {
        const inner = argument.trim();
        const [matches, weight] = SIMPLE.test(inner) && !/^:not\(/i.test(inner) ? matchSimple(inner, state) : [true, 0];
        return [!matches, weight];
    }
    if (name === 'dir' && argument !== undefined)
        return [argument.trim().toLowerCase() === (state.rtl ? 'rtl' : 'ltr'), 100];
    return [argument === undefined && (name === 'root' || (name === 'backdrop' && state.backdrop)), 100];
}

// The simple selectors of a compound selector, or null for any other, which can't match the window.
function compoundParts(selector) {
    const m = COMPOUND.exec(selector.trim());
    return m && m[0] ? [m[1] ?? '*', ...m[2].match(PARTS) ?? []] : null;
}

// Specificity of compoundParts() that match the window, or -1.
function specificity(parts, state) {
    let total = 0;
    for (const simple of parts) {
        const [matches, weight] = matchSimple(simple, state);
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

// The window's values in LOOKS[look].
function computeState(rules, look, defines, colorName) {
    const ordered = rules
        .filter(rule => rule.specificities[look] >= 0)
        .sort((a, b) => a.sheet - b.sheet || a.specificities[look] - b.specificities[look]);

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
 * Reads the rules of a stylesheet that can match the window, and its @define-color statements.
 *
 * @param {string} css
 * @returns {Array<object>} In order, each with the media queries it is inside.
 */
export function parseStylesheet(css) {
    const items = [];
    for (const item of eachRule(stripComments(css))) {
        if (item.define) {
            items.push(item);
            continue;
        }
        // Its specificity in each look, left to right and right to left; -1 where it doesn't match.
        const compounds = splitOn(item.prelude, ',').map(compoundParts).filter(Boolean);
        const specificities = [false, true].map(rtl => LOOKS.map(({classes, backdrop}) =>
            Math.max(-1, ...compounds.map(parts => specificity(parts, {classes, backdrop, rtl})))));
        if (specificities.flat().some(s => s >= 0))
            items.push({media: item.media, specificities, declarations: parseDeclarations(item.body)});
    }
    return items;
}

/**
 * Computes the window's corner radii, outline and shadows the way GTK does.
 *
 * @param {Array<Array<object>>} sheets - From parseStylesheet(), lowest priority first.
 * @param {object} env
 * @param {boolean} env.dark
 * @param {boolean} env.highContrast
 * @param {boolean} env.rtl - Whether text runs right to left.
 * @param {function(string): ?number[]} env.colorName - Looks up a color name, as Pango does for GTK.
 * @returns {object} {normal, tiled, maximized}, each {radii, focused, backdrop}.
 */
export function readWindowStyle(sheets, env) {
    const rules = [];
    const defines = new Map();
    sheets.forEach((items, sheet) => {
        for (const item of items) {
            if (!item.media.every(query => mediaMatches(query, env)))
                continue;
            if (item.define)
                defines.set(...item.define);
            else
                rules.push({sheet, specificities: item.specificities[env.rtl ? 1 : 0], declarations: item.declarations});
        }
    });

    // GTK leaves no room around a maximized window, so none of its shadow shows.
    const look = (values, shadowed) => {
        const style = values.get('outline-style');
        return {
            outlineWidth: style === 'none' || style === 'hidden' ? 0 : values.get('outline-width'),
            outlineOffset: values.get('outline-offset'),
            outlineColor: drawnColor(values.get('outline-color')),
            shadow: shadowed ? values.get('box-shadow').map(layer => ({...layer, color: drawnColor(layer.color)})) : [],
        };
    };
    const state = (focused, backdrop, shadowed = true) => ({
        radii: CORNERS.map(corner => focused.get(corner)),
        focused: look(focused, shadowed),
        backdrop: look(backdrop, shadowed),
    });

    // Looks whose rules match alike cascade alike, so each is computed once.
    const values = [];
    for (let i = 0; i < LOOKS.length; i++) {
        const same = values.findIndex((_, j) => rules.every(rule => rule.specificities[j] === rule.specificities[i]));
        values.push(same >= 0 ? values[same] : computeState(rules, i, defines, env.colorName));
    }
    const [normal, backdrop, tiled, tiledBackdrop, maximized, maximizedBackdrop] = values;
    return {
        normal: state(normal, backdrop),
        tiled: state(tiled, tiledBackdrop),
        maximized: state(maximized, maximizedBackdrop, false),
    };
}

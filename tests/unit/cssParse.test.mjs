import test from 'node:test';
import assert from 'node:assert/strict';
import {FALLBACK_CSS, parseBoxShadow, parseStylesheet, readWindowStyle} from './cssParse.js';

const read = (sheets, env) => readWindowStyle(sheets.map(parseStylesheet), env);

// Stands in for Pango, which GTK asks for color names.
const PANGO = new Map([['white', [1, 1, 1, 1]], ['black', [0, 0, 0, 1]], ['red', [1, 0, 0, 1]], ['green', [0, 128 / 255, 0, 1]]]);
const colorName = name => PANGO.get(name.toLowerCase()) ?? null;
const CURRENT = [0.1, 0.2, 0.3, 1];
const names = name => name.toLowerCase() === 'currentcolor' ? CURRENT : colorName(name);

const LIGHT = {dark: false, highContrast: false, colorName};
const styleOf = (...sheets) => read(sheets, LIGHT);
const radiiOf = (...sheets) => styleOf(...sheets).normal.radii;
const lookOf = (...sheets) => styleOf(...sheets).normal.focused;
const round = s => JSON.parse(JSON.stringify(s, (k, v) => typeof v === 'number' ? Number(v.toFixed(6)) : v));

test('box-shadow: lengths, inset and color in any order, the color defaulting to currentColor', () => {
    const layer = {dx: 0, dy: 4, blur: 8, spread: 0, color: [0, 0, 0, 0.2]};
    assert.deepEqual(parseBoxShadow('0 4px 8px rgba(0,0,0,0.2)', names), [layer]);
    assert.deepEqual(parseBoxShadow('rgba(0,0,0,0.2) 0 4px 8px', names), [layer]);
    assert.deepEqual(parseBoxShadow('0 4px 8px', names), [{...layer, color: CURRENT}]);
    assert.deepEqual(parseBoxShadow('0 4px 8px currentColor', names), [{...layer, color: CURRENT}]);
    assert.deepEqual(parseBoxShadow('0 calc(2px * 2) 8px', names), [{...layer, color: CURRENT}]);
    for (const v of ['0 0 10px alpha(@theme_bg_color, 0.5)', '#000',
        '#000 0 0 #000', '0 0 1px 2px 3px #000', '0 0 4px #000 !important', '0 0 #000 4px', '0 0 -4px #000',
        'inset inset 0 0 #000', '0', ''])
        assert.equal(parseBoxShadow(v, names), null, v);
    assert.deepEqual(parseBoxShadow('none', names), []);
    assert.deepEqual(parseBoxShadow('inset 0 0 4px #000', names), []);
    assert.deepEqual(parseBoxShadow('0 0 4px #000 inset', names), []);
    assert.deepEqual(parseBoxShadow('0 0 4px transparent', names), []);
    assert.equal(parseBoxShadow('0 0 2px -3px #000', names)[0].spread, -3);
});

test('the fallback sheet gives libadwaita\'s window style', () => {
    const shadow = alpha => [
        {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
        {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.1]},
        {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, alpha]},
    ];
    const backdrop = alpha => [
        {dx: 0, dy: 0, blur: 10, spread: 5, color: [0, 0, 0, 0.08]},
        {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, alpha]},
    ];
    // Tiled, square with no outline and a 1 px line in the window's color at the border opacity; maximized, neither.
    const color = dark => dark ? [1, 1, 1, 1] : [0, 0, 6 / 255, 0.8];
    const line = (dark, opacity) => [{dx: 0, dy: 0, blur: 0, spread: 1, color: [...color(dark).slice(0, 3), color(dark)[3] * opacity]}];
    const look = (dark, layers) => ({outlineWidth: 0, outlineOffset: -1, outlineColor: color(dark), shadow: layers});
    const rounded = (focused, inBackdrop) => ({radii: [15, 15, 15, 15], focused, backdrop: inBackdrop});
    const flat = (dark, layers) => ({radii: [0, 0, 0, 0], focused: look(dark, layers), backdrop: look(dark, layers)});
    for (const dark of [false, true]) {
        for (const [highContrast, alpha, outline, opacity] of [[false, 0.05, 0.07, 0.15], [true, 0.8, 0.3, 0.5]]) {
            const outlined = layers => ({outlineWidth: 1, outlineOffset: -1, outlineColor: [1, 1, 1, outline], shadow: layers});
            assert.deepEqual(round(read([FALLBACK_CSS], {...LIGHT, dark, highContrast})), round({
                normal: rounded(outlined(shadow(alpha)), outlined(backdrop(alpha))),
                tiled: flat(dark, line(dark, opacity)),
                maximized: flat(dark, []),
            }));
        }
    }

    // currentColor is the window's color.
    const outline = dark => read([FALLBACK_CSS, 'window { outline-color: currentColor; }'], {...LIGHT, dark}).normal.focused.outlineColor;
    assert.deepEqual(round(outline(false)), [0, 0, round(6 / 255), 0.8]);
    assert.deepEqual(outline(true), [1, 1, 1, 1]);
});

test('unreadable values are dropped, leaving the one before, as GTK does', () => {
    assert.deepEqual(radiiOf(FALLBACK_CSS, 'window { border-radius: 0 !important; }'), [15, 15, 15, 15]);
    assert.deepEqual(radiiOf('window { border-radius: 8px; border-radius: 1em; }'), [8, 8, 8, 8]);
    assert.deepEqual(radiiOf('window { border-radius: 4px; } window.csd { border-radius: 9px ! important; }'), [4, 4, 4, 4]);
    const s = lookOf(FALLBACK_CSS, 'window { outline: 2px solid red !important; box-shadow: none !important; outline: ; }');
    assert.equal(s.outlineWidth, 1);
    assert.equal(s.shadow.length, 3);
});

test('a value with var() that cannot be read is unset, as GTK does at compute time', () => {
    assert.deepEqual(radiiOf(FALLBACK_CSS, 'window { border-radius: var(--nope); }'), [0, 0, 0, 0]);
    assert.deepEqual(radiiOf(FALLBACK_CSS, 'window { border-radius: var(--window-radius) !important; }'), [0, 0, 0, 0]);
    assert.deepEqual(radiiOf(FALLBACK_CSS, ':root { --r: 1em; } window { border-radius: var(--r); }'), [0, 0, 0, 0]);
    assert.deepEqual(radiiOf(FALLBACK_CSS, ':root { --a: var(--b); --b: var(--a); } window { border-radius: var(--a); }'), [0, 0, 0, 0]);
    assert.equal(lookOf(FALLBACK_CSS, 'window { box-shadow: var(--nope); }').shadow.length, 0);
});

test('initial, inherit and unset give GTK\'s initial values', () => {
    const s = styleOf(FALLBACK_CSS, 'window { box-shadow: initial; outline: unset; border-top-left-radius: inherit; }').normal;
    assert.deepEqual(s.focused.shadow, []);
    assert.equal(s.focused.outlineWidth, 0);
    assert.deepEqual(s.radii, [0, 15, 15, 15]);
    assert.deepEqual(styleOf(FALLBACK_CSS, 'window { all: initial; }').normal.radii, [0, 0, 0, 0]);
    assert.deepEqual(styleOf(FALLBACK_CSS, 'window { all: 3px; }').normal.radii, [15, 15, 15, 15]);
});

test('comments are ignored anywhere, as GTK ignores them', () => {
    assert.deepEqual(radiiOf('/* a */ window /* b */ { /* c */ border-radius: /* d */ 7px /* e */; }'), [7, 7, 7, 7]);
    assert.deepEqual(radiiOf('window { border-radius: 7px; /* } window { border-radius: 2px; */ }'), [7, 7, 7, 7]);
});

test('media queries: GTK\'s features, and no media types', () => {
    const css = `@media (prefers-color-scheme: dark) { window { border-radius: 1px; } }
        @media (prefers-contrast: more) and (prefers-color-scheme: light) { window { border-radius: 2px; } }
        @media screen { window { border-radius: 3px; } }`;
    assert.equal(read([css], {...LIGHT, dark: true}).normal.radii[0], 1);
    assert.equal(read([css], {...LIGHT, highContrast: true}).normal.radii[0], 2);
    assert.equal(read([css], LIGHT).normal.radii[0], 0);
});

test('selectors: those GTK matches to a libadwaita window apply', () => {
    for (const selector of ['window', '.csd', '*', ':root', 'window.csd', '.background.csd',
        'window.background.csd', '*.csd', 'window.csd:not(.solid-csd)', 'window:not(.maximized)',
        'window:not(:backdrop)', 'window:not(headerbar)', 'window.csd, headerbar', 'headerbar,\n  .csd'])
        assert.equal(radiiOf(`${selector} { border-radius: 7px; }`)[0], 7, selector);
});

test('selectors: :dir() follows the text direction', () => {
    const css = 'window:dir(ltr) { border-radius: 4px; } window:not(:dir(ltr)) { border-radius: 6px; }';
    assert.equal(read([css], LIGHT).normal.radii[0], 4);
    assert.equal(read([css], {...LIGHT, rtl: true}).normal.radii[0], 6);
    assert.equal(radiiOf('window:not(:not(.csd)) { border-radius: 7px; }')[0], 0, 'GTK does not nest :not()');
});

test('selectors: other nodes, other window states and unknown syntax never apply', () => {
    for (const selector of ['decoration', 'headerbar', 'window.csd.maximized', 'window.csd.tiled',
        'window.dialog', 'window.solid-csd', 'window > headerbar', 'window .csd', 'window+window',
        'window ~ window', '#main', 'window[x]', 'window.csd:hover', 'window::selection',
        ':not(.csd)', 'window:not(.csd .x)', 'window:not(window)', 'window:not(*)', 'window:backdrop',
        '.csd.ssd-frame', 'window:nth-child(1)', 'Window', '', 'window.', 'window:not()'])
        assert.equal(radiiOf(`${selector} { border-radius: 7px; }`)[0], 0, selector);
});

test('cascade: specificity and then order decide within a stylesheet', () => {
    assert.equal(radiiOf('window.csd { border-radius: 5px; } window { border-radius: 9px; }')[0], 5);
    assert.equal(radiiOf('.csd { border-radius: 5px; } window { border-radius: 9px; }')[0], 5);
    assert.equal(radiiOf('window { border-radius: 9px; } * { border-radius: 4px; }')[0], 9);
    assert.equal(radiiOf('.csd { border-radius: 5px; } .background { border-radius: 9px; }')[0], 9);
    assert.equal(radiiOf('window:not(.x) { border-radius: 5px; } window:not(headerbar) { border-radius: 9px; }')[0], 5);
});

test('cascade: a later stylesheet wins whatever its specificity, as gtk.css does', () => {
    assert.equal(radiiOf('window.csd:not(.solid-csd) { border-radius: 15px; }', '* { border-radius: 4px; }')[0], 4);
    assert.equal(radiiOf('window.csd { border-radius: 15px; }', 'headerbar { border-radius: 4px; }')[0], 15);
});

test('cascade: variables resolve across stylesheets, and are case-sensitive', () => {
    const adw = ':root { --window-radius: 15px; } window.csd { border-radius: var(--window-radius); }';
    assert.equal(radiiOf(adw, ':root { --window-radius: 8px; }')[0], 8);
    assert.equal(radiiOf(adw, 'window.csd { --window-radius: 6px; }')[0], 6);
    assert.equal(radiiOf(adw, 'window.csd.maximized { --window-radius: 0px; }')[0], 15);
    assert.equal(radiiOf(adw, ':root { --Window-Radius: 3px; }')[0], 15);
    assert.equal(radiiOf(adw, 'window { border-radius: var(--nope, 2px); }')[0], 2);
    assert.equal(radiiOf(adw, 'window { border-radius: var(--nope, var(--window-radius)); }')[0], 15);
    assert.deepEqual(lookOf(adw, ':root { --c: rgb(0 0 255); } window { outline-color: var(--nope, var(--c)); }').outlineColor, [0, 0, 1, 1]);
});

test('colors: libadwaita\'s computed accent color reaches the window, clamped when drawn', () => {
    const adw = `:root { --accent-bg-color: @accent_bg_color; --accent-color: oklab(from var(--accent-bg-color) var(--standalone)); }
        :root { --standalone: min(l, 0.5) a b; }
        @media (prefers-color-scheme: dark) { :root { --standalone: max(l, 0.85) a b; } }`;
    const sheets = [adw, '@define-color accent_bg_color #3584e4;', 'window { outline: 2px solid var(--accent-color); }'];
    const near = (got, want) => assert.ok(got.every((v, i) => Math.abs(v - want[i]) < 1e-4), `${got}`);
    near(read(sheets, LIGHT).normal.focused.outlineColor, [0.01646, 0.37937, 0.74356, 1]);
    near(read(sheets, {...LIGHT, dark: true}).normal.focused.outlineColor, [0.50431, 0.81723, 1, 1]);
    assert.equal(lookOf('window { outline: calc(1px + 2px) solid red; outline-offset: calc(-2px * 2); }').outlineWidth, 3);
});

test('@define-color: names resolve across stylesheets and media queries, as libadwaita\'s accent does', () => {
    const adw = `:root { --accent-bg-color: @accent_bg_color; }
        @define-color window_fg_color #000;
        @media (prefers-color-scheme: dark) { @define-color window_fg_color #fff; }`;
    const accent = '@define-color accent_bg_color #3584e4;';
    const user = 'window { outline: 2px solid var(--accent-bg-color); box-shadow: 0 0 2px @window_fg_color; }';
    const light = read([adw, accent, user], LIGHT).normal.focused;
    assert.deepEqual(light.outlineColor, [0x35 / 255, 0x84 / 255, 0xe4 / 255, 1]);
    assert.deepEqual(light.shadow[0].color, [0, 0, 0, 1]);
    assert.deepEqual(read([adw, accent, user], {...LIGHT, dark: true}).normal.focused.shadow[0].color, [1, 1, 1, 1]);

    const loop = '@define-color a @b; @define-color b @a; window { outline-color: #fff; outline-color: @a; }';
    assert.deepEqual(lookOf(loop).outlineColor, [1, 1, 1, 1]);
});

test('radii: one to four corners, longhands, and elliptical corners as circles', () => {
    assert.deepEqual(radiiOf('window { border-radius: 10px; }'), [10, 10, 10, 10]);
    assert.deepEqual(radiiOf('window { border-radius: 10px 0; }'), [10, 0, 10, 0]);
    assert.deepEqual(radiiOf('window { border-radius: 10px 5px 0; }'), [10, 5, 0, 5]);
    assert.deepEqual(radiiOf('window { border-radius: 20px 20px 0 0; }'), [20, 20, 0, 0]);
    assert.deepEqual(radiiOf('window { border-radius: 12px / 6px; }'), [12, 12, 12, 12]);
    assert.deepEqual(radiiOf('window { border-radius: 12px; border-bottom-left-radius: 3px 9px; }'), [12, 12, 12, 3]);
    for (const v of ['1em', '1px 2px 3px 4px 5px', '1px / 2px / 3px', '-1px', '1px /'])
        assert.deepEqual(radiiOf(`window { border-radius: 7px; border-radius: ${v}; }`), [7, 7, 7, 7], v);
});

test('outline: the shorthand resets what it omits to GTK\'s initial values, but not the offset', () => {
    const adw = '.background { color: #102030; } window.csd { outline: 1px solid RGB(255 255 255/7%); outline-offset: -1px; }';
    const user = 'window, .csd, decoration { outline: 8px solid #3584e4; outline-offset: -8px; }';
    const s = lookOf(adw, user);
    assert.equal(s.outlineWidth, 8);
    assert.equal(s.outlineOffset, -8);
    assert.deepEqual(s.outlineColor, [0x35 / 255, 0x84 / 255, 0xe4 / 255, 1]);

    for (const outline of ['3px solid', '3px solid currentColor', 'solid 3px']) {
        const t = lookOf(adw, `window { outline: ${outline}; }`);
        assert.equal(t.outlineWidth, 3, outline);
        assert.equal(t.outlineOffset, -1, outline);
        assert.deepEqual(t.outlineColor, [0x10 / 255, 0x20 / 255, 0x30 / 255, 1], outline);
    }

    assert.equal(lookOf('window { outline: 2px solid #fff; outline-width: 4px; }').outlineWidth, 4);
    assert.equal(lookOf('window { outline-width: 4px; outline: 2px solid #fff; }').outlineWidth, 2);
    assert.deepEqual(lookOf('window { outline: 2px solid red; }').outlineColor, [1, 0, 0, 1]);
});

test('outline: none, styles, and values GTK rejects', () => {
    const widthOf = css => lookOf(`window { outline: 6px solid #fff; } ${css}`).outlineWidth;
    assert.equal(widthOf('window { outline: none; }'), 0);
    assert.equal(widthOf('window { outline-style: hidden; }'), 0);
    assert.equal(widthOf('window { outline: solid #fff; }'), 0, 'GTK\'s initial width is 0');
    assert.equal(widthOf('window { outline-style: NONE; }'), 0);
    for (const v of ['-2px', '1em', 'thin', 'medium', 'thick', 'constructor', '__proto__'])
        assert.equal(widthOf(`window { outline-width: ${v}; }`), 6, v);
    for (const v of ['1px 2px solid', '1px solid solid', '1px solid #fff #000', '1px solid bogus', 'thick solid', '-1px solid'])
        assert.equal(widthOf(`window { outline: ${v}; }`), 6, v);
    assert.equal(lookOf('window { outline-offset: 3px; }').outlineOffset, 3);
});

test('backdrop: the focused rules apply unless overridden or excluded', () => {
    const css = `
        window.csd { box-shadow: 0 0 4px #000; }
        window:not(:backdrop) { outline-width: 3px; }`;
    const s = styleOf(css).normal;
    assert.deepEqual(s.backdrop.shadow, s.focused.shadow);
    assert.equal(styleOf(`${css} window.csd:backdrop { box-shadow: none; }`).normal.backdrop.shadow.length, 0);
    assert.equal(lookOf(`${css} window:backdrop { box-shadow: none; }`).shadow.length, 1);

    const outlined = styleOf('window { outline: 2px solid red; } window:backdrop { outline-color: transparent; }').normal;
    assert.deepEqual([outlined.focused.outlineWidth, outlined.focused.outlineColor], [2, [1, 0, 0, 1]]);
    assert.deepEqual([outlined.backdrop.outlineWidth, outlined.backdrop.outlineColor], [2, [0, 0, 0, 0]]);
    const excluded = styleOf(`window { outline: 1px solid red; } ${css}`).normal;
    assert.deepEqual([excluded.focused.outlineWidth, excluded.backdrop.outlineWidth], [3, 1]);
});

test('tiled and maximized: their own rules apply, and no shadow shows around a maximized window', () => {
    const css = `window.csd { border-radius: 8px; outline: 1px solid red; box-shadow: 0 0 4px #000; }
        window.csd.tiled-left { border-radius: 2px; outline-width: 2px; box-shadow: 0 0 0 1px red; }
        window.csd.maximized { border-radius: 0; outline-width: 3px; box-shadow: 0 0 9px #000; }`;
    const {normal, tiled, maximized} = styleOf(css);
    assert.deepEqual([normal.radii[0], normal.focused.outlineWidth, normal.focused.shadow[0].blur], [8, 1, 4]);
    assert.deepEqual([tiled.radii[0], tiled.focused.outlineWidth, tiled.focused.shadow], [2, 2, [{dx: 0, dy: 0, blur: 0, spread: 1, color: [1, 0, 0, 1]}]]);
    assert.deepEqual([maximized.radii[0], maximized.focused.outlineWidth, maximized.focused.shadow, maximized.backdrop.shadow], [0, 3, [], []]);
});

test('parsing keeps only what can reach the window, and parsed sheets serve every environment', () => {
    const css = `${FALLBACK_CSS}
        headerbar { border-radius: 9px; } .card > row { color: red; } @media (prefers-color-scheme: dark) { button { color: red; } }
        @define-color window_fg_color #000; window:dir(rtl) { border-radius: 3px; }`;
    const items = parseStylesheet(css);
    assert.equal(items.filter(item => !item.define).length, parseStylesheet(FALLBACK_CSS).length + 1, 'only the :dir(rtl) rule joins');
    assert.equal(items.filter(item => item.define).length, 1);
    for (const env of [LIGHT, {...LIGHT, dark: true, highContrast: true, rtl: true}, LIGHT])
        assert.deepEqual(readWindowStyle([items], env), read([css], env));
    assert.equal(readWindowStyle([items], {...LIGHT, rtl: true}).normal.radii[0], 3);
    assert.equal(readWindowStyle([items], LIGHT).normal.radii[0], 15);
});

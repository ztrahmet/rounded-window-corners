import test from 'node:test';
import assert from 'node:assert/strict';
import {FALLBACK_CSS, parseBoxShadow, readWindowStyle} from './cssParse.js';

// Stands in for Pango, which GTK asks for color names.
const PANGO = new Map([['white', [1, 1, 1, 1]], ['black', [0, 0, 0, 1]], ['red', [1, 0, 0, 1]], ['green', [0, 128 / 255, 0, 1]]]);
const colorName = name => PANGO.get(name.toLowerCase()) ?? null;
const CURRENT = [0.1, 0.2, 0.3, 1];
const names = name => name.toLowerCase() === 'currentcolor' ? CURRENT : colorName(name);

const LIGHT = {dark: false, highContrast: false, colorName};
const styleOf = (...sheets) => readWindowStyle(sheets, LIGHT);
const radiiOf = (...sheets) => styleOf(...sheets).radii;
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
    for (const dark of [false, true]) {
        assert.deepEqual(round(readWindowStyle([FALLBACK_CSS], {...LIGHT, dark})), {
            radii: [15, 15, 15, 15], outlineWidth: 1, outlineOffset: -1, outlineColor: [1, 1, 1, 0.07],
            shadow: shadow(0.05), shadowBackdrop: backdrop(0.05),
        });
        assert.deepEqual(round(readWindowStyle([FALLBACK_CSS], {...LIGHT, dark, highContrast: true})), {
            radii: [15, 15, 15, 15], outlineWidth: 1, outlineOffset: -1, outlineColor: [1, 1, 1, 0.3],
            shadow: shadow(0.8), shadowBackdrop: backdrop(0.8),
        });
    }

    // currentColor is the window's color.
    const outline = dark => readWindowStyle([FALLBACK_CSS, 'window { outline-color: currentColor; }'], {...LIGHT, dark}).outlineColor;
    assert.deepEqual(round(outline(false)), [0, 0, round(6 / 255), 0.8]);
    assert.deepEqual(outline(true), [1, 1, 1, 1]);
});

test('unreadable values are dropped, leaving the one before, as GTK does', () => {
    assert.deepEqual(radiiOf(FALLBACK_CSS, 'window { border-radius: 0 !important; }'), [15, 15, 15, 15]);
    assert.deepEqual(radiiOf('window { border-radius: 8px; border-radius: 1em; }'), [8, 8, 8, 8]);
    assert.deepEqual(radiiOf('window { border-radius: 4px; } window.csd { border-radius: 9px ! important; }'), [4, 4, 4, 4]);
    const s = styleOf(FALLBACK_CSS, 'window { outline: 2px solid red !important; box-shadow: none !important; outline: ; }');
    assert.equal(s.outlineWidth, 1);
    assert.equal(s.shadow.length, 3);
});

test('a value with var() that cannot be read is unset, as GTK does at compute time', () => {
    assert.deepEqual(radiiOf(FALLBACK_CSS, 'window { border-radius: var(--nope); }'), [0, 0, 0, 0]);
    assert.deepEqual(radiiOf(FALLBACK_CSS, 'window { border-radius: var(--window-radius) !important; }'), [0, 0, 0, 0]);
    assert.deepEqual(radiiOf(FALLBACK_CSS, ':root { --r: 1em; } window { border-radius: var(--r); }'), [0, 0, 0, 0]);
    assert.deepEqual(radiiOf(FALLBACK_CSS, ':root { --a: var(--b); --b: var(--a); } window { border-radius: var(--a); }'), [0, 0, 0, 0]);
    assert.equal(styleOf(FALLBACK_CSS, 'window { box-shadow: var(--nope); }').shadow.length, 0);
});

test('initial, inherit and unset give GTK\'s initial values', () => {
    const s = styleOf(FALLBACK_CSS, 'window { box-shadow: initial; outline: unset; border-top-left-radius: inherit; }');
    assert.deepEqual(s.shadow, []);
    assert.equal(s.outlineWidth, 0);
    assert.deepEqual(s.radii, [0, 15, 15, 15]);
    assert.deepEqual(styleOf(FALLBACK_CSS, 'window { all: initial; }').radii, [0, 0, 0, 0]);
    assert.deepEqual(styleOf(FALLBACK_CSS, 'window { all: 3px; }').radii, [15, 15, 15, 15]);
});

test('media queries: GTK\'s features, and no media types', () => {
    const css = `@media (prefers-color-scheme: dark) { window { border-radius: 1px; } }
        @media (prefers-contrast: more) and (prefers-color-scheme: light) { window { border-radius: 2px; } }
        @media screen { window { border-radius: 3px; } }`;
    assert.equal(readWindowStyle([css], {...LIGHT, dark: true}).radii[0], 1);
    assert.equal(readWindowStyle([css], {...LIGHT, highContrast: true}).radii[0], 2);
    assert.equal(readWindowStyle([css], LIGHT).radii[0], 0);
});

test('selectors: those GTK matches to a libadwaita window apply', () => {
    for (const selector of ['window', '.csd', '*', ':root', 'window.csd', '.background.csd',
        'window.background.csd', '*.csd', 'window.csd:not(.solid-csd)', 'window:not(.maximized)',
        'window:not(:backdrop)', 'window:not(headerbar)', 'window.csd, headerbar', 'headerbar,\n  .csd'])
        assert.equal(radiiOf(`${selector} { border-radius: 7px; }`)[0], 7, selector);
});

test('selectors: :dir() follows the text direction', () => {
    const css = 'window:dir(ltr) { border-radius: 4px; } window:not(:dir(ltr)) { border-radius: 6px; }';
    assert.equal(readWindowStyle([css], LIGHT).radii[0], 4);
    assert.equal(readWindowStyle([css], {...LIGHT, rtl: true}).radii[0], 6);
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
    assert.deepEqual(styleOf(adw, ':root { --c: rgb(0 0 255); } window { outline-color: var(--nope, var(--c)); }').outlineColor, [0, 0, 1, 1]);
});

test('colors: libadwaita\'s computed accent color reaches the window, clamped when drawn', () => {
    const adw = `:root { --accent-bg-color: @accent_bg_color; --accent-color: oklab(from var(--accent-bg-color) var(--standalone)); }
        :root { --standalone: min(l, 0.5) a b; }
        @media (prefers-color-scheme: dark) { :root { --standalone: max(l, 0.85) a b; } }`;
    const sheets = [adw, '@define-color accent_bg_color #3584e4;', 'window { outline: 2px solid var(--accent-color); }'];
    const near = (got, want) => assert.ok(got.every((v, i) => Math.abs(v - want[i]) < 1e-4), `${got}`);
    near(readWindowStyle(sheets, LIGHT).outlineColor, [0.01646, 0.37937, 0.74356, 1]);
    near(readWindowStyle(sheets, {...LIGHT, dark: true}).outlineColor, [0.50431, 0.81723, 1, 1]);
    assert.equal(styleOf('window { outline: calc(1px + 2px) solid red; outline-offset: calc(-2px * 2); }').outlineWidth, 3);
});

test('@define-color: names resolve across stylesheets and media queries, as libadwaita\'s accent does', () => {
    const adw = `:root { --accent-bg-color: @accent_bg_color; }
        @define-color window_fg_color #000;
        @media (prefers-color-scheme: dark) { @define-color window_fg_color #fff; }`;
    const accent = '@define-color accent_bg_color #3584e4;';
    const user = 'window { outline: 2px solid var(--accent-bg-color); box-shadow: 0 0 2px @window_fg_color; }';
    const light = readWindowStyle([adw, accent, user], LIGHT);
    assert.deepEqual(light.outlineColor, [0x35 / 255, 0x84 / 255, 0xe4 / 255, 1]);
    assert.deepEqual(light.shadow[0].color, [0, 0, 0, 1]);
    assert.deepEqual(readWindowStyle([adw, accent, user], {...LIGHT, dark: true}).shadow[0].color, [1, 1, 1, 1]);

    const loop = '@define-color a @b; @define-color b @a; window { outline-color: #fff; outline-color: @a; }';
    assert.deepEqual(styleOf(loop).outlineColor, [1, 1, 1, 1]);
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
    const s = styleOf(adw, user);
    assert.equal(s.outlineWidth, 8);
    assert.equal(s.outlineOffset, -8);
    assert.deepEqual(s.outlineColor, [0x35 / 255, 0x84 / 255, 0xe4 / 255, 1]);

    for (const outline of ['3px solid', '3px solid currentColor', 'solid 3px']) {
        const t = styleOf(adw, `window { outline: ${outline}; }`);
        assert.equal(t.outlineWidth, 3, outline);
        assert.equal(t.outlineOffset, -1, outline);
        assert.deepEqual(t.outlineColor, [0x10 / 255, 0x20 / 255, 0x30 / 255, 1], outline);
    }

    assert.equal(styleOf('window { outline: 2px solid #fff; outline-width: 4px; }').outlineWidth, 4);
    assert.equal(styleOf('window { outline-width: 4px; outline: 2px solid #fff; }').outlineWidth, 2);
    assert.deepEqual(styleOf('window { outline: 2px solid red; }').outlineColor, [1, 0, 0, 1]);
});

test('outline: none, styles, and values GTK rejects', () => {
    const widthOf = css => styleOf(`window { outline: 6px solid #fff; } ${css}`).outlineWidth;
    assert.equal(widthOf('window { outline: none; }'), 0);
    assert.equal(widthOf('window { outline-style: hidden; }'), 0);
    assert.equal(widthOf('window { outline: solid #fff; }'), 0, 'GTK\'s initial width is 0');
    assert.equal(widthOf('window { outline-style: NONE; }'), 0);
    for (const v of ['-2px', '1em', 'thin', 'medium', 'thick', 'constructor', '__proto__'])
        assert.equal(widthOf(`window { outline-width: ${v}; }`), 6, v);
    for (const v of ['1px 2px solid', '1px solid solid', '1px solid #fff #000', '1px solid bogus', 'thick solid', '-1px solid'])
        assert.equal(widthOf(`window { outline: ${v}; }`), 6, v);
    assert.equal(styleOf('window { outline-offset: 3px; }').outlineOffset, 3);
});

test('backdrop: the focused rules apply unless overridden or excluded', () => {
    const css = `
        window.csd { box-shadow: 0 0 4px #000; }
        window:not(:backdrop) { outline-width: 3px; }`;
    const s = styleOf(css);
    assert.deepEqual(s.shadowBackdrop, s.shadow);
    assert.equal(styleOf(`${css} window.csd:backdrop { box-shadow: none; }`).shadowBackdrop.length, 0);
    assert.equal(styleOf(`${css} window:backdrop { box-shadow: none; }`).shadow.length, 1);
});

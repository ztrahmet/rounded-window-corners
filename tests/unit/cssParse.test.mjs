import test from 'node:test';
import assert from 'node:assert/strict';
import {FALLBACK_CSS, parseColor, parseLength, parseBoxShadow, readWindowStyle} from './cssParse.js';

const LIGHT = {dark: false, highContrast: false};
const styleOf = (...sheets) => readWindowStyle(sheets, LIGHT);
const radiiOf = (...sheets) => styleOf(...sheets).radii;
const round = s => JSON.parse(JSON.stringify(s, (k, v) => typeof v === 'number' ? Number(v.toFixed(6)) : v));

test('lengths: px and unitless zero only', () => {
    assert.equal(parseLength('12px'), 12);
    assert.equal(parseLength('0'), 0);
    assert.equal(parseLength('-3px'), -3);
    assert.equal(parseLength('1.5px'), 1.5);
    for (const v of ['1rem', '1.5em', '50%', 'calc(12px + 1px)', '12.3.4px', 'px', '', `${'9'.repeat(400)}px`])
        assert.equal(parseLength(v), null, v);
});

test('lengths: a long digit run stays linear', () => {
    const t0 = process.hrtime.bigint();
    parseLength(`${'9'.repeat(40000)}x`);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 50, `took ${ms.toFixed(0)}ms`);
});

test('colours: the syntaxes GTK and libadwaita emit', () => {
    assert.deepEqual(parseColor('#ff0000'), [1, 0, 0, 1]);
    assert.deepEqual(parseColor('#f008'), [1, 0, 0, 0x88 / 255]);
    assert.deepEqual(parseColor('white'), [1, 1, 1, 1]);
    assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
    assert.deepEqual(parseColor('rgba(0, 0, 0, 0.2)'), [0, 0, 0, 0.2]);
    const rgb = parseColor('RGB(255 255 255/7%)');
    assert.equal(rgb[0], 1);
    assert.ok(Math.abs(rgb[3] - 0.07) < 1e-9);
    for (const v of ['currentColor', 'oklch(0.5 0.1 20)', 'hsl(210 50% 40%)', 'shade(#222, 1.2)', '@accent_color',
        'rgb(1 2 3 4 5)', 'rgba(0, 0, 0, )', '#ff0000 !important'])
        assert.equal(parseColor(v), null, v);
});

test('colours: out-of-range channels and alpha are clamped, as GTK does', () => {
    assert.deepEqual(parseColor('rgb(300, -20, 0)'), [1, 0, 0, 1]);
    assert.deepEqual(parseColor('rgba(0, 0, 0, 3)'), [0, 0, 0, 1]);
    assert.deepEqual(parseColor('rgba(0, 0, 0, -1)'), [0, 0, 0, 0]);
    assert.deepEqual(parseColor('rgb(0 0 0 / 150%)'), [0, 0, 0, 1]);
    assert.deepEqual(parseColor('color-mix(in srgb, white 200%, transparent)'), [1, 1, 1, 1]);
});

test('box-shadow: the colour may come first or last, and must be readable', () => {
    const layer = {dx: 0, dy: 4, blur: 8, spread: 0, color: [0, 0, 0, 0.2]};
    assert.deepEqual(parseBoxShadow('0 4px 8px rgba(0,0,0,0.2)'), [layer]);
    assert.deepEqual(parseBoxShadow('rgba(0,0,0,0.2) 0 4px 8px'), [layer]);
    for (const v of ['0 0 10px currentColor', '0 0 10px hsl(210 50% 40%)', '0 0 10px alpha(@theme_bg_color, 0.5)',
        '0 0 10px', '#000 0 0 #000', '0 0 1px 2px 3px #000', '0 0 4px #000 !important'])
        assert.equal(parseBoxShadow(v), null, v);
    assert.deepEqual(parseBoxShadow('none'), []);
    assert.deepEqual(parseBoxShadow('inset 0 0 4px #000'), []);
    assert.deepEqual(parseBoxShadow('0 0 4px transparent'), []);
});

test('the fallback sheet gives the values libadwaita 1.10 does', () => {
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
        assert.deepEqual(round(readWindowStyle([FALLBACK_CSS], {dark, highContrast: false})), {
            radii: [15, 15, 15, 15], outlineWidth: 1, outlineOffset: -1, outlineColor: [1, 1, 1, 0.07],
            shadow: shadow(0.05), shadowBackdrop: backdrop(0.05),
        });
        assert.deepEqual(round(readWindowStyle([FALLBACK_CSS], {dark, highContrast: true})), {
            radii: [15, 15, 15, 15], outlineWidth: 1, outlineOffset: -1, outlineColor: [1, 1, 1, 0.3],
            shadow: shadow(0.8), shadowBackdrop: backdrop(0.8),
        });
    }
});

test('unreadable values are dropped, leaving the one before, as GTK does', () => {
    assert.deepEqual(radiiOf(FALLBACK_CSS, 'window { border-radius: 0 !important; }'), [15, 15, 15, 15]);
    assert.deepEqual(radiiOf('window { border-radius: 8px; border-radius: 1em; }'), [8, 8, 8, 8]);
    assert.deepEqual(radiiOf('window { border-radius: 4px; } window.csd { border-radius: 9px ! important; }'), [4, 4, 4, 4]);
    const s = styleOf(FALLBACK_CSS, 'window { outline: 2px solid red !important; box-shadow: none !important; }');
    assert.equal(s.outlineWidth, 1);
    assert.equal(s.shadow.length, 3);
});

test('media queries: GTK\'s features, and no media types', () => {
    const css = `@media (prefers-color-scheme: dark) { window { border-radius: 1px; } }
        @media (prefers-contrast: more) and (prefers-color-scheme: light) { window { border-radius: 2px; } }
        @media screen { window { border-radius: 3px; } }`;
    assert.equal(readWindowStyle([css], {dark: true, highContrast: false}).radii[0], 1);
    assert.equal(readWindowStyle([css], {dark: false, highContrast: true}).radii[0], 2);
    assert.equal(readWindowStyle([css], LIGHT).radii[0], undefined);
});

test('selectors: those GTK matches to a libadwaita window apply', () => {
    for (const selector of ['window', '.csd', '*', ':root', 'window.csd', '.background.csd',
        'window.background.csd', '*.csd', 'window.csd:not(.solid-csd)', 'window:not(.maximized)',
        'window:not(:backdrop)', 'window:not(headerbar)', 'window.csd, headerbar', 'headerbar,\n  .csd'])
        assert.equal(radiiOf(`${selector} { border-radius: 7px; }`)[0], 7, selector);
});

test('selectors: other nodes, other window states and unknown syntax never apply', () => {
    for (const selector of ['decoration', 'headerbar', 'window.csd.maximized', 'window.csd.tiled',
        'window.dialog', 'window.solid-csd', 'window > headerbar', 'window .csd', 'window+window',
        'window ~ window', '#main', 'window[x]', 'window.csd:hover', 'window::selection',
        ':not(.csd)', 'window:not(.csd .x)', 'window:not(window)', 'window:not(*)', 'window:backdrop',
        '.csd.ssd-frame', 'window:nth-child(1)', 'Window', '', 'window.', 'window:not()'])
        assert.equal(radiiOf(`${selector} { border-radius: 7px; }`)[0], undefined, selector);
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
    assert.equal(radiiOf(adw, 'window { border-radius: var(--nope); }')[0], 15);
});

test('radii: one to four corners, longhands, and elliptical corners as circles', () => {
    assert.deepEqual(radiiOf('window { border-radius: 10px; }'), [10, 10, 10, 10]);
    assert.deepEqual(radiiOf('window { border-radius: 10px 0; }'), [10, 0, 10, 0]);
    assert.deepEqual(radiiOf('window { border-radius: 10px 5px 0; }'), [10, 5, 0, 5]);
    assert.deepEqual(radiiOf('window { border-radius: 20px 20px 0 0; }'), [20, 20, 0, 0]);
    assert.deepEqual(radiiOf('window { border-radius: 12px / 6px; }'), [12, 12, 12, 12]);
    assert.deepEqual(radiiOf('window { border-radius: 12px; border-bottom-left-radius: 3px 9px; }'), [12, 12, 12, 3]);
    for (const v of ['1em', '1px 2px 3px 4px 5px', '1px / 2px / 3px', '-1px', '1px /'])
        assert.deepEqual(radiiOf(`window { border-radius: ${v}; }`), [undefined, undefined, undefined, undefined], v);
});

test('outline: the shorthand resets what it omits, but not the offset or the colour', () => {
    const adw = 'window.csd { outline: 1px solid RGB(255 255 255/7%); outline-offset: -1px; }';
    const user = 'window, .csd, decoration { outline: 8px solid #3584e4; outline-offset: -8px; }';
    const s = styleOf(adw, user);
    assert.equal(s.outlineWidth, 8);
    assert.equal(s.outlineOffset, -8);
    assert.deepEqual(s.outlineColor, [0x35 / 255, 0x84 / 255, 0xe4 / 255, 1]);

    for (const outline of ['3px solid', '3px solid currentColor']) {
        const t = styleOf(adw, `window { outline: ${outline}; }`);
        assert.equal(t.outlineWidth, 3, outline);
        assert.equal(t.outlineOffset, -1, outline);
        assert.ok(Math.abs(t.outlineColor[3] - 0.07) < 1e-9, outline);
    }

    assert.equal(styleOf('window { outline: 2px solid #fff; outline-width: 4px; }').outlineWidth, 4);
    assert.equal(styleOf('window { outline-width: 4px; outline: 2px solid #fff; }').outlineWidth, 2);
});

test('outline: none, styles, keywords and invalid values', () => {
    const widthOf = css => styleOf(css).outlineWidth;
    assert.equal(widthOf('window { outline: none; }'), 0);
    assert.equal(widthOf('window { outline: 4px solid #fff; outline-style: hidden; }'), 0);
    assert.equal(widthOf('window { outline: solid #fff; }'), 0, 'GTK\'s initial width is 0');
    assert.equal(widthOf('window { outline: thick solid #fff; }'), 5);
    assert.equal(widthOf('window { outline-width: thin; }'), 1);
    assert.equal(widthOf('window { outline: 2px solid #fff; outline-style: NONE; }'), 0);
    for (const v of ['-2px', '1em', 'constructor', '__proto__'])
        assert.equal(widthOf(`window { outline-width: ${v}; }`), undefined, v);
    for (const v of ['1px 2px solid', '1px solid solid', '1px solid #fff #000', '1px solid bogus'])
        assert.equal(widthOf(`window { outline: ${v}; }`), undefined, v);
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

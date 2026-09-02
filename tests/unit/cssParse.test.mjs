import test from 'node:test';
import assert from 'node:assert/strict';
import {parseColor, parseLength, parseBoxShadow, readWindowStyle} from './cssParse.js';

test('lengths: px and unitless zero only', () => {
    assert.equal(parseLength('12px'), 12);
    assert.equal(parseLength('0'), 0);
    assert.equal(parseLength('-3px'), -3);
    assert.equal(parseLength('1.5px'), 1.5);
    for (const v of ['1rem', '1.5em', '50%', 'calc(12px + 1px)', '12.3.4px', 'px', ''])
        assert.equal(parseLength(v), null, `${v} should not parse`);
});

test('lengths: a long digit run stays linear', () => {
    const t0 = process.hrtime.bigint();
    parseLength(`${'9'.repeat(40000)}x`);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 50, `took ${ms.toFixed(0)}ms, pattern is backtracking again`);
});

test('colours: the syntaxes GTK and libadwaita emit', () => {
    assert.deepEqual(parseColor('#ff0000'), [1, 0, 0, 1]);
    assert.deepEqual(parseColor('white'), [1, 1, 1, 1]);
    assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
    assert.deepEqual(parseColor('rgba(0, 0, 0, 0.2)'), [0, 0, 0, 0.2]);
    const rgb = parseColor('RGB(255 255 255/7%)');
    assert.equal(rgb[0], 1);
    assert.ok(Math.abs(rgb[3] - 0.07) < 1e-9);
    for (const v of ['currentColor', 'oklch(0.5 0.1 20)', 'hsl(210 50% 40%)', 'shade(#222, 1.2)'])
        assert.equal(parseColor(v), null, `${v} should not parse`);
});

test('box-shadow: an unreadable colour invalidates the value rather than guessing black', () => {
    assert.deepEqual(parseBoxShadow('0 4px 8px rgba(0,0,0,0.2)'),
        [{dx: 0, dy: 4, blur: 8, spread: 0, color: [0, 0, 0, 0.2]}]);
    for (const v of ['0 0 10px currentColor', '0 0 10px hsl(210 50% 40%)',
        '0 0 10px alpha(@theme_bg_color, 0.5)', '0 0 10px'])
        assert.equal(parseBoxShadow(v), null, `${v} must not become opaque black`);
    assert.deepEqual(parseBoxShadow('none'), []);
    assert.deepEqual(parseBoxShadow('inset 0 0 4px #000'), []);
});

test('declarations: !important is stripped, not treated as junk', () => {
    const css = 'window.csd { border-radius: 12px !important;' +
        ' box-shadow: 0 2px 4px rgba(0,0,0,.2) !important; }';
    const s = readWindowStyle(css, {dark: false, highContrast: false});
    assert.equal(s.radius, 12);
    assert.equal(s.shadow.length, 1);
});

test('media queries pick the variant, and .maximized overrides are ignored', () => {
    const css = `
        :root { --window-radius: 15px; }
        window.csd { border-radius: var(--window-radius); outline: 1px solid RGB(255 255 255/7%); }
        @media (prefers-contrast: more) { window.csd { outline-color: RGB(255 255 255/30%); } }
        window.csd.maximized { --window-radius: 0px; }`;
    const normal = readWindowStyle(css, {dark: false, highContrast: false});
    const hc = readWindowStyle(css, {dark: false, highContrast: true});
    assert.equal(normal.radius, 15, 'the .maximized override must not win');
    assert.ok(Math.abs(normal.outlineColor[3] - 0.07) < 1e-9);
    assert.ok(Math.abs(hc.outlineColor[3] - 0.30) < 1e-9);
});

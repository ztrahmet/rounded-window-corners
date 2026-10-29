import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate, parseColor, parseLength} from './cssValues.js';

// Stands in for Pango and libadwaita's light colors.
const NAMES = new Map([
    ['white', [1, 1, 1, 1]], ['black', [0, 0, 0, 1]], ['red', [1, 0, 0, 1]], ['blue', [0, 0, 1, 1]],
    ['lime', [0, 1, 0, 1]], ['green', [0, 128 / 255, 0, 1]],
    ['@accent_bg_color', [0x35 / 255, 0x84 / 255, 0xe4 / 255, 1]], ['@window_bg_color', [0xfa / 255, 0xfa / 255, 0xfb / 255, 1]],
]);
const CURRENT = [0.1, 0.2, 0.3, 1];
const names = name => name.toLowerCase() === 'currentcolor' ? CURRENT : NAMES.get(name.toLowerCase()) ?? null;

const near = (expr, got, want, tolerance = 1e-4) =>
    assert.ok(got && got.every((v, i) => Math.abs(v - want[i]) <= tolerance), `${expr}: got ${got}, want ${want}`);

test('numbers: calc(), min(), max() and clamp() with units', () => {
    assert.deepEqual(evaluate('calc(2px + 3px * 2)'), {n: 8, unit: 'px'});
    assert.deepEqual(evaluate('calc((2px + 3px) * 2)'), {n: 10, unit: 'px'});
    assert.deepEqual(evaluate('-calc(4px / 2)'), {n: -2, unit: 'px'});
    assert.deepEqual(evaluate('max(4px, min(20px, 6px))'), {n: 6, unit: 'px'});
    assert.deepEqual(evaluate('clamp(1px, 8px, 5px)'), {n: 5, unit: 'px'});
    assert.deepEqual(evaluate('calc(0.25 * 65%)'), {n: 16.25, unit: '%'});
    assert.deepEqual(evaluate('0.5turn'), {n: 180, unit: 'deg'});
    assert.deepEqual(evaluate('calc(l * 2)', new Map([['l', 0.3]])), {n: 0.6, unit: ''});
    for (const v of ['1px + 2%', 'calc(1px * 2px)', 'calc(2 / 1px)', 'calc(1px + 1)', '1em', 'calc(x)', 'min()',
        'calc(1px', '1px 2px', '', 'clamp(1px, 2px)', '1e999px'])
        assert.equal(evaluate(v), null, v);
});

test('lengths: px, unitless zero and calc()', () => {
    assert.equal(parseLength('12px'), 12);
    assert.equal(parseLength('0'), 0);
    assert.equal(parseLength('-3px'), -3);
    assert.equal(parseLength('1.5px'), 1.5);
    assert.equal(parseLength('calc(12px + 1px)'), 13);
    for (const v of ['1rem', '1.5em', '50%', '12', '12.3.4px', 'px', '', `${'9'.repeat(400)}px`])
        assert.equal(parseLength(v), null, v);
});

test('lengths: a long digit run stays linear', () => {
    const t0 = process.hrtime.bigint();
    parseLength(`${'9'.repeat(40000)}x`);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 50, `took ${ms.toFixed(0)}ms`);
});

test('colors: hex, names, currentColor and rgb()', () => {
    assert.deepEqual(parseColor('#ff0000', names), [1, 0, 0, 1]);
    assert.deepEqual(parseColor('#f008', names), [1, 0, 0, 0x88 / 255]);
    assert.deepEqual(parseColor('transparent', names), [0, 0, 0, 0]);
    assert.deepEqual(parseColor('Green', names), [0, 128 / 255, 0, 1]);
    assert.deepEqual(parseColor('currentColor', names), CURRENT);
    assert.deepEqual(parseColor('rgba(0, 0, 0, 0.2)', names), [0, 0, 0, 0.2]);
    near('RGB(255 255 255/7%)', parseColor('RGB(255 255 255/7%)', names), [1, 1, 1, 0.07]);
    assert.deepEqual(parseColor('rgb(300, -20, 0)', names), [1, 0, 0, 1]);
    assert.deepEqual(parseColor('rgb(0 0 0 / 150%)', names), [0, 0, 0, 1]);
});

// Each as GTK 4.24 draws it, read back from its render nodes.
const GTK = [
    ['hsl(210, 50%, 40%)', [0.2, 0.4, 0.6, 1]],
    ['hsl(210 50 40 / 50%)', [0.2, 0.4, 0.6, 0.5]],
    ['hsl(3.5rad 60% 50%)', [0.2, 0.59465, 0.8, 1]],
    ['hsla(210, 50%, 40%, 0.5)', [0.2, 0.4, 0.6, 0.5]],
    ['hwb(120 20% 30%)', [0.2, 0.7, 0.2, 1]],
    ['oklab(0.6 0.1 -0.1)', [0.62547, 0.38867, 0.72747, 1]],
    ['oklab(50% 50% -20%)', [0.40483, -3.7794, 1.6164, 1]],
    ['oklch(0.7 0.15 250)', [0.29458, 0.63946, 0.96975, 1]],
    ['oklch(70% 40% 250deg / 0.8)', [0.26062, 0.63874, 0.9922, 0.8]],
    ['rgb(100% 0% 0% / 0.5)', [1, 0, 0, 0.5]],
    ['rgb(255 none 0)', [1, 0, 0, 1]],
    ['color-mix(in srgb, red 30%, blue 20%)', [0.6, 0, 0.4, 0.5]],
    ['color-mix(in srgb-linear, red, blue)', [0.73536, 0, 0.73536, 1]],
    ['color-mix(in hsl, red 25%, blue)', [0.5, 0, 1, 1]],
    ['color-mix(in hwb decreasing hue, red, lime)', [0, 0, 1, 1]],
    ['color-mix(in oklab, red, blue)', [0.55044, 0.32562, 0.6365, 1]],
    ['color-mix(in oklch, red, blue)', [0.72991, -0.33132, 0.76008, 1]],
    ['color-mix(in oklch longer hue, red 30%, blue)', [-3.21488, 0.54823, 0.58165, 1]],
    ['color-mix(in oklab, rgb(255 0 0 / 50%) 40%, #00ff0080)', [0.75303, 0.73373, 0.00175, 0.50118]],
    ['color-mix(in srgb, @accent_bg_color 60%, @window_bg_color)', [0.51686, 0.70274, 0.9302, 1]],
    ['color-mix(in srgb, currentColor calc(0.25 * 65%), transparent)', [0.1, 0.2, 0.3, 0.1625]],
    ['oklab(from @accent_bg_color min(l, 0.5) a b)', [0.01646, 0.37937, 0.74356, 1]],
    ['oklab(from @accent_bg_color max(l, 0.85) a b)', [0.50431, 0.81723, 1.21872, 1]],
    ['oklab(from #e62d42 min(l, 0.5) a b)', [0.75484, -0.15117, 0.13888, 1]],
    ['rgb(from #3584e4 calc(r * 0.5) g b)', [0.10392, 0.51765, 0.89412, 1]],
    ['rgb(from @accent_bg_color r g b / calc(alpha * 0.5))', [0.20784, 0.51765, 0.89412, 0.5]],
    ['hsl(from @accent_bg_color h s calc(l * 0.8))', [0.10394, 0.40806, 0.77763, 1]],
    ['alpha(@accent_bg_color, 0.5)', [0.20784, 0.51765, 0.89412, 0.5]],
    ['mix(@accent_bg_color, @window_bg_color, 0.3)', [0.43961, 0.65647, 0.92118, 1]],
    ['mix(rgba(255, 0, 0, 0.5), #00ff00, 0.3)', [0.53846, 0.46154, 0, 0.65]],
    ['shade(@window_bg_color, 0.7)', [0.66335, 0.66335, 0.71194, 1]],
    ['lighter(@accent_bg_color)', [0.43441, 0.68889, 0.99814, 1]],
    ['darker(@accent_bg_color)', [0.17937, 0.36564, 0.592, 1]],
];

test('colors: every syntax computes to what GTK draws', () => {
    for (const [expr, want] of GTK)
        near(expr, parseColor(expr, names), want);
});

test('colors: what GTK rejects is not read', () => {
    for (const v of ['rgb(255, 0, 0, 0.5)', 'rgba(255, 0, 0)', 'rgb(100%, 0, 0)', 'hsl(120, 50, 50)',
        'color-mix(in srgb, red 120%, blue)', 'color-mix(in srgb, red -5%, white)', 'color-mix(red, white)',
        'color-mix(in srgb shorter hue, red, blue)', 'color-mix(in srgb, red 0%, blue 0%)', 'oklab(0.5 0.1)',
        'oklab(from nosuch l a b)', 'oklch(0.5 0.1 10%)', 'hsl(120deg 50% 50% 0.5)', 'rgb(1 2 3 4)', 'rgb(1 2 3 /)',
        'alpha(red)', 'alpha(red, 50%)', 'mix(red, 0.5)', 'shade(#222)', 'lighter(red, 2)', 'rgb(none, 0, 0)',
        'shade(#222, 1.2', 'oklch(from red l c h, 1)', '#ff0000 !important', '#12345', 'nosuchcolor', '@undefined'])
        assert.equal(parseColor(v, names), null, v);
});

test('colors: as in GTK, only absolute channels and alpha are clamped', () => {
    assert.deepEqual(parseColor('rgb(0 0 0 / 3)', names), [0, 0, 0, 1]);
    assert.equal(parseColor('oklab(1.5 0 0)', names)[0], parseColor('oklab(1 0 0)', names)[0]);
    assert.ok(parseColor('rgb(from @accent_bg_color calc(r * 9) g b)', names)[0] > 1);
    assert.ok(parseColor('rgb(from #3584e4 calc(r * 9) g b)', names)[0] <= 1);
});

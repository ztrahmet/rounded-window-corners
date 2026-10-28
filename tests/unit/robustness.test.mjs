import test from 'node:test';
import assert from 'node:assert/strict';
import {readWindowStyle} from './cssParse.js';
import {compileShadow, shadowExtent} from './shadowProfile.js';

// The parser reads whatever the user put in ~/.config/gtk-4.0/gtk.css, so
// malformed input must never throw or hand the shader out-of-range values.
// Seeded, so a failure reproduces.
function random(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SELECTORS = [
    'window.csd', 'window.csd:backdrop', ':root', 'window', '*', 'window.csd.maximized', 'headerbar', '.csd',
    'window:not(.solid-csd)', 'window:not(', 'window > .csd', ':not(:backdrop)', 'window.csd, headerbar',
    'window:not(headerbar)', 'window:not(:not(.csd))',
];
const PROPERTIES = [
    'border-radius', 'border-top-left-radius', 'outline', 'outline-width', 'outline-color', 'outline-offset',
    'outline-style', 'box-shadow', '--window-radius', '--x',
];
const VALUES = [
    'var(--window-radius)', 'var(--x, 3px)', 'var(--x)', 'none', 'inset', 'solid', '!important', 'calc(1px + 2px)',
    'currentColor', '/',
    'thin', 'thick', 'hidden', 'NONE', '1px / 2px', 'constructor', '__proto__', 'toString',
    '0', '1px', '-3px', '12.5px', '1e9px', '50%', '999', 'NaN', 'Infinity',
    'rgba(0, 0, 0, 0.2)', 'rgba(0,0,0,5)', 'rgb(300 -20 0 / 150%)', 'RGB(255 255 255/7%)', '#fff', '#12345678', '#zz',
    'transparent', 'white', 'color-mix(in srgb, white 700%, transparent)', 'alpha(@x, 0.5)', ',',
];
const JUNK = ['{', '}', ':', ';', '(', ')', '"', "'", '/*', '*/', '@media', '(prefers-color-scheme: dark)', '@import'];

const inUnitRange = c => Array.isArray(c) && c.length === 4 && c.every(v => Number.isFinite(v) && v >= 0 && v <= 1);

// Mostly well-formed rules with random values, plus random stray tokens, so
// the values actually reach the code that reads them.
function stylesheet(next) {
    const pick = list => list[Math.floor(next() * list.length)];
    const parts = [];
    for (let r = 1 + Math.floor(next() * 5); r > 0; r--) {
        const declarations = [];
        for (let d = 1 + Math.floor(next() * 4); d > 0; d--) {
            const value = Array.from({length: 1 + Math.floor(next() * 5)}, () => pick(VALUES)).join(' ');
            declarations.push(`${pick(PROPERTIES)}: ${value}`);
        }
        const rule = `${pick(SELECTORS)} { ${declarations.join('; ')} }`;
        parts.push(next() < 0.2 ? `@media ${pick(['(prefers-color-scheme: dark)', '(prefers-contrast: more)'])} { ${rule} }` : rule);
        if (next() < 0.3)
            parts.push(pick(JUNK));
    }
    return parts.join(' ');
}

test('malformed stylesheets never throw and only give sane values', () => {
    const next = random(51);
    for (let i = 0; i < 3000; i++) {
        const css = stylesheet(next);
        for (const env of [{dark: false, highContrast: false}, {dark: true, highContrast: true}]) {
            const s = readWindowStyle([css, stylesheet(next)], env);
            assert.ok(s.radii.length === 4 && s.radii.every(r => r === undefined || (Number.isFinite(r) && r >= 0)), css);
            assert.ok(s.outlineWidth === undefined || (Number.isFinite(s.outlineWidth) && s.outlineWidth >= 0), css);
            assert.ok(s.outlineOffset === undefined || Number.isFinite(s.outlineOffset), css);
            assert.ok(s.outlineColor === undefined || inUnitRange(s.outlineColor), css);
            for (const layers of [s.shadow, s.shadowBackdrop]) {
                assert.ok(layers === undefined || Array.isArray(layers), css);
                for (const l of layers ?? []) {
                    assert.ok([l.dx, l.dy, l.blur, l.spread].every(Number.isFinite), css);
                    assert.ok(l.blur >= 0 && inUnitRange(l.color), css);
                }
            }
        }
    }
});

test('any parsed shadow compiles to finite uniforms with alpha in range', () => {
    const next = random(7);
    for (let i = 0; i < 3000; i++) {
        const layers = Array.from({length: Math.floor(next() * 6)}, () => ({
            dx: (next() - 0.5) * 40,
            dy: (next() - 0.5) * 40,
            blur: next() * 60,
            spread: (next() - 0.5) * 30,
            color: [next(), next(), next(), next()],
        }));
        const s = compileShadow(layers, 0.5 + next() * 2);
        for (const v of [...s.color, ...s.spread, ...s.sigma, ...s.alpha, ...s.offset])
            assert.ok(Number.isFinite(v));
        assert.ok(Number.isFinite(shadowExtent(layers)) && shadowExtent(layers) >= 0);
        assert.ok(s.sigma.every(v => v === 0 || v >= 0.35), 'the shader divides by any sigma above zero');
        assert.ok(s.alpha.every(v => v >= 0 && v <= 1));
    }
});

test('a large stylesheet still parses quickly', () => {
    const rule = `
        :root { --window-radius: 15px; }
        window.csd { border-radius: var(--window-radius); outline: 1px solid RGB(255 255 255/7%); }
        @media (prefers-color-scheme: dark) { window.csd { box-shadow: 0 1px 3px 3px transparent, 0 2px 8px 2px rgba(0,0,0,0.13); } }
        button.flat:hover:not(:disabled) { background-color: color-mix(in srgb, currentColor 7%, transparent); }
        /* a comment with { braces } and "quotes" */
        .card > row:selected label { color: #3584e4; }`;
    const css = rule.repeat(40000);
    const start = performance.now();
    const s = readWindowStyle([css], {dark: true, highContrast: false});
    const ms = performance.now() - start;
    assert.deepEqual(s.radii, [15, 15, 15, 15]);
    assert.ok(ms < 3000, `took ${ms.toFixed(0)}ms for ${(css.length / 1e6).toFixed(1)} MB`);
});

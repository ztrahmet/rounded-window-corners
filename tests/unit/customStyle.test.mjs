import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {customStyle} from './customStyle.js';

// The schema's defaults, by key as customStyle() takes them.
const xml = readFileSync(readdirSync('.').find(f => f.endsWith('.gschema.xml')), 'utf8');
const keys = [...xml.matchAll(/<key name="([\w-]+)" type="(\w)">[\s\S]*?<default>(.*?)<\/default>/g)];
const DEFAULTS = Object.fromEntries(keys.map(([, name, type, value]) => [name, type === 's' ? value.slice(1, -1) : Number(value)]));
const styleWith = values => customStyle({...DEFAULTS, ...values});
const round = v => JSON.parse(JSON.stringify(v, (k, x) => typeof x === 'number' ? Number(x.toFixed(4)) : x));

// libadwaita's light style, as cssParse.test.mjs reads it from the fallback sheet.
const OUTLINE = {outlineWidth: 1, outlineOffset: -1, outlineColor: [1, 1, 1, 0.07]};
// Tiled, square with only a line in the shadow color; maximized, nothing.
const NONE = {...OUTLINE, outlineWidth: 0};
const TILED = {...NONE, shadow: [{dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.12]}]};
const LIBADWAITA = {
    normal: {
        radii: [15, 15, 15, 15],
        focused: {
            ...OUTLINE,
            shadow: [
                {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
                {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.1]},
                {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
            ],
        },
        backdrop: {
            ...OUTLINE,
            shadow: [
                {dx: 0, dy: 0, blur: 10, spread: 5, color: [0, 0, 0, 0.08]},
                {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
            ],
        },
    },
    tiled: {radii: [0, 0, 0, 0], focused: TILED, backdrop: TILED},
    maximized: {radii: [0, 0, 0, 0], focused: {...NONE, shadow: []}, backdrop: {...NONE, shadow: []}},
};

test('the schema defaults give libadwaita\'s light style', () => {
    assert.deepEqual(round(styleWith({})), LIBADWAITA);
});

test('the radius is every corner\'s, and the outline sits inside the edge in both looks', () => {
    const {normal, tiled, maximized} = styleWith({'corner-radius': 7, 'outline-width': 3});
    assert.deepEqual([normal.radii, tiled.radii, maximized.radii], [[7, 7, 7, 7], [0, 0, 0, 0], [0, 0, 0, 0]], 'square when tiled or maximized');
    const {focused, backdrop} = normal;
    assert.deepEqual([focused.outlineWidth, focused.outlineOffset, backdrop.outlineWidth, backdrop.outlineOffset], [3, -3, 3, -3]);
});

test('the shadow moves away from where the light comes from', () => {
    const offset = angle => round(styleWith({'shadow-angle': angle, 'shadow-distance': 10}).normal.focused.shadow.map(l => [l.dx, l.dy]));
    assert.deepEqual(offset(90), [[0, 10], [0, 10], [0, 10]], 'light from above');
    assert.deepEqual(offset(0), [[-10, 0], [-10, 0], [-10, 0]], 'light from the right');
    assert.deepEqual(offset(180), [[10, 0], [10, 0], [10, 0]], 'light from the left');
});

test('blur and opacity scale libadwaita\'s layers in proportion', () => {
    const s = styleWith({'shadow-blur': 28, 'shadow-opacity': 0.3}).normal;
    assert.deepEqual(round(s.focused.shadow.map(l => [l.blur, l.color[3]])), [[28, 0.3], [10, 0.2], [0, 0.1]]);
    assert.deepEqual(round(s.backdrop.shadow.map(l => [l.blur, l.color[3]])), [[20, 0.16], [0, 0.1]]);
    const none = styleWith({'shadow-opacity': 0}).normal;
    assert.deepEqual([none.focused.shadow, none.backdrop.shadow], [[], []], 'transparent layers are left out');
});

test('colors: as drawn, and libadwaita\'s when they cannot be read', () => {
    const s = styleWith({'outline-color': 'rgba(255, 0, 0, 0.5)', 'outline-opacity': 0.5, 'shadow-color': '#203040'}).normal.focused;
    assert.deepEqual(s.outlineColor, [1, 0, 0, 0.25], 'the color\'s alpha times the opacity');
    assert.deepEqual(round(s.shadow[0].color.slice(0, 3)), round([0x20 / 255, 0x30 / 255, 0x40 / 255]));
    assert.ok(styleWith({'outline-color': 'oklch(0.9 0.4 30)'}).normal.focused.outlineColor.every(v => v >= 0 && v <= 1), 'clamped to sRGB');
    for (const unreadable of ['red', 'nosuch', '']) {
        const fallback = round(styleWith({'outline-color': unreadable, 'shadow-color': unreadable})).normal.focused;
        const {focused} = LIBADWAITA.normal;
        assert.deepEqual([fallback.outlineColor, fallback.shadow.map(l => l.color)],
            [focused.outlineColor, focused.shadow.map(l => l.color)], unreadable);
    }
});

test('tiled and maximized: no outline, and the tiled line takes the shadow\'s color and opacity but not its light', () => {
    const {tiled, maximized} = styleWith({'outline-width': 4, 'shadow-color': '#ff0000', 'shadow-opacity': 0.3, 'shadow-distance': 10, 'shadow-blur': 28});
    assert.deepEqual([tiled.focused.outlineWidth, maximized.focused.outlineWidth], [0, 0]);
    assert.deepEqual(round(tiled.focused.shadow), [{dx: 0, dy: 0, blur: 0, spread: 1, color: [1, 0, 0, 0.24]}]);
    assert.deepEqual([maximized.focused.shadow, maximized.backdrop.shadow], [[], []]);
    assert.deepEqual(styleWith({'shadow-opacity': 0}).tiled.focused.shadow, [], 'no shadow, no line');
});

test('the outline sits inside, across or outside the window\'s edge', () => {
    const offset = position => styleWith({'outline-width': 4, 'outline-position': position}).normal.focused.outlineOffset;
    assert.deepEqual(['inside', 'center', 'outside'].map(offset), [-4, -2, 0]);
});

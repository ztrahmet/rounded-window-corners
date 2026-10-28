import test from 'node:test';
import assert from 'node:assert/strict';
import {compileShadow, shadowExtent} from './shadowProfile.js';

const adwaita = [
    {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
    {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.10]},
    {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
];

test('no layers disables the shadow', () => {
    assert.equal(compileShadow([]).color[3], 0);
    assert.equal(shadowExtent([]), 0);
});

test('fully transparent layers are dropped', () => {
    const transparent = [{dx: 0, dy: 0, blur: 4, spread: 0, color: [0, 0, 0, 0]}];
    assert.equal(compileShadow(transparent).color[3], 0);
    assert.equal(shadowExtent(transparent), 0, 'nothing drawn needs no room');
});

test('libadwaita shadow compiles to usable uniforms', () => {
    const s = compileShadow(adwaita);
    assert.equal(s.color[3], 1, 'alpha is the master switch, on when enabled');
    assert.equal(s.spread.length, 4);
    assert.equal(s.sigma.length, 4);
    assert.equal(s.alpha.length, 4);
    assert.deepEqual(s.sigma.map(v => v > 0), [true, true, false, true],
        'only the unblurred layer has sigma 0');
    for (const v of [...s.spread, ...s.sigma, ...s.alpha, ...s.color, ...s.offset])
        assert.ok(Number.isFinite(v), 'no NaN or Infinity may reach the GPU');
});

test('the shadow keeps its CSS size, in actor pixels', () => {
    const one = compileShadow(adwaita);
    const two = compileShadow(adwaita, 2);
    assert.deepEqual(one.sigma.slice(0, 3), [7, 2.5, 0]);
    assert.deepEqual(one.spread.slice(0, 3), [5, 2, 1]);
    assert.deepEqual(two.sigma.slice(0, 3), [14, 5, 0], 'scaled with the actor, never fitted');
});

test('the extent covers the widest layer, offsets included', () => {
    assert.equal(shadowExtent(adwaita), 26, '5px spread + 3 sigma of a 14px blur');
    const offset = [{dx: 3, dy: 4, blur: 0, spread: 0, color: [0, 0, 0, 0.5]}];
    assert.equal(shadowExtent(offset), 5, 'an unblurred layer reaches only its offset');
});

test('more layers than the shader has slots keeps the most opaque', () => {
    const many = [
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.01]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.50]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.02]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.40]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.03]},
    ];
    const s = compileShadow(many);
    assert.equal(s.alpha.length, 4);
    assert.ok(s.alpha.includes(0.5) && s.alpha.includes(0.4),
        'the two most opaque layers must survive');
});

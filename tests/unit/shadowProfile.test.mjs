import test from 'node:test';
import assert from 'node:assert/strict';
import {compileShadow, shadowExtent} from './shadowProfile.js';

const adwaita = [
    {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
    {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.10]},
    {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
];

test('no layers draws no shadow', () => {
    assert.deepEqual(compileShadow([]).alpha, [0, 0, 0, 0]);
    assert.equal(shadowExtent([]), 0);
});

test('libadwaita\'s shadow fills three slots, as GTK sizes it', () => {
    const s = compileShadow(adwaita);
    assert.deepEqual(s.color, [0, 0, 0]);
    assert.deepEqual(s.offset, [0, 0]);
    assert.deepEqual(s.spread, [5, 2, 1, 0]);
    assert.deepEqual(s.sigma, [7, 2.5, 0, 0], 'half the blur, and 0 for the unblurred layer');
    assert.deepEqual(s.alpha, [0.15, 0.1, 0.05, 0]);
});

test('as in GTK, only a blur below 0.01 px is drawn unblurred', () => {
    const layer = blur => [{dx: 0, dy: 0, blur, spread: 0, color: [0, 0, 0, 1]}];
    assert.equal(compileShadow(layer(0.009)).sigma[0], 0);
    assert.equal(compileShadow(layer(0.01)).sigma[0], 0.005);
    assert.equal(compileShadow(layer(0.5)).sigma[0], 0.25);
});

test('the layers share a color and offset, weighted by opacity', () => {
    const s = compileShadow([
        {dx: 4, dy: 0, blur: 2, spread: 0, color: [1, 0, 0, 0.75]},
        {dx: 0, dy: 8, blur: 2, spread: 0, color: [0, 0, 1, 0.25]},
    ]);
    assert.deepEqual(s.color, [0.75, 0, 0.25]);
    assert.deepEqual(s.offset, [3, 2]);
});

test('the extent covers the widest layer, offsets included', () => {
    assert.equal(shadowExtent(adwaita), 26, '5px spread + 3 sigma of a 14px blur');
    const offset = [{dx: 3, dy: 4, blur: 0, spread: 0, color: [0, 0, 0, 0.5]}];
    assert.equal(shadowExtent(offset), 5, 'an unblurred layer reaches only its offset');
    assert.equal(shadowExtent([{dx: 0, dy: 0, blur: 0, spread: -4, color: [0, 0, 0, 1]}]), 0);
});

test('more layers than the shader has slots keeps the most opaque', () => {
    const many = [
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.01]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.50]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.02]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.40]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.03]},
    ];
    assert.deepEqual(compileShadow(many).alpha, [0.5, 0.4, 0.03, 0.02]);
});

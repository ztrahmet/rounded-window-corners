import test from 'node:test';
import assert from 'node:assert/strict';
import {SHADOW_SLOTS, compileShadow, shadowExtent} from './shadowProfile.js';

const adwaita = [
    {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
    {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.10]},
    {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
];
const empty = {shape: [0, 0, 0, 0], color: [0, 0, 0, 0]};

test('no layers fills every slot with nothing', () => {
    assert.deepEqual(compileShadow([]), Array(SHADOW_SLOTS).fill(empty));
    assert.equal(shadowExtent([]), 0);
});

test('libadwaita\'s shadow fills three slots, as GTK sizes it', () => {
    const s = compileShadow(adwaita);
    assert.deepEqual(s.slice(0, 3), [
        {shape: [0, 0, 5, 7], color: [0, 0, 0, 0.15]},
        {shape: [0, 0, 2, 2.5], color: [0, 0, 0, 0.10]},
        {shape: [0, 0, 1, 0], color: [0, 0, 0, 0.05]},
    ], 'half the blur, and 0 for the unblurred layer');
    assert.deepEqual(s.slice(3), Array(SHADOW_SLOTS - 3).fill(empty));
});

test('as in GTK, only a blur below 0.01 px is drawn unblurred', () => {
    const sigma = blur => compileShadow([{dx: 0, dy: 0, blur, spread: 0, color: [0, 0, 0, 1]}])[0].shape[3];
    assert.equal(sigma(0.009), 0);
    assert.equal(sigma(0.01), 0.005);
    assert.equal(sigma(0.5), 0.25);
});

test('each layer keeps its own offset and color, in GTK\'s order', () => {
    const s = compileShadow([
        {dx: 4, dy: 0, blur: 2, spread: 0, color: [1, 0, 0, 0.25]},
        {dx: 0, dy: 8, blur: 2, spread: -1, color: [0, 0, 1, 0.75]},
    ]);
    assert.deepEqual(s[0], {shape: [4, 0, 0, 1], color: [1, 0, 0, 0.25]});
    assert.deepEqual(s[1], {shape: [0, 8, -1, 1], color: [0, 0, 1, 0.75]});
});

test('the extent covers the widest layer, offsets included', () => {
    assert.equal(shadowExtent(adwaita), 26, '5px spread + 3 sigma of a 14px blur');
    const offset = [{dx: 3, dy: 4, blur: 0, spread: 0, color: [0, 0, 0, 0.5]}];
    assert.equal(shadowExtent(offset), 5, 'an unblurred layer reaches only its offset');
    assert.equal(shadowExtent([{dx: 0, dy: 0, blur: 0, spread: -4, color: [0, 0, 0, 1]}]), 0);
});

test('more layers than slots leaves out the faintest and keeps the order', () => {
    const alphas = [0.01, 0.5, 0.02, 0.4, 0.03, 0.3, 0.2, 0.1];
    const s = compileShadow(alphas.map(a => ({dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, a]})));
    assert.deepEqual(s.map(slot => slot.color[3]), [0.5, 0.4, 0.03, 0.3, 0.2, 0.1]);
});

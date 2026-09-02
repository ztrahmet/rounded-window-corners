import test from 'node:test';
import assert from 'node:assert/strict';
import {compileShadow} from './shadowProfile.js';

const adwaita = [
    {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
    {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.10]},
    {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
];

test('no layers, or no room to draw them, disables the shadow', () => {
    assert.equal(compileShadow([], 24).color[3], 0);
    assert.equal(compileShadow(null, 24).color[3], 0);
    assert.equal(compileShadow(adwaita, 0).color[3], 0, 'margin 0 must disable');
    assert.equal(compileShadow(adwaita, 3).color[3], 0, 'under MIN_MARGIN must disable');
});

test('fully transparent layers are dropped', () => {
    const s = compileShadow([{dx: 0, dy: 0, blur: 4, spread: 0, color: [0, 0, 0, 0]}], 24);
    assert.equal(s.color[3], 0);
});

test('libadwaita shadow compiles to usable uniforms', () => {
    const s = compileShadow(adwaita, 24);
    assert.equal(s.color[3], 1, 'alpha is the master switch, on when enabled');
    assert.equal(s.spread.length, 4);
    assert.equal(s.sigma.length, 4);
    assert.equal(s.alpha.length, 4);
    for (const v of s.sigma)
        assert.ok(v > 0, 'sigma is divided by in the shader, so never zero');
    for (const v of [...s.spread, ...s.sigma, ...s.alpha, ...s.color, ...s.offset])
        assert.ok(Number.isFinite(v), 'no NaN or Infinity may reach the GPU');
});

test('the shadow is scaled to fit the margin it has', () => {
    const roomy = compileShadow(adwaita, 100);
    const tight = compileShadow(adwaita, 6);
    const maxSigma = p => Math.max(...p.sigma);
    assert.ok(maxSigma(tight) < maxSigma(roomy), 'a small margin must compress the shadow');
    for (const v of tight.sigma)
        assert.ok(v > 0);
});

test('more layers than the shader has slots keeps the most opaque', () => {
    const many = [
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.01]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.50]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.02]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.40]},
        {dx: 0, dy: 0, blur: 2, spread: 0, color: [0, 0, 0, 0.03]},
    ];
    const s = compileShadow(many, 40);
    assert.equal(s.alpha.length, 4);
    assert.ok(s.alpha.includes(0.5) && s.alpha.includes(0.4),
        'the two most opaque layers must survive');
});

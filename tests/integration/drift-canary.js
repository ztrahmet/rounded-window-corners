// Compares the live libadwaita stylesheet against the constants that
// lib/styleResolver.js falls back to. Those constants are only a last resort,
// but they are also this project's claim about what Adwaita looks like. When
// Adwaita changes them, this fails, which is the moment to revisit them.
//
// Run with: gjs -m tests/integration/drift-canary.js

import Gio from 'gi://Gio';
import Adw from 'gi://Adw?version=1';

import {readWindowStyle} from '../../lib/cssParse.js';

// Mirrors FALLBACK and FALLBACK_HIGH_CONTRAST in lib/styleResolver.js.
const EXPECTED = {
    normal: {
        radius: 15, outlineWidth: 1, outlineColor: [1, 1, 1, 0.07],
        shadow: [
            {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
            {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.10]},
            {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
        ],
        shadowBackdrop: [
            {dx: 0, dy: 0, blur: 10, spread: 5, color: [0, 0, 0, 0.08]},
            {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.05]},
        ],
    },
    highContrast: {
        radius: 15, outlineWidth: 1, outlineColor: [1, 1, 1, 0.30],
        shadow: [
            {dx: 0, dy: 0, blur: 14, spread: 5, color: [0, 0, 0, 0.15]},
            {dx: 0, dy: 0, blur: 5, spread: 2, color: [0, 0, 0, 0.10]},
            {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.80]},
        ],
        shadowBackdrop: [
            {dx: 0, dy: 0, blur: 10, spread: 5, color: [0, 0, 0, 0.08]},
            {dx: 0, dy: 0, blur: 0, spread: 1, color: [0, 0, 0, 0.80]},
        ],
    },
};

// GI dlopens the library lazily, and it is that dlopen which registers the
// GResource holding the stylesheet.
Adw.get_major_version();
const version = `${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`;

// The path tools/adw-probe.js reads. libadwaita has reorganised these
// resources more than once, so report rather than assume.
const RESOURCE = '/org/gnome/Adwaita/styles/gtk.css';
let bytes = null;
try {
    bytes = Gio.resources_lookup_data(RESOURCE, Gio.ResourceLookupFlags.NONE);
} catch {
    const available = Gio.resources_enumerate_children(
        '/org/gnome/Adwaita/styles/', Gio.ResourceLookupFlags.NONE).join(', ');
    print(`libadwaita ${version}`);
    print(`  SKIP  ${RESOURCE} does not exist in this libadwaita.`);
    print(`        tools/adw-probe.js therefore returns nothing and the extension`);
    print(`        falls back to the constants in lib/styleResolver.js.`);
    print(`        Available here: ${available}`);
    imports.system.exit(0);
}
const css = new TextDecoder().decode(bytes.get_data());
print(`libadwaita ${version}, ${(css.length / 1024).toFixed(0)} KB`);

let failed = 0;
for (const dark of [false, true]) {
    for (const highContrast of [false, true]) {
        const got = readWindowStyle(css, {dark, highContrast});
        const want = highContrast ? EXPECTED.highContrast : EXPECTED.normal;
        const label = `dark=${dark} highContrast=${highContrast}`;
        if (JSON.stringify(got) === JSON.stringify(want)) {
            print(`  PASS  ${label}`);
        } else {
            failed++;
            print(`  FAIL  ${label}`);
            print(`        want ${JSON.stringify(want)}`);
            print(`        got  ${JSON.stringify(got)}`);
        }
    }
}
if (failed > 0)
    printerr(`${failed} environment(s) drifted from the constants in lib/styleResolver.js`);
imports.system.exit(failed === 0 ? 0 : 1);

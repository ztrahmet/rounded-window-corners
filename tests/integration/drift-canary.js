// Fails when libadwaita's window style no longer matches FALLBACK_CSS.
//
// Run with: gjs -m tests/integration/drift-canary.js

import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Adw from 'gi://Adw?version=1';

import {FALLBACK_CSS, readWindowStyle} from '../../lib/cssParse.js';

// The first call loads the library, which registers its resources.
const version = `${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`;

// The resource tools/adw-probe.js reads. libadwaita has moved it before, so report rather than fail.
const RESOURCE = '/org/gnome/Adwaita/styles/gtk.css';
let bytes;
try {
    bytes = Gio.resources_lookup_data(RESOURCE, Gio.ResourceLookupFlags.NONE);
} catch {
    const available = Gio.resources_enumerate_children(
        '/org/gnome/Adwaita/styles/', Gio.ResourceLookupFlags.NONE).join(', ');
    print(`libadwaita ${version}`);
    print(`  SKIP  ${RESOURCE} does not exist, so the extension uses FALLBACK_CSS.`);
    print(`        Available here: ${available}`);
    imports.system.exit(0);
}
const css = new TextDecoder().decode(bytes.get_data());
print(`libadwaita ${version}, ${(css.length / 1024).toFixed(0)} KB`);

function colorName(name) {
    const color = new Pango.Color();
    const [found, alpha] = color.parse_with_alpha(name);
    return found ? [color.red / 65535, color.green / 65535, color.blue / 65535, alpha / 65535] : null;
}

// currentColor gives the window's color, which then shows in the outline.
const CURRENT = 'window { outline-color: currentColor; }';

let failed = 0;
for (const dark of [false, true]) {
    for (const highContrast of [false, true]) {
        const env = {dark, highContrast, colorName};
        const got = JSON.stringify([readWindowStyle([css], env), readWindowStyle([css, CURRENT], env).outlineColor]);
        const want = JSON.stringify([readWindowStyle([FALLBACK_CSS], env), readWindowStyle([FALLBACK_CSS, CURRENT], env).outlineColor]);
        const label = `dark=${dark} highContrast=${highContrast}`;
        if (got === want) {
            print(`  PASS  ${label}`);
        } else {
            failed++;
            print(`  FAIL  ${label}`);
            print(`        want ${want}`);
            print(`        got  ${got}`);
        }
    }
}
if (failed > 0)
    printerr(`${failed} environment(s) drifted from FALLBACK_CSS in lib/cssParse.js`);
imports.system.exit(failed === 0 ? 0 : 1);

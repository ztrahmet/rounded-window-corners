// Fails when libadwaita's window style no longer matches FALLBACK_CSS in
// lib/cssParse.js.
//
// Run with: gjs -m tests/integration/drift-canary.js

import Gio from 'gi://Gio';
import Adw from 'gi://Adw?version=1';

import {FALLBACK_CSS, readWindowStyle} from '../../lib/cssParse.js';

// The first call loads the library, which registers its resources.
const version = `${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`;

// The path tools/adw-probe.js reads. libadwaita has moved its resources
// before, so report rather than assume.
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

let failed = 0;
for (const dark of [false, true]) {
    for (const highContrast of [false, true]) {
        const env = {dark, highContrast};
        const got = JSON.stringify(readWindowStyle([css], env));
        const want = JSON.stringify(readWindowStyle([FALLBACK_CSS], env));
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

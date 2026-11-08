/**
 * Process memory maps inspector for toolkit detection
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';

Gio._promisify(Gio.File.prototype, 'load_contents_async');

// Each toolkit and a file its apps load; the more specific first, as many apps load others' too.
export const TOOLKITS = [
    ['libadwaita', /libadwaita-1\.so/],
    ['libhandy', /libhandy-1\.so/],
    ['chromium', /_100_percent\.pak/],
    ['firefox', /libxul\.so/],
    ['java', /libjvm\.so/],
    ['qt', /libQt[56]Gui\.so/],
    ['gtk4', /libgtk-4\.so/],
    ['gtk3', /libgtk-3\.so/],
];

/**
 * Finds the toolkit a window's app is built with.
 *
 * @param {Meta.Window} win
 * @returns {Promise<?string>} One of the toolkits above, or null.
 */
export async function windowToolkit(win) {
    try {
        const file = Gio.File.new_for_path(`/proc/${win.get_pid()}/maps`);
        const [bytes] = await file.load_contents_async(null);
        const maps = new TextDecoder().decode(bytes);
        return TOOLKITS.find(([, marker]) => marker.test(maps))?.[0] ?? null;
    } catch {
        // The process is unknown, gone, or not ours to read.
        return null;
    }
}

/**
 * Process memory maps inspector for toolkit detection
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';

Gio._promisify(Gio.File.prototype, 'load_contents_async');

// Libraries that round their apps' windows themselves.
const TOOLKITS = ['libadwaita', 'libhandy'];

/**
 * Finds which of the libraries that round windows a window's process has loaded.
 *
 * @param {Meta.Window} win
 * @returns {Promise<?string>} 'libadwaita', 'libhandy' or null.
 */
export async function windowToolkit(win) {
    try {
        const file = Gio.File.new_for_path(`/proc/${win.get_pid()}/maps`);
        const [bytes] = await file.load_contents_async(null);
        const maps = new TextDecoder().decode(bytes);
        return TOOLKITS.find(name => maps.includes(`${name}-1.so`)) ?? null;
    } catch {
        // The process is unknown, gone, or not ours to read.
        return null;
    }
}

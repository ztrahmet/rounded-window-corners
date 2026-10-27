/**
 * Process memory maps inspector for toolkit detection
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';

Gio._promisify(Gio.File.prototype, 'load_contents_async');

/**
 * Checks whether a window's process has libadwaita loaded.
 *
 * @param {Meta.Window} win
 * @returns {Promise<boolean>}
 */
export async function usesLibadwaita(win) {
    try {
        const file = Gio.File.new_for_path(`/proc/${win.get_pid()}/maps`);
        const [bytes] = await file.load_contents_async(null);
        return new TextDecoder().decode(bytes).includes('libadwaita-1.so');
    } catch {
        // The process is unknown, gone, or not ours to read.
        return false;
    }
}

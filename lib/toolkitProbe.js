/**
 * Process memory maps inspector for toolkit detection
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Gio from 'gi://Gio';

const cache = new WeakMap();

/**
 * Checks whether a window client process links to libadwaita.
 *
 * @param {Meta.Window} win
 * @returns {Promise<boolean>}
 */
export async function usesLibadwaita(win) {
    const cached = cache.get(win);
    if (cached !== undefined)
        return cached;

    let result = false;
    const pid = win.get_pid();
    if (pid > 0) {
        try {
            const file = Gio.File.new_for_path(`/proc/${pid}/maps`);
            const [bytes] = await file.load_contents_async(null);
            result = new TextDecoder().decode(bytes).includes('libadwaita-1.so');
        } catch {
            result = false;
        }
    }

    cache.set(win, result);
    return result;
}

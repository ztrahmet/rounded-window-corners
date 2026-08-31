/**
 * Works out whether a window is already rounded by its own toolkit.
 *
 * libadwaita apps draw libadwaita's corners, outline and shadow themselves, so
 * touching them would at best duplicate work and at worst make them look
 * different from every other Adwaita app. Everything else is ours to fix: GTK3,
 * libhandy, bare GTK4 (which rounds only its top corners), Qt, Electron, Java
 * and terminals.
 *
 * The only reliable signal available to the compositor is which libraries the
 * client process has mapped. It is read once per window, off the main loop, and
 * cached.
 */

import Gio from 'gi://Gio';

/**
 * GJS hands out a stable wrapper per GObject, so a weak map keyed by the window
 * both caches correctly and lets entries go when the window does.
 */
const cache = new WeakMap();

/**
 * @param {object} win - A Meta.Window.
 * @returns {Promise<boolean>} Whether the client links libadwaita. Processes we
 *     cannot read, such as root-owned apps and some sandboxes, report false and
 *     so get rounded, which is the right default for an unidentified toolkit.
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
            // Not readable, or the process exited while we asked.
            result = false;
        }
    }

    cache.set(win, result);
    return result;
}

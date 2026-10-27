/**
 * Extension entry point
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {WindowTracker} from './lib/windowTracker.js';

export default class RoundedWindowCornersExtension extends Extension {
    enable() {
        this._tracker = new WindowTracker(this.path);
    }

    disable() {
        this._tracker.destroy();
        this._tracker = null;
    }
}

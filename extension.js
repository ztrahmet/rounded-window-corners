/**
 * Extension entry point
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {preloadShader} from './lib/roundedCornersEffect.js';
import {StyleResolver} from './lib/styleResolver.js';
import {WindowTracker} from './lib/windowTracker.js';

export default class RoundedWindowCornersExtension extends Extension {
    enable() {
        this._startupId = 0;
        this._styles = new StyleResolver(this.path, () => this._tracker?.refreshAll());
        this._tracker = new WindowTracker(this._styles);

        preloadShader().then(() => this._startTracking());
    }

    _startTracking() {
        if (!this._tracker)
            return;

        if (Main.layoutManager._startingUp) {
            if (this._startupId)
                return;

            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startupId);
                this._startupId = 0;
                this._tracker?.enable();
            });
        } else {
            this._tracker.enable();
        }
    }

    disable() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }

        this._tracker?.destroy();
        this._tracker = null;

        this._styles?.destroy();
        this._styles = null;
    }
}

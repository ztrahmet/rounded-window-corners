/**
 * Rounded Window Corners Native
 *
 * Gives every window that its toolkit left square the same corners, hairline
 * outline and drop shadow that libadwaita apps already have, taking all of
 * those values from the live GTK/Adwaita theme rather than from settings.
 *
 * There is nothing to configure and nothing of GNOME Shell is patched: the
 * whole effect is one GLSL effect per window, which the shell's own clones
 * reproduce wherever a window is drawn.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {invalidateShaderCache} from './lib/roundedCornersEffect.js';
import {StyleResolver} from './lib/styleResolver.js';
import {WindowTracker} from './lib/windowTracker.js';

export default class RoundedWindowCornersExtension extends Extension {
    enable() {
        this._startupId = 0;
        this._styles = new StyleResolver(this.path, () => this._tracker?.refreshAll());
        this._tracker = new WindowTracker(this._styles);

        // Windows that exist during startup do not have usable geometry yet.
        if (Main.layoutManager._startingUp) {
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

        invalidateShaderCache();
    }
}

/**
 * Rounded corners Clutter shader effect
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

let shaderSource = null;

/**
 * Preloads and parses the fragment shader.
 */
export async function preloadShader() {
    if (shaderSource)
        return;

    const [path] = GLib.filename_from_uri(import.meta.url);
    const file = Gio.File.new_for_path(GLib.build_filenamev([
        GLib.path_get_dirname(path), '..', 'shaders', 'rounded.frag',
    ]));

    const [bytes] = await file.load_contents_async(null);
    const text = new TextDecoder().decode(bytes);

    const opening = /void\s+main\s*\(\s*\)\s*\{/.exec(text);
    if (!opening)
        throw new Error('rounded.frag has no main()');

    const declarations = text.slice(0, opening.index);
    const rest = text.slice(opening.index + opening[0].length);
    const body = rest.slice(0, rest.lastIndexOf('}'));

    shaderSource = [declarations, body];
}

export const RoundedCornersEffect = GObject.registerClass(
class RoundedCornersEffect extends Clutter.ShaderEffect {
    constructor() {
        if (!shaderSource)
            throw new Error('Shader was not preloaded');

        super();

        this._mappingDirty = true;
        this._fboWidth = -1;
        this._fboHeight = -1;
    }

    vfunc_get_static_snippet() {
        const [declarations, body] = shaderSource;
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, declarations, body);
    }

    vfunc_paint_target(node, paintContext) {
        const [known, width, height] = this.get_target_size();
        if (this._mappingDirty || width !== this._fboWidth || height !== this._fboHeight) {
            this._syncFramebufferMapping(known, width, height);
            this._fboWidth = width;
            this._fboHeight = height;
            this._mappingDirty = false;
        }

        super.vfunc_paint_target(node, paintContext);
    }

    // Maps offscreen framebuffer coordinate space to actor-local pixels.
    _syncFramebufferMapping(known, targetWidth, targetHeight) {
        const actor = this.get_actor();
        if (!actor)
            return;

        let originX = 0;
        let originY = 0;
        let rawWidth = actor.width;
        let rawHeight = actor.height;

        const volume = actor.get_paint_volume();
        if (volume) {
            const origin = volume.get_origin();
            originX = origin.x;
            originY = origin.y;
            rawWidth = volume.get_width();
            rawHeight = volume.get_height();
        }

        const resourceScale = actor.get_resource_scale();
        const scale = Number.isFinite(resourceScale)
            ? Math.max(Math.ceil(resourceScale), 1)
            : 1;

        const spanX = known ? targetWidth / scale : Math.round(rawWidth) + 3;
        const spanY = known ? targetHeight / scale : Math.round(rawHeight) + 3;

        const left = Math.ceil(originX + rawWidth + 0.75) - spanX;
        const top = Math.ceil(originY + rawHeight + 0.75) - spanY;

        this.set_uniform_float('fboMap', 4, [left, top, spanX, spanY]);
    }

    /**
     * Updates shader uniforms for window geometry, border styling, and shadows.
     *
     * @param {number[]} bounds - Frame bounds in actor pixels [x1, y1, x2, y2].
     * @param {number} radius - Corner radius in actor pixels.
     * @param {number} outlineWidth - Hairline outline width in actor pixels.
     * @param {number[]} outlineColor - Outline color RGBA [r, g, b, a].
     * @param {object} shadow - Compiled shadow profile.
     */
    update(bounds, radius, outlineWidth, outlineColor, shadow) {
        this._mappingDirty = true;

        this.set_uniform_float('bounds', 4, bounds);
        this.set_uniform_float('metrics', 4,
            [radius, outlineWidth, shadow.offset[0], shadow.offset[1]]);
        this.set_uniform_float('outlineColor', 4, outlineColor);
        this.set_uniform_float('shadowColor', 4, shadow.color);
        this.set_uniform_float('shadowSpread', 4, shadow.spread);
        this.set_uniform_float('shadowSigma', 4, shadow.sigma);
        this.set_uniform_float('shadowAlpha', 4, shadow.alpha);
    }
});

/** @file Binds shaders/rounded.frag to a window actor. */

import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

/** Every uniform in the shader, in no particular order. */
const UNIFORMS = [
    'bounds',
    'radius',
    'fboOrigin',
    'fboSpan',
    'outlineWidth',
    'outlineColor',
    'shadowColor',
    'shadowSpread',
    'shadowSigma',
    'shadowAlpha',
    'shadowOffset',
];

// Both of these survive a disable, which happens on every screen lock. The
// shader text never changes, and the uniform locations belong to the effect
// class, registered once when this module is first imported and alive for as
// long as the shell process. Clearing them bought nothing and meant rereading
// the shader on every unlock.
let shaderSource = null;
let uniformLocations = null;

/**
 * Read the shader and split it the way `add_glsl_snippet` wants it: everything
 * before `main` as declarations, the body of `main` as the snippet itself.
 *
 * Called once from enable() so that the read is off the compositor thread. By
 * the time any window can be given an effect the result is cached, which is
 * what lets `vfunc_build_pipeline` stay synchronous without touching the disk.
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
class RoundedCornersEffect extends Shell.GLSLEffect {
    constructor() {
        super();

        // Set whenever the texture-to-actor mapping may have gone stale. Paint
        // does nothing while this is false, which is the overwhelming majority
        // of frames.
        this._mappingDirty = true;
        this._mappingFailed = false;
        this._fboWidth = -1;
        this._fboHeight = -1;

        // Uniform locations depend only on the shader, which every instance
        // shares, so they are looked up once. The lookup is not cheap and would
        // otherwise happen on every window.
        if (!uniformLocations) {
            uniformLocations = {};
            for (const name of UNIFORMS)
                uniformLocations[name] = this.get_uniform_location(name);
        }
    }

    vfunc_build_pipeline() {
        if (!shaderSource)
            throw new Error('shader was not preloaded');
        const [declarations, body] = shaderSource;
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, declarations, body, false);
    }

    vfunc_paint_target(node, paintContext) {
        // Nothing in here may stop the chain-up at the end: skipping that would
        // leave the window unpainted, which looks like the app failed to open.
        // A failure is also latched, so a persistent one cannot flood the
        // journal at the frame rate.
        if (!this._mappingFailed) {
            try {
                // The framebuffer can be recreated underneath us at any time,
                // and its size is the one reliable signal that the mapping
                // changed. Querying it is a single cheap call; deriving the
                // mapping is not, so that only happens when something moved.
                const [known, width, height] = this.get_target_size();
                if (this._mappingDirty ||
                    width !== this._fboWidth || height !== this._fboHeight) {
                    // Overview previews are drawn scaled down from this texture
                    // and come out blocky without linear filtering. The pipeline
                    // is recreated with the texture, so this belongs here too.
                    this.get_pipeline()?.set_layer_filters(
                        0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
                    this._syncFramebufferMapping(known, width, height);
                    this._fboWidth = width;
                    this._fboHeight = height;
                    this._mappingDirty = false;
                }
            } catch (error) {
                this._mappingFailed = true;
                logError(error, 'rounded-window-corners: framebuffer mapping');
            }
        }

        super.vfunc_paint_target(node, paintContext);
    }

    /**
     * Tell the shader where its offscreen texture sits in actor coordinates.
     *
     * ClutterOffscreenEffect does not render the actor into a texture of the
     * actor's size. It takes the actor's paint volume, enlarges it for effects
     * (`_clutter_actor_box_enlarge_for_effects` in clutter-actor-box.c rounds
     * the size and pads it by 3px), scales that by the ceiled resource scale,
     * and rounds up. Treating the texture as if it spanned exactly the actor,
     * which is what the reference extensions do, misplaces every sampled pixel
     * and shrinks the visible corner radius by several pixels.
     *
     * The span comes from the public `get_target_size()`, and the origin is
     * derived from that span, so a change to the padding is followed rather
     * than assumed. What is left reproduced here is the rounding of the bottom
     * right corner, which degrades to a sub-pixel error rather than a failure.
     */
    _syncFramebufferMapping(known, targetWidth, targetHeight) {
        const actor = this.get_actor();
        if (!actor || !uniformLocations)
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

        // The enlarged box is an integer size and the texture is that size
        // times an integer scale, so dividing the texture back down measures
        // the box instead of assuming it. Reproducing the padding is only the
        // fallback for when the texture size is not available yet.
        const spanX = known ? targetWidth / scale : Math.round(rawWidth) + 3;
        const spanY = known ? targetHeight / scale : Math.round(rawHeight) + 3;

        // The enlargement defines the top left relative to a rounded-up bottom
        // right, so that the size stays stable as the actor moves sub-pixel.
        // Deriving it from the measured span means a change to Clutter's
        // padding carries the origin with it rather than shifting every pixel.
        const left = Math.ceil(originX + rawWidth + 0.75) - spanX;
        const top = Math.ceil(originY + rawHeight + 0.75) - spanY;

        const at = uniformLocations;
        this.set_uniform_float(at.fboOrigin, 2, [left, top]);
        this.set_uniform_float(at.fboSpan, 2, [spanX, spanY]);
    }

    /**
     * Push a complete set of uniforms. Called when a window's geometry, focus
     * or theme changes, not per frame.
     *
     * @param {number[]} bounds - Frame rect within the actor, in actor pixels.
     * @param {number} radius - Corner radius in actor pixels.
     * @param {number} outlineWidth - Inset hairline width in actor pixels.
     * @param {number[]} outlineColor - Straight RGBA, 0..1.
     * @param {object} shadow - Compiled shadow, from lib/shadowProfile.js.
     */
    update(bounds, radius, outlineWidth, outlineColor, shadow) {
        const at = uniformLocations;
        if (!at)
            return;

        // A geometry change can move the mapping without resizing the
        // framebuffer, so re-derive it on the next paint.
        this._mappingDirty = true;

        this.set_uniform_float(at.bounds, 4, bounds);
        this.set_uniform_float(at.radius, 1, [radius]);
        this.set_uniform_float(at.outlineWidth, 1, [outlineWidth]);
        this.set_uniform_float(at.outlineColor, 4, outlineColor);
        this.set_uniform_float(at.shadowColor, 4, shadow.color);
        this.set_uniform_float(at.shadowSpread, 4, shadow.spread);
        this.set_uniform_float(at.shadowSigma, 4, shadow.sigma);
        this.set_uniform_float(at.shadowAlpha, 4, shadow.alpha);
        this.set_uniform_float(at.shadowOffset, 2, shadow.offset);
        this.queue_repaint();
    }
});

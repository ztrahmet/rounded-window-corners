// Evaluated inside the shell by run.sh. gdbus reads it as a GVariant string, so no backslash escapes.
const UUID = 'rounded-window-corners@ztrahmet.github.io';
const NAME = 'rounded-window-corners';

const rwcTest = {
    tracker: () => Main.extensionManager.lookup(UUID).stateObj._tracker,
    // sharp-windows removed
    // effect: actor => actor.get_effect(NAME),
    // sharp-windows start: the effect drawing the window.
    effect: actor => [actor.get_effect(`${NAME}-sharp`), actor.get_effect(NAME)].find(e => e?.enabled) ??
        actor.get_effect(NAME),
    // sharp-windows end
    ours: actor => actor.get_effects().filter(e => e.get_name().startsWith(NAME)).length,
    rounded: actor => actor.get_effects().filter(e => e.get_name().startsWith(NAME) && e.enabled).length === 2,
    isX11: actor => actor.metaWindow.get_client_type() === Meta.WindowClientType.X11,
    isAdwaita: actor => /adwaita/i.test(actor.metaWindow.get_wm_class() || ''),

    shouldRound(actor) {
        const win = actor.metaWindow;
        return win.get_window_type() === Meta.WindowType.NORMAL && !rwcTest.isAdwaita(actor) &&
            !win.maximizedHorizontally && !win.maximizedVertically && !win.fullscreen;
    },

    // Records what each effect was last given, to compare with its window.
    spy(effect) {
        const proto = Object.getPrototypeOf(effect);
        if (proto.rwcSpied)
            return;
        const update = proto.update;
        proto.update = function (...args) {
            this.rwcArgs = args;
            return update.apply(this, args);
        };
        proto.rwcSpied = true;
    },

    // Empty when the effect's bounds match the window frame inside its buffer.
    boundsError(actor) {
        const effect = rwcTest.effect(actor);
        if (!effect || !effect.rwcArgs)
            return 'no recorded update';

        const win = actor.metaWindow;
        const f = win.get_frame_rect();
        const b = win.get_buffer_rect();
        const want = [f.x - b.x, f.y - b.y, f.x - b.x + f.width, f.y - b.y + f.height];
        const got = effect.rwcArgs[0];
        if (want.every((v, i) => Math.abs(v - got[i]) < 0.5))
            return '';
        return `${got.map(Math.round)} for ${want.map(Math.round)}`;
    },

    // The shell serves DisplayConfig itself, so the calls must not block.
    setScale(scale) {
        const {Gio, GLib} = imports.gi;
        const call = (method, params, done) => Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig',
            '/org/gnome/Mutter/DisplayConfig', 'org.gnome.Mutter.DisplayConfig', method, params, null, 0, -1, null,
            (bus, res) => done?.(bus.call_finish(res).deepUnpack()));
        call('GetCurrentState', null, ([serial, monitors]) => {
            const [[connector], modes] = monitors[0];
            const mode = modes.find(m => 'is-current' in m[6]);
            const supported = mode[5].find(s => Math.abs(s - scale) < 0.01);
            call('ApplyMonitorsConfig', new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
                [serial, 1, [[0, 0, supported, 0, true, [[connector, mode[0], {}]]]], {}]), null);
        });
    },

    // Stores a pixbuf of the top-left of the stage, or the error, in rwcTest.shot.
    capture() {
        const {Clutter, Gio, Mtk, Shell} = imports.gi;
        rwcTest.shot = null;
        rwcTest.shotScale = global.display.get_monitor_scale(0);
        const content = global.stage.paint_to_content(new Mtk.Rectangle({x: 0, y: 0, width: 500, height: 400}),
            rwcTest.shotScale, null, Clutter.PaintFlag.NO_CURSORS);
        Shell.Screenshot.composite_to_stream(content.get_texture(), 0, 0, -1, -1, 1, null, 0, 0, 1,
            Gio.MemoryOutputStream.new_resizable(), (o, res) => {
                try {
                    rwcTest.shot = Shell.Screenshot.composite_to_stream_finish(res);
                } catch (e) {
                    rwcTest.shot = e;
                }
            });
    },

    // Worst (R - G) / 255 of the app's red border at the edges and bottom corners.
    borderShowing(actor) {
        const pixel = rwcTest.pixels();
        if (typeof pixel === 'string')
            return pixel;

        const s = rwcTest.shotScale;
        const f = actor.metaWindow.get_frame_rect();
        let worst = 0;
        const look = (x0, y0, w, h) => {
            for (let y = y0; y < y0 + h; y++) {
                for (let x = x0; x < x0 + w; x++) {
                    const [r, g, b] = pixel(x, y);
                    if (r + b > 127)
                        worst = Math.max(worst, (r - g) / 255);
                }
            }
        };
        const left = Math.floor(f.x * s);
        const right = Math.floor((f.x + f.width) * s);
        const bottom = Math.floor((f.y + f.height) * s);
        const corner = Math.ceil(20 * s);
        look(left - 3, Math.round((f.y + f.height / 2) * s), 9, 1);
        look(right - 5, Math.round((f.y + f.height / 2) * s), 9, 1);
        look(Math.round((f.x + f.width / 2) * s), bottom - 6, 1, 9);
        look(left - 2, bottom - corner, corner, corner + 2);
        look(right - corner + 2, bottom - corner, corner, corner + 2);
        return worst.toFixed(2);
    },

    // 'ok' when the capture shows the window's blue as the app draws it, which borderShowing() relies on.
    trueColors(actor) {
        const pixel = rwcTest.pixels();
        if (typeof pixel === 'string')
            return pixel;

        const s = rwcTest.shotScale;
        const f = actor.metaWindow.get_frame_rect();
        const [r, g, b] = pixel(Math.round((f.x + f.width / 2) * s), Math.round((f.y + f.height / 2) * s));
        return r < 16 && g < 16 && b > 239 ? 'ok' : `${r},${g},${b}`;
    },

    // How much the shadow darkens the background 1 to 12 px left of the window.
    shadowShowing(actor) {
        const pixel = rwcTest.pixels();
        if (typeof pixel === 'string')
            return pixel;

        const s = rwcTest.shotScale;
        const f = actor.metaWindow.get_frame_rect();
        const y = Math.round((f.y + f.height / 2) * s);
        const light = x => pixel(Math.floor(x * s), y).reduce((sum, v) => sum + v, 0);
        const far = light(f.x - 45);
        return Array.from({length: 12}, (_, i) => ((far - light(f.x - 1 - i)) / far).toFixed(3)).join();
    },

    // The last capture as pixel(x, y) => [r, g, b], or why there is none.
    pixels() {
        const shot = rwcTest.shot;
        if (shot === null)
            return 'pending';
        if (!(shot instanceof imports.gi.GdkPixbuf.Pixbuf))
            return 'unsupported';
        const data = shot.read_pixel_bytes().toArray();
        const stride = shot.get_rowstride();
        const channels = shot.get_n_channels();
        return (x, y) => {
            const i = y * stride + x * channels;
            return [data[i], data[i + 1], data[i + 2]];
        };
    },

    // sharp-windows start
    // Whether the effect has painted, into a buffer that holds the whole paint volume. Clutter's offscreen effect
    // pads it by 3 pixels, which the shader relies on.
    buffered(actor) {
        const effect = rwcTest.effect(actor);
        const volume = actor.get_paint_volume();
        if (effect instanceof imports.gi.Clutter.OffscreenEffect) {
            const [painted, width, height] = effect.get_target_size();
            const scale = actor.get_resource_scale();
            return painted && width === (Math.round(volume.get_width()) + 3) * scale &&
                height === (Math.round(volume.get_height()) + 3) * scale;
        }
        const place = effect._buffers[0]?.place;
        return !!place && place.width >= Math.ceil(volume.get_width() * place.densityX) &&
            place.height >= Math.ceil(volume.get_height() * place.densityY);
    },

    // Empty when the effect handles the monitor's scale: Clutter's offscreen effect smears at fractional scales,
    // the sharp effect buffers the window at the monitor's scale.
    followsScale(actor) {
        const effect = rwcTest.effect(actor);
        const scale = global.display.get_monitor_scale(0);
        if (effect instanceof imports.gi.Clutter.OffscreenEffect) {
            const want = scale % 1 === 0 ? 0 : 1;
            return effect._smear === want ? '' : `smear ${effect._smear} at ${scale}`;
        }
        const density = effect._buffers[0]?.place?.densityX;
        return Math.abs(density - scale) < 1e-3 ? '' : `buffered at ${density} for ${scale}`;
    },

    // Scales an actor over 400 ms, frame by frame, even where the Shell turns its animations off.
    animateScale(actor, from, to) {
        const timeline = new imports.gi.Clutter.Timeline({actor, duration: 400});
        timeline.connect('new-frame', () => {
            const scale = from + (to - from) * timeline.get_progress();
            actor.set_scale(scale, scale);
        });
        timeline.connect('completed', () => actor.set_scale(to, to));
        // Held, so it isn't collected while it runs.
        rwcTest.timeline = timeline;
        timeline.start();
    },

    // Slides a clone of an actor by dx over 400 ms, as the overview slides its window previews.
    slideClone(actor, dx) {
        const {Clutter} = imports.gi;
        const clone = new Clutter.Clone({source: actor, x: 1000, y: 100});
        global.stage.add_child(clone);
        const timeline = new Clutter.Timeline({actor: clone, duration: 400});
        timeline.connect('new-frame', () => clone.set_translation(dx * timeline.get_progress(), 0, 0));
        timeline.connect('completed', () => clone.set_translation(dx, 0, 0));
        rwcTest.clone = clone;
        rwcTest.timeline = timeline;
        timeline.start();
    },

    // Counts what the sharp effect does from now on: buffers made, buffers moved to another place, draws scaled from
    // another density, and those scaled up from a less sharp one.
    countBuffers(actor) {
        const proto = Object.getPrototypeOf(actor.get_effect(`${NAME}-sharp`));
        rwcTest.newBuffers = 0;
        rwcTest.placed = 0;
        rwcTest.scaledDraws = 0;
        rwcTest.upscaledDraws = 0;
        if (proto.rwcCounted)
            return;
        const newBuffer = proto._newBuffer;
        const place = proto._place;
        const draw = proto._draw;
        proto._newBuffer = function () {
            rwcTest.newBuffers++;
            return newBuffer.call(this);
        };
        proto._place = function (buffer, where) {
            rwcTest.placed++;
            return place.call(this, buffer, where);
        };
        proto._draw = function (node, buffer, texelScale, smear) {
            if (texelScale !== buffer.place.texelScale)
                rwcTest.scaledDraws++;
            if (texelScale > buffer.place.texelScale + 1e-3)
                rwcTest.upscaledDraws++;
            return draw.call(this, node, buffer, texelScale, smear);
        };
        proto.rwcCounted = true;
    },
    // sharp-windows end

    // The room must come just before the effect, or its framebuffer lacks it.
    roomError(actor) {
        const names = actor.get_effects().map(e => e.get_name());
        return names.indexOf(NAME) === names.indexOf(`${NAME}-room`) + 1 ? '' : `effects ${names}`;
    },

    // The least room the window's paint box leaves past its frame.
    room(actor) {
        const f = actor.metaWindow.get_frame_rect();
        const [ok, b] = actor.get_paint_box();
        if (!ok)
            return -1;
        return Math.round(Math.min(f.x - b.x1, f.y - b.y1, b.x2 - f.x - f.width, b.y2 - f.y - f.height));
    },

    // Checks every window against what the extension should be doing to it.
    audit() {
        const actors = global.get_window_actors();
        const problems = [];
        for (const actor of actors) {
            const name = actor.metaWindow.get_wm_class() || '?';
            if (actor.get_children().some(rwcTest.ours)) {
                problems.push(`${name} has the effect on a child`);
            } else if (!rwcTest.shouldRound(actor)) {
                if (rwcTest.rounded(actor))
                    problems.push(`${name} should not be rounded`);
            } else if (!rwcTest.rounded(actor)) {
                problems.push(`${name} is not rounded`);
            } else if (rwcTest.roomError(actor)) {
                problems.push(`${name} ${rwcTest.roomError(actor)}`);
            } else {
                const error = rwcTest.boundsError(actor);
                if (error)
                    problems.push(`${name} bounds ${error}`);
            }
        }
        // libadwaita windows are tracked too, so their switch applies live.
        const tracked = rwcTest.tracker()._windows.size;
        if (tracked !== actors.length)
            problems.push(`tracker holds ${tracked} windows for ${actors.length}`);
        return problems.join('; ') || 'ok';
    },
};
globalThis.rwcTest = rwcTest;

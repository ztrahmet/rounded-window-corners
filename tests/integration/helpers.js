// Evaluated inside the shell by run.sh. gdbus reads it as a GVariant string, so no backslash escapes.
const UUID = 'rounded-window-corners@ztrahmet.github.io';
const NAME = 'rounded-window-corners';

const rwcTest = {
    tracker: () => Main.extensionManager.lookup(UUID).stateObj._tracker,
    effect: actor => actor.get_effect(NAME),
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
        const tracked = rwcTest.tracker()._windows.size;
        const roundable = actors.filter(a => !rwcTest.isAdwaita(a)).length;
        if (tracked !== roundable)
            problems.push(`tracker holds ${tracked} windows for ${roundable}`);
        return problems.join('; ') || 'ok';
    },
};
globalThis.rwcTest = rwcTest;

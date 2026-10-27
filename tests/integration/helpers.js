// Test helpers, evaluated inside the shell by run.sh. gdbus parses the code as
// a GVariant string first, so it must stay free of backslash escapes.
const UUID = 'rounded-window-corners@ztrahmet.github.io';
const NAME = 'rounded-window-corners';

globalThis.rwcTest = {
    tracker: () => Main.extensionManager.lookup(UUID).stateObj._tracker,
    effect: actor => actor.get_effect(NAME),
    surface: actor => actor.get_children().find(c => c.constructor.$gtype.name.startsWith('MetaSurfaceActor')),
    isX11: actor => actor.metaWindow.get_client_type() === Meta.WindowClientType.X11,
    isAdwaita: actor => /adwaita/i.test(actor.metaWindow.get_wm_class() || ''),
    target: actor => (rwcTest.isX11(actor) ? rwcTest.surface(actor) : actor),

    shouldRound(actor) {
        const win = actor.metaWindow;
        return win.get_window_type() === Meta.WindowType.NORMAL && !rwcTest.isAdwaita(actor) &&
            !win.maximizedHorizontally && !win.maximizedVertically && !win.fullscreen;
    },

    // Records what each effect was last given, so the tests can compare it
    // with the window it belongs to. Patches the class once; it survives
    // disable and enable because the module stays loaded.
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
        const target = rwcTest.target(actor);
        const effect = target && rwcTest.effect(target);
        if (!effect || !effect.rwcArgs)
            return 'no recorded update';

        const win = actor.metaWindow;
        const f = win.get_frame_rect();
        const b = win.get_buffer_rect();
        const sx = target.width / b.width;
        const sy = target.height / b.height;
        const want = [(f.x - b.x) * sx, (f.y - b.y) * sy, (f.x - b.x + f.width) * sx, (f.y - b.y + f.height) * sy];
        const got = effect.rwcArgs[0];
        if (want.every((v, i) => Math.abs(v - got[i]) < 0.5))
            return '';
        return `${got.map(Math.round)} for ${want.map(Math.round)}`;
    },

    // Checks every window against what the extension should be doing to it.
    audit() {
        const actors = global.get_window_actors();
        const problems = [];
        for (const actor of actors) {
            const name = actor.metaWindow.get_wm_class() || '?';
            const rounded = [actor, ...actor.get_children()].filter(a => rwcTest.effect(a));
            if (!rwcTest.shouldRound(actor)) {
                if (rounded.length)
                    problems.push(`${name} should not be rounded`);
            } else if (rounded.length !== 1 || rounded[0] !== rwcTest.target(actor)) {
                problems.push(`${name} has the effect on ${rounded.length} actors`);
            } else {
                const error = rwcTest.boundsError(actor);
                if (error)
                    problems.push(`${name} bounds ${error}`);
            }
        }
        const tracked = rwcTest.tracker()._states.size;
        if (tracked !== actors.length)
            problems.push(`tracker holds ${tracked} windows for ${actors.length}`);
        return problems.join('; ') || 'ok';
    },
};

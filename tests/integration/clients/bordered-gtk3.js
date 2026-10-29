// A synthetic window: solid blue with a hard 1 px red border. With RWC_BARE it is undecorated.
imports.gi.versions.Gtk = '3.0';
const {Gtk, Gdk, GLib} = imports.gi;
Gtk.init(null);
const bare = GLib.getenv('RWC_BARE') !== null;
const css = new Gtk.CssProvider();
css.load_from_data(
    'window { background-color: #0000ff; border: 1px solid #ff0000; }' +
    'headerbar, .titlebar { background-image: none; background-color: #0000ff;' +
    ' border: none; box-shadow: none; color: #ffffff; }');
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), css, 800);
const w = new Gtk.Window({default_width: 800, default_height: 600, title: bare ? 'rwc-bare' : 'rwc-client'});
if (bare)
    w.set_decorated(false);
else
    w.set_titlebar(new Gtk.HeaderBar({title: 'rwc', show_close_button: false}));
w.connect('destroy', () => Gtk.main_quit());
w.show_all();
Gtk.main();

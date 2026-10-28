// A deliberately synthetic client: solid blue with a hard 1px red border.
// Real applications change appearance between GNOME releases, which would make
// assertions version-dependent. This one does not.
// With RWC_BARE set it draws no shadow, so it leaves no room around itself.
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
if (bare) {
    const noShadow = new Gtk.CssProvider();
    noShadow.load_from_data('decoration { box-shadow: none; margin: 0; }');
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), noShadow, 800);
}
const w = new Gtk.Window({default_width: 800, default_height: 600, title: 'rwc-client'});
w.set_titlebar(new Gtk.HeaderBar({title: bare ? 'rwc-bare' : 'rwc', show_close_button: false}));
w.connect('destroy', () => Gtk.main_quit());
w.show_all();
Gtk.main();

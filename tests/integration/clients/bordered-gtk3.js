// A deliberately synthetic client: solid blue with a hard 1px red border.
// Real applications change appearance between GNOME releases, which would make
// assertions version-dependent. This one does not.
imports.gi.versions.Gtk = '3.0';
const {Gtk, Gdk} = imports.gi;
Gtk.init(null);
const css = new Gtk.CssProvider();
css.load_from_data(
    'window { background-color: #0000ff; border: 1px solid #ff0000; }' +
    'headerbar, .titlebar { background-image: none; background-color: #0000ff;' +
    ' border: none; box-shadow: none; color: #ffffff; }');
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), css, 800);
const w = new Gtk.Window({default_width: 800, default_height: 600, title: 'rwc-client'});
w.set_titlebar(new Gtk.HeaderBar({title: 'rwc', show_close_button: false}));
w.connect('destroy', () => Gtk.main_quit());
w.show_all();
Gtk.main();

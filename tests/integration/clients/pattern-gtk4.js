// A GTK 4 window of fine stripes, which any resampling of the window blurs.
imports.gi.versions.Gtk = '4.0';
const {Gdk, Gtk, GLib} = imports.gi;
Gtk.init();
const loop = new GLib.MainLoop(null, false);
const css = new Gtk.CssProvider();
css.load_from_string('window { background: repeating-linear-gradient(90deg, #000 0, #000 1px, #fff 1px, #fff 3px); }');
Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, 800);
const w = new Gtk.Window({default_width: 400, default_height: 300, title: 'rwc-pattern'});
w.connect('close-request', () => loop.quit());
w.present();
loop.run();

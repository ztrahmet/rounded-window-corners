// A GTK 3 dialog from a process of its own, over the X11 window whose ID is given, as the file chooser portal puts one.
// It takes Settings' WM class, so it has an app of its own.
imports.gi.versions.Gtk = '3.0';
imports.gi.versions.GdkX11 = '3.0';
const {Gtk, Gdk, GdkX11} = imports.gi;
Gtk.init(null);
Gdk.set_program_class('org.gnome.Settings');
const w = new Gtk.Window({default_width: 300, default_height: 200, title: 'rwc-foreign', type_hint: Gdk.WindowTypeHint.DIALOG});
w.realize();
w.get_window().set_transient_for(GdkX11.X11Window.foreign_new_for_display(w.get_display(), Number(ARGV[0])));
w.connect('destroy', () => Gtk.main_quit());
w.show_all();
Gtk.main();

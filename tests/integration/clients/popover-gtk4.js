// A GTK 4 window that opens a popover, which the shell gets as a popup window.
imports.gi.versions.Gtk = '4.0';
const {Gtk, GLib} = imports.gi;
Gtk.init();
const loop = new GLib.MainLoop(null, false);
const button = new Gtk.MenuButton({label: 'menu', popover: new Gtk.Popover({child: new Gtk.Label({label: 'popover'})})});
const w = new Gtk.Window({default_width: 400, default_height: 300, title: 'rwc-popover', child: button});
w.connect('close-request', () => loop.quit());
w.present();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    button.popup();
    return GLib.SOURCE_REMOVE;
});
loop.run();

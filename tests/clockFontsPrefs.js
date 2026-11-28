import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {addClockFonts} from '../src/prefs/clockFonts.js';
import {CLOCK_FONTS} from '../src/shared/clockFonts.js';

Adw.init();
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const schema = Gio.SettingsSchemaSource.new_from_directory(root.get_child('schemas').get_path(),
    Gio.SettingsSchemaSource.get_default(), false).lookup('org.gnome.shell.extensions.nova-island', false);
const settings = new Gio.Settings({settings_schema: schema});
const app = new Adw.Application({application_id: 'org.gnome.Shell.Extensions'});
const assert = (ok, message) => { if (!ok) throw new Error(message); };
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, default_width: 680, default_height: 640});
    const page = new Adw.PreferencesPage({title: 'Clock font check'});
    const section = new Adw.PreferencesGroup({title: 'Typography and spacing'});
    page.add(section);
    window.add(page);
    addClockFonts(section, settings, window, root.get_path());
    const descendants = widget => [widget, ...Array.from((function* () {
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) yield child;
    })()).flatMap(descendants)];
    window.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        const children = descendants(window);
        const row = children.find(child => child instanceof Adw.ComboRow);
        assert(row.model.get_n_items() === 11, 'ten fonts plus system default');
        for (let i = 0; i < CLOCK_FONTS.length; i++) {
            row.selected = i + 1;
            assert(settings.get_string('clock-font') === CLOCK_FONTS[i], 'font selection did not persist');
            const preview = descendants(section).find(child => child instanceof Gtk.Label && /^\d\d:\d\d$/.test(child.label));
            assert(preview && preview.attributes.to_string().includes(CLOCK_FONTS[i]), 'live preview family');
        }
        settings.set_string('clock-font', 'Inter');
        row.activate();
        print('PASS GTK font dropdown constructs, all ten selections persist, live preview updates');
        return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => { window.close(); return GLib.SOURCE_REMOVE; });
});
app.run([]);

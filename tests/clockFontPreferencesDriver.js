import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {addClockFonts} from '../src/prefs/clockFonts.js';
import {createPreview} from '../src/prefs/preview.js';
import {CLOCK_FONTS} from '../src/shared/clockFonts.js';

Adw.init();
const directory = GLib.getenv('NOVA_FONT_CONTROL_DIR');
const schemaDirectory = GLib.getenv('GSETTINGS_SCHEMA_DIR');
const schema = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory,
    Gio.SettingsSchemaSource.get_default(), false).lookup('org.gnome.shell.extensions.nova-island', false);
const settings = new Gio.Settings({settings_schema: schema});
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const descendants = widget => {
    const all = [widget];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        all.push(...descendants(child));
    return all;
};
const read = name => {
    try { return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${directory}/${name}`)[1])); }
    catch { return null; }
};
const reply = data => GLib.file_set_contents(`${directory}/response.json`, JSON.stringify(data));
const renderedFamily = label => label.get_layout().get_iter().get_run_readonly().item.analysis.font.describe().get_family();
const app = new Adw.Application({application_id: 'org.gnome.Shell.Extensions'});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, default_width: 720, default_height: 680});
    const page = new Adw.PreferencesPage({title: 'Appearance'});
    const preview = new Adw.PreferencesGroup();
    const typography = new Adw.PreferencesGroup({title: 'Typography and spacing'});
    page.add(preview);
    page.add(typography);
    window.add(page);
    createPreview(preview, settings, window);
    addClockFonts(typography, settings, window, root.get_path());
    window.present();
    const widgets = descendants(window);
    const row = widgets.find(widget => widget instanceof Adw.ComboRow && widget.title === 'Clock Font');
    const compact = widgets.find(widget => widget instanceof Gtk.Label && widget.has_css_class('nova-sample-compact-time'));
    const expanded = widgets.find(widget => widget instanceof Gtk.Label && widget.has_css_class('nova-sample-clock'));
    const live = descendants(typography).find(widget => widget instanceof Gtk.Label && widget.attributes && /^\d\d:\d\d$/.test(widget.label));
    let serial = -1;
    let pending = false;
    reply({serial: 0, status: 'ready'});
    const poll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
        const command = read('command.json');
        if (!command || command.serial === serial || pending)
            return GLib.SOURCE_CONTINUE;
        serial = command.serial;
        if (command.close) {
            reply({serial, status: 'closed'});
            window.close();
            return GLib.SOURCE_REMOVE;
        }
        pending = true;
        try {
            const selected = command.family ? CLOCK_FONTS.indexOf(command.family) + 1 : 0;
            if (selected < 0 || (command.family && !CLOCK_FONTS.includes(command.family)))
                throw new Error(`Unknown font: ${command.family}`);
            row.selected = selected;
            if (command.size !== undefined)
                settings.set_int('clock-font-size', command.size);
            Gio.Settings.sync();
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
                try {
                    reply({serial, status: 'applied', selected: settings.get_string('clock-font'),
                        previewFamilies: [compact, expanded, live].map(renderedFamily),
                        previewLabels: [compact, expanded, live].map(widget => widget.label)});
                } catch (error) { reply({serial, status: 'error', error: error.message}); }
                pending = false;
                return GLib.SOURCE_REMOVE;
            });
        } catch (error) {
            reply({serial, status: 'error', error: error.message});
            pending = false;
        }
        return GLib.SOURCE_CONTINUE;
    });
    window.connect('close-request', () => {
        // poll removes itself on the normal command-driven close path.
        return false;
    });
});
app.run([]);

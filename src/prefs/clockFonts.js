import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

import {CLOCK_FONTS, clockFont} from '../shared/clockFonts.js';
import {installClockFonts} from '../shared/installClockFonts.js';
import {watch} from './controls.js';

function attributes(family, size = null) {
    const attrs = new Pango.AttrList();
    if (family)
        attrs.insert(Pango.attr_family_new(family));
    if (size)
        attrs.insert(Pango.attr_size_new(size * Pango.SCALE));
    return attrs;
}

export function addClockFonts(section, settings, window, directory) {
    const choices = ['', ...CLOCK_FONTS];
    const row = new Adw.ComboRow({title: 'Clock Font', subtitle: 'Compact and expanded clock time',
        model: Gtk.StringList.new(['System default (current appearance)', ...CLOCK_FONTS])});
    const factory = new Gtk.SignalListItemFactory();
    factory.connect('setup', (_factory, item) => { item.child = new Gtk.Label({xalign: 0}); });
    factory.connect('bind', (_factory, item) => {
        item.child.label = item.item.string;
        item.child.attributes = attributes(clockFont(item.item.string));
    });
    row.factory = factory;
    section.add(row);
    const preview = new Gtk.Label({margin_top: 12, margin_bottom: 12});
    section.add(preview);
    const refresh = () => {
        const family = clockFont(settings.get_string('clock-font'));
        row.selected = Math.max(0, choices.indexOf(family));
        preview.label = GLib.DateTime.new_now_local().format('%H:%M');
        preview.attributes = attributes(family, settings.get_int('clock-font-size') + 44);
    };
    row.connect('notify::selected', () => {
        if (choices[row.selected] !== undefined)
            settings.set_string('clock-font', choices[row.selected]);
    });
    watch(settings, window, 'changed::clock-font', refresh);
    watch(settings, window, 'changed::clock-font-size', refresh);
    const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        refresh();
        return GLib.SOURCE_CONTINUE;
    });
    window.connect('close-request', () => { GLib.Source.remove(timer); return false; });
    const installation = new Adw.ActionRow({title: 'Install bundled clock fonts',
        subtitle: 'Copies locally to your user fonts without replacing existing files. Log out and back in afterward.'});
    const install = new Gtk.Button({label: 'Install fonts', valign: Gtk.Align.CENTER});
    installation.add_suffix(install);
    section.add(installation);
    install.connect('clicked', async () => {
        install.sensitive = false;
        try {
            const target = await installClockFonts(directory);
            installation.subtitle = `Installed in ${target}. Log out and back in, then reopen Preferences.`;
            install.label = 'Installed';
        } catch (error) {
            installation.subtitle = `Installation failed: ${error.message}`;
            install.sensitive = true;
        }
    });
    refresh();
}

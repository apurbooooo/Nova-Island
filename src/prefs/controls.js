import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

export function group(page, title = '', description = '') {
    const section = new Adw.PreferencesGroup({title, description});
    page.add(section);
    return section;
}

export function spin(section, settings, key, title, subtitle = '') {
    if (!settings.settings_schema.has_key(key))
        return;
    const [, range] = settings.settings_schema.get_key(key).get_range().deepUnpack();
    const [minimum, maximum] = range.deepUnpack();
    const row = Adw.SpinRow.new_with_range(minimum, maximum, 1);
    row.title = title;
    row.subtitle = subtitle;
    section.add(row);
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function toggle(section, settings, key, title, subtitle = '') {
    if (!settings.settings_schema.has_key(key))
        return;
    const row = new Adw.SwitchRow({title, subtitle});
    section.add(row);
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// 0 maps to the first value. Updating the model follows external setting writes.
export function combo(section, settings, key, title, choices, window, select, subtitle = '') {
    if (!settings.settings_schema.has_key(key))
        return null;
    const row = new Adw.ComboRow({title, subtitle});
    section.add(row);
    let values = [];
    let updating = false;
    const sync = () => {
        updating = true;
        row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
        updating = false;
    };
    const setChoices = options => {
        updating = true;
        values = options.map(([value]) => value);
        row.model = Gtk.StringList.new(options.map(([, label]) => label));
        sync();
    };
    setChoices(choices);
    watch(settings, window, `changed::${key}`, sync);
    row.connect('notify::selected', () => {
        if (!updating && values[row.selected] !== undefined)
            (select ?? (value => settings.set_string(key, value)))(values[row.selected]);
    });
    return setChoices;
}

export function color(section, settings, key, title, window, changed) {
    if (!settings.settings_schema.has_key(key))
        return;
    const row = new Adw.ActionRow({title});
    const dialog = new Gtk.ColorDialog({title, with_alpha: false});
    const picker = new Gtk.ColorDialogButton({dialog, valign: Gtk.Align.CENTER});
    let updating = false;
    const sync = () => {
        const rgba = new Gdk.RGBA();
        if (!rgba.parse(settings.get_string(key)))
            return;
        updating = true;
        picker.rgba = rgba;
        updating = false;
    };
    sync();
    watch(settings, window, `changed::${key}`, sync);
    picker.connect('notify::rgba', () => {
        if (updating)
            return;
        const {red, green, blue} = picker.rgba;
        const hex = '#' + [red, green, blue].map(value => Math.round(value * 255)
            .toString(16).padStart(2, '0')).join('');
        changed(key, hex);
    });
    row.add_suffix(picker);
    row.activatable_widget = picker;
    section.add(row);
}

export function watch(source, window, signal, callback) {
    const id = source.connect(signal, callback);
    window.connect('close-request', () => {
        source.disconnect(id);
        return false;
    });
}

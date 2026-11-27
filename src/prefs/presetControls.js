import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {applyPreset, listPresets, MAX_PRESET_BYTES, parsePreset, savePreset, snapshot,
    writeSettings} from '../shared/presets.js';

Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');
Gio._promisify(Gio.InputStream.prototype, 'close_async');
Gio._promisify(Gtk.FileDialog.prototype, 'open');
Gio._promisify(Gtk.FileDialog.prototype, 'save');

async function readFile(file, cancellable) {
    const stream = await file.read_async(GLib.PRIORITY_DEFAULT, cancellable);
    try {
        const chunks = [];
        let total = 0;
        for (;;) {
            const chunk = await stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellable);
            if (chunk.get_size() === 0)
                break;
            total += chunk.get_size();
            if (total > MAX_PRESET_BYTES)
                throw new Error('Preset files are limited to 64 KiB.');
            chunks.push(chunk.get_data());
        }
        const data = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        return new TextDecoder('utf-8', {fatal: true}).decode(data);
    } finally {
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    }
}

export async function importPresetFile(settings, file, cancellable) {
    return parsePreset(settings, await readFile(file, cancellable));
}

export async function exportPresetFile(preset, file, cancellable) {
    const contents = new TextEncoder().encode(JSON.stringify(preset, null, 2) + '\n');
    await file.replace_contents_bytes_async(new GLib.Bytes(contents), null, false, Gio.FileCreateFlags.NONE, cancellable);
}

export function addPresetControls(section, settings, window) {
    const cancellable = new Gio.Cancellable();
    window.connect('close-request', () => {
        cancellable.cancel();
        return false;
    });
    const notify = title => window.add_toast(new Adw.Toast({title}));
    const act = callback => async () => {
        try {
            await callback();
        } catch (error) {
            if (!cancellable.is_cancelled() && !error.matches?.(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED))
                notify(error.message);
        }
    };
    const name = new Adw.EntryRow({title: 'Preset name'});
    section.add(name);
    const saved = new Adw.ComboRow({title: 'Saved presets'});
    section.add(saved);
    const refresh = () => {
        const presets = listPresets(settings);
        saved.model = Gtk.StringList.new(presets.map(preset => preset.name));
        return presets;
    };
    refresh();
    const addAction = (title, label, icon, callback) => {
        const row = new Adw.ActionRow({title, icon_name: icon});
        const button = new Gtk.Button({label, valign: Gtk.Align.CENTER});
        button.connect('clicked', act(callback));
        row.add_suffix(button);
        row.activatable_widget = button;
        section.add(row);
    };
    addAction('Save current settings', 'Save', 'document-save-symbolic', () => {
        savePreset(settings, snapshot(settings, name.text.trim()));
        refresh();
        notify('Preset saved');
    });
    addAction('Apply selected preset', 'Apply', 'object-select-symbolic', () => {
        const preset = listPresets(settings)[saved.selected];
        if (preset)
            applyPreset(settings, preset);
    });
    addAction('Import preset JSON', 'Import', 'document-open-symbolic', async () => {
        const file = await new Gtk.FileDialog({title: 'Import NOVA preset'}).open(window, cancellable);
        const preset = await importPresetFile(settings, file, cancellable);
        applyPreset(settings, preset);
        savePreset(settings, preset);
        refresh();
        notify('Preset imported');
    });
    addAction('Export current settings', 'Export', 'document-send-symbolic', async () => {
        const preset = snapshot(settings, name.text.trim() || 'NOVA Island');
        const dialog = new Gtk.FileDialog({title: 'Export NOVA preset', initial_name: 'nova-island.json'});
        const file = await dialog.save(window, cancellable);
        await exportPresetFile(preset, file, cancellable);
        notify('Preset exported');
    });
    addAction('Restore default settings', 'Reset', 'edit-clear-all-symbolic', async () => {
        const dialog = new Adw.AlertDialog({heading: 'Reset NOVA Island settings?',
            body: 'Saved presets will remain available.'});
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('reset', 'Reset');
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response::reset', act(() => {
            writeSettings(settings, settings.settings_schema.list_keys()
                .filter(key => key !== 'saved-presets').map(key => [key, undefined]));
            notify('Default settings restored');
        }));
        dialog.present(window);
    });
}

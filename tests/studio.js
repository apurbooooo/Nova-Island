import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {exportPresetFile, importPresetFile} from '../src/prefs/presetControls.js';

import {applyPreset, listPresets, parsePreset, savePreset, snapshot, writeSettings} from '../src/shared/presets.js';
import {readAppearance, surfaceStyle, THEMES, THEME_TOKENS} from '../src/shared/studio.js';

const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.nova-island'});
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const baseline = snapshot(settings, 'Baseline');
for (const [theme, [, tokens]] of Object.entries(THEMES)) {
    writeSettings(settings, [['theme', theme], ...Object.entries(tokens ?? {})]);
    Gio.Settings.sync();
    assert(settings.get_string('theme') === theme, 'Theme was not applied');
    if (tokens) {
        assert(THEME_TOKENS.every(key => readAppearance(settings)[key] === tokens[key]), 'Theme token mismatch');
        assert(surfaceStyle(readAppearance(settings), false).includes(tokens['text-color']), 'Missing color in CSS');
    }
}
savePreset(settings, baseline);
assert(listPresets(settings).length === 1, 'Preset was not saved');
applyPreset(settings, parsePreset(settings, JSON.stringify(listPresets(settings)[0])));
assert(settings.get_string('theme') === baseline.settings.theme, 'Round trip failed');

for (const invalid of [
    '{', '[]', JSON.stringify({...baseline, version: 2}),
    ...Object.entries({'compact-width': 10000, 'expand-duration': 1.5, 'accent-color': 'red;',
        'theme': 'unknown', 'hover-expand': 'true', 'unexpected-key': true})
        .map(([key, value]) => JSON.stringify({...baseline, settings: {[key]: value}})),
    ' '.repeat(65537),
]) {
    let rejected = false;
    try {
        parsePreset(settings, invalid);
    } catch {
        rejected = true;
    }
    assert(rejected, 'Invalid preset was accepted');
}
assert(settings.get_int('compact-width') === baseline.settings['compact-width'], 'A rejected preset changed settings');
print('PASS built-in themes, all appearance tokens, persisted preset and JSON round trip, invalid import rejection');

const [descriptor, path] = GLib.file_open_tmp('nova-preset-XXXXXX');
GLib.close(descriptor);
const file = Gio.File.new_for_path(path);
const cancel = new Gio.Cancellable();
try {
    await exportPresetFile(baseline, file, cancel);
    assert(JSON.stringify(await importPresetFile(settings, file, cancel)) === JSON.stringify(baseline),
        'Asynchronous JSON file round trip changed a preset');
    GLib.file_set_contents(path, new TextEncoder().encode('{"version": 2}'));
    let rejected = false;
    try {
        await importPresetFile(settings, file, cancel);
    } catch {
        rejected = true;
    }
    assert(rejected, 'File loader accepted an unsupported preset');
    print('PASS asynchronous preset file export, import, and malformed file rejection');
} finally {
    GLib.unlink(path);
}

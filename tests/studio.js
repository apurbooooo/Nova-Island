import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {addModuleControls} from '../src/prefs/moduleControls.js';
import {exportPresetFile, importPresetFile} from '../src/prefs/presetControls.js';

import {applyPreset, listPresets, parsePreset, savePreset, snapshot, writeSettings} from '../src/shared/presets.js';
import {MODULES, readAppearance, surfaceStyle, THEMES, THEME_TOKENS} from '../src/shared/studio.js';

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

Adw.init();
const prefsWindow = new Adw.PreferencesWindow();
const modulesPage = new Adw.PreferencesPage({title: 'Modules'});
prefsWindow.add(modulesPage);
const sections = addModuleControls(modulesPage, settings, prefsWindow);
assert(sections.length === MODULES.length, 'Preferences did not build all registered module groups');
assert(sections.map(({id}) => id).join(',') === MODULES.map(([id]) => id).join(','),
    'Preferences module groups are missing or out of registry order');
for (const {id, title, section, enabled, compact, expanded, priority} of sections) {
    assert(section.title === title, `${id} group title was not rendered`);
    assert(enabled?.title === `Enable ${title}` && compact?.title === 'Show in compact view' &&
        expanded?.title === 'Show in expanded view' && priority?.title === 'Display priority',
    `${id} preference rows were not constructed`);
    for (const [row, suffix] of [[enabled, 'enabled'], [compact, 'compact'], [expanded, 'expanded']]) {
        const key = `${id}-${suffix}`;
        const initial = settings.get_boolean(key);
        row.active = !initial;
        assert(settings.get_boolean(key) === !initial, `${id} ${suffix} control did not update its setting`);
        row.active = initial;
    }
    const priorityKey = `${id}-priority`;
    const initialPriority = settings.get_int(priorityKey);
    const [, range] = settings.settings_schema.get_key(priorityKey).get_range().deepUnpack();
    const [minimum, maximum] = range.deepUnpack();
    priority.value = initialPriority < maximum ? initialPriority + 1 : minimum;
    assert(settings.get_int(priorityKey) === priority.value, `${id} priority control did not update its setting`);
    settings.set_int(priorityKey, initialPriority);
}
prefsWindow.close();
print('PASS Modules preferences construct all nine groups and bind every module control');

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

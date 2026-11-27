import Adw from 'gi://Adw?version=1';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {color, combo, group, spin, toggle, watch} from './src/prefs/controls.js';
import {addMediaControls} from './src/prefs/mediaControls.js';
import {createPreview} from './src/prefs/preview.js';
import {addPresetControls} from './src/prefs/presetControls.js';
import {writeSettings} from './src/shared/presets.js';
import {ALIGNMENTS, ANIMATIONS, COLORS, CONTENT, MODULES, MOTION, SIZE, SURFACE, THEMES,
    THEME_TOKENS} from './src/shared/studio.js';

export default class NovaIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const has = key => settings.settings_schema.has_key(key);
        window.set_default_size(660, 780);
        window.search_enabled = true;
        const page = (title, icon_name) => {
            const item = new Adw.PreferencesPage({title, icon_name});
            window.add(item);
            return item;
        };
        const spins = (section, rows) => rows.forEach(([key, title, subtitle]) =>
            spin(section, settings, key, title, subtitle));

        const appearance = page('Appearance', 'applications-graphics-symbolic');
        createPreview(group(appearance), settings, window);
        const theme = group(appearance, 'Theme');
        const themeOptions = Object.entries(THEMES).map(([key, [label]]) => [key, label]);
        combo(theme, settings, 'theme', 'Style', themeOptions, window, value =>
            writeSettings(settings, [...Object.entries(THEMES[value][1] ?? {}), ['theme', value]]
                .filter(([key]) => has(key))));
        const themeKeys = has('theme') ? THEME_TOKENS.filter(has) : [];
        for (const key of themeKeys) {
            watch(settings, window, `changed::${key}`, () => {
                const active = settings.get_string('theme');
                const tokens = THEMES[active]?.[1];
                if (tokens && themeKeys.some(token => settings.get_value(token).deepUnpack() !== tokens[token]))
                    settings.set_string('theme', 'custom');
            });
        }

        const glass = group(appearance, 'Glass surface', 'Translucent color, border, and shadow simulate glass in GNOME Shell.');
        spins(glass, SURFACE);
        groupColors(group(appearance, 'Palette'), settings, window);
        spins(group(appearance, 'Typography and spacing'), CONTENT);

        const layout = page('Layout', 'view-grid-symbolic');
        spins(group(layout, 'Dimensions', 'Logical pixels. The compact pill fits the available space in the centered panel.'), SIZE);
        const position = group(layout, 'Preview position');
        spins(position, [
            ['top-offset', 'Panel gap', 'Distance below the top bar.'],
            ['horizontal-offset', 'Horizontal offset', 'Negative values move the preview left.'],
        ]);
        combo(position, settings, 'content-alignment', 'Content alignment', ALIGNMENTS, window);
        toggle(group(layout, 'Panel placement'), settings, 'floating-fallback', 'Floating fallback',
            'Show a pill below the bar when the center slot is unavailable. GNOME’s clock stays visible.');

        const animations = page('Motion', 'media-playback-start-symbolic');
        const motion = group(animations, 'Animation Studio');
        combo(motion, settings, 'animation-style', 'Animation style', ANIMATIONS, window);
        spins(motion, MOTION);
        toggle(motion, settings, 'reduce-motion', 'Reduce motion', 'GNOME’s reduced-motion setting also applies.');
        const input = group(animations, 'Interaction');
        toggle(input, settings, 'hover-expand', 'Expand on hover');
        toggle(input, settings, 'click-to-pin', 'Click to pin', 'When off, activation toggles the preview.');

        const modules = page('Modules', 'application-x-addon-symbolic');
        combo(group(modules, 'Selection'), settings, 'default-expanded-module', 'Default expanded module',
            [['auto', 'Automatic'], ...MODULES], window, null, 'Automatic uses the highest available priority.');
        for (const [id, title] of MODULES.filter(([id]) => has(`${id}-enabled`))) {
            const section = group(modules, title);
            toggle(section, settings, `${id}-enabled`, `Enable ${title}`);
            toggle(section, settings, `${id}-compact`, 'Show in compact view');
            toggle(section, settings, `${id}-expanded`, 'Show in expanded view');
            spin(section, settings, `${id}-priority`, 'Display priority');
        }
        if (has('media-enabled'))
            addMediaControls(page('Media', 'audio-x-generic-symbolic'), settings, window);
        if (has('saved-presets'))
            addPresetControls(group(page('Presets', 'document-save-symbolic'), 'Saved configurations'), settings, window);
    }
}

function groupColors(section, settings, window) {
    for (const [key, label] of COLORS) {
        color(section, settings, key, label, window, (changedKey, value) =>
            writeSettings(settings, [[changedKey, value], ['theme', 'custom']]
                .filter(([key]) => settings.settings_schema.has_key(key))));
    }
}

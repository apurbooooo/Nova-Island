import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {color, combo, group, spin, toggle, watch} from './src/prefs/controls.js';
import {addModuleControls} from './src/prefs/moduleControls.js';
import {addMediaControls} from './src/prefs/mediaControls.js';
import {createPreview, createThemeGallery} from './src/prefs/preview.js';
import {addPresetControls} from './src/prefs/presetControls.js';
import {writeSettings} from './src/shared/presets.js';
import {ALIGNMENTS, ANIMATIONS, COLORS, CONTENT, MOTION, SIZE, SURFACE} from './src/shared/studio.js';

export default class NovaIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const has = key => settings.settings_schema.has_key(key);
        window.set_default_size(720, 860);
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
        createThemeGallery(group(appearance, 'Theme', 'Pick a starting point. Any edit below becomes your Custom theme.'),
            settings, window);

        const glass = group(appearance, 'Glass surface', 'Opacity, corners, border, and shadow. Higher opacity keeps text readable on busy wallpapers.');
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
        addModuleControls(modules, settings, window);
        if (has('media-enabled'))
            addMediaControls(page('Media', 'audio-x-generic-symbolic'), settings, window);
        if (has('notifications-enabled')) {
            const notifications = page('Alerts', 'preferences-system-notifications-symbolic');
            const behavior = group(notifications, 'NOVA previews');
            toggle(behavior, settings, 'notifications-auto-expand', 'Expand for incoming notifications');
            spin(behavior, settings, 'notifications-peek-duration', 'Preview duration (ms)');
            spin(behavior, settings, 'notifications-minimum-urgency', 'Minimum priority',
                '1 normal, 2 high, 3 critical.');
            const quiet = group(notifications, 'Quiet modes');
            toggle(quiet, settings, 'notifications-dnd', 'Do Not Disturb', 'Suppress NOVA previews.');
            toggle(quiet, settings, 'notifications-focus-mode', 'Focus Mode',
                'Show only critical NOVA previews.');
        }
        if (has('productivity-enabled')) {
            const productivity = page('Productivity', 'alarm-symbolic');
            const timing = group(productivity, 'Timers', 'Saved sessions reopen paused. Timers count awake time.');
            spin(timing, settings, 'productivity-countdown', 'Countdown duration (seconds)');
            spin(timing, settings, 'productivity-focus-minutes', 'Focus interval (minutes)');
            spin(timing, settings, 'productivity-break-minutes', 'Break interval (minutes)');
            const zones = new Adw.EntryRow({title: 'Time zones separated by commas'});
            zones.text = settings.get_strv('productivity-timezones').join(', ');
            zones.show_apply_button = true;
            zones.connect('apply', () => {
                const values = zones.text.split(',').map(value => value.trim()).filter(Boolean);
                if (values.length > 0 && values.length <= 12 && values.every(value => GLib.TimeZone.new_identifier(value))) {
                    settings.set_strv('productivity-timezones', values);
                    zones.remove_css_class('error');
                } else {
                    zones.add_css_class('error');
                }
            });
            group(productivity, 'World Clock', 'Use IANA identifiers such as Europe/London or Asia/Dhaka.').add(zones);
        }
        if (has('clipboard-enabled')) {
            const tools = page('Tools', 'applications-utilities-symbolic');
            const clipboard = group(tools, 'Clipboard',
                'Capture is opt-in. History stays in memory and is cleared on lock, capture off, or extension disable. Filters cannot identify every secret.');
            toggle(clipboard, settings, 'clipboard-capture', 'Capture clipboard',
                'Requires the Clipboard module. Text and PNG images only. The primary selection is excluded.');
            spin(clipboard, settings, 'clipboard-limit', 'Maximum items');
            spin(clipboard, settings, 'clipboard-retention', 'Unpinned retention (minutes)');
            const exclusions = new Adw.EntryRow({title: 'Exclude text containing these comma-separated terms'});
            exclusions.text = settings.get_strv('clipboard-exclusions').join(', ');
            exclusions.show_apply_button = true;
            exclusions.connect('apply', () => settings.set_strv('clipboard-exclusions',
                exclusions.text.split(',').map(value => value.trim().slice(0, 128)).filter(Boolean).slice(0, 32)));
            clipboard.add(exclusions);
            spin(group(tools, 'System Monitor', 'Sampling runs only while the monitor is visible.'),
                settings, 'system-monitor-interval', 'Sampling interval (seconds)');
            group(tools, 'Capture and device controls',
                'Screenshot Studio opens GNOME’s selection and recording controls. Wi-Fi and Bluetooth open GNOME Quick Settings. Hardware controls appear when available.');
        }
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

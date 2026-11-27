import {combo, group, spin, toggle} from './controls.js';
import Gtk from 'gi://Gtk?version=4.0';

import {MODULES, MODULE_ICONS} from '../shared/studio.js';

const DESCRIPTIONS = {
    clock: 'Time, date, week and time zone.',
    media: 'MPRIS player with artwork, lyrics and karaoke.',
    notifications: 'Private session history and NOVA previews.',
    productivity: 'Calendar, world clock, stopwatch, timer and focus.',
    clipboard: 'Opt-in, in-memory text and image history.',
    emoji: 'Offline emoji, symbols and kaomoji picker.',
    screenshot: 'GNOME’s native screenshot and recording tools.',
    'system-monitor': 'CPU, memory, network, temperatures and battery.',
    'quick-settings': 'Sound, brightness, Night Light and power.',
};

export function addModuleControls(page, settings, window) {
    combo(group(page, 'Selection'), settings, 'default-expanded-module', 'Default expanded module',
        [['auto', 'Automatic'], ...MODULES], window, null,
        'Automatic uses the highest available priority.');

    const sections = [];
    for (const [id, title] of MODULES) {
        if (!settings.settings_schema.has_key(`${id}-enabled`))
            continue;

        const section = group(page, title, DESCRIPTIONS[id] ?? '');
        const badge = new Gtk.Image({icon_name: MODULE_ICONS[id] ?? 'application-x-addon-symbolic',
            pixel_size: 18, valign: Gtk.Align.CENTER, css_classes: ['dim-label']});
        section.header_suffix = badge;
        sections.push({
            id,
            title,
            section,
            enabled: toggle(section, settings, `${id}-enabled`, `Enable ${title}`),
            compact: toggle(section, settings, `${id}-compact`, 'Show in compact view'),
            expanded: toggle(section, settings, `${id}-expanded`, 'Show in expanded view'),
            priority: spin(section, settings, `${id}-priority`, 'Display priority'),
        });
    }

    return sections;
}

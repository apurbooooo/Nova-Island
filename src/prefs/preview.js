import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import {readAppearance, readSetting, surfaceStyle, THEMES} from '../shared/studio.js';
import {watch} from './controls.js';

export function createPreview(section, settings, window) {
    const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
    card.add_css_class('nova-preview-card');
    const heading = new Gtk.Label({label: 'Live preview', xalign: 0});
    heading.add_css_class('title-2');
    card.append(heading);
    const theme = new Gtk.Label({xalign: 0});
    theme.add_css_class('dim-label');
    card.append(theme);
    const compact = new Gtk.Box({halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
    compact.add_css_class('nova-sample-compact');
    window.add_css_class('nova-studio');
    const compactContent = new Gtk.Box({hexpand: true});
    const dot = new Gtk.Label({label: '●', valign: Gtk.Align.CENTER});
    dot.add_css_class('nova-sample-dot');
    compactContent.append(dot);
    compactContent.append(new Gtk.Label({label: '10:42', valign: Gtk.Align.CENTER}));
    compact.append(compactContent);
    card.append(compact);

    const expanded = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER});
    expanded.add_css_class('nova-sample-expanded');
    const largeClock = new Gtk.Label({label: '10:42'});
    largeClock.add_css_class('nova-sample-clock');
    expanded.append(largeClock);
    const date = new Gtk.Label({label: 'Friday, November 27'});
    date.add_css_class('nova-sample-date');
    expanded.append(date);
    card.append(expanded);

    const row = new Adw.Bin({child: card});
    section.add(row);
    const provider = new Gtk.CssProvider();
    const display = window.get_display();
    Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    window.connect('close-request', () => {
        Gtk.StyleContext.remove_provider_for_display(display, provider);
        return false;
    });

    const update = () => {
        const t = readAppearance(settings);
        const align = readSetting(settings, 'content-alignment', 'center');
        const alignment = {start: Gtk.Align.START, end: Gtk.Align.END, center: Gtk.Align.CENTER}[align];
        compactContent.halign = alignment;
        compactContent.set_spacing(t['compact-spacing']);
        expanded.set_spacing(t['expanded-spacing']);
        largeClock.halign = alignment;
        date.halign = alignment;
        theme.label = `${THEMES[readSetting(settings, 'theme', 'nova-dark')]?.[0] ?? 'Custom'} · Preferences sample`;
        provider.load_from_string(`
            window.nova-studio { background-color: #111521; color: #f1f4fc; }
            .nova-studio headerbar, .nova-studio list.boxed-list, .nova-studio popover contents {
                background-color: #1d2636; color: #f1f4fc;
            }
            .nova-studio row:hover, .nova-studio headerbar button:checked { background-color: #2a3951; }
            .nova-studio entry { background-color: #253149; color: #f1f4fc; }
            .nova-preview-card { background: #151c2d; color: #f1f4fc; padding: 18px;
                border-radius: 18px; border: 1px solid #344053; }
            .nova-sample-compact { ${surfaceStyle(t, true)} font-size: ${t['clock-font-size']}px;
                font-weight: 600; padding: 2px 8px;
                min-width: ${Math.round(settings.get_int('compact-width') * 0.68)}px;
                min-height: ${Math.round(settings.get_int('compact-height') * 0.58)}px; }
            .nova-sample-expanded { ${surfaceStyle(t, false)} padding: 10px;
                min-width: ${Math.round(settings.get_int('expanded-width') * 0.57)}px;
                min-height: ${Math.round(settings.get_int('expanded-height') * 0.45)}px; }
            .nova-sample-dot { color: ${t['accent-color']}; font-size: 9px; }
            .nova-sample-date { color: ${t['secondary-text-color']}; font-size: 14px; }
            .nova-sample-clock { font-weight: 700; font-size: ${t['clock-font-size'] + 22}px; }
        `);
    };
    watch(settings, window, 'changed', update);
    update();
}

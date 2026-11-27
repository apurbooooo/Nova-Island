import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import {writeSettings} from '../shared/presets.js';
import {MODULE_ICONS, readAppearance, readSetting, rgba, surfaceStyle, THEMES, THEME_TOKENS} from '../shared/studio.js';
import {watch} from './controls.js';

const STUDIO_CSS = `
    window.nova-studio { background-color: #0f121a; color: #eef1f8; }
    .nova-studio headerbar { background-color: #141824; color: #eef1f8; box-shadow: none; }
    .nova-studio list.boxed-list { background-color: #181d2a; color: #eef1f8; border-radius: 14px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06); }
    .nova-studio list.boxed-list > row { border-color: rgba(255, 255, 255, 0.05); }
    .nova-studio popover contents { background-color: #1b2130; color: #eef1f8; }
    .nova-studio row:hover { background-color: rgba(255, 255, 255, 0.04); }
    .nova-studio entry, .nova-studio spinbutton { background-color: rgba(255, 255, 255, 0.07); color: #eef1f8; }
    .nova-studio viewswitcher button:checked, .nova-studio headerbar button:checked {
        background-color: rgba(255, 255, 255, 0.1); }
    .nova-studio preferencesgroup > box > box > label.heading { font-size: 13px; letter-spacing: 0.4px; }
    .nova-stage { border-radius: 20px; padding: 26px 18px 30px;
        background: linear-gradient(135deg, #2a1f4a 0%, #15233f 45%, #3b1730 100%);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
    .nova-stage-caption { color: rgba(255, 255, 255, 0.55); font-size: 12px; }
    .nova-stage-title { font-size: 20px; font-weight: 800; color: #ffffff; }
    .nova-chip-dim { color: rgba(255, 255, 255, 0.6); font-size: 11px; font-weight: 700;
        padding: 3px 10px; border-radius: 999px; background-color: rgba(255, 255, 255, 0.08); }
    .nova-sample-weekday { font-size: 10px; font-weight: 800; letter-spacing: 2px; }
    .nova-sample-dock { padding: 4px; border-radius: 12px; background-color: rgba(255, 255, 255, 0.06); }
    .nova-sample-dock image { padding: 5px 7px; border-radius: 9px; color: rgba(255, 255, 255, 0.62); }
    .nova-theme-card { padding: 0; border-radius: 16px; background: transparent; box-shadow: none; }
    .nova-theme-card > box { padding: 10px; border-radius: 16px; background-color: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
    .nova-theme-card:hover > box { background-color: rgba(255, 255, 255, 0.08); }
    .nova-theme-name { font-weight: 700; font-size: 13px; }
    .nova-theme-check { color: #0b1020; padding: 3px; border-radius: 999px; min-width: 18px; min-height: 18px; }
`;

const sampleTime = () => {
    const now = new Date();
    return `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
};

// Live preview of the compact pill and expanded island over a desktop-like stage.
export function createPreview(section, settings, window) {
    window.add_css_class('nova-studio');
    const stage = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16});
    stage.add_css_class('nova-stage');
    const top = new Gtk.Box({spacing: 10});
    const titles = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true});
    const title = new Gtk.Label({label: 'Live preview', xalign: 0});
    title.add_css_class('nova-stage-title');
    const theme = new Gtk.Label({xalign: 0});
    theme.add_css_class('nova-stage-caption');
    titles.append(title);
    titles.append(theme);
    top.append(titles);
    const size = new Gtk.Label({valign: Gtk.Align.CENTER});
    size.add_css_class('nova-chip-dim');
    top.append(size);
    stage.append(top);

    const compact = new Gtk.Box({halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
    compact.add_css_class('nova-sample-compact');
    const compactContent = new Gtk.Box({hexpand: true, valign: Gtk.Align.CENTER});
    const dot = new Gtk.Label({label: '●', valign: Gtk.Align.CENTER});
    dot.add_css_class('nova-sample-dot');
    const compactTime = new Gtk.Label({label: sampleTime(), valign: Gtk.Align.CENTER});
    compactContent.append(dot);
    compactContent.append(compactTime);
    compact.append(compactContent);
    stage.append(compact);

    const expanded = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER});
    expanded.add_css_class('nova-sample-expanded');
    const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, vexpand: true, valign: Gtk.Align.CENTER});
    const weekday = new Gtk.Label({label: new Date().toLocaleDateString(undefined, {weekday: 'long'}).toUpperCase()});
    weekday.add_css_class('nova-sample-weekday');
    const largeClock = new Gtk.Label({label: sampleTime()});
    largeClock.add_css_class('nova-sample-clock');
    const date = new Gtk.Label({label: new Date().toLocaleDateString(undefined, {month: 'long', day: 'numeric', year: 'numeric'})});
    date.add_css_class('nova-sample-date');
    [weekday, largeClock, date].forEach(widget => body.append(widget));
    expanded.append(body);
    const dock = new Gtk.Box({halign: Gtk.Align.CENTER, spacing: 2, margin_top: 10});
    dock.add_css_class('nova-sample-dock');
    Object.values(MODULE_ICONS).slice(0, 7).forEach((icon_name, index) => {
        const image = new Gtk.Image({icon_name, pixel_size: 14});
        if (index === 0)
            image.add_css_class('nova-sample-active');
        dock.append(image);
    });
    expanded.append(dock);
    stage.append(expanded);

    section.add(new Adw.Bin({child: stage}));
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
        body.set_spacing(t['expanded-spacing']);
        for (const widget of [weekday, largeClock, date])
            widget.halign = alignment;
        theme.label = `${THEMES[readSetting(settings, 'theme', 'nova-dark')]?.[0] ?? 'Custom'} theme · updates as you edit`;
        size.label = `${settings.get_int('expanded-width')} × ${settings.get_int('expanded-height')}`;
        const swatches = Object.entries(THEMES).map(([key, [, tokens]]) => {
            const value = tokens ?? t;
            return `.nova-swatch-${key} { ${surfaceStyle(value, false)} min-height: 70px; border-radius: 14px; }
                .nova-swatch-${key} .nova-swatch-time { color: ${value['text-color']}; font-weight: 300; font-size: 22px; }
                .nova-swatch-${key} .nova-swatch-dot { background-color: ${value['accent-color']};
                    min-width: 8px; min-height: 8px; border-radius: 999px; }
                .nova-swatch-${key} .nova-swatch-bar { background-color: ${rgba(value['accent-color'], 55)};
                    min-height: 4px; border-radius: 4px; }`;
        }).join('\n');
        provider.load_from_string(`${STUDIO_CSS}
            .nova-sample-compact { ${surfaceStyle(t, true)} font-size: ${t['clock-font-size']}px;
                font-weight: 600; padding: 2px 14px;
                min-width: ${Math.round(settings.get_int('compact-width') * 0.8)}px;
                min-height: ${Math.round(settings.get_int('compact-height') * 0.8)}px; }
            .nova-sample-expanded { ${surfaceStyle(t, false)} padding: 18px 16px 10px;
                min-width: ${Math.round(settings.get_int('expanded-width') * 0.7)}px;
                min-height: ${Math.round(settings.get_int('expanded-height') * 0.58)}px; }
            .nova-sample-dot { color: ${t['accent-color']}; font-size: 9px; }
            .nova-sample-weekday { color: ${t['accent-color']}; }
            .nova-sample-date { color: ${t['secondary-text-color']}; font-size: 13px; }
            .nova-sample-clock { font-weight: 300; font-size: ${t['clock-font-size'] + 30}px; }
            .nova-sample-dock image.nova-sample-active { color: ${t['accent-color']};
                background-color: ${rgba(t['accent-color'], 20)}; }
            .nova-theme-card.selected > box { box-shadow: inset 0 0 0 2px ${t['accent-color']};
                background-color: ${rgba(t['accent-color'], 10)}; }
            .nova-theme-check { background-color: ${t['accent-color']}; }
            ${swatches}
        `);
    };
    watch(settings, window, 'changed', update);
    update();
}

// Visual theme picker. Selecting a built-in theme writes all of its tokens.
export function createThemeGallery(section, settings, window) {
    const has = key => settings.settings_schema.has_key(key);
    if (!has('theme'))
        return;
    const flow = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, homogeneous: true,
        min_children_per_line: 2, max_children_per_line: 3, column_spacing: 12, row_spacing: 12,
        margin_top: 4});
    const cards = new Map();
    for (const [key, [name, tokens]] of Object.entries(THEMES)) {
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
        const swatch = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, valign: Gtk.Align.START});
        swatch.add_css_class(`nova-swatch-${key}`);
        const row = new Gtk.Box({spacing: 8, margin_start: 12, margin_top: 12, margin_end: 12});
        const dot = new Gtk.Box({valign: Gtk.Align.CENTER});
        dot.add_css_class('nova-swatch-dot');
        const time = new Gtk.Label({label: '10:42', xalign: 0});
        time.add_css_class('nova-swatch-time');
        row.append(dot);
        row.append(time);
        const bar = new Gtk.Box({margin_start: 12, margin_end: 40, margin_bottom: 12});
        bar.add_css_class('nova-swatch-bar');
        swatch.append(row);
        swatch.append(bar);
        const footer = new Gtk.Box({spacing: 6});
        const label = new Gtk.Label({label: name, xalign: 0, hexpand: true});
        label.add_css_class('nova-theme-name');
        const check = new Gtk.Image({icon_name: 'object-select-symbolic', pixel_size: 12, valign: Gtk.Align.CENTER});
        check.add_css_class('nova-theme-check');
        footer.append(label);
        footer.append(check);
        content.append(swatch);
        content.append(footer);
        const button = new Gtk.Button({child: content, tooltip_text: tokens ? `Apply ${name}` : 'Your own colors'});
        button.add_css_class('nova-theme-card');
        button.update_property([Gtk.AccessibleProperty.LABEL], [`${name} theme`]);
        button.connect('clicked', () => {
            if (tokens)
                writeSettings(settings, [...Object.entries(tokens), ['theme', key]].filter(([token]) => has(token)));
            else
                settings.set_string('theme', 'custom');
        });
        flow.append(button);
        cards.set(key, {button, check});
    }
    const sync = () => {
        const active = settings.get_string('theme');
        for (const [key, {button, check}] of cards) {
            check.visible = key === active;
            if (key === active)
                button.add_css_class('selected');
            else
                button.remove_css_class('selected');
        }
    };
    watch(settings, window, 'changed::theme', sync);
    sync();
    section.add(new Adw.Bin({child: flow}));

    // Editing any token by hand turns the selection into Custom.
    const themeKeys = THEME_TOKENS.filter(has);
    for (const key of themeKeys) {
        watch(settings, window, `changed::${key}`, () => {
            const tokens = THEMES[settings.get_string('theme')]?.[1];
            if (tokens && themeKeys.some(token => settings.get_value(token).deepUnpack() !== tokens[token]))
                settings.set_string('theme', 'custom');
        });
    }
}

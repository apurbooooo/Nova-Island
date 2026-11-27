import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop?version=4.0';
import St from 'gi://St';

import {box, chip, label, setChip} from '../ui/kit.js';

export function createClockWidget(lifecycle, onChanged) {
    const compact = new St.BoxLayout({
        style_class: 'nova-island-compact',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const dot = new St.Widget({
        style_class: 'nova-island-dot',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const time = new St.Label({
        style_class: 'nova-island-time',
        y_align: Clutter.ActorAlign.CENTER,
    });
    compact.add_child(dot);
    compact.add_child(time);

    const expanded = new St.BoxLayout({
        style_class: 'nova-island-preview',
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const weekday = label('', 'nova-clock-weekday', {x_align: Clutter.ActorAlign.CENTER, ellipsize: false});
    const largeTime = new St.Label({
        style_class: 'nova-island-preview-time',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const date = new St.Label({
        style_class: 'nova-island-preview-date',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const meta = box({style_class: 'nova-clock-meta', x_align: Clutter.ActorAlign.CENTER});
    const week = chip('', {iconName: 'x-office-calendar-symbolic'});
    const day = chip('');
    const zone = chip('', {iconName: 'preferences-system-time-symbolic'});
    [week, day, zone].forEach(actor => meta.add_child(actor));
    [weekday, largeTime, date, meta].forEach(actor => expanded.add_child(actor));

    const wallClock = new GnomeDesktop.WallClock({time_only: true});
    const refresh = () => {
        const now = GLib.DateTime.new_now_local();
        time.text = wallClock.clock;
        largeTime.text = time.text;
        weekday.text = now.format('%A').toLocaleUpperCase();
        date.text = now.format('%B %-d, %Y');
        const year = now.get_year();
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        setChip(week, `Week ${now.get_week_of_year()}`, 'neutral');
        setChip(day, `Day ${now.get_day_of_year()} of ${leap ? 366 : 365}`, 'neutral');
        const abbreviation = now.format('%Z');
        setChip(zone, /^[A-Za-z]{2,5}$/.test(abbreviation) ? abbreviation : `UTC${now.format('%:::z')}`, 'neutral');
    };
    refresh();
    lifecycle.connect(wallClock, 'notify::clock', () => {
        refresh();
        onChanged();
    });

    return {
        compact,
        expanded: new St.Button({child: expanded, button_mask: St.ButtonMask.PRIMARY, reactive: true}),
        clickPreview: true,
        fit: {minHeight: 150, maxHeight: 320},
        applyTheme(tokens, alignment) {
            compact.x_align = alignment;
            compact.style = `spacing: ${tokens['compact-spacing']}px;`;
            expanded.style = `spacing: ${tokens['expanded-spacing']}px;`;
            for (const actor of [weekday, largeTime, date, meta])
                actor.x_align = alignment;
            dot.style = `background-color: ${tokens['accent-color']}; box-shadow: 0 0 6px ${tokens['accent-color']};`;
            time.style = `font-size: ${tokens['clock-font-size']}px;`;
            weekday.style = `color: ${tokens['accent-color']};`;
            largeTime.style = `font-size: ${tokens['clock-font-size'] + 44}px;`;
            date.style = `color: ${tokens['secondary-text-color']};`;
        },
        describe: isExpanded => isExpanded ? `${largeTime.text}, ${weekday.text}, ${date.text}` : time.text,
    };
}

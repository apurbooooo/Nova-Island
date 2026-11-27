import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop?version=4.0';
import St from 'gi://St';

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
    const largeTime = new St.Label({
        style_class: 'nova-island-preview-time',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const date = new St.Label({
        style_class: 'nova-island-preview-date',
        x_align: Clutter.ActorAlign.CENTER,
    });
    expanded.add_child(largeTime);
    expanded.add_child(date);

    const wallClock = new GnomeDesktop.WallClock({time_only: true});
    const refresh = () => {
        time.text = wallClock.clock;
        largeTime.text = time.text;
        date.text = GLib.DateTime.new_now_local().format('%A, %B %-d');
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
        applyTheme(tokens, alignment) {
            compact.x_align = alignment;
            compact.style = `spacing: ${tokens['compact-spacing']}px;`;
            expanded.style = `spacing: ${tokens['expanded-spacing']}px;`;
            largeTime.x_align = alignment;
            date.x_align = alignment;
            dot.style = `background-color: ${tokens['accent-color']};`;
            time.style = `font-size: ${tokens['clock-font-size']}px;`;
            largeTime.style = `font-size: ${tokens['clock-font-size'] + 26}px;`;
            date.style = `color: ${tokens['secondary-text-color']};`;
        },
        describe: isExpanded => isExpanded ? `${largeTime.text}, ${date.text}` : time.text,
    };
}

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {NotificationManager} from '../notificationManager.js';
import {bindTheme, box, card, chip, emptyState, header, icon, iconButton, inkFor, label,
    pillButton, setEnabled} from '../ui/kit.js';

function age(time) {
    const minutes = Math.floor((Date.now() - time) / 60000);
    if (!Number.isFinite(minutes) || minutes < 1)
        return 'Now';
    if (minutes < 60)
        return `${minutes} min ago`;
    return GLib.DateTime.new_from_unix_local(Math.floor(time / 1000)).format('%H:%M');
}

export function createNotificationsWidget(lifecycle, onChanged, settings) {
    const compact = box({style_class: 'nova-notifications-compact', y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER});
    const compactIcon = icon('preferences-system-notifications-symbolic', 14);
    const count = label('Notifications');
    const badge = label('', 'nova-notifications-badge', {y_align: Clutter.ActorAlign.CENTER});
    bindTheme(badge, theme => (badge.style = `background-color: ${theme.accent}; color: ${inkFor(theme.accent)};`));
    compact.add_child(compactIcon);
    compact.add_child(count);
    compact.add_child(badge);

    const expanded = box({vertical: true, style_class: 'nova-tool', name: 'nova-notifications'});
    const head = header({iconName: 'preferences-system-notifications-symbolic', title: 'Notifications'});
    const quiet = chip('', {iconName: 'notifications-disabled-symbolic', tone: 'warning'});
    const clear = pillButton({text: 'Clear all', iconName: 'edit-clear-all-symbolic', name: 'nova-notifications-clear',
        style_class: 'nova-btn nova-btn-ghost'});
    head.trailing.add_child(quiet);
    head.trailing.add_child(clear);
    expanded.add_child(head.actor);
    const scroll = new St.ScrollView({x_expand: true, y_expand: true,
        hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
    const list = box({name: 'nova-notifications-list', vertical: true, style_class: 'nova-notifications-list',
        x_expand: true});
    scroll.set_child(list);
    expanded.add_child(scroll);

    let manager;
    const render = (peek = false) => {
        const history = manager?.history ?? [];
        count.text = history.length ? `${history.length} new` : 'Notifications';
        badge.visible = false;
        setEnabled(clear, history.length > 0);
        clear.opacity = history.length ? 255 : 0;
        const dnd = settings.get('notifications-dnd', false);
        const focus = settings.get('notifications-focus-mode', false) || settings.get('productivity-focus-active', false);
        quiet.visible = dnd || focus;
        quiet._caption.text = dnd ? 'Do Not Disturb' : 'Focus';
        head.setSubtitle(history.length
            ? `${history.length} recent · only this session`
            : 'Private session history');
        for (const child of list.get_children())
            child.destroy();
        if (!history.length) {
            list.add_child(emptyState({iconName: 'preferences-system-notifications-symbolic',
                title: 'You’re all caught up',
                body: dnd ? 'Do Not Disturb is on — NOVA won’t expand for new notifications.'
                    : 'New notifications will appear here while you’re signed in.'}));
        } else {
            history.forEach((entry, index) => {
                const item = card('nova-notifications-item', false, {x_expand: true});
                const appIcon = new St.Bin({style_class: 'nova-notifications-app-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                    child: entry.icon ? new St.Icon({gicon: entry.icon, icon_size: 18})
                        : icon('preferences-system-notifications-symbolic', 18)});
                const text = box({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
                const meta = box({style: 'spacing: 6px;'});
                meta.add_child(label(entry.source || 'Application', 'nova-notifications-source'));
                if (entry.time)
                    meta.add_child(label(`· ${age(entry.time)}`, 'nova-notifications-source nova-faint'));
                if (entry.urgency >= MessageTray.Urgency.HIGH) {
                    const critical = entry.urgency >= MessageTray.Urgency.CRITICAL;
                    meta.add_child(new St.Widget({style_class: `nova-notifications-priority ${critical
                        ? 'nova-priority-critical' : 'nova-priority-high'}`, y_align: Clutter.ActorAlign.CENTER}));
                    meta.add_child(label(critical ? 'Critical' : 'High priority',
                        `nova-notifications-source`, {style: `color: ${critical ? '#ff9a9a' : '#ffcf7f'};`}));
                }
                text.add_child(meta);
                text.add_child(label(entry.title || '(No title)', 'nova-notifications-title', {wrap: true}));
                const dismiss = iconButton({iconName: 'window-close-symbolic', size: 12,
                    accessibleName: `Remove ${entry.title} from NOVA history`,
                    callback: () => manager.dismiss(index)});
                item.add_child(appIcon);
                item.add_child(text);
                item.add_child(dismiss);
                list.add_child(item);
            });
        }
        onChanged(peek ? settings.get('notifications-peek-duration', 3500) : false);
    };
    const configure = () => {
        if (settings.get('notifications-enabled', false))
            manager ??= new NotificationManager(settings, render);
        else if (manager) {
            manager.destroy();
            manager = null;
        }
        render();
    };
    configure();
    clear.connect('clicked', () => manager?.clear());
    lifecycle.connect(expanded, 'notify::mapped', () => {
        if (expanded.mapped)
            render();
    });
    lifecycle.add(() => manager?.destroy());

    return {
        compact, expanded, fit: {minWidth: 456, maxHeight: 520},
        get available() { return true; },
        configure,
        describe() { return count.text; },
        applyTheme(tokens) {
            compact.style = `spacing: ${Math.min(10, tokens['compact-spacing'])}px;`;
        },
    };
}

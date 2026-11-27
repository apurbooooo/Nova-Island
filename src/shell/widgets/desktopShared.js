import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {MODULE_ICONS} from '../../shared/studio.js';
import {box, clearChildren, header, icon, label, pillButton} from '../ui/kit.js';

export {clearChildren};

// Common module scaffold: compact pill content plus a header and scrollable body.
export function toolView(id, title, {subtitle = '', scroll = true, fit = {}} = {}) {
    const iconName = MODULE_ICONS[id] ?? 'application-x-addon-symbolic';
    const compact = box({style_class: 'nova-tool-compact', y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER});
    const compactIcon = icon(iconName, 14);
    const compactLabel = label(title, '');
    compact.add_child(compactIcon);
    compact.add_child(compactLabel);
    const expanded = box({name: `nova-${id}`, vertical: true, style_class: 'nova-tool',
        x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL});
    const head = header({iconName, title, subtitle});
    expanded.add_child(head.actor);
    const content = box({vertical: true, style_class: 'nova-tool-content', x_expand: true});
    if (scroll) {
        const view = new St.ScrollView({x_expand: true, y_expand: true, overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        view.set_child(content);
        expanded.add_child(view);
    } else {
        content.y_expand = true;
        expanded.add_child(content);
    }
    return {compact, compactLabel, compactIcon, expanded, content, header: head, fit,
        describe: () => title, applyTheme() {}};
}

// Kept for callers that want a full-width secondary action.
export function toolButton(parent, text, callback, name = '') {
    const button = pillButton({text, callback, name: name || null, x_expand: true});
    parent.add_child(button);
    return button;
}

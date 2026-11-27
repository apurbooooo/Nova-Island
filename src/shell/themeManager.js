import Clutter from 'gi://Clutter';

import {surfaceStyle} from '../shared/studio.js';

export function contentAlignment(value) {
    return {start: Clutter.ActorAlign.START, end: Clutter.ActorAlign.END}[value] ?? Clutter.ActorAlign.CENTER;
}

export function applyAppearance(actor, tokens, compact, emphasized) {
    const highlight = emphasized ? ` border-color: ${tokens['accent-color']};` : '';
    actor.style = surfaceStyle(tokens, compact) + highlight;
}

export function applyPinnedStyle(actor, pinned) {
    if (pinned)
        actor.add_style_class_name('nova-island-pinned');
    else
        actor.remove_style_class_name('nova-island-pinned');
}

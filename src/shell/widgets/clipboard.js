import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ClipboardManager} from '../../desktop/clipboard.js';
import {toolView, clearChildren} from './desktopShared.js';
import {bindTheme, box, card, chip, emptyState, icon, iconButton, imageContent, label, pillButton,
    relativeTime, rgbaCss, searchEntry, sectionTitle, setChip, setEmptyState, setEnabled} from '../ui/kit.js';

const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 76;

export function createClipboardWidget(lifecycle, onChanged, settings) {
    const view = toolView('clipboard', _('Clipboard'), {fit: {minWidth: 456, maxHeight: 540}});
    const status = chip(_('Off'), {tone: 'neutral'});
    const clear = pillButton({text: _('Clear'), iconName: 'edit-clear-all-symbolic', name: 'nova-clipboard-clear',
        style_class: 'nova-btn nova-btn-ghost', callback: () => {
            manager.clear();
            render();
        }});
    view.header.trailing.add_child(status);
    view.header.trailing.add_child(clear);
    const search = searchEntry('nova-clipboard-search', _('Search clipboard history'), _('Search clipboard'));
    view.expanded.insert_child_at_index(search, 1);

    const empty = emptyState({iconName: 'edit-paste-symbolic', title: _('Clipboard capture is off')});
    const openSettings = pillButton({text: _('Open Settings'), iconName: 'emblem-system-symbolic', primary: true,
        callback: () => onChanged('preferences')});
    openSettings.x_align = Clutter.ActorAlign.CENTER;
    empty.add_child(openSettings);
    view.content.add_child(empty);
    const pinnedTitle = sectionTitle(_('Pinned'));
    const pinned = box({name: 'nova-clipboard-pinned', vertical: true, style_class: 'nova-clip-list'});
    const recentTitle = sectionTitle(_('Recent'));
    const list = box({name: 'nova-clipboard-list', vertical: true, style_class: 'nova-clip-list'});
    const noMatches = label(_('No matching items'), 'nova-caption', {x_align: Clutter.ActorAlign.CENTER});
    [pinnedTitle, pinned, recentTitle, list, noMatches].forEach(actor => view.content.add_child(actor));

    const thumbnails = new Map();
    const thumbnail = item => {
        if (thumbnails.has(item.id))
            return thumbnails.get(item.id);
        let content = null;
        try {
            const loader = GdkPixbuf.PixbufLoader.new_with_type('png');
            loader.write_bytes(new GLib.Bytes(GLib.base64_decode(item.data)));
            loader.close();
            const source = loader.get_pixbuf();
            const ratio = Math.min(THUMB_WIDTH / source.width, THUMB_HEIGHT / source.height, 1);
            const scaled = source.scale_simple(Math.max(1, Math.round(source.width * ratio)),
                Math.max(1, Math.round(source.height * ratio)), GdkPixbuf.InterpType.BILINEAR);
            content = imageContent(scaled);
        } catch {
            content = null;
        }
        thumbnails.set(item.id, content);
        return content;
    };

    let flash = 0;
    const manager = new ClipboardManager(settings, () => { if (view.expanded.mapped) render(); });
    function row(item) {
        const actor = card('nova-clip-item', false, {x_expand: true});
        const content = box({style_class: 'nova-clip-main-content', x_expand: true});
        const image = item.type === 'image/png';
        if (image) {
            const preview = thumbnail(item);
            content.add_child(new St.Bin({style_class: 'nova-clip-thumb', content: preview,
                content_gravity: Clutter.ContentGravity.RESIZE_ASPECT,
                child: preview ? null : icon('image-x-generic-symbolic', 18), y_align: Clutter.ActorAlign.CENTER}));
        } else {
            const kind = /^https?:\/\//i.test(item.text.trim()) ? 'insert-link-symbolic' : 'text-x-generic-symbolic';
            content.add_child(new St.Bin({style_class: 'nova-clip-kind', child: icon(kind, 16),
                y_align: Clutter.ActorAlign.CENTER}));
        }
        const text = box({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        text.add_child(label(image ? _('Image') : item.text.replace(/\s+/g, ' ').trim().slice(0, 140), 'nova-clip-text'));
        const kb = Math.max(1, Math.round(item.size / 1024));
        text.add_child(label(`${image ? `PNG · ${kb} KB` : `${item.text.length} ${_('characters')}`} · ${relativeTime(item.created)}`,
            'nova-caption'));
        content.add_child(text);
        const main = new St.Button({style_class: 'nova-clip-main', child: content, x_expand: true, can_focus: true,
            reactive: true, accessible_name: image ? _('Copy image') : `${_('Copy')} ${item.text.slice(0, 60)}`});
        main.connect('clicked', () => {
            manager.copy(item);
            setChip(status, _('Copied'), 'accent');
            if (flash)
                GLib.Source.remove(flash);
            flash = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1400, () => {
                flash = 0;
                syncStatus();
                return GLib.SOURCE_REMOVE;
            });
        });
        const pin = iconButton({iconName: 'view-pin-symbolic', size: 14,
            accessibleName: item.pinned ? _('Unpin') : _('Pin'), callback: () => {
                item.pinned = !item.pinned;
                render();
            }});
        if (item.pinned)
            bindTheme(pin, theme => (pin.style = `color: ${theme.accent}; background-color: ${rgbaCss(theme.accent, 0.14)};`));
        const remove = iconButton({iconName: 'user-trash-symbolic', size: 14, accessibleName: _('Delete'),
            callback: () => {
                manager.history.items = manager.history.items.filter(entry => entry.id !== item.id);
                render();
            }});
        actor.add_child(main);
        actor.add_child(pin);
        actor.add_child(remove);
        return actor;
    }
    function syncStatus() {
        const capturing = manager.allowed();
        setChip(status, capturing ? _('Capturing') : _('Off'), capturing ? 'success' : 'neutral');
        view.header.setSubtitle(capturing ? _('Session-only history · cleared on lock')
            : _('Capture is off'));
    }
    function render() {
        syncStatus();
        clearChildren(pinned);
        clearChildren(list);
        const all = manager.history.search(search.get_text());
        const capturing = manager.allowed();
        const hasAny = manager.history.items.length > 0;
        for (const id of thumbnails.keys()) {
            if (!manager.history.items.some(item => item.id === id))
                thumbnails.delete(id);
        }
        for (const item of all)
            (item.pinned ? pinned : list).add_child(row(item));
        empty.visible = !hasAny;
        openSettings.visible = !capturing;
        setEmptyState(empty, capturing
            ? {iconName: 'edit-paste-symbolic', title: _('Nothing copied yet'),
                body: _('Copy text or an image and it will show up here. Items stay in memory only.')}
            : {iconName: 'edit-paste-symbolic', title: _('Clipboard capture is off'),
                body: _('Turn on capture to keep a private, in-memory history of text and images.')});
        search.visible = hasAny;
        setEnabled(clear, hasAny);
        clear.opacity = hasAny ? 255 : 0;
        pinnedTitle.visible = pinned.get_n_children() > 0;
        recentTitle.visible = list.get_n_children() > 0 && pinnedTitle.visible;
        noMatches.visible = hasAny && all.length === 0;
        onChanged(false);
    }
    lifecycle.connect(search.clutter_text, 'text-changed', render);
    lifecycle.connect(view.expanded, 'notify::mapped', () => { if (view.expanded.mapped) render(); });
    lifecycle.add(() => {
        if (flash)
            GLib.Source.remove(flash);
        thumbnails.clear();
        manager.destroy();
    });
    return {...view, configure() { manager.configure(); if (view.expanded.mapped) render(); }};
}

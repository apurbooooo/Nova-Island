import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {CATEGORIES, EMOJI, searchEmoji, addRecent} from '../../desktop/emoji.js';
import {toolView, clearChildren} from './desktopShared.js';
import {box, card, emptyState, label, searchEntry, segmented, setEmptyState} from '../ui/kit.js';

const DIRECTIONS = new Map([
    [Clutter.KEY_Left, St.DirectionType.LEFT], [Clutter.KEY_Right, St.DirectionType.RIGHT],
    [Clutter.KEY_Up, St.DirectionType.UP], [Clutter.KEY_Down, St.DirectionType.DOWN],
]);

export function createEmojiWidget(lifecycle, onChanged, settings) {
    const view = toolView('emoji', _('Emoji'), {subtitle: _('Choose to copy, then paste anywhere'),
        fit: {minWidth: 456, maxHeight: 500, minHeight: 360}});
    const search = searchEntry('nova-emoji-search', _('Search emoji, symbols, kaomoji'), _('Search emoji'));
    view.expanded.insert_child_at_index(search, 1);
    const tabs = segmented([['recent', _('Recent'), 'emoji-recent-symbolic'],
        ...CATEGORIES.map(([key, title, iconName]) => [key, _(title), iconName])], key => {
        category = key;
        search.set_text('');
        render();
    }, {iconsOnly: true});
    view.expanded.insert_child_at_index(tabs.actor, 2);
    const heading = label('', 'nova-section-title');
    view.content.add_child(heading);
    const results = new St.Widget({name: 'nova-emoji-results', style_class: 'nova-emoji-grid', x_expand: true,
        layout_manager: new Clutter.FlowLayout({orientation: Clutter.Orientation.HORIZONTAL,
            column_spacing: 4, row_spacing: 4})});
    view.content.add_child(results);
    const empty = emptyState({iconName: 'face-smile-symbolic', title: _('No emoji found')});
    view.content.add_child(empty);

    const footer = card('nova-emoji-footer', false, {x_expand: true});
    const glyph = label('😀', 'nova-emoji-preview', {ellipsize: false});
    const info = box({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const name = label('', 'nova-card-title');
    const status = label(_('Enter copies the first result'), 'nova-caption');
    info.add_child(name);
    info.add_child(status);
    footer.add_child(glyph);
    footer.add_child(info);
    view.expanded.add_child(footer);

    let category = null;
    let matches = EMOJI;
    let flash = 0;
    function recent() {
        try {
            const saved = settings.get('emoji-recent', '[]');
            if (saved.length > 4096)
                return [];
            return JSON.parse(saved).filter(item => typeof item === 'string').slice(0, 20);
        } catch {
            return [];
        }
    }
    function describe([text, keywords]) {
        glyph.text = text;
        name.text = keywords.replace(/\b(kaomoji|symbol)\b/g, '').trim() || text;
    }
    function copy(text) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        settings.set('emoji-recent', JSON.stringify(addRecent(recent(), text)));
        status.text = _('Copied to clipboard');
        if (flash)
            GLib.Source.remove(flash);
        flash = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1600, () => {
            flash = 0;
            status.text = _('Enter copies the first result');
            return GLib.SOURCE_REMOVE;
        });
    }
    function render() {
        clearChildren(results);
        const query = search.get_text();
        const saved = recent();
        if (!category)
            category = saved.length ? 'recent' : 'smileys';
        if (query) {
            matches = searchEmoji(query, saved);
            tabs.select(null);
            heading.text = `${_('Results')} · ${matches.length}`.toLocaleUpperCase();
        } else if (category === 'recent') {
            matches = saved.map(text => EMOJI.find(([emoji]) => emoji === text)).filter(Boolean);
            tabs.select('recent');
            heading.text = _('Recently used').toLocaleUpperCase();
        } else {
            matches = searchEmoji('', [], category);
            tabs.select(category);
            heading.text = _(CATEGORIES.find(([key]) => key === category)?.[1] ?? '').toLocaleUpperCase();
        }
        for (const entry of matches) {
            const [text, keywords, group] = entry;
            const button = new St.Button({label: text, accessible_name: `${text} ${keywords}`, can_focus: true,
                reactive: true, style_class: `nova-emoji-cell${group === 'kaomoji' ? ' nova-emoji-kaomoji' : ''}`});
            button.connect('clicked', () => copy(text));
            button.connect('notify::hover', () => {
                if (button.hover)
                    describe(entry);
            });
            button.connect('key-focus-in', () => describe(entry));
            results.add_child(button);
        }
        if (matches.length)
            describe(matches[0]);
        empty.visible = matches.length === 0;
        setEmptyState(empty, category === 'recent' && !query
            ? {iconName: 'emoji-recent-symbolic', title: _('No recent emoji'), body: _('Emoji you copy appear here.')}
            : {iconName: 'face-smile-symbolic', title: _('No emoji found'), body: _('Try another word, like “heart” or “party”.')});
        onChanged(false);
    }
    lifecycle.connect(search.clutter_text, 'text-changed', render);
    lifecycle.connect(search.clutter_text, 'activate', () => { if (matches.length) copy(matches[0][0]); });
    const keys = new Clutter.KeyController();
    search.add_action(keys);
    lifecycle.connect(keys, 'key-press', () => {
        const [valid, key] = keys.get_key();
        if (valid && key === Clutter.KEY_Down)
            return results.navigate_focus(null, St.DirectionType.TAB_FORWARD, false) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_PROPAGATE;
    });
    // Arrow keys move through the grid; Up from the first row returns to search.
    const gridKeys = new Clutter.KeyController();
    results.add_action(gridKeys);
    lifecycle.connect(gridKeys, 'key-press', () => {
        const [valid, key] = gridKeys.get_key();
        const direction = valid ? DIRECTIONS.get(key) : undefined;
        if (direction === undefined)
            return Clutter.EVENT_PROPAGATE;
        const focused = global.stage.get_key_focus();
        if (results.navigate_focus(focused, direction, false))
            return Clutter.EVENT_STOP;
        if (direction === St.DirectionType.UP)
            search.grab_key_focus();
        return Clutter.EVENT_STOP;
    });
    lifecycle.connect(view.expanded, 'notify::mapped', () => { if (view.expanded.mapped) render(); });
    lifecycle.add(() => {
        if (flash)
            GLib.Source.remove(flash);
    });
    return {...view, configure() { if (view.expanded.mapped) render(); }};
}

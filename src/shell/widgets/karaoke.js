import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {activeCue, cueAt} from '../../media/lyricTiming.js';
import {COLOR_PATTERN} from '../../shared/studio.js';
import {motionEnabled} from '../animationEngine.js';

const escape = text => GLib.markup_escape_text(text, -1);
function lineLabel() {
    const label = new St.Label({x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.line_alignment = Pango.Alignment.CENTER;
    label.set_pivot_point(0.5, 0.5);
    return label;
}

export class KaraokeView {
    constructor(settings) {
        this.settings = settings;
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_expand: true, style_class: 'nova-karaoke', name: 'nova-media-lyrics-view'});
        this.heading = new St.Label({style_class: 'nova-lyrics-heading'});
        this.stage = new St.Widget({layout_manager: new Clutter.BinLayout(), clip_to_allocation: true,
            x_expand: true, y_expand: true});
        this.rows = Array.from({length: 5}, () => {
            const actor = lineLabel();
            this.stage.add_child(actor);
            return actor;
        });
        this.scroll = new St.ScrollView({x_expand: true, y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this.message = lineLabel();
        const body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
        this.stateIcon = new St.Icon({icon_size: 32, x_align: Clutter.ActorAlign.CENTER,
            style_class: 'nova-lyrics-state-icon'});
        body.add_child(this.stateIcon);
        body.add_child(this.message);
        this.scroll.set_child(body);
        this.nav = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style_class: 'nova-lyrics-nav'});
        for (const [name, iconName, step] of [['Previous lyric line', 'go-up-symbolic', -1],
            ['Return to current line', null, 0], ['Next lyric line', 'go-down-symbolic', 1]]) {
            const button = new St.Button({accessible_name: name, can_focus: true, reactive: true,
                style_class: iconName ? 'nova-media-action' : 'nova-media-action nova-media-pill'});
            if (iconName)
                button.child = new St.Icon({icon_name: iconName, icon_size: 14});
            else
                button.label = 'Now playing';
            button.connect('clicked', () => this.navigate(step));
            this.nav.add_child(button);
        }
        for (const actor of [this.heading, this.stage, this.scroll, this.nav])
            this.actor.add_child(actor);
        this.stage.connect('notify::width', () => this.paint(true));
        this.stage.connect('notify::height', () => this.paint(true));
        this.configure();
    }

    configure() {
        const get = (key, fallback) => this.settings.get('lyrics-' + key, fallback);
        const color = (key, fallback) => {
            const value = get(key, fallback);
            return COLOR_PATTERN.test(value) ? value : fallback;
        };
        this.currentColor = color('current-color', '#9ff2d5');
        this.wordColor = color('word-color', '#ffffff');
        this.currentSize = get('current-size', 30);
        this.otherSize = get('neighbor-size', 23);
        this.inactive = Math.round(2.55 * get('inactive-opacity', 54));
        this.gap = get('spacing', 18);
        this.speed = get('scroll-duration', 260);
        this.transition = get('transition', 'slide');
        this.highlight = get('word-highlight', true);
        this.auto = get('auto-scroll', true);
        this.message.style = `font-size: ${get('font-size', 21)}px;`;
        this.motion = motionEnabled(this.settings) && this.transition !== 'none';
        this.center = undefined;
        this.paint(true);
    }

    setContent(result, plain, status, title, message) {
        const changed = this.result !== result || this.plain !== plain || this.trackTitle !== title;
        this.result = result;
        this.plain = plain;
        this.trackTitle = title;
        this.lines = plain ? null : result?.timed;
        this.heading.text = [status, title].filter(Boolean).join('  ·  ');
        this.stage.visible = Boolean(this.lines?.length);
        this.scroll.visible = !this.stage.visible;
        this.stateIcon.visible = !this.stage.visible && !result?.plain;
        if (this.stateIcon.visible) {
            this.stateIcon.icon_name = result?.retry ? 'network-error-symbolic' :
                status === 'Loading…' ? 'content-loading-symbolic' : 'audio-x-generic-symbolic';
        }
        this.message.name = this.stage.visible ? null : 'nova-media-lyric-text';
        if (!this.stage.visible)
            this.rows.forEach(row => row.name = null);
        if (!this.stage.visible)
            this.message.text = result?.plain || message || result?.message || '';
        this.nav.visible = this.stage.visible;
        if (changed) {
            this.manual = null;
            this.center = undefined;
            this.scroll.vadjustment.value = 0;
            for (const row of this.rows)
                row._line = undefined;
        }
    }

    navigate(step) {
        this.manual = step ? Math.max(0, Math.min(this.lines.length - 1, (this.center ?? 0) + step)) : null;
        this.center = undefined;
        this.paint();
    }

    update(seconds, playing, ended = false) {
        const force = playing !== this.playing || ended !== this.ended;
        this.ended = ended;
        this.seconds = seconds;
        this.playing = playing;
        this.paint(force);
    }

    paint(force = false) {
        if (!this.actor.visible || !this.lines?.length || this.seconds == null)
            return;
        const latest = cueAt(this.lines, this.seconds);
        const active = this.ended ? -1 : activeCue(this.lines, this.seconds);
        const center = this.manual ?? (!this.auto && this.center != null ? this.center : Math.max(0, latest));
        const word = this.highlight && center === active ? activeCue(this.lines[center].words ?? [], this.seconds) : -1;
        const words = this.lines[center].words ?? [];
        const sung = this.highlight && center === active ? cueAt(words, this.seconds) : -1;
        // Four color steps soften the onset without changing glyph metrics or measuring the row.
        const phase = word >= 0 && this.motion && this.playing
            ? Math.min(4, 1 + Math.floor((this.seconds - words[word].seconds) / 0.032)) : 4;
        if (!force && sung === this.sung && phase === this.phase && this.center === center && this.active === active && this.word === word)
            return;
        const layout = force || this.center !== center || this.active !== active;
        this.center = center;
        this.active = active;
        this.word = word;
        this.sung = sung;
        this.phase = phase;
        const line = this.lines[center];
        const current = this.rows[center % 5];
        if (layout) {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const heights = [];
            const visible = [];
            for (let index = center - 2; index <= center + 2; index++) {
                const row = this.rows[(index % 5 + 5) % 5];
                const cue = this.lines[index];
                row.visible = Boolean(cue);
                row.name = index === center ? 'nova-media-lyric-text' : null;
                if (!cue)
                    continue;
                const selected = index === active;
                row.style = `font-size: ${selected ? this.currentSize : this.otherSize}px; font-weight: ${selected ? 800 : 500}; color: ${selected ? this.currentColor : '#e6ebf2'};`;
                row.text = cue.text || '♪';
                const width = this.stage.has_allocation() ? this.stage.get_allocation_box().get_width() : this.stage.width;
                heights[index - center + 2] = row.get_preferred_height(Math.max(1, width))[1];
                visible.push([index, row, selected]);
            }
            for (const [index, row, selected] of visible) {
                let offset = 0;
                const direction = Math.sign(index - center);
                for (let i = center; i !== index; i += direction)
                    offset += direction * ((heights[i - center + 2] + heights[i + direction - center + 2]) / 2 + this.gap * scale);
                const target = {translation_y: offset, opacity: selected ? 255 : this.inactive,
                    scale_x: selected ? 1 : 0.98, scale_y: selected ? 1 : 0.98};
                const animate = this.actor.mapped && this.playing && motionEnabled(this.settings) &&
                    this.transition !== 'none' && this.speed > 0;
                row.remove_all_transitions();
                if (animate) {
                    if (row._line !== index) {
                        row.opacity = 0;
                        row.translation_y = offset + (this.transition === 'slide' ? 14 * scale : 0);
                    }
                    if (this.transition === 'fade')
                        row.translation_y = offset;
                    row.ease({...target, duration: this.speed, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                } else {
                    Object.assign(row, target);
                }
                row._line = index;
            }
        }
        if (sung >= 0) {
            const {start, end} = words[sung];
            const color = '#' + [1, 3, 5].map(i => {
                const from = parseInt(this.currentColor.slice(i, i + 2), 16);
                const to = parseInt(this.wordColor.slice(i, i + 2), 16);
                return Math.round(from + (to - from) * phase / 4).toString(16).padStart(2, '0');
            }).join('');
            current.clutter_text.set_markup(escape(line.text.slice(0, start)) +
                `<span foreground="${word >= 0 ? color : this.currentColor}">${escape(line.text.slice(start, end))}</span>` +
                `<span alpha="76%">${escape(line.text.slice(end))}</span>`);
        } else {
            current.text = line.text || '♪';
        }
    }
}

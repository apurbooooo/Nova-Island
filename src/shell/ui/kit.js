// NOVA Island shared UI kit: one visual language for every module.
import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

const DEFAULT_ACCENT = '#bdceff';

export function hexToRgb(hex) {
    const value = /^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex : DEFAULT_ACCENT;
    return value.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255);
}

export function rgbaCss(hex, alpha) {
    const [r, g, b] = hexToRgb(hex).map(value => Math.round(value * 255));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Dark ink on light accents, white on saturated or dark accents.
export function inkFor(hex) {
    const [r, g, b] = hexToRgb(hex).map(value =>
        value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#0b1020' : '#ffffff';
}

class ThemeBus extends EventEmitter {
    accent = DEFAULT_ACCENT;
    text = '#f3f5fc';
    secondary = '#b2bcd6';

    set(tokens) {
        const next = [tokens['accent-color'], tokens['text-color'], tokens['secondary-text-color']];
        if (next[0] === this.accent && next[1] === this.text && next[2] === this.secondary)
            return;
        [this.accent, this.text, this.secondary] = next.map((value, index) =>
            /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : [DEFAULT_ACCENT, '#f3f5fc', '#b2bcd6'][index]);
        this.emit('changed');
    }
}

export const Theme = new ThemeBus();

// Runs `apply` now and on each theme change until the actor is destroyed.
export function bindTheme(actor, apply) {
    apply(Theme);
    const id = Theme.connect('changed', () => apply(Theme));
    actor.connect('destroy', () => Theme.disconnect(id));
}

export function box({vertical = false, style_class = '', name = null, ...props} = {}) {
    return new St.BoxLayout({style_class, name, orientation: vertical
        ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL, ...props});
}

export function label(text = '', style_class = '', {wrap = false, ellipsize = true, ...props} = {}) {
    const actor = new St.Label({text, style_class, y_align: Clutter.ActorAlign.CENTER, ...props});
    if (wrap) {
        actor.clutter_text.line_wrap = true;
        actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        actor.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    } else {
        // St.Label ellipsizes by default; letter-spaced captions need it off.
        actor.clutter_text.ellipsize = ellipsize ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE;
    }
    return actor;
}

export function icon(icon_name, icon_size = 16, style_class = '') {
    return new St.Icon({icon_name, icon_size, style_class, y_align: Clutter.ActorAlign.CENTER});
}

export function iconButton({iconName, accessibleName, callback, name = null, style_class = 'nova-icon-btn',
    size = 16}) {
    const button = new St.Button({name, style_class, accessible_name: accessibleName, can_focus: true,
        reactive: true, child: icon(iconName, size), y_align: Clutter.ActorAlign.CENTER});
    if (callback)
        button.connect('clicked', callback);
    return button;
}

export function setButtonIcon(button, iconName) {
    if (button.child instanceof St.Icon)
        button.child.icon_name = iconName;
}

// Text button with an optional leading icon. `primary` buttons follow the accent.
export function pillButton({text, iconName = null, callback, name = null, primary = false,
    style_class = 'nova-btn', x_expand = false}) {
    const content = box({style_class: 'nova-btn-content', x_align: Clutter.ActorAlign.CENTER});
    const glyph = iconName ? icon(iconName, 15) : null;
    if (glyph)
        content.add_child(glyph);
    const caption = label(text, 'nova-btn-label');
    content.add_child(caption);
    const button = new St.Button({name, style_class, child: content, accessible_name: text,
        can_focus: true, reactive: true, x_expand});
    button._caption = caption;
    button._glyph = glyph;
    if (primary)
        makePrimary(button);
    if (callback)
        button.connect('clicked', callback);
    return button;
}

export function setPillText(button, text, iconName) {
    button._caption.text = text;
    button.accessible_name = text;
    if (iconName && button._glyph)
        button._glyph.icon_name = iconName;
}

export function makePrimary(button) {
    button.add_style_class_name('nova-btn-primary');
    bindTheme(button, theme => {
        button.style = `background-color: ${theme.accent}; color: ${inkFor(theme.accent)};`;
    });
}

export function setEnabled(actor, enabled) {
    actor.reactive = enabled;
    actor.can_focus = enabled;
    if (enabled)
        actor.remove_style_pseudo_class('insensitive');
    else
        actor.add_style_pseudo_class('insensitive');
}

export function card(extra = '', vertical = true, props = {}) {
    return box({vertical, style_class: `nova-card ${extra}`.trim(), ...props});
}

export function chip(text, {iconName = null, tone = 'neutral', name = null} = {}) {
    const actor = box({style_class: `nova-chip nova-chip-${tone}`, name, y_align: Clutter.ActorAlign.CENTER});
    if (iconName)
        actor.add_child(icon(iconName, 12));
    const caption = label(text, 'nova-chip-label');
    actor.add_child(caption);
    actor._caption = caption;
    return actor;
}

export function setChip(actor, text, tone) {
    actor._caption.text = text;
    for (const name of ['neutral', 'accent', 'success', 'warning', 'danger'])
        actor.remove_style_class_name(`nova-chip-${name}`);
    actor.add_style_class_name(`nova-chip-${tone}`);
}

export function sectionTitle(text) {
    return label(text.toLocaleUpperCase(), 'nova-section-title', {ellipsize: false});
}

// Standard module header: tinted icon badge, title, subtitle, and trailing slot.
export function header({iconName, title, subtitle = ''}) {
    const actor = box({style_class: 'nova-header'});
    const badge = new St.Bin({style_class: 'nova-header-badge', child: icon(iconName, 16),
        y_align: Clutter.ActorAlign.CENTER});
    bindTheme(badge, theme => {
        badge.style = `background-color: ${rgbaCss(theme.accent, 0.16)}; color: ${theme.accent};`;
    });
    const text = box({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const heading = label(title, 'nova-header-title');
    const caption = label(subtitle, 'nova-header-subtitle');
    caption.visible = Boolean(subtitle);
    text.add_child(heading);
    text.add_child(caption);
    const trailing = box({style_class: 'nova-header-trailing', y_align: Clutter.ActorAlign.CENTER});
    actor.add_child(badge);
    actor.add_child(text);
    actor.add_child(trailing);
    return {
        actor, trailing, title: heading,
        setSubtitle(value) {
            caption.text = value ?? '';
            caption.visible = Boolean(value);
        },
    };
}

export function emptyState({iconName, title, body = '', name = null}) {
    const actor = box({vertical: true, style_class: 'nova-empty', name, x_expand: true,
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
    const halo = new St.Bin({style_class: 'nova-empty-icon', child: icon(iconName, 26),
        x_align: Clutter.ActorAlign.CENTER});
    bindTheme(halo, theme => {
        halo.style = `background-color: ${rgbaCss(theme.accent, 0.12)}; color: ${theme.accent};`;
    });
    const heading = label(title, 'nova-empty-title', {x_align: Clutter.ActorAlign.CENTER});
    const text = label(body, 'nova-empty-body', {wrap: true, x_align: Clutter.ActorAlign.CENTER});
    text.clutter_text.line_alignment = Pango.Alignment.CENTER;
    text.visible = Boolean(body);
    actor.add_child(halo);
    actor.add_child(heading);
    actor.add_child(text);
    actor._title = heading;
    actor._body = text;
    actor._icon = halo.child;
    return actor;
}

export function setEmptyState(actor, {iconName, title, body}) {
    if (iconName)
        actor._icon.icon_name = iconName;
    if (title !== undefined)
        actor._title.text = title;
    if (body !== undefined) {
        actor._body.text = body;
        actor._body.visible = Boolean(body);
    }
}

export function searchEntry(name, hint, accessibleName) {
    const entry = new St.Entry({name, hint_text: hint, can_focus: true, x_expand: true,
        style_class: 'nova-search', primary_icon: icon('edit-find-symbolic', 15, 'nova-search-icon')});
    entry.clutter_text.accessible_name = accessibleName;
    return entry;
}

// Segmented control. Items: [key, label, iconName, name].
export function segmented(items, onSelect, {iconsOnly = false} = {}) {
    const actor = box({style_class: 'nova-segmented', x_expand: true});
    const buttons = new Map();
    for (const [key, text, iconName, name] of items) {
        const content = box({style_class: 'nova-segment-content', x_align: Clutter.ActorAlign.CENTER});
        if (iconName)
            content.add_child(icon(iconName, 14));
        if (!iconsOnly)
            content.add_child(label(text, 'nova-segment-label'));
        const button = new St.Button({name: name ?? null, style_class: 'nova-segment', child: content,
            accessible_name: text, can_focus: true, reactive: true, x_expand: true, toggle_mode: false});
        button.connect('clicked', () => onSelect(key));
        actor.add_child(button);
        buttons.set(key, button);
    }
    let current = null;
    const paint = theme => {
        for (const [key, button] of buttons) {
            button.checked = key === current;
            button.style = key === current
                ? `background-color: ${rgbaCss(theme.accent, 0.2)}; color: ${theme.accent};` : '';
        }
    };
    bindTheme(actor, paint);
    return {
        actor, buttons,
        select(key) {
            current = key;
            paint(Theme);
        },
    };
}

export function clearChildren(parent) {
    for (const child of parent.get_children())
        child.destroy();
}

function roundedRect(cr, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    cr.newSubPath();
    cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

function drawingArea(style_class, name, paint) {
    const area = new St.DrawingArea({style_class, name, x_expand: true});
    area.connect('repaint', () => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        try {
            paint(cr, width, height, St.ThemeContext.get_for_stage(global.stage).scale_factor);
        } finally {
            cr.$dispose();
        }
    });
    bindTheme(area, () => area.queue_repaint());
    return area;
}

// Horizontal meter with a rounded track. Fraction is clamped to 0..1.
export class Meter {
    constructor({style_class = 'nova-meter', name = null, color = null} = {}) {
        this.fraction = 0;
        this.color = color;
        this.actor = drawingArea(style_class, name, (cr, width, height) => {
            const radius = height / 2;
            const rtl = this.actor.get_text_direction() === Clutter.TextDirection.RTL;
            cr.setSourceRGBA(1, 1, 1, 0.1);
            roundedRect(cr, 0, 0, width, height, radius);
            cr.fill();
            const filled = Math.max(this.fraction > 0 ? height : 0, width * this.fraction);
            if (filled <= 0)
                return;
            cr.setSourceRGBA(...hexToRgb(this.color ?? Theme.accent), 1);
            roundedRect(cr, rtl ? width - filled : 0, 0, filled, height, radius);
            cr.fill();
        });
    }

    set(fraction, color = this.color) {
        const next = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
        if (next === this.fraction && color === this.color)
            return;
        this.fraction = next;
        this.color = color;
        if (this.actor.mapped)
            this.actor.queue_repaint();
    }
}

// Circular progress ring. Content can be layered on top through `overlay`.
export class Ring {
    constructor({size = 148, thickness = 10, name = null} = {}) {
        this.fraction = 0;
        this.color = null;
        this.thickness = thickness;
        this.area = drawingArea('nova-ring', name, (cr, width, height, scale) => {
            const line = this.thickness * scale;
            const radius = Math.min(width, height) / 2 - line / 2 - 1;
            const cx = width / 2;
            const cy = height / 2;
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(line);
            cr.setSourceRGBA(1, 1, 1, 0.09);
            cr.arc(cx, cy, radius, 0, 2 * Math.PI);
            cr.stroke();
            if (this.fraction <= 0)
                return;
            const [r, g, b] = hexToRgb(this.color ?? Theme.accent);
            cr.setSourceRGBA(r, g, b, 1);
            const start = -Math.PI / 2;
            cr.arc(cx, cy, radius, start, start + 2 * Math.PI * Math.min(1, this.fraction));
            cr.stroke();
        });
        this.area.set_size(size, size);
        this.area.x_expand = false;
        this.overlay = box({vertical: true, x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER, style_class: 'nova-ring-content'});
        this.actor = new St.Widget({layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this.area);
        this.actor.add_child(this.overlay);
    }

    set(fraction, color = this.color) {
        const next = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
        if (next === this.fraction && color === this.color)
            return;
        this.fraction = next;
        this.color = color;
        if (this.area.mapped)
            this.area.queue_repaint();
    }
}

// Line graph of measured samples. Only samples that were pushed are drawn.
export class Sparkline {
    constructor({style_class = 'nova-sparkline', name = null, capacity = 40, series = 1, max = null} = {}) {
        this.capacity = capacity;
        this.max = max;
        this.colors = Array(series).fill(null);
        this.data = Array.from({length: series}, () => []);
        this.actor = drawingArea(style_class, name, (cr, width, height, scale) => {
            const top = Math.max(1, this.max ?? Math.max(...this.data.flat(), 1));
            const step = width / Math.max(1, this.capacity - 1);
            // Quiet guides so a graph that is still filling reads as a chart.
            cr.setSourceRGBA(1, 1, 1, 0.06);
            cr.setLineWidth(scale);
            for (const fraction of [0.25, 0.5, 0.75]) {
                const y = Math.round(height * fraction) + 0.5;
                cr.moveTo(0, y);
                cr.lineTo(width, y);
            }
            cr.stroke();
            cr.setSourceRGBA(1, 1, 1, 0.1);
            cr.moveTo(0, height - 0.5);
            cr.lineTo(width, height - 0.5);
            cr.stroke();
            this.data.forEach((points, index) => {
                if (points.length < 2)
                    return;
                const [r, g, b] = hexToRgb(this.colors[index] ?? Theme.accent);
                const x0 = width - (points.length - 1) * step;
                const y = value => height - 1.5 * scale - (height - 3 * scale) * Math.min(1, value / top);
                cr.moveTo(x0, y(points[0]));
                points.forEach((value, i) => cr.lineTo(x0 + i * step, y(value)));
                if (index === 0) {
                    cr.lineTo(width, height);
                    cr.lineTo(x0, height);
                    cr.closePath();
                    const gradient = new Cairo.LinearGradient(0, 0, 0, height);
                    gradient.addColorStopRGBA(0, r, g, b, 0.32);
                    gradient.addColorStopRGBA(1, r, g, b, 0.02);
                    cr.setSource(gradient);
                    cr.fill();
                    cr.moveTo(x0, y(points[0]));
                    points.forEach((value, i) => cr.lineTo(x0 + i * step, y(value)));
                }
                cr.setSourceRGBA(r, g, b, 1);
                cr.setLineWidth(1.6 * scale);
                cr.setLineJoin(Cairo.LineJoin.ROUND);
                cr.stroke();
            });
        });
    }

    push(...values) {
        values.forEach((value, index) => {
            if (!Number.isFinite(value))
                return;
            const points = this.data[index];
            points.push(value);
            if (points.length > this.capacity)
                points.shift();
        });
        if (this.actor.mapped)
            this.actor.queue_repaint();
    }

    reset() {
        this.data.forEach(points => (points.length = 0));
        if (this.actor.mapped)
            this.actor.queue_repaint();
    }
}

// A floating caption for icon-only controls, shown on hover and keyboard focus.
export class Tooltip {
    constructor(parent) {
        this.actor = new St.Label({style_class: 'nova-tooltip', visible: false, opacity: 0});
        parent.add_child(this.actor);
        this.source = null;
    }

    attach(button, text) {
        const show = () => this.show(button, typeof text === 'function' ? text() : text);
        const hide = () => {
            if (this.source === button)
                this.hide();
        };
        button.connect('notify::hover', () => (button.hover ? show() : hide()));
        button.connect('key-focus-in', show);
        button.connect('key-focus-out', hide);
        button.connect('destroy', hide);
    }

    show(button, text) {
        this.source = button;
        this.actor.text = text;
        this.actor.show();
        this.actor.get_parent()?.set_child_above_sibling(this.actor, null);
        const [x, y] = button.get_transformed_position();
        const [, width] = this.actor.get_preferred_width(-1);
        const [, height] = this.actor.get_preferred_height(-1);
        const [px, py] = this.actor.get_parent().get_transformed_position();
        const parentWidth = this.actor.get_parent().width;
        const left = Math.round(Math.max(4, Math.min(parentWidth - width - 4,
            x - px + (button.width - width) / 2)));
        this.actor.set_position(left, Math.round(y - py - height - 6));
        this.actor.remove_all_transitions();
        this.actor.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    hide() {
        this.source = null;
        this.actor.remove_all_transitions();
        this.actor.opacity = 0;
        this.actor.hide();
    }
}

export function formatBytes(bytes, perSecond = false) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Math.max(0, bytes);
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const digits = value >= 100 || unit === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unit]}${perSecond ? '/s' : ''}`;
}

// Upload a GdkPixbuf as St content (shared by artwork and image previews).
export function imageContent(pixbuf) {
    const content = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
    const context = global.stage.get_context().get_backend().get_cogl_context();
    const format = pixbuf.has_alpha ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
    return content.set_bytes(context, pixbuf.read_pixel_bytes(), format, pixbuf.width, pixbuf.height,
        pixbuf.rowstride) ? content : null;
}

export function relativeTime(milliseconds) {
    const minutes = Math.floor((Date.now() - milliseconds) / 60000);
    if (!Number.isFinite(minutes) || minutes < 1)
        return 'just now';
    if (minutes < 60)
        return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} h ago`;
}

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {fallbackBounds, panelGeometry} from './layoutEngine.js';

const CALENDAR_NAME = 'Calendar and notifications';

const PanelSlot = GObject.registerClass(
class NovaIslandPanelSlot extends St.Widget {
    _init(pill, dateMenu) {
        super._init({name: 'nova-island-panel-slot', clip_to_allocation: true});
        this._pill = pill;
        this._dateMenu = dateMenu;
        this._calendarBox = new Clutter.ActorBox();
        this._pillBox = new Clutter.ActorBox();
    }

    configure(geometry, rtl) {
        const previous = this._geometry;
        if (this._rtl === rtl && previous &&
            Object.keys(geometry).every(key => geometry[key] === previous[key]))
            return;

        this._geometry = geometry;
        this._rtl = rtl;
        this.queue_relayout();
    }

    vfunc_get_preferred_width() {
        const width = this._geometry?.slotWidth ?? 0;
        return [width, width];
    }

    vfunc_get_preferred_height() {
        return this._dateMenu?.get_preferred_height(-1) ?? [0, 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        // Keep the panel's height independent of the pill's preferred size.
        const {width, height, offset, gap, calendarWidth} = this._geometry;
        const rowHeight = box.get_height();
        const pillWidth = Math.min(width, box.get_width());
        const pillHeight = Math.min(height, rowHeight);
        const pillX = Math.round((box.get_width() - pillWidth) / 2 + offset);
        const pillY = Math.floor((rowHeight - pillHeight) / 2);
        this._pillBox.set_origin(pillX, pillY);
        this._pillBox.set_size(pillWidth, pillHeight);
        this._pill.allocate(this._pillBox);

        if (this._dateMenu) {
            const calendarX = this._rtl ? pillX - gap - calendarWidth : pillX + pillWidth + gap;
            this._calendarBox.set_origin(calendarX, 0);
            this._calendarBox.set_size(calendarWidth, rowHeight);
            this._dateMenu.allocate(this._calendarBox);
        }
    }
});

// The session mode supplies defaults. Extensions can move the live date container.
export const PanelPlacement = Object.freeze({
    PANEL: 'panel-integrated',
    FLOATING: 'floating-fallback',
    UNAVAILABLE: 'panel-unavailable',
    HIDDEN: 'hidden',
});

export class PanelAdapter {
    #panel;
    #layoutManager;
    #pill;
    #dateMenu;
    #clockLabel;
    #clockBox;
    #center;
    #left;
    #right;
    #container;
    #calendar;
    #slot;
    #dateBox;
    #oldName;
    #incompatibleReason;
    #lastDiagnostic;
    #floating = false;

    constructor(panel, layoutManager, pill, lifecycle, onLayoutChanged, onCalendarOpened) {
        this.#panel = panel;
        this.#layoutManager = layoutManager;
        this.#pill = pill;
        this.#dateMenu = panel.statusArea?.dateMenu;
        this.#container = this.#dateMenu?.container;
        this.#clockLabel = this.#dateMenu?.label_actor;
        this.#clockBox = this.#clockLabel?.get_parent();
        this.#center = panel._centerBox;
        this.#left = panel._leftBox;
        this.#right = panel._rightBox;

        lifecycle.add(() => {
            this.restore();
            this.#calendar?.destroy();
        });
        lifecycle.connect(panel, 'notify::allocation', onLayoutChanged);
        lifecycle.connect(panel, 'notify::mapped', onLayoutChanged);
        lifecycle.connect(panel, 'notify::text-direction', onLayoutChanged);
        lifecycle.connect(panel, 'style-changed', onLayoutChanged);
        lifecycle.connect(panel, 'parent-set', onLayoutChanged);

        if (![this.#left, this.#center, this.#right].every(box => box instanceof St.BoxLayout)) {
            this.#incompatibleReason = 'panel groups are missing or have an unsupported actor type';
            return;
        }

        for (const box of [this.#left, this.#center, this.#right]) {
            lifecycle.connect(box, 'queue-relayout', onLayoutChanged);
            lifecycle.connect(box, 'notify::allocation', onLayoutChanged);
            lifecycle.connect(box, 'notify::mapped', onLayoutChanged);
            lifecycle.connect(box, 'child-added', onLayoutChanged);
            lifecycle.connect(box, 'child-removed', onLayoutChanged);
        }

        if (!(this.#container instanceof St.Bin) || !this.#dateMenu.menu ||
            !(this.#clockLabel instanceof St.Label) || !(this.#clockBox instanceof St.BoxLayout) ||
            this.#clockBox !== this.#dateMenu.get_first_child()) {
            this.#incompatibleReason = 'native date menu or clock hierarchy has an unsupported actor type';
            return;
        }

        this.#calendar = new St.Icon({
            name: 'nova-island-calendar',
            icon_name: 'x-office-calendar-symbolic',
            style_class: 'clock nova-island-calendar',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.#clockBox.insert_child_below(this.#calendar, this.#clockLabel);
        lifecycle.connect(this.#container, 'parent-set', onLayoutChanged);
        lifecycle.connect(this.#container, 'notify::child', onLayoutChanged);
        lifecycle.connect(this.#container, 'notify::visible', onLayoutChanged);
        lifecycle.connect(this.#clockLabel, 'notify::visible', onLayoutChanged);
        lifecycle.connect(this.#dateMenu, 'notify::label-actor', onLayoutChanged);
        lifecycle.connect(this.#dateMenu.menu, 'open-state-changed', (_menu, open) => {
            if (open)
                onCalendarOpened();
        });
    }

    get calendarOpen() {
        return this.#dateMenu?.menu?.isOpen ?? false;
    }

    sync(monitor, workArea, settings, scale) {
        if (!monitor || !this.#panel.mapped) {
            this.restore();
            return this.#report(PanelPlacement.HIDDEN,
                monitor ? 'top panel is not mapped' : 'desktop surfaces are suspended');
        }

        const dateBox = this.#container?.get_parent();
        if (this.#slot && dateBox !== this.#dateBox)
            this.#unmountSlot();

        const [panelX, panelY] = this.#panel.get_transformed_position();
        const panel = {x: panelX, y: panelY, width: this.#panel.width, height: this.#panel.height};
        const liveGroup = dateBox?.name ?? 'none';
        let reason = this.#slotFailure(dateBox);
        if (!reason) {
            const rtl = this.#panel.get_text_direction() === Clutter.TextDirection.RTL;
            const [, start] = this.#left.get_preferred_width(-1);
            const [, end] = this.#right.get_preferred_width(-1);
            const calendarWidth = this.#calendarWidth();
            // A side group keeps its date menu. Before the swap its preferred
            // width includes the clock label, so replace only that width.
            const delta = this.#slot ? 0 : calendarWidth - this.#container.get_preferred_width(-1)[1];
            const effectiveStart = start + (dateBox === this.#left ? delta : 0);
            const effectiveEnd = end + (dateBox === this.#right ? delta : 0);
            const neighbors = rtl
                ? {left: effectiveEnd, right: effectiveStart}
                : {left: effectiveStart, right: effectiveEnd};
            const embedded = dateBox === this.#center;
            const result = panelGeometry(panel, monitor, workArea, neighbors,
                embedded ? calendarWidth : 0, rtl, settings, scale);
            if (result.geometry) {
                this.#removeFallback();
                if (this.#slot)
                    this.#slot.configure(result.geometry, rtl);
                else
                    this.#mount(result.geometry, rtl, dateBox);
                return this.#report(PanelPlacement.PANEL, `native date menu in ${liveGroup}`);
            }

            reason = result.reason;
        }

        this.#unmountSlot();
        const bounds = settings.floatingFallback &&
            fallbackBounds(monitor, workArea, panel, settings, scale);
        if (!bounds) {
            this.#removeFallback();
            const fallback = settings.floatingFallback ? 'no space for floating fallback' : 'floating fallback disabled';
            return this.#report(PanelPlacement.UNAVAILABLE, `${reason} (${fallback})`);
        }

        const {x, y, width, height} = bounds;
        this.#pill.set_position(x, y);
        this.#pill.set_size(width, height);
        if (!this.#floating) {
            this.#layoutManager.addChrome(this.#pill);
            this.#floating = true;
        }
        return this.#report(PanelPlacement.FLOATING, reason);
    }

    #calendarWidth() {
        if (this.#slot)
            return Math.ceil(this.#dateMenu.get_preferred_width(-1)[1]);

        const [, nativeWidth] = this.#container.get_preferred_width(-1);
        const [, labelWidth] = this.#clockLabel.get_preferred_width(-1);
        const [, iconWidth] = this.#calendar.get_preferred_width(-1);
        return Math.ceil(nativeWidth - labelWidth + iconWidth);
    }

    #removeFallback() {
        if (!this.#floating)
            return;

        this.#layoutManager.removeChrome(this.#pill);
        this.#pill.set_size(-1, -1);
        this.#pill.fixed_position_set = false;
        this.#floating = false;
    }

    #slotFailure(dateBox) {
        if (this.#incompatibleReason)
            return this.#incompatibleReason;
        if (this.#panel.get_parent() !== this.#layoutManager.panelBox)
            return 'panel is outside the native panelBox';
        if (![this.#left, this.#center, this.#right].every(box => box.get_parent() === this.#panel))
            return 'a native panel group is outside Main.panel';
        if (![this.#left, this.#center, this.#right].includes(dateBox))
            return `native date menu is outside the panel groups (parent: ${dateBox?.name || 'unknown'})`;
        if (!this.#center.mapped || !this.#container.mapped || !this.#dateMenu.mapped)
            return 'center group or native date menu is not mapped';
        if (this.#clockLabel.get_parent() !== this.#clockBox ||
            this.#clockBox.get_parent() !== this.#dateMenu ||
            this.#calendar.get_parent() !== this.#clockBox)
            return 'native clock actor hierarchy changed';

        const embedded = this.#slot && this.#dateBox === this.#center;
        if (this.#container.child !== (embedded ? this.#slot : this.#dateMenu) ||
            this.#dateMenu.get_parent() !== (embedded ? this.#slot : this.#container) ||
            (this.#slot && this.#slot.get_parent() !== (embedded ? this.#container : this.#center)))
            return 'native date menu or NOVA slot was reparented';
        if (this.#dateMenu.label_actor !== (this.#slot ? null : this.#clockLabel) ||
            this.#clockLabel.visible !== !this.#slot)
            return 'native clock label or its visibility was overridden';

        const conflict = this.#center.get_children().find(actor =>
            actor !== this.#container && actor !== this.#slot && actor.visible);
        if (conflict)
            return `center group contains another visible actor (${conflict.name || conflict.constructor.name})`;

        return null;
    }

    #report(placement, reason) {
        const message = `[NOVA Island] ${placement}: ${reason}`;
        if (message !== this.#lastDiagnostic) {
            this.#lastDiagnostic = message;
            if (placement === PanelPlacement.PANEL)
                console.log(message);
            else if (placement === PanelPlacement.HIDDEN)
                console.debug(message);
            else
                console.warn(message);
        }
        return placement;
    }

    #mount(geometry, rtl, dateBox) {
        const embedded = dateBox === this.#center;
        const slot = new PanelSlot(this.#pill, embedded ? this.#dateMenu : null);
        this.#slot = slot;
        this.#dateBox = dateBox;
        this.#oldName = this.#dateMenu.accessible_name;
        this.#clockLabel.hide();
        this.#calendar.show();
        this.#dateMenu.label_actor = null;
        this.#dateMenu.accessible_name = CALENDAR_NAME;

        slot.configure(geometry, rtl);
        slot.add_child(this.#pill);
        if (embedded) {
            this.#container.set_child(slot);
            slot.add_child(this.#dateMenu);
        } else {
            this.#center.add_child(slot);
        }
    }

    #unmountSlot() {
        const slot = this.#slot;
        if (!slot)
            return;

        this.#slot = null;
        this.#dateBox = null;
        this.#calendar.hide();
        if (this.#clockLabel.get_parent() === this.#clockBox)
            this.#clockLabel.show();
        if (!this.#dateMenu.label_actor)
            this.#dateMenu.label_actor = this.#clockLabel;
        if (this.#dateMenu.accessible_name === CALENDAR_NAME)
            this.#dateMenu.accessible_name = this.#oldName;

        if (this.#pill.get_parent() === slot)
            slot.remove_child(this.#pill);
        if (this.#dateMenu.get_parent() === slot)
            slot.remove_child(this.#dateMenu);
        if (this.#container.child === slot)
            this.#container.set_child(this.#dateMenu.get_parent() ? null : this.#dateMenu);
        slot.destroy();
    }

    restore() {
        this.#removeFallback();
        this.#unmountSlot();
    }
}

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {EventEmitter as EventBus} from 'resource:///org/gnome/shell/misc/signals.js';

import {MODULES} from '../shared/studio.js';
import {AnimationEngine} from './animationEngine.js';
import {previewBounds} from './layoutEngine.js';
import {PanelAdapter, PanelPlacement} from './panelAdapter.js';
import {StateManager} from './stateManager.js';
import {applyAppearance, applyPinnedStyle, contentAlignment} from './themeManager.js';

export class IslandController {
    #lifecycle;
    #settings;
    #widgets;
    #bus = new EventBus();
    #state = new StateManager(this.#bus);
    #button;
    #preview;
    #panel;
    #placement = PanelPlacement.HIDDEN;
    #instances = new Map();
    #compactHost;
    #expandedHost;
    #moduleButtons = new Map();
    #moduleTabs;
    #openPreferences;
    #selectedModule;
    #trackSource = 0;
    #compact;
    #expanded;
    #animation;
    #theme;
    #layoutSource = 0;
    #leaveSource = 0;
    #previewTarget = null;
    #anchor = null;
    #shuttingDown = false;

    constructor(lifecycle, settings, widgets, openPreferences) {
        this.#lifecycle = lifecycle;
        this.#settings = settings;
        this.#widgets = widgets;
        this.#openPreferences = openPreferences;
    }

    mount() {
        const lifecycle = this.#lifecycle;
        const button = new St.Button({
            name: 'nova-island',
            style_class: 'nova-island',
            reactive: true,
            can_focus: true,
            button_mask: St.ButtonMask.PRIMARY,
            visible: false,
        });
        this.#button = button;
        lifecycle.add(() => button.destroy());
        button.get_accessible().set_description('Activate to open or collapse the preview. Press Down to reach preview controls.');
        button.add_accessible_state(Atk.StateType.EXPANDABLE);
        const preview = new St.Bin({
            name: 'nova-island-preview',
            style_class: 'nova-island-popover',
            visible: false,
            reactive: false,
        });
        this.#preview = preview;
        lifecycle.add(() => preview.destroy());

        const makeHost = () => new St.Widget({layout_manager: new Clutter.BinLayout(), clip_to_allocation: true});
        this.#compactHost = makeHost();
        this.#expandedHost = makeHost();
        button.set_child(this.#compactHost);
        const placeholder = new St.Icon({icon_name: 'open-menu-symbolic', icon_size: 14,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.#compactHost.add_child(placeholder);
        for (const id of this.#widgets.ids()) {
            const widget = this.#widgets.create(id, lifecycle, peek => this.#onWidgetChanged(id, peek), this.#settings);
            if (widget.clickPreview)
                lifecycle.connect(widget.expanded, 'clicked', () => this.#activate());
            this.#instances.set(id, widget);
            this.#compactHost.add_child(widget.compact);
            this.#expandedHost.add_child(widget.expanded);
        }
        this.#expandedHost.y_expand = true;
        const frame = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, clip_to_allocation: true});
        frame.add_child(this.#expandedHost);
        this.#moduleTabs = new St.BoxLayout({name: 'nova-module-tabs', style_class: 'nova-module-tabs',
            x_align: Clutter.ActorAlign.CENTER});
        frame.add_child(this.#moduleTabs);
        for (const [id, label] of MODULES) {
            const tab = new St.Button({name: `nova-module-${id}`, label, can_focus: true, reactive: true,
                style_class: 'nova-module-tab'});
            this.#moduleTabs.add_child(tab);
            this.#moduleButtons.set(id, tab);
            lifecycle.connect(tab, 'clicked', () => {
                this.#selectedModule = id;
                this.#onWidgetChanged();
            });
        }
        const preferences = new St.Button({name: 'nova-settings', accessible_name: 'NOVA Island Settings',
            child: new St.Icon({icon_name: 'preferences-system-symbolic', icon_size: 16}),
            reactive: true, can_focus: true, style_class: 'nova-module-tab'});
        this.#moduleTabs.add_child(preferences);
        lifecycle.connect(preferences, 'clicked', () => {
            this.#collapseImmediately();
            this.#openPreferences();
        });
        preview.set_child(frame);
        Main.layoutManager.addChrome(preview);
        lifecycle.add(() => Main.layoutManager.removeChrome(preview));
        this.#animation = new AnimationEngine(preview, this.#settings);
        this.#theme = St.ThemeContext.get_for_stage(global.stage);

        const queueLayout = () => this.#queueLayout();
        this.#panel = new PanelAdapter(Main.panel, Main.layoutManager, button, lifecycle,
            queueLayout, () => this.#collapseImmediately());
        Main.ctrlAltTabManager.addGroup(button, 'NOVA Island', 'preferences-system-time-symbolic', {
            focusCallback: () => button.grab_key_focus(),
        });

        this.#bindInput();
        lifecycle.connect(this.#bus, 'state-changed', () => this.#render(true));
        lifecycle.connect(button, 'notify::allocation', queueLayout);
        lifecycle.connect(button, 'key-focus-in', () => this.#updateAppearance());
        lifecycle.connect(button, 'key-focus-out', () => this.#updateAppearance());
        lifecycle.connect(Main.layoutManager, 'monitors-changed', queueLayout);
        lifecycle.connect(global.display, 'workareas-changed', queueLayout);
        lifecycle.connect(global.display, 'in-fullscreen-changed', queueLayout);
        lifecycle.connect(Main.overview, 'showing', () => this.#syncLayout());
        lifecycle.connect(Main.overview, 'hidden', queueLayout);
        lifecycle.connect(Main.sessionMode, 'updated', queueLayout);
        lifecycle.connect(this.#theme, 'notify::scale-factor', queueLayout);
        lifecycle.connect(Main.layoutManager, 'system-modal-opened', () => this.#collapseImmediately());
        lifecycle.connect(St.Settings.get(), 'notify::reduced-motion', () => this.#render(false));
        lifecycle.connect(St.Settings.get(), 'notify::enable-animations', () => this.#render(false));
        // Shell destroys its panel before running the remaining shutdown handlers.
        lifecycle.connect(Main.panel, 'destroy', () => this.#stopScheduling());
        lifecycle.connect(global, 'shutdown', () => this.#stopScheduling());
        this.#settings.observe(lifecycle, key => this.#onSettingsChanged(key));
        this.#updateWidgets();
        this.#updateAppearance();
        lifecycle.add(() => this.#animation.hide());
        lifecycle.add(() => this.#cancelCollapse());
        lifecycle.add(() => this.#stopScheduling());
        this.#syncLayout();
    }

    #bindInput() {
        const lifecycle = this.#lifecycle;
        for (const actor of [this.#button, this.#preview]) {
            const motion = new Clutter.MotionController();
            actor.add_action(motion);
            lifecycle.connect(motion, 'enter', () => {
                this.#cancelCollapse();
                this.#cancelTrackTimer();
                if (actor === this.#button && this.#expanded && !this.#panel.calendarOpen &&
                    this.#settings.get('hover-expand', true))
                    this.#state.hover();
            });
            lifecycle.connect(motion, 'leave', () => this.#scheduleCollapse());
            const keys = new Clutter.KeyController();
            actor.add_action(keys);
            lifecycle.connect(keys, 'key-press', () => this.#onKeyPress(actor, keys));
        }
        lifecycle.connect(this.#button, 'clicked', () => this.#activate());
    }

    #activate() {
        this.#cancelCollapse();
        this.#cancelTrackTimer();
        if (this.#expanded && !this.#panel.calendarOpen)
            this.#state.activate(this.#settings.get('click-to-pin', true));
    }

    #onKeyPress(actor, keys) {
        const [hasKey, symbol] = keys.get_key();
        if (!hasKey || !this.#state.expanded)
            return Clutter.EVENT_PROPAGATE;
        if (symbol === Clutter.KEY_Escape) {
            this.#cancelCollapse();
            this.#state.collapse();
            if (actor === this.#preview)
                this.#button.grab_key_focus();
            return Clutter.EVENT_STOP;
        }
        if (actor === this.#button && symbol === Clutter.KEY_Down &&
            this.#preview.navigate_focus(null, St.DirectionType.TAB_FORWARD, false)) {
            this.#cancelTrackTimer();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    #cancelTrackTimer() {
        if (this.#trackSource) {
            GLib.Source.remove(this.#trackSource);
            this.#trackSource = 0;
        }
    }

    #trackPreview(id) {
        if (!this.#state.visible || this.#state.expanded || this.#panel.calendarOpen ||
            !this.#settings.get('track-previews', false) ||
            !this.#widgets.candidates(this.#instances, this.#settings, 'expanded').some(([key]) => key === id))
            return;
        this.#selectedModule = id;
        this.#updateWidgets();
        this.#state.hover();
        this.#trackSource = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT,
            this.#settings.get('track-preview-duration', 3500), () => {
                this.#trackSource = 0;
                if (!this.#state.pinned)
                    this.#state.collapse();
            });
    }

    #scheduleCollapse() {
        this.#cancelCollapse();
        if (this.#shuttingDown || !this.#state.expanded || this.#state.pinned)
            return;

        const delay = this.#settings.mouseLeaveDelay;
        if (delay === 0) {
            this.#state.collapse();
            return;
        }

        this.#leaveSource = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, delay, () => {
            this.#leaveSource = 0;
            this.#state.collapse();
        });
    }

    #cancelCollapse() {
        if (this.#leaveSource === 0)
            return;

        GLib.Source.remove(this.#leaveSource);
        this.#leaveSource = 0;
    }

    #collapseImmediately() {
        if (this.#shuttingDown)
            return;

        this.#cancelCollapse();
        this.#cancelTrackTimer();
        this.#state.collapse();
        this.#animation.hide();
    }

    #updateAppearance() {
        const tokens = this.#settings.appearance;
        const alignment = contentAlignment(this.#settings.get('content-alignment', 'center'));
        for (const widget of this.#instances.values())
            widget.applyTheme?.(tokens, alignment);
        applyAppearance(this.#button, tokens, true, this.#state.pinned || this.#button.has_key_focus());
        applyAppearance(this.#preview, tokens, false, this.#state.pinned);
    }

    #updateWidgets() {
        this.#compact = this.#widgets.select(this.#instances, this.#settings, 'compact');
        const expanded = this.#widgets.candidates(this.#instances, this.#settings, 'expanded');
        const selected = expanded.find(([id]) => id === this.#selectedModule) ?? expanded[0];
        this.#expanded = selected?.[1] ?? null;
        for (const [id, tab] of this.#moduleButtons) {
            tab.visible = expanded.length > 1 && expanded.some(([key]) => key === id);
            if (selected?.[0] === id)
                tab.add_style_class_name('nova-media-selected');
            else
                tab.remove_style_class_name('nova-media-selected');
        }
        for (const widget of this.#instances.values()) {
            widget.compact.visible = widget === this.#compact;
            widget.expanded.visible = widget === this.#expanded;
        }
        this.#compactHost.get_first_child().visible = !this.#compact;
        if (!this.#expanded)
            this.#collapseImmediately();
    }

    #onWidgetChanged(id, peek) {
        if (this.#shuttingDown || !this.#animation)
            return;
        this.#updateWidgets();
        if (peek)
            this.#trackPreview(id);
        this.#updateAccessibleName();
        this.#queueLayout();
    }

    #onSettingsChanged(key) {
        if (this.#shuttingDown)
            return;

        if (key === 'mouse-leave-delay' && this.#leaveSource !== 0)
            this.#scheduleCollapse();
        if (key === 'reduce-motion')
            this.#render(false);
        if (key.startsWith('media-') || key.startsWith('lyrics-') || [
            'default-player', 'last-player', 'player-priority', 'artwork-size',
            'remote-artwork', 'visualizer-intensity', 'reduce-motion',
        ].includes(key))
            this.#instances.get('media')?.configure();
        if (key === 'track-previews' && this.#trackSource && !this.#settings.get('track-previews'))
            this.#collapseImmediately();
        this.#updateWidgets();
        this.#updateAppearance();
        this.#updateAccessibleName();
        this.#queueLayout();
    }

    #bounds() {
        const {primaryMonitor} = Main.layoutManager;
        const button = this.#button;
        if (!primaryMonitor || !button.mapped)
            return null;
        if (button.has_allocation()) {
            const [x, y] = button.get_transformed_position();
            const [width, height] = button.get_transformed_size();
            this.#anchor = {x, y, width, height};
        }
        // Metadata and icon changes invalidate allocation before the next frame.
        // Use the last mapped anchor while the panel is waiting to relayout.
        if (!this.#anchor)
            return null;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(primaryMonitor.index);
        const {x: anchorX, y: anchorY, width: anchorWidth, height: anchorHeight} = this.#anchor;
        const [, panelY] = Main.panel.get_transformed_position();
        const [, panelHeight] = Main.panel.get_transformed_size();
        const top = this.#placement === PanelPlacement.FLOATING
            ? anchorY + anchorHeight : panelY + panelHeight;
        const layout = this.#settings.layout;
        if (this.#expanded?.lyricsOpen) {
            layout.expandedWidth = this.#settings.get('lyrics-width', 620);
            layout.expandedHeight = this.#settings.get('lyrics-height', 540);
        }
        return previewBounds(workArea, top, anchorX + anchorWidth / 2, layout, this.#theme.scale_factor);
    }

    #queueLayout() {
        if (this.#shuttingDown || this.#layoutSource !== 0)
            return;

        this.#layoutSource = GLib.idle_add_once(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#layoutSource = 0;
            this.#syncLayout();
        });
    }

    #stopScheduling() {
        this.#shuttingDown = true;
        this.#cancelTrackTimer();
        this.#cancelCollapse();
        if (this.#layoutSource !== 0) {
            GLib.Source.remove(this.#layoutSource);
            this.#layoutSource = 0;
        }
    }

    #syncLayout() {
        if (this.#shuttingDown)
            return;

        const monitor = Main.layoutManager.primaryMonitor;
        const allowed = (this.#compact || this.#expanded) && monitor && !monitor.inFullscreen && !Main.overview.visible &&
            Main.sessionMode.hasWindows && !Main.sessionMode.isLocked;
        const workArea = allowed ? Main.layoutManager.getWorkAreaForMonitor(monitor.index) : null;
        const placement = this.#panel.sync(allowed ? monitor : null, workArea,
            this.#settings.layout, this.#theme.scale_factor);
        if (placement !== this.#placement) {
            this.#placement = placement;
            this.#anchor = null;
            this.#collapseImmediately();
        }

        const available = placement === PanelPlacement.PANEL || placement === PanelPlacement.FLOATING;
        if (this.#state.setAvailable(available) || !this.#state.expanded)
            return;

        const target = this.#bounds();
        if (target && (!this.#previewTarget ||
            Object.keys(target).some(key => target[key] !== this.#previewTarget[key])))
            this.#render(false);
    }

    #updateAccessibleName() {
        if (this.#shuttingDown)
            return;

        const widget = this.#state.expanded ? this.#expanded : this.#compact ?? this.#expanded;
        this.#button.accessible_name = widget
            ? `NOVA Island, ${widget.describe(this.#state.expanded)}` : 'NOVA Island';
    }

    #render(animate) {
        if (this.#shuttingDown)
            return;

        const button = this.#button;
        if (!this.#state.visible) {
            this.#cancelCollapse();
            this.#animation.hide();
            this.#previewTarget = null;
            button.hide();
            return;
        }

        const expanded = this.#state.expanded;
        if (!expanded) {
            this.#cancelTrackTimer();
            if (this.#selectedModule) {
                this.#selectedModule = null;
                this.#updateWidgets();
            }
        }
        const target = expanded || this.#preview.visible ? this.#bounds() : null;
        if (!target)
            this.#animation.hide();
        else if (!animate || expanded !== Boolean(this.#previewTarget))
            this.#animation.present(target, button.width, expanded, animate);
        this.#previewTarget = expanded ? target : null;

        applyPinnedStyle(button, this.#state.pinned);
        applyPinnedStyle(this.#preview, this.#state.pinned);
        if (expanded)
            button.add_accessible_state(Atk.StateType.EXPANDED);
        else
            button.remove_accessible_state(Atk.StateType.EXPANDED);
        this.#updateAppearance();
        this.#updateAccessibleName();
        button.show();
    }
}

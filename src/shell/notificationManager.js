import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const MAX_HISTORY = 20;

export function shouldPreview(urgency, options) {
    if (!options.enabled || options.dnd || !options.unlocked || !options.banners)
        return false;
    if (options.focus && urgency < MessageTray.Urgency.CRITICAL)
        return false;
    return urgency >= options.minimum && urgency >= MessageTray.Urgency.NORMAL;
}

export class NotificationManager {
    #settings;
    #changed;
    #sources = new Map();
    #traySignals = [];
    #sessionSignal;
    #desktopSettings;
    #desktopSignal;
    #history = [];
    #active = false;

    constructor(settings, changed) {
        this.#settings = settings;
        this.#changed = changed;
        this.#desktopSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this.#desktopSignal = this.#desktopSettings.connect('changed::show-banners', () => this.#changed(false));
        this.#sessionSignal = Main.sessionMode.connect('updated', () => {
            if (!this.#unlocked())
                this.clear();
        });
        const tray = Main.messageTray;
        this.#traySignals.push(tray.connect('source-added', (_tray, source) => this.#watch(source)));
        this.#traySignals.push(tray.connect('source-removed', (_tray, source) => this.#unwatch(source)));
        for (const source of tray.getSources())
            this.#watch(source);
        this.#active = true;
    }

    #unlocked() {
        return Main.sessionMode.hasWindows && !Main.sessionMode.isLocked;
    }

    #watch(source) {
        if (this.#sources.has(source))
            return;
        const id = source.connect('notification-added', (_source, notification) => this.#receive(source, notification));
        this.#sources.set(source, id);
    }

    #unwatch(source) {
        const id = this.#sources.get(source);
        if (id === undefined)
            return;
        source.disconnect(id);
        this.#sources.delete(source);
    }

    #receive(source, notification) {
        if (!this.#active || !this.#settings.get('notifications-enabled', false) || !this.#unlocked())
            return;
        const urgency = notification.urgency;
        const entry = {
            source: String(source.title ?? '').slice(0, 80),
            title: String(notification.title ?? '').slice(0, 160),
            urgency,
            icon: source.icon ?? null,
            time: Date.now(),
        };
        this.#history.unshift(entry);
        this.#history.length = Math.min(this.#history.length, MAX_HISTORY);
        const preview = shouldPreview(urgency, {
            enabled: this.#settings.get('notifications-auto-expand', true),
            dnd: this.#settings.get('notifications-dnd', false),
            focus: this.#settings.get('notifications-focus-mode', false) ||
                this.#settings.get('productivity-focus-active', false),
            minimum: this.#settings.get('notifications-minimum-urgency', 1),
            unlocked: this.#unlocked(),
            banners: this.#desktopSettings.get_boolean('show-banners') && source.policy.showBanners,
        });
        this.#changed(preview);
    }

    get history() {
        return this.#history;
    }

    clear() {
        this.#history = [];
        this.#changed(false);
    }

    dismiss(index) {
        this.#history.splice(index, 1);
        this.#changed(false);
    }

    destroy() {
        this.#active = false;
        for (const source of [...this.#sources.keys()])
            this.#unwatch(source);
        for (const id of this.#traySignals)
            Main.messageTray.disconnect(id);
        Main.sessionMode.disconnect(this.#sessionSignal);
        this.#desktopSettings.disconnect(this.#desktopSignal);
        this.#history = [];
    }
}

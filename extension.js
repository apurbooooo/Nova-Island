import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {IslandController} from './src/shell/islandController.js';
import {LifecycleManager} from './src/shell/lifecycleManager.js';
import {SettingsManager} from './src/shell/settingsManager.js';
import {WidgetRegistry} from './src/shell/widgetRegistry.js';
import {createClockWidget} from './src/shell/widgets/clock.js';
import {createMediaWidget} from './src/shell/widgets/media.js';
import {createNotificationsWidget} from './src/shell/widgets/notifications.js';
import {createProductivityWidget} from './src/shell/widgets/productivity.js';
import {createClipboardWidget} from './src/shell/widgets/clipboard.js';
import {createEmojiWidget} from './src/shell/widgets/emoji.js';
import {createScreenshotWidget} from './src/shell/widgets/screenshot.js';
import {createSystemMonitorWidget} from './src/shell/widgets/systemMonitor.js';
import {createQuickSettingsWidget} from './src/shell/widgets/quickSettings.js';

export default class NovaIslandExtension extends Extension {
    #lifecycle = null;

    enable() {
        const lifecycle = new LifecycleManager();
        this.#lifecycle = lifecycle;

        try {
            const settings = new SettingsManager(this.getSettings());
            const widgets = new WidgetRegistry();
            widgets.register('clock', createClockWidget);
            widgets.register('media', createMediaWidget);
            widgets.register('notifications', createNotificationsWidget);
            widgets.register('productivity', createProductivityWidget);
            widgets.register('clipboard', createClipboardWidget);
            widgets.register('emoji', createEmojiWidget);
            widgets.register('screenshot', createScreenshotWidget);
            widgets.register('system-monitor', createSystemMonitorWidget);
            widgets.register('quick-settings', createQuickSettingsWidget);
            new IslandController(lifecycle, settings, widgets, () => this.openPreferences()).mount();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    disable() {
        this.#lifecycle?.destroy();
        this.#lifecycle = null;
    }
}

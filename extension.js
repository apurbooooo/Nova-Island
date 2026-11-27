import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {IslandController} from './src/shell/islandController.js';
import {LifecycleManager} from './src/shell/lifecycleManager.js';
import {SettingsManager} from './src/shell/settingsManager.js';
import {WidgetRegistry} from './src/shell/widgetRegistry.js';
import {createClockWidget} from './src/shell/widgets/clock.js';
import {createMediaWidget} from './src/shell/widgets/media.js';

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

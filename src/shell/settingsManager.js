import {readAppearance, readSetting} from '../shared/studio.js';

export class SettingsManager {
    #settings;

    constructor(settings) {
        this.#settings = settings;
    }

    get(key, fallback) {
        return readSetting(this.#settings, key, fallback);
    }

    set(key, value) {
        return this.#settings.settings_schema.has_key(key) && this.#settings.set_string(key, value);
    }

    get appearance() {
        return readAppearance(this.#settings);
    }

    get motion() {
        return {
            speed: this.get('animation-speed', 100),
            expand: this.get('expand-duration', 340),
            collapse: this.get('collapse-duration', 250),
            fade: this.get('content-fade-duration', 230),
            intensity: this.get('animation-intensity', 100) / 100,
            style: this.get('animation-style', 'nova'),
        };
    }

    get layout() {
        return {
            compactWidth: this.#settings.get_int('compact-width'),
            compactHeight: this.#settings.get_int('compact-height'),
            expandedWidth: this.#settings.get_int('expanded-width'),
            expandedHeight: this.#settings.get_int('expanded-height'),
            topOffset: this.#settings.get_int('top-offset'),
            horizontalOffset: this.#settings.get_int('horizontal-offset'),
            floatingFallback: this.#settings.get_boolean('floating-fallback'),
        };
    }

    get mouseLeaveDelay() {
        return this.#settings.get_int('mouse-leave-delay');
    }

    get reduceMotion() {
        return this.#settings.get_boolean('reduce-motion');
    }

    observe(lifecycle, callback) {
        lifecycle.connect(this.#settings, 'changed', (_settings, key) => callback(key));
    }
}

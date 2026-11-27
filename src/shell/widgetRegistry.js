export class WidgetRegistry {
    #factories = new Map();

    register(id, factory) {
        if (this.#factories.has(id))
            throw new Error(`Widget "${id}" is already registered`);

        this.#factories.set(id, factory);
    }

    ids() {
        return this.#factories.keys();
    }

    candidates(widgets, settings, view) {
        const preferred = view === 'expanded' ? settings.get('default-expanded-module', 'auto') : 'auto';
        const eligible = [...widgets].filter(([id, widget]) => widget.available !== false &&
            settings.get(`${id}-enabled`, id === 'clock') && settings.get(`${id}-${view}`, true));
        eligible.sort(([first], [second]) =>
            Number(second === preferred) - Number(first === preferred) ||
            settings.get(`${second}-priority`, 50) - settings.get(`${first}-priority`, 50));
        return eligible;
    }

    select(widgets, settings, view) {
        return this.candidates(widgets, settings, view)[0]?.[1] ?? null;
    }

    create(id, lifecycle, onChanged, settings) {
        const factory = this.#factories.get(id);
        if (!factory)
            throw new Error(`Widget "${id}" is unavailable`);

        return factory(lifecycle, onChanged, settings);
    }
}

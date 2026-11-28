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

    // Manual pill selection can reach all enabled modules; per-view switches
    // continue to govern automatic compact selection and expanded visibility.
    candidates(widgets, settings, view, manual = false) {
        const preferred = view === 'expanded' ? settings.get('default-expanded-module', 'auto') : 'auto';
        const eligible = [...widgets].filter(([id, widget]) => widget.available !== false &&
            settings.get(`${id}-enabled`, id === 'clock') && (manual || settings.get(`${id}-${view}`, true)));
        const automaticPriority = ([id, widget]) => {
            if (view === 'compact' && id === 'media' && widget.playing)
                return 2;
            return Number(id === 'clock');
        };
        eligible.sort((a, b) => {
            const [first] = a;
            const [second] = b;
            return Number(second === preferred) - Number(first === preferred) ||
                (!manual ? automaticPriority(b) - automaticPriority(a) : 0) ||
                settings.get(`${second}-priority`, 50) - settings.get(`${first}-priority`, 50);
        });
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

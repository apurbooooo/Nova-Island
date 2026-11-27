const Mode = Object.freeze({
    HIDDEN: 'hidden',
    COMPACT: 'compact',
    EXPANDED: 'expanded',
});

export class StateManager {
    #bus;
    #mode = Mode.HIDDEN;
    #pinned = false;

    constructor(bus) {
        this.#bus = bus;
    }

    get visible() {
        return this.#mode !== Mode.HIDDEN;
    }

    get expanded() {
        return this.#mode === Mode.EXPANDED;
    }

    get pinned() {
        return this.#pinned;
    }

    setAvailable(available) {
        if (available === this.visible)
            return false;

        return this.#set(available ? Mode.COMPACT : Mode.HIDDEN, false);
    }

    hover() {
        if (this.visible && !this.expanded)
            this.#set(Mode.EXPANDED, false);
    }

    activate(pin = true) {
        if (!this.visible)
            return;
        const close = this.pinned || (!pin && this.expanded);
        this.#set(close ? Mode.COMPACT : Mode.EXPANDED, pin && !close);
    }

    collapse() {
        if (this.expanded)
            this.#set(Mode.COMPACT, false);
    }

    #set(mode, pinned) {
        if (mode === this.#mode && pinned === this.#pinned)
            return false;

        this.#mode = mode;
        this.#pinned = pinned;
        this.#bus.emit('state-changed');
        return true;
    }
}

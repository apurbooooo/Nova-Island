// A wheel notch switches immediately. Smooth deltas accumulate to a full step;
// idle gaps/direction reversals reset them, and no event switches more than once.
export class ModuleScroll {
    constructor() { this.reset(); }

    reset() {
        this.accumulated = 0;
        this.lastEvent = -Infinity;
        this.lastSwitch = -Infinity;
    }

    step(dx, dy, now) {
        if (!Number.isFinite(dy) || !dy || Math.abs(dx) > Math.abs(dy))
            return 0;
        if (now - this.lastEvent > 250 || Math.sign(dy) !== Math.sign(this.accumulated))
            this.accumulated = 0;
        this.lastEvent = now;
        if (now - this.lastSwitch < 140) {
            this.accumulated = 0;
            return 0;
        }
        this.accumulated += dy;
        if (Math.abs(this.accumulated) < 1)
            return 0;
        this.accumulated = 0;
        this.lastSwitch = now;
        return Math.sign(dy);
    }
}

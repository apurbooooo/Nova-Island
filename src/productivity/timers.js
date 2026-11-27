// All time values are milliseconds from an injected monotonic clock.
export class SessionTimer {
    constructor(now, duration = 0) {
        this.now = now;
        this.duration = duration;
        this.elapsed = 0;
        this.anchor = null;
        this.laps = [];
        this.phase = 'focus';
        this.sessions = 0;
    }

    get running() { return this.anchor !== null; }
    get value() { return this.elapsed + (this.running ? Math.max(0, this.now() - this.anchor) : 0); }
    get remaining() { return Math.max(0, this.duration - this.value); }

    start() {
        if (!this.running)
            this.anchor = this.now();
    }

    pause() {
        this.elapsed = this.value;
        this.anchor = null;
    }

    reset(duration = this.duration) {
        this.anchor = null;
        this.elapsed = 0;
        this.duration = duration;
        this.laps = [];
        this.phase = 'focus';
        this.sessions = 0;
    }

    lap() {
        if (this.running && this.laps.length < 100)
            this.laps.push(this.value);
    }

    finish() {
        if (!this.running || this.value < this.duration)
            return false;
        this.pause();
        this.elapsed = this.duration;
        return true;
    }

    // Each completed interval waits for explicit Start, including after a long sleep.
    nextPhase(focusDuration, breakDuration) {
        if (this.phase === 'focus')
            this.sessions++;
        this.phase = this.phase === 'focus' ? 'break' : 'focus';
        this.duration = this.phase === 'focus' ? focusDuration : breakDuration;
        this.elapsed = 0;
        this.anchor = null;
    }

    snapshot() {
        return {duration: this.duration, elapsed: this.value, laps: this.laps,
            phase: this.phase, sessions: this.sessions};
    }

    restore(saved) {
        if (!saved || !Number.isFinite(saved.elapsed) || saved.elapsed < 0 ||
            saved.elapsed > 31536000000 || !Number.isFinite(saved.duration) ||
            saved.duration < 0 || saved.duration > 86400000)
            return;
        this.duration = saved.duration;
        this.elapsed = saved.elapsed;
        this.anchor = null;
        this.laps = Array.isArray(saved.laps) ? saved.laps.filter(value =>
            Number.isFinite(value) && value >= 0 && value <= this.elapsed).slice(0, 100) : [];
        this.phase = saved.phase === 'break' ? 'break' : 'focus';
        this.sessions = Number.isSafeInteger(saved.sessions) && saved.sessions >= 0 ? saved.sessions : 0;
    }
}
